#!/usr/bin/env bash
# Hardening Verification Script (Bash) for Project Billing (YC6 / CP6)
# Tests H1 to H6 controls and reports PASS/FAIL.

set -uo pipefail

failures=0

report_check() {
  local id="$1"
  local name="$2"
  local passed="$3"
  local detail="${4:-}"
  if [ "$passed" -eq 1 ]; then
    echo -e "\033[0;32m[PASS] $id - $name: $detail\033[0m"
  else
    echo -e "\033[0;31m[FAIL] $id - $name: $detail\033[0m"
    failures=$((failures + 1))
  fi
}

echo "===================================================="
echo "     BILLING SYSTEM - HARDENING VERIFICATION (CP6)  "
echo "===================================================="

# Load credentials from .env if present
db_app_pass="${BILLING_APP_PASSWORD:-}"
db_ro_pass="${BILLING_READONLY_PASSWORD:-}"
db_pg_pass="${POSTGRES_PASSWORD:-}"

if [ -f .env ]; then
  if [ -z "$db_app_pass" ]; then db_app_pass=$(grep '^BILLING_APP_PASSWORD=' .env | cut -d= -f2- | tr -d '\r'); fi
  if [ -z "$db_ro_pass" ]; then db_ro_pass=$(grep '^BILLING_READONLY_PASSWORD=' .env | cut -d= -f2- | tr -d '\r'); fi
  if [ -z "$db_pg_pass" ]; then db_pg_pass=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2- | tr -d '\r'); fi
fi

# --- H1: Non-root container runtime ---
web_id=$(docker compose exec -T web id 2>/dev/null || true)
if echo "$web_id" | grep -q 'uid=1000(node)'; then
  report_check "H1.1" "Web container runs as non-root user (node:1000)" 1 "$web_id"
else
  report_check "H1.1" "Web container runs as non-root user (node:1000)" 0 "$web_id"
fi

pg_top=$(docker compose top postgres 2>/dev/null || true)
pg_count=$(echo "$pg_top" | grep -c 'postgres.*999' || true)
if [ "$pg_count" -gt 0 ]; then
  report_check "H1.2" "PostgreSQL server processes run as non-root (UID 999/postgres)" 1 "Processes inspected: $pg_count"
else
  report_check "H1.2" "PostgreSQL server processes run as non-root (UID 999/postgres)" 0 "Processes inspected: $pg_count"
fi

nginx_id=$(docker compose exec -T nginx id 2>/dev/null || true)
if echo "$nginx_id" | grep -q 'uid=101'; then
  report_check "H1.3" "Nginx container runs as unprivileged (UID 101)" 1 "$nginx_id"
else
  report_check "H1.3" "Nginx container runs as unprivileged (UID 101)" 0 "$nginx_id"
fi

grafana_id=$(docker compose exec -T grafana id 2>/dev/null || true)
if echo "$grafana_id" | grep -q 'uid=472'; then
  report_check "H1.4" "Grafana container runs as non-root (UID 472)" 1 "$grafana_id"
else
  report_check "H1.4" "Grafana container runs as non-root (UID 472)" 0 "$grafana_id"
fi

prom_id=$(docker compose exec -T prometheus id 2>/dev/null || true)
if echo "$prom_id" | grep -q 'uid=65534'; then
  report_check "H1.5" "Prometheus container runs as nobody (UID 65534)" 1 "$prom_id"
else
  report_check "H1.5" "Prometheus container runs as nobody (UID 65534)" 0 "$prom_id"
fi

loki_user=$(docker inspect billing-loki-1 --format '{{.Config.User}}' 2>/dev/null || true)
if [ "$loki_user" = "10001" ]; then
  report_check "H1.6" "Loki container configured as non-root (UID 10001)" 1 "User: $loki_user"
else
  report_check "H1.6" "Loki container configured as non-root (UID 10001)" 0 "User: $loki_user"
fi

cadvisor_priv=$(docker inspect billing-cadvisor-1 --format '{{.HostConfig.Privileged}}' 2>/dev/null || true)
if [ "$cadvisor_priv" = "true" ]; then
  report_check "H1.7" "cAdvisor documented privileged exception" 1 "Privileged: true (Documented Exception)"
else
  report_check "H1.7" "cAdvisor documented privileged exception" 0 "Privileged: $cadvisor_priv"
fi

# --- H2: Network isolation & membership ---
nets=$(docker network ls --filter "name=billing_" --format "{{.Name}}")
if echo "$nets" | grep -q "billing_edge_net" && echo "$nets" | grep -q "billing_admin_net" && echo "$nets" | grep -q "billing_app_net" && echo "$nets" | grep -q "billing_db_net" && echo "$nets" | grep -q "billing_monitoring_net"; then
  report_check "H2.1" "All 5 dedicated networks exist" 1 "All 5 networks found"
