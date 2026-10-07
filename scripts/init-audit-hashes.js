const crypto = require('node:crypto');
const { pool } = require('../app/src/db');

async function initHashes() {
  const rows = (await pool.query('SELECT * FROM public.audit_logs ORDER BY id ASC')).rows;
  let prevHash = '0'.repeat(64);
  for (const r of rows) {
    const canonicalData = r.metadata ? JSON.stringify(r.metadata) : '';
    const ts = new Date(r.timestamp).toISOString();
    const raw = [
      prevHash,
      ts,
      String(r.actor_id || ''),
      String(r.actor_name || ''),
      String(r.module || ''),
      String(r.action || ''),
      String(r.target_ref || ''),
      String(r.severity || ''),
      String(r.summary || ''),
      canonicalData
    ].join('|');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    await pool.query(
      'UPDATE public.audit_logs SET prev_hash = $1, hash = $2, canonical_data = $3 WHERE id = $4',
      [prevHash, hash, canonicalData, r.id]
    );
    prevHash = hash;
  }
  console.log(`Successfully initialized hash chain for ${rows.length} existing audit records.`);
  await pool.end();
}

initHashes().catch(err => {
  console.error(err);
  process.exit(1);
});
