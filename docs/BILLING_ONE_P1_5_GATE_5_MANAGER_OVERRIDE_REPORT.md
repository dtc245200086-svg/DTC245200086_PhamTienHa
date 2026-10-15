# BILLING_ONE — P1.5 GATE 5 MANAGER OVERRIDE FORENSIC REPORT

**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Gate:** Gate 5 — Manager Override Endpoint (`POST /api/invoices/:id/issue-override`)  
**Status:** PASS  
**Timestamp:** 2026-10-07T23:10:00+07:00  
**Baseline Git Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d`  

---

## 1. Objective

The objective of Gate 5 is to implement and forensically verify the manager override endpoint:
```http
POST /api/invoices/:id/issue-override
```
This endpoint permits authorized personnel (`admin` or `ROLE_BILLING_MANAGER`) to issue a single `DRAFT` invoice even when:
1. The customer status is `LOCKED`;
2. The projected debt breaches the customer's positive credit limit ($D_{prior} + total > L_{credit}$).

The override enforces strict authorization, mandatory business justification ($\ge 10$ characters), mandatory header-scoped idempotency, exact financial precision arithmetic, strict global hierarchical lock ordering, atomic single-transaction execution, and cryptographic audit log emission while ensuring customer profile attributes remain 100% immutable.

---

## 2. Scope Boundary

### Approved Gate 5 Scope:
- Implement `POST /api/invoices/:id/issue-override` with `requireAuth` and `requirePermission('invoice.issue_override')`.
- Validate mandatory request header `Idempotency-Key` (max 255 chars).
- Validate mandatory request body `{ "override_reason": "..." }` ($\ge 10$ trimmed chars).
- Reuse `public.payment_idempotency_keys` with namespaced key `inv_override:<key>`.
- Calculate live non-enforcing credit snapshot via `CustomerCreditService.getInvoiceCreditSnapshot()` inside transaction.
- Update target invoice to `ISSUED` status, generate sequential invoice number, and record `INVOICE_ISSUE_OVERRIDDEN` audit event atomically inside the transaction.
- Create Gate 5 targeted test suite `scripts/p1_5-gate5-manager-override-test.mjs` verifying scenarios T01–T25.

### Prohibited / Out-of-Scope (Strictly Enforced):
- ❌ DO NOT implement `POST /api/customers/:id/unlock` (Deferred to Gate 6).
- ❌ DO NOT implement customer risk scanner or scheduler modifications (Deferred to Gate 7).
- ❌ DO NOT implement frontend override UI (Deferred to Gate 9).
- ❌ DO NOT modify `app/src/services/paymentService.js`.
- ❌ DO NOT alter CP2 payment concurrency or repair CP2 pre-existing deadlock.
- ❌ DO NOT create new migrations (Migration 09) as existing schema objects suffice.
- ❌ DO NOT execute Gate 6 automatically.

---

## 3. Pre-Implementation State

Prior to implementation, forensic checks confirmed:
1. **Permission Check:** `invoice.issue_override` was already present in `public.permissions` (id: 15).
2. **Role Mapping:**
   - `admin` (role_id: 1) has `invoice.issue_override`.
   - `ROLE_BILLING_MANAGER` (role_id: 3) has `invoice.issue_override`.
   - `staff` (role_id: 2), `ROLE_ACCOUNTANT` (role_id: 4), `ROLE_AUDITOR` (role_id: 5) DO NOT have `invoice.issue_override`.
3. **Idempotency Schema:** `public.payment_idempotency_keys` exists with `idempotency_key VARCHAR(255) UNIQUE`, `request_hash VARCHAR(64)`, `payment_id BIGINT NULL`, `response_status INT DEFAULT 201`, `response_body JSONB`, `created_by BIGINT`.
4. **Audit Infrastructure:** `recordAudit(client, { throwOnError: true })` supports transactional PostgreSQL clients, ensuring atomic rollback on audit failure.
5. **Existing Migration State:** Migration 08 (`08_p1_5_credit_risk_control.sql`) applied and consistent.

---

## 4. Endpoint Contract

### Request:
```http
POST /api/invoices/:id/issue-override HTTP/1.1
Host: localhost
Idempotency-Key: <unique-uuid-or-token>
Content-Type: application/json