else
  report_check "H2.1" "All 5 dedicated networks exist" 0 "Missing one or more networks"
fi

app_int=$(docker network inspect billing_app_net --format '{{.Internal}}' 2>/dev/null || true)
db_int=$(docker network inspect billing_db_net --format '{{.Internal}}' 2>/dev/null || true)
mon_int=$(docker network inspect billing_monitoring_net --format '{{.Internal}}' 2>/dev/null || true)
edge_int=$(docker network inspect billing_edge_net --format '{{.Internal}}' 2>/dev/null || true)
admin_int=$(docker network inspect billing_admin_net --format '{{.Internal}}' 2>/dev/null || true)

if [ "$app_int" = "true" ] && [ "$db_int" = "true" ] && [ "$mon_int" = "true" ] && [ "$edge_int" = "false" ] && [ "$admin_int" = "false" ]; then
  report_check "H2.2" "Network internal flags match design" 1 "app_net, db_net, monitoring_net are internal: true"
else
  report_check "H2.2" "Network internal flags match design" 0 "Mismatch in internal flags"
fi

db_members=$(docker network inspect billing_db_net --format '{{range $k, $v := .Containers}}{{$v.Name}} {{end}}' 2>/dev/null || true)
if echo "$db_members" | grep -q "billing-postgres-1" && ! echo "$db_members" | grep -q "billing-nginx-1"; then
  report_check "H2.3" "Postgres in db_net and Nginx isolated from db_net" 1 "db_net members: $db_members"
else
  report_check "H2.3" "Postgres in db_net and Nginx isolated from db_net" 0 "db_net members: $db_members"
fi

# --- H3: Credentials & Secrets ---
tracked_env=$(git ls-files .env 2>/dev/null || true)
if [ -z "$tracked_env" ]; then
  report_check "H3.1" "Secret .env file is NOT tracked by Git" 1 "git ls-files .env is empty"
else
  report_check "H3.1" "Secret .env file is NOT tracked by Git" 0 "tracked: $tracked_env"
fi

example_tracked=$(git ls-files .env.example 2>/dev/null || true)
if [ "$example_tracked" = ".env.example" ]; then
  report_check "H3.2" "Template .env.example IS tracked by Git" 1 "tracked: $example_tracked"
else
  report_check "H3.2" "Template .env.example IS tracked by Git" 0 "tracked: $example_tracked"
fi

