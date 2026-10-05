#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${LOAD_TEST_BASE_URL:-https://localhost}"
ITERATIONS="${LOAD_TEST_ITERATIONS:-3}"
if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD in .env or the process environment}"
[[ "$ITERATIONS" =~ ^[1-9][0-9]*$ ]] || { printf 'LOAD_TEST_ITERATIONS must be a positive integer.\n' >&2; exit 2; }

COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT
STAMP="$(date +%s)"

request() {
  local method="$1" path="$2" body="$3" expected="$4" response status payload
  local -a args=(-k -sS --max-time 20 -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X "$method" -H 'Accept: application/json' -w $'\n%{http_code}')
  if [[ -n "$body" ]]; then args+=(-H 'Content-Type: application/json' --data-binary "$body"); fi
  response="$(curl "${args[@]}" "$BASE_URL$path")"
  status="${response##*$'\n'}"
  payload="${response%$'\n'*}"
  case ",$expected," in *,"$status",*) ;; *) printf '%s %s returned HTTP %s; expected %s.\n' "$method" "$path" "$status" "$expected" >&2; return 1 ;; esac
  printf '%s' "$payload"
}

for ((index = 1; index <= ITERATIONS; index++)); do
  request POST /api/auth/login '{"username":"admin","password":"invalid-load-test-password"}' '401,429' >/dev/null
  if (( index == 1 )); then
    login_body="$(jq -cn --arg password "$ADMIN_PASSWORD" '{username:"admin",password:$password}')"
    request POST /api/auth/login "$login_body" 200 >/dev/null
    request GET /api/auth/me '' 200 >/dev/null
  fi

  customer_name="YC4 LOAD $STAMP $index"
  customer_body="$(printf '{"name":"%s","email":"yc4-load-%s-%s@example.test","phone":"0900000000","address":"YC4 traffic generation","tax_code":"YC4LOAD"}' "$customer_name" "$STAMP" "$index")"
  customer_json="$(request POST /api/customers "$customer_body" 201)"
  customer_id="$(printf '%s' "$customer_json" | jq -r '.customer.id')"
  request GET /api/customers '' 200 >/dev/null
  update_body="$(printf '{"name":"%s updated","email":"yc4-load-%s-%s@example.test","phone":"0900000001","address":"YC4 traffic generation updated","tax_code":"YC4LOAD"}' "$customer_name" "$STAMP" "$index")"
  request PUT "/api/customers/$customer_id" "$update_body" 200 >/dev/null

  invoice_body="$(printf '{"customer_id":%s,"due_date":"2030-12-31","tax_rate":"0.10","items":[{"description":"YC4 load item","quantity":"2","unit_price":"125000.00"}]}' "$customer_id")"
  invoice_json="$(request POST /api/invoices "$invoice_body" 201)"
  invoice_id="$(printf '%s' "$invoice_json" | jq -r '.invoice.id')"
  request POST "/api/invoices/$invoice_id/issue" '{}' 200 >/dev/null
  payment_body="$(printf '{"amount":"50000.00","method":"BANK_TRANSFER","paid_at":"%s","reference":"YC4-LOAD-%s-%s"}' "$(date +%F)" "$STAMP" "$index")"
  request POST "/api/invoices/$invoice_id/payments" "$payment_body" 201 >/dev/null
  request GET /api/yc4-load-test-not-found '' 404 >/dev/null
  printf 'Created YC4 LOAD customer, invoice, and payment set %s/%s.\n' "$index" "$ITERATIONS"
done

public_metrics="$(curl -k -sS -o /dev/null -w '%{http_code}' "$BASE_URL/metrics")"
[[ "$public_metrics" == 404 ]] || { printf 'Public /metrics must return 404; received %s.\n' "$public_metrics" >&2; exit 1; }
printf 'Public /metrics is blocked; generated %s real billing traffic sets.\n' "$ITERATIONS"