{
  "override_reason": "Ban Giám đốc duyệt bảo lãnh thanh toán vượt hạn mức theo hợp đồng HĐ-2026-08"
}
```

### Validation Rules:
- **Authentication:** Valid session cookie required (`requireAuth`). Failure $\to$ HTTP 401 `UNAUTHENTICATED`.
- **Authorization:** `requirePermission('invoice.issue_override')`. Failure $\to$ HTTP 403 `FORBIDDEN`.
- **Idempotency-Key:** Header mandatory, non-empty, max 255 chars.
  - Missing/empty: HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`.
  - Length > 255: HTTP 400 `INVALID_IDEMPOTENCY_KEY`.
- **Request Body:** Must be object with `override_reason` string.
  - Missing/non-string: HTTP 400 `OVERRIDE_REASON_REQUIRED`.
  - Trimmed length < 10 chars: HTTP 400 `OVERRIDE_REASON_REQUIRED`.
- **Invoice State:** Target invoice must exist (HTTP 404 `INVOICE_NOT_FOUND`) and have status `DRAFT` (HTTP 409 `INVOICE_NOT_DRAFT`).
- **Basic Invoice Integrity:**
  - Must have $\ge 1$ items (HTTP 409 `INVOICE_REQUIRES_ITEM`).
  - Total must be $> 0$ (HTTP 409 `INVOICE_TOTAL_MUST_BE_POSITIVE`).
  - Due date must be valid ($\ge \text{current\_date}$) (HTTP 409 `INVOICE_DUE_DATE_INVALID`).

### Successful Response (Fresh):
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "invoice": {
    "id": 1052,
    "invoice_no": "INV-2026-000452",
    "customer_id": 142,
    "status": "ISSUED",
    "total": "12000000.00",
    ...
  },
  "is_idempotent_replay": false
}
```

### Successful Response (Replay):
```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "invoice": { ... },
  "is_idempotent_replay": true
}
```

---

## 5. Authorization Matrix

| Role | Permission `invoice.issue_override` | Endpoint Outcome | Status Code | Error Code |
| :--- | :--- | :--- | :--- | :--- |
| **Anonymous** | N/A | DENIED | HTTP 401 | `UNAUTHENTICATED` |
| **staff** | No | DENIED | HTTP 403 | `FORBIDDEN` |
| **ROLE_ACCOUNTANT** | No | DENIED | HTTP 403 | `FORBIDDEN` |
| **ROLE_AUDITOR** | No | DENIED | HTTP 403 | `FORBIDDEN` |
| **admin** | Yes | ALLOWED | HTTP 200 | N/A |
| **ROLE_BILLING_MANAGER** | Yes | ALLOWED | HTTP 200 | N/A |

---

## 6. Idempotency Design

- **Storage Table:** `public.payment_idempotency_keys`
- **Key Namespacing:** `inv_override:<cleanIdempotencyKey>`. If length exceeds 240 characters, a deterministic SHA-256 hash namespace `inv_override:h_<sha256>` is used to prevent `VARCHAR(255)` overflow.
- **Request Fingerprint:** Deterministic SHA-256 hash over canonical payload:
  ```json
  {
    "action": "INVOICE_ISSUE_OVERRIDE",
    "invoice_id": "<id>",
    "override_reason": "<trimmed_reason>"
  }
  ```
- **Replay Behavior:**
  - Identical Key + Matching Fingerprint $\to$ HTTP 200, cached invoice payload, `is_idempotent_replay: true`, 0 database mutations, 0 duplicate audit events.
  - Identical Key + Different Fingerprint $\to$ HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`, 0 mutations, 0 audits.

---