grafana_auth=$(curl -s -o /dev/null -w "%{http_code}" -u "admin:admin" http://127.0.0.1:3000/api/org 2>/dev/null || true)
if [ "$grafana_auth" = "401" ]; then
  report_check "H3.3" "Default Grafana credential (admin/admin) is rejected" 1 "Status: 401"
else
  report_check "H3.3" "Default Grafana credential (admin/admin) is rejected" 0 "Status: $grafana_auth"
fi

# --- H4: Database Least Privilege ---
drop_out=$(docker compose exec -T -e PGPASSWORD="$db_app_pass" postgres psql -h 127.0.0.1 -U billing_app -d billing -c "DROP TABLE payments;" 2>&1 || true)
if echo "$drop_out" | grep -q 'ERROR:.*must be owner of table payments'; then
  report_check "H4.1" "billing_app cannot DROP TABLE" 1 "Operation rejected as expected"
else
  report_check "H4.1" "billing_app cannot DROP TABLE" 0 "$drop_out"
fi

update_out=$(docker compose exec -T -e PGPASSWORD="$db_app_pass" postgres psql -h 127.0.0.1 -U billing_app -d billing -c "UPDATE payments SET amount = 1;" 2>&1 || true)
if echo "$update_out" | grep -q 'ERROR:.*permission denied for table payments'; then
  report_check "H4.2" "billing_app cannot UPDATE payments (append-only enforced)" 1 "Operation rejected as expected"
else
  report_check "H4.2" "billing_app cannot UPDATE payments (append-only enforced)" 0 "$update_out"
fi

delete_out=$(docker compose exec -T -e PGPASSWORD="$db_app_pass" postgres psql -h 127.0.0.1 -U billing_app -d billing -c "DELETE FROM payments;" 2>&1 || true)
if echo "$delete_out" | grep -q 'ERROR:.*permission denied for table payments'; then
  report_check "H4.3" "billing_app cannot DELETE payments" 1 "Operation rejected as expected"
else
  report_check "H4.3" "billing_app cannot DELETE payments" 0 "$delete_out"
fi

select_out=$(docker compose exec -T -e PGPASSWORD="$db_ro_pass" postgres psql -h 127.0.0.1 -U billing_readonly -d billing -c "SELECT count(*) FROM invoices;" 2>&1 || true)
if echo "$select_out" | grep -q '(1 row)'; then
  report_check "H4.4" "billing_readonly can SELECT invoices" 1 "SELECT query successful"
else
  report_check "H4.4" "billing_readonly can SELECT invoices" 0 "$select_out"
fi

insert_out=$(docker compose exec -T -e PGPASSWORD="$db_ro_pass" postgres psql -h 127.0.0.1 -U billing_readonly -d billing -c "INSERT INTO customers (name, email) VALUES ('x','x@x.com');" 2>&1 || true)
if echo "$insert_out" | grep -q 'ERROR:.*permission denied for table customers'; then
  report_check "H4.5" "billing_readonly cannot INSERT into customers" 1 "Operation rejected as expected"
else
  report_check "H4.5" "billing_readonly cannot INSERT into customers" 0 "$insert_out"
fi

users_out=$(docker compose exec -T -e PGPASSWORD="$db_ro_pass" postgres psql -h 127.0.0.1 -U billing_readonly -d billing -c "SELECT * FROM users;" 2>&1 || true)
if echo "$users_out" | grep -q 'ERROR:.*permission denied for table users'; then
  report_check "H4.6" "billing_readonly cannot access users auth table" 1 "Operation rejected as expected"
else
  report_check "H4.6" "billing_readonly cannot access users auth table" 0 "$users_out"
fi

exp_out=$(docker compose exec -T -e PGPASSWORD="$db_pg_pass" postgres psql -h 127.0.0.1 -U postgres -d billing -c "SELECT r.rolname, m.rolname AS memberof FROM pg_roles r JOIN pg_auth_members a ON r.oid = a.member JOIN pg_roles m ON a.roleid = m.oid WHERE r.rolname = 'exporter';" 2>&1 || true)
if echo "$exp_out" | grep -q 'exporter.*pg_monitor'; then
  report_check "H4.7" "exporter role belongs to pg_monitor" 1 "Role confirmed in pg_monitor"
else
  report_check "H4.7" "exporter role belongs to pg_monitor" 0 "$exp_out"
fi

# --- H5: Security headers & TLS ---
header_out=$(curl -k -s -I https://localhost 2>&1 || true)
if echo "$header_out" | grep -qi "Strict-Transport-Security: max-age=86400" && \
   echo "$header_out" | grep -qi "X-Content-Type-Options: nosniff" && \
   echo "$header_out" | grep -qi "X-Frame-Options: DENY" && \
   echo "$header_out" | grep -qi "Referrer-Policy: strict-origin-when-cross-origin" && \
   echo "$header_out" | grep -qi "Permissions-Policy: camera=()" && \
   echo "$header_out" | grep -qi "Content-Security-Policy: default-src"; then
  report_check "H5.1" "All 6 security headers present" 1 "HSTS, nosniff, DENY, Referrer, Permissions, CSP"
else
  report_check "H5.1" "All 6 security headers present" 0 "Missing one or more security headers"
fi

if echo "$header_out" | grep -q "^Server: nginx$"; then
  report_check "H5.2" "Nginx version token hidden (server_tokens off)" 1 "Server header has no version"
else
  report_check "H5.2" "Nginx version token hidden (server_tokens off)" 0 "Server header exposed or missing"
fi

# --- H6: Port exposure ---
web_ports=$(docker ps --filter "name=billing-web-1" --format "{{.Ports}}")
if echo "$web_ports" | grep -q -- '->'; then
  report_check "H6.1" "web container internal port 3000 is NOT published" 0 "Port published: $web_ports"
else
  report_check "H6.1" "web container internal port 3000 is NOT published" 1 "Internal port only"
fi

pg_ports=$(docker ps --filter "name=billing-postgres-1" --format "{{.Ports}}")
if echo "$pg_ports" | grep -q -- '->'; then
  report_check "H6.2" "postgres container internal port 5432 is NOT published" 0 "Port published: $pg_ports"
else
  report_check "H6.2" "postgres container internal port 5432 is NOT published" 1 "Internal port only"
fi

echo "===================================================="
if [ "$failures" -eq 0 ]; then
  echo -e "\033[0;32mHARDENING VERIFICATION PASSED (All H1-H6 checks OK)\033[0m"
  exit 0
else
  echo -e "\033[0;31mHARDENING VERIFICATION FAILED ($failures failures)\033[0m"
  exit 1
fi
