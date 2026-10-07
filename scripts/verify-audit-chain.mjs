import assert from 'node:assert/strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const baseUrl = process.env.CP2_BASE_URL || 'https://localhost';
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  throw new Error('ADMIN_PASSWORD is required.');
}

async function verify() {
  const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: adminPassword })
  });

  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'Admin login succeeded');

  const verifyRes = await fetch(`${baseUrl}/api/audit/verify`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });

  const data = await verifyRes.json();
  console.log('Audit Verification Result:');
  console.log(JSON.stringify(data, null, 2));

  assert.equal(data.valid, true, 'Audit chain must be valid');
  assert.equal(data.verified_count, data.total_records, '100% records verified');
  console.log(`\nSUCCESS: 100% Valid Cryptographic Chain over ${data.total_records} audit log records!`);
}

verify().catch(err => {
  console.error(err);
  process.exit(1);
});