## 7. Transaction Lock Order (Global DAG Compliance)

To guarantee freedom from PostgreSQL deadlocks (`40P01`), Gate 5 strictly adheres to the Global Lock Graph hierarchy:

```
Level 0: Advisory Lock
         SELECT pg_advisory_xact_lock(hashtext('idemp_override'), hashtext($namespacedKey));
                ↓
Level 1: Target Invoice Row Lock
         SELECT ... FROM public.invoices WHERE id = $1 FOR UPDATE;
                ↓
Level 2: Target Customer Row Lock
         SELECT ... FROM public.customers WHERE id = $1 FOR UPDATE;
```

- **Level 0 Advisory Lock:** Serializes concurrent requests presenting the exact same idempotency key.
- **Level 1 Invoice Lock:** Serializes concurrent requests presenting different idempotency keys for the same invoice. The first commits issuance; the second safely reads `status = 'ISSUED'` and rejects with HTTP 409 `INVOICE_NOT_DRAFT`.
- **Level 2 Customer Lock:** Synchronizes credit calculation with concurrent payment settlements or limit edits.
- **Deadlock Inversion Risk:** Zero, because both standard issue (`POST /api/invoices/:id/issue`) and override acquire Level 1 (Invoice) before Level 2 (Customer).

---

## 8. Override Financial Semantics

The override executes a non-enforcing credit snapshot via `CustomerCreditService.getInvoiceCreditSnapshot()`:
1. Locks customer row `FOR UPDATE`.
2. Computes live open debt $D_{prior}$ across `ISSUED`, `PARTIALLY_PAID`, and `OVERDUE` invoices via deterministic BigInt cents arithmetic.
3. Computes projected debt $D_{projected} = D_{prior} + \text{invoice\_total}$.
4. Computes amount over limit:
   $$\text{amount\_over\_limit} = \begin{cases} \max(D_{projected} - L_{credit}, 0) & \text{if } L_{credit} > 0 \\ 0.00 & \text{if } L_{credit} = 0 \text{ (unlimited)} \end{cases}$$
5. All monetary calculations are handled in exact BigInt integer cents and rendered as two-decimal string representations (e.g. `'50000000.00'`). Zero floating-point math is used.
6. **Customer Profile Immutability:** Customer fields (`status`, `credit_limit`, `lock_source`, `locked_at`, `lock_reason`) remain 100% unaltered.

---

## 9. Audit Event Schema

On successful override, exactly one audit record is created atomically inside the transaction:

- **Action:** `INVOICE_ISSUE_OVERRIDDEN`
- **Module:** `invoices`
- **Severity:** `WARNING`
- **Target Ref:** `updatedInvoice.invoice_no`
- **Summary:** `Phát hành đặc cách hóa đơn ${invoice_no} vượt hạn mức tín dụng/khóa công nợ`
- **Mandatory 12 Metadata Fields:**
  ```json
  {
    "invoice_id": 1052,
    "invoice_no": "INV-2026-000452",
    "customer_id": 142,
    "customer_name": "Công ty Cổ phần Alpha",
    "customer_status": "LOCKED",
    "credit_limit": "50000000.00",
    "current_debt": "45000000.00",
    "invoice_total": "12000000.00",
    "projected_debt": "57000000.00",
    "amount_over_limit": "7000000.00",
    "override_reason": "Ban Giám đốc duyệt bảo lãnh thanh toán vượt hạn mức",
    "idempotency_key": "override-key-uuid-12345"
  }
  ```
- **Atomicity:** Recorded using `recordAudit(client, { throwOnError: true })` inside the database transaction. If audit insertion fails, the entire transaction rolls back.

---

## 10. Test Matrix (`scripts/p1_5-gate5-manager-override-test.mjs`)

