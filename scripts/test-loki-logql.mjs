import { execSync } from 'node:child_process';

const queries = [
  '{service="web"} | json | msg="auth.login_failed"',
  '{service="nginx"} | json | status >= 400',
  '{service="web"} | json | msg=~"invoice.created|payment.recorded"'
];

console.log('Testing Loki LogQL Queries via Grafana Container...');

for (const q of queries) {
  const enc = encodeURIComponent(q);
  const out = execSync(`docker compose exec -T grafana curl -s "http://loki:3100/loki/api/v1/query_range?query=${enc}"`, { encoding: 'utf8' });
  const json = JSON.parse(out);
  const streamCount = json.data?.result?.length || 0;
  const entryCount = json.data?.result?.reduce((s, r) => s + r.values.length, 0) || 0;
  console.log(`[PASS] Query: ${q}`);
  console.log(`       Result: ${streamCount} stream(s), ${entryCount} log entry/entries returned.`);
}
