const crypto = require('node:crypto');
const { writeLog } = require('./logger');
const { inTransaction } = require('./db');

const AUDIT_CHAIN_LOCK_KEY = '4776472477610091604'; // ASCII 'BILLAUDT' (0x42494c4c41554454)

function computeAuditHash({ prevHash, timestamp, actorId, actorName, module, action, targetRef, severity, summary, canonicalData }) {
  const ts = timestamp instanceof Date ? timestamp.toISOString() : new Date(timestamp).toISOString();
  const raw = [
    prevHash || '0'.repeat(64),
    ts,
    String(actorId || ''),
    String(actorName || ''),
    String(module || ''),
    String(action || ''),
    String(targetRef || ''),
    String(severity || ''),
    String(summary || ''),
    canonicalData || ''
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Record an immutable business audit trail entry into public.audit_logs with cryptographic SHA-256 chaining.
 * Guarantees transaction-level serialization via PostgreSQL advisory xact lock to prevent concurrent hash forks.
 */
async function recordAudit(dbOrClient, {
  user,
  ip = null,
  module,
  action,
  targetRef = null,
  severity = 'INFO',
  summary,
  metadata = null,
  throwOnError = false
}) {
  const isTransactionClient = dbOrClient && typeof dbOrClient.query === 'function' && typeof dbOrClient.release === 'function';

  const executeRecord = async (client) => {
    // 1. Transaction-level serialization: guarantees zero concurrent forks across sessions/processes
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [AUDIT_CHAIN_LOCK_KEY]);

    // 2. Read latest committed hash in chain
    const lastRes = await client.query('SELECT hash FROM public.audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = lastRes.rows[0]?.hash || '0'.repeat(64);

    // 3. Prepare payload & timestamp
    const now = new Date();
    const canonicalData = metadata ? JSON.stringify(metadata) : '';
    const actorId = user?.id || null;
    const actorName = user?.username || 'System';
    const actorRole = user?.role || 'SYSTEM';

    const hash = computeAuditHash({
      prevHash,
      timestamp: now,
      actorId,
      actorName,
      module,
      action,
      targetRef,
      severity,
      summary,
      canonicalData
    });

    // 4. Insert chained audit record
    await client.query(
      `INSERT INTO public.audit_logs
        (timestamp, actor_id, actor_name, actor_role, ip_address, module, action, target_ref,
         severity, summary, metadata, prev_hash, hash, entity_type, entity_id, canonical_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        now,
        actorId,
        actorName,
        actorRole,
        ip,
        module,
        action,
        targetRef,
        severity,
        summary,
        metadata ? JSON.stringify(metadata) : null,
        prevHash,
        hash,
        module,
        targetRef,
        canonicalData
      ]
    );

    writeLog('info', `audit.${action.toLowerCase()}`, {
      module,
      action,
      target_ref: targetRef,
      actor: actorName,
      severity,
      hash_short: hash.slice(0, 16)
    });

    return hash;
  };

  try {
    if (isTransactionClient) {
      return await executeRecord(dbOrClient);
    } else {
      // Standalone execution: wrap in dedicated transaction to guarantee lock acquisition & serialization
      return await inTransaction(async (client) => {
        return await executeRecord(client);
      });
    }
  } catch (err) {
    writeLog('error', 'audit_log_failed', { error: err.message, action, module });
    if (throwOnError || isTransactionClient) throw err;
  }
}

module.exports = { recordAudit, computeAuditHash, AUDIT_CHAIN_LOCK_KEY };