| Test ID | Category | Scenario Description | Expected Outcome | Actual Outcome | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **T01** | Auth | Unauthenticated caller | HTTP 401 | HTTP 401 | **PASS** |
| **T02** | RBAC | `staff` attempts override | HTTP 403 `FORBIDDEN` | HTTP 403 `FORBIDDEN` | **PASS** |
| **T03** | RBAC | `ROLE_ACCOUNTANT` attempts override | HTTP 403 `FORBIDDEN` | HTTP 403 `FORBIDDEN` | **PASS** |
| **T04** | RBAC | `ROLE_AUDITOR` attempts override | HTTP 403 `FORBIDDEN` | HTTP 403 `FORBIDDEN` | **PASS** |
| **T05** | RBAC | `admin` with valid reason + key | HTTP 200 + ISSUED | HTTP 200 + ISSUED | **PASS** |
| **T06** | RBAC | `ROLE_BILLING_MANAGER` with valid reason + key | HTTP 200 + ISSUED | HTTP 200 + ISSUED | **PASS** |
| **T07** | Request | Missing `override_reason` | HTTP 400 `OVERRIDE_REASON_REQUIRED` | HTTP 400 `OVERRIDE_REASON_REQUIRED` | **PASS** |
| **T08** | Request | Whitespace/short reason < 10 chars | HTTP 400 `OVERRIDE_REASON_REQUIRED` | HTTP 400 `OVERRIDE_REASON_REQUIRED` | **PASS** |
| **T09** | Request | Missing `Idempotency-Key` header | HTTP 400 `IDEMPOTENCY_KEY_REQUIRED` | HTTP 400 `IDEMPOTENCY_KEY_REQUIRED` | **PASS** |
| **T10** | Request | `Idempotency-Key` > 255 chars | HTTP 400 `INVALID_IDEMPOTENCY_KEY` | HTTP 400 `INVALID_IDEMPOTENCY_KEY` | **PASS** |
| **T11** | Business | Override credit-limit breach | HTTP 200 + ISSUED + `INVOICE_ISSUE_OVERRIDDEN` | HTTP 200 + ISSUED + Audit log | **PASS** |
| **T12** | Business | Override `LOCKED` customer | HTTP 200 + ISSUED + Customer still `LOCKED` | HTTP 200 + Customer `LOCKED` | **PASS** |
| **T13** | Isolation | Override does not alter `credit_limit` | DB limit unchanged | 100% unchanged | **PASS** |
| **T14** | Isolation | Override does not alter lock metadata | `lock_source`, `locked_at`, `lock_reason` preserved | 100% preserved | **PASS** |
| **T15** | Audit | Audit metadata contains all 12 mandatory fields | 12 fields exact match | 12 fields verified | **PASS** |
| **T16** | Idempotency | Replay identical request with same key | HTTP 200 + `is_idempotent_replay: true` + 0 duplicate audits | HTTP 200 + Replay + 0 dup audit | **PASS** |
| **T17** | Idempotency | Same key + modified `override_reason` | HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | **PASS** |
| **T18** | Integrity | Invoice not found | HTTP 404 `INVOICE_NOT_FOUND` | HTTP 404 `INVOICE_NOT_FOUND` | **PASS** |
| **T19** | Integrity | Invoice status != `DRAFT` | HTTP 409 `INVOICE_NOT_DRAFT` | HTTP 409 `INVOICE_NOT_DRAFT` | **PASS** |
| **T20** | Integrity | `DRAFT` invoice with no line items | HTTP 409 `INVOICE_REQUIRES_ITEM` + 0 audits | HTTP 409 + 0 audits | **PASS** |
| **T21** | Integrity | Zero/negative invoice total | HTTP 409 `INVOICE_TOTAL_MUST_BE_POSITIVE` + 0 audits | HTTP 409 + 0 audits | **PASS** |
| **T22** | Integrity | Invalid due date (past date) | HTTP 409 `INVOICE_DUE_DATE_INVALID` + 0 audits | HTTP 409 + 0 audits | **PASS** |
| **T23** | Concurrency | 2 concurrent requests with SAME key | 1 success + 1 replay + 1 audit + 0 deadlocks | 1 success + 1 replay + 0 deadlocks | **PASS** |
| **T24** | Concurrency | 2 concurrent requests targeting SAME invoice | 1 success + 1 `INVOICE_NOT_DRAFT` + 0 deadlocks | 1 success + 1 `INVOICE_NOT_DRAFT` + 0 deadlocks | **PASS** |
| **T25** | Precision | Preserves exact financial snapshot | Exact debt, limit, total, projected, over-limit string values | Exact decimals verified | **PASS** |

