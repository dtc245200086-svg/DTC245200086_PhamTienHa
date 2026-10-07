const crypto = require('node:crypto');
const { writeLog } = require('./logger');

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
 */
async function recordAudit(dbOrClient, {
  user,
  ip = null,
  module,
  action,
  targetRef = null,
  severity = 'INFO',
  summary,
  metadata = null
}) {
  try {
    const actorId = user?.id || null;
    const actorName = user?.username || 'System';
    const actorRole = user?.role || 'SYSTEM';

    // 1. Get latest hash in chain
    const lastRes = await dbOrClient.query('SELECT hash FROM public.audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = lastRes.rows[0]?.hash || '0'.repeat(64);

    // 2. Prepare payload & timestamp
    const now = new Date();
    const canonicalData = metadata ? JSON.stringify(metadata) : '';
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

    // 3. Insert chained audit record
    await dbOrClient.query(
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
  } catch (err) {
    writeLog('error', 'audit_log_failed', { error: err.message, action, module });
  }
}

module.exports = { recordAudit, computeAuditHash };