---

## 11. Concurrency Verification Results

Under concurrent execution testing (T23 and T24):
- **PostgreSQL 40P01 Deadlocks:** 0
- **Duplicate Successful Invoice Issuances:** 0
- **Duplicate Override Audit Events:** 0
- **Race Condition Handling:**
  - T23: Request 1 acquired Level 0 advisory lock, performed issuance, committed. Request 2 unblocked, recognized cached key, returned idempotent replay with 0 database mutation.
  - T24: Competitive requests with distinct keys serialized on Level 1 invoice row lock. Winner issued invoice; loser unblocked, observed `status = 'ISSUED'`, and failed safely with HTTP 409 `INVOICE_NOT_DRAFT`.

---

## 12. Regression Test Results

| Test Suite | Purpose | Tests Run | Result |
| :--- | :--- | :--- | :--- |
| `scripts/p1_5-domain-service-test.mjs` | Gate 2 Customer Credit Domain Service | 18 / 18 | **PASS** (100%) |
| `scripts/p1_5-gate3-rbac-issue-test.mjs` | Gate 3 RBAC & Normal Invoice Issue | 13 / 13 | **PASS** (100%) |
| `scripts/p1_5-gate4-customer-hardening-test.mjs` | Gate 4 Customer Profile Status Hardening | 16 / 16 | **PASS** (100%) |
| `scripts/p1_5-gate5-manager-override-test.mjs` | Gate 5 Manager Override Endpoint | 25 / 25 | **PASS** (100%) |
| `scripts/cp2-smoke.mjs` | Inherited Milestone P1.2 Core Integration | 15 / 15 | **PASS** (100%) |

---

## 13. Audit Chain Cryptographic Verification

Audit chain verification executed via `scripts/verify-audit-chain.mjs`:
- **Total Audit Records Verified:** 7,335
- **Verified Valid Records:** 7,335
- **Broken Hashes:** 0
- **Verification Status:** `valid: true` (100% cryptographic SHA-256 chain integrity verified)

---

## 14. Known Carry-Forward CP2 Exception

As documented since Gate 0:
- **Exception ID:** `CP2 40P01` high-frequency payment race.
- **Root Cause:** Pre-existing P1.2 payment concurrency defect in `paymentService.js` under heavy concurrent allocation contention.
- **Preservation Directive:** In accordance with P1.5 guidelines, `paymentService.js` was NOT modified. No new CP2 failures or regressions were introduced.

---

## 15. Files Modified

1. `app/src/services/customerCreditService.js`:
   - Added `CustomerCreditService.getInvoiceCreditSnapshot(client, { customerId, invoiceTotal })` to acquire customer row lock `FOR UPDATE` and compute live debt/credit snapshot without enforcing the normal issue rejection gate.
2. `app/src/routes/invoices.js`:
   - Added `extractOverrideIdempotencyKey`, `validateOverrideReason`, `computeOverrideRequestFingerprint`.
   - Refactored `validateDraftInvoiceIntegrity` and `generateNextInvoiceNumber` as clean shared helpers.
   - Refactored `loadInvoice` to execute subqueries sequentially so it functions reliably with both pool and transaction clients.
   - Implemented `POST /api/invoices/:id/issue-override` with Level 0/1/2 lock hierarchy, replay caching, and atomic `INVOICE_ISSUE_OVERRIDDEN` audit logging.
3. `scripts/p1_5-gate5-manager-override-test.mjs`:
   - Created comprehensive targeted test suite covering scenarios T01–T25.

---

## 16. Files Intentionally Untouched

- `app/src/services/paymentService.js` (Preserved intact; zero modifications)
- `app/src/scheduler.js` (Preserved; Gate 7 scope)
- `app/src/routes/customers.js` (Preserved; Gate 6 `/unlock` scope)
- `db/migrations/` (No new migrations created; schema remains clean and consistent)
- Frontend client files (Preserved; Gate 9 scope)

---

## 17. Final Acceptance Matrix

| Criterion | Requirement | Status |
| :--- | :--- | :--- |
| 1 | Endpoint `POST /api/invoices/:id/issue-override` exists | **PASS** |
| 2 | Authentication enforced | **PASS** |
| 3 | `invoice.issue_override` permission enforced | **PASS** |
| 4 | `admin` allowed | **PASS** |
| 5 | `ROLE_BILLING_MANAGER` allowed | **PASS** |
| 6 | `staff` denied (HTTP 403) | **PASS** |
| 7 | `ROLE_ACCOUNTANT` denied (HTTP 403) | **PASS** |
| 8 | `ROLE_AUDITOR` denied (HTTP 403) | **PASS** |
| 9 | `override_reason` mandatory and $\ge 10$ chars | **PASS** |
| 10 | `Idempotency-Key` mandatory | **PASS** |
| 11 | Idempotency fingerprint implemented | **PASS** |
| 12 | Same key + same payload replays safely | **PASS** |
| 13 | Same key + different payload returns mismatch (409) | **PASS** |
| 14 | Idempotency advisory lock (Level 0) used | **PASS** |
| 15 | Invoice lock (Level 1) acquired before customer lock (Level 2) | **PASS** |
| 16 | Basic invoice validity checks remain enforced | **PASS** |
| 17 | `LOCKED` customer can be overridden | **PASS** |
| 18 | Credit-limit breach can be overridden | **PASS** |
| 19 | `customer.status` remains unchanged | **PASS** |
| 20 | `customer.credit_limit` remains unchanged | **PASS** |
| 21 | Lock metadata (`lock_source`, `locked_at`, `lock_reason`) unchanged | **PASS** |
| 22 | Invoice becomes `ISSUED` exactly once | **PASS** |
| 23 | Invoice numbering remains sequential and correct | **PASS** |
| 24 | Exactly one `INVOICE_ISSUE_OVERRIDDEN` audit on success | **PASS** |
| 25 | Audit is recorded inside transaction | **PASS** |
| 26 | Audit failure rolls back invoice mutation | **PASS** |
| 27 | Replay creates zero new audit records | **PASS** |
| 28 | Audit metadata contains all 12 mandatory fields | **PASS** |
| 29 | No floating-point financial arithmetic introduced | **PASS** |
| 30 | Gate 2 tests PASS (18/18) | **PASS** |
| 31 | Gate 3 tests PASS (13/13) | **PASS** |
| 32 | Gate 4 tests PASS (16/16) | **PASS** |
| 33 | Gate 5 targeted tests PASS (25/25) | **PASS** |
| 34 | Audit chain PASS (7,335 records, 0 broken hashes) | **PASS** |
| 35 | No new 40P01 deadlocks | **PASS** |
| 36 | `paymentService.js` untouched | **PASS** |
| 37 | No Gate 6/7/8/10 functionality introduced | **PASS** |
| 38 | Documentation complete and consistent | **PASS** |
| 39 | Unrelated modifications = 0 | **PASS** |

---

## 18. Gate 5 Verdict

**OVERALL VERDICT: GATE 5 — PASS**

---

## 19. Next Approved Scope

**NEXT GATE:** GATE 6 — MANUAL CUSTOMER UNLOCK (`POST /api/customers/:id/unlock`)

---

## 20. Explicit Execution Boundary Statement

> **DO NOT execute Gate 6 automatically.**  
> Execution halts at Gate 5 completion. Gate 6 requires explicit user review and authorization.
