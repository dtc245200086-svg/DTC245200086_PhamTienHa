# BILLING_ONE — P1.5 GATE 3 EXECUTION REPORT
# RBAC / PERMISSION VERIFICATION & INVOICE ISSUE INTEGRATION

**Document ID:** `BILLING_ONE_P1_5_GATE_3_RBAC_INVOICE_ISSUE_REPORT`  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Gate:** GATE 3 — RBAC Verification & Invoice Issue Integration  
**Author:** Principal Financial Systems Architect + PostgreSQL Concurrency Engineer + Security & RBAC Architect + QA Lead  
**Execution Timestamp:** 2026-10-07T21:15:00+07:00  
**Baseline Git Commit:** `8fbb8c8` (P1.4 Final Closure Baseline)  
**Status:** **GATE 3 — PASS**

---

## 1. OBJECTIVE & SCOPE BOUNDARY

Gate 3 accomplishes two vital foundational goals:
1. **RBAC & Permission Architecture Verification:** Complete database and runtime audit of role and permission mappings for standard, managerial, and administrative roles.
2. **Synchronous Invoice Issue Credit Gate Integration:** Fortification of `POST /api/invoices/:id/issue` with live transactional customer credit and risk enforcement via `CustomerCreditService`.

### Strict Scope Enforcement:
- [x] **IN SCOPE:**
  - RBAC matrix and runtime permission verification.
  - Integration of `CustomerCreditService.checkInvoiceIssueEligibility` in `POST /api/invoices/:id/issue`.
  - Strict lock hierarchy DAG (`invoices` $\to$ `customers`).
  - Strict sequence guard: `nextval('public.invoice_no_seq')` only executed after all validations and credit checks pass.
  - Atomic in-transaction forensic audit snapshot `INVOICE_ISSUED`.
  - High-concurrency issue race verification (double-issue race on customer limit).
  - Targeted test suite [`scripts/p1_5-gate3-rbac-issue-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate3-rbac-issue-test.mjs).
  - Full P0–P1.4 regression suite verification.
- [x] **STRICTLY EXCLUDED FROM GATE 3:**
  - `POST /api/invoices/:id/issue-override` (Deferred to Gate 5).
  - `POST /api/customers/:id/unlock` (Deferred to Gate 6).
  - Customer status PUT hardening (Gate 4).
  - Scheduled background risk scanner (Gate 7).
  - Frontend UI implementation is deferred to its designated later P1.5 gate.
  - Concurrency fixes for legacy CP2 / paymentService.

---

## 2. RBAC & PERMISSION ARCHITECTURE AUDIT

### 2.1. Authoritative Role-Permission Matrix in PostgreSQL
Queried directly from `public.role_permissions`, `public.roles`, and `public.permissions`:

| Permission Code | `admin` | `ROLE_BILLING_MANAGER` | `staff` | `ROLE_ACCOUNTANT` | `ROLE_AUDITOR` | Module | Description |
|---|:---:|:---:|:---:|:---:|:---:|---|---|
| `invoice.create` | ✅ | ✅ | ✅ | ❌ | ❌ | invoices | Tạo hóa đơn nháp |
| `invoice.read` | ✅ | ✅ | ✅ | ✅ | ✅ | invoices | Xem danh sách và chi tiết hóa đơn |
| `invoice.update` | ✅ | ✅ | ✅ | ❌ | ❌ | invoices | Chỉnh sửa hóa đơn nháp |
| **`invoice.issue`** | ✅ | ✅ | ✅ | ❌ | ❌ | invoices | Phát hành hóa đơn chính thức |
| `invoice.cancel` | ✅ | ✅ | ❌ | ❌ | ❌ | invoices | Hủy hóa đơn chưa thanh toán |
| **`invoice.issue_override`** | ✅ | ✅ | ❌ | ❌ | ❌ | invoices | Phê duyệt phát hành hóa đơn đặc cách vượt hạn mức |
| `customer.create` | ✅ | ✅ | ✅ | ❌ | ❌ | customers | Thêm khách hàng mới |
| `customer.read` | ✅ | ✅ | ✅ | ✅ | ✅ | customers | Xem danh sách và chi tiết khách hàng |
| **`customer.update`** | ✅ | ✅ | ✅ | ❌ | ❌ | customers | Chỉnh sửa thông tin khách hàng |
| `customer.delete` | ✅ | ❌ | ❌ | ❌ | ❌ | customers | Xóa khách hàng |
| **`customer.unlock`** | ✅ | ✅ | ❌ | ❌ | ❌ | customers | Mở khóa công nợ khách hàng (LOCKED $\to$ ACTIVE) |
| `product.manage` | ✅ | ❌ | ✅ | ❌ | ❌ | products | Quản trị danh mục sản phẩm |
| `payment.create` | ✅ | ❌ | ✅ | ✅ | ❌ | payments | Ghi nhận thanh toán |
| `payment.read` | ✅ | ❌ | ✅ | ✅ | ✅ | payments | Xem lịch sử thanh toán |
| `adjustment.create` | ✅ | ✅ | ✅ | ❌ | ❌ | adjustments | Lập biên bản điều chỉnh |
| `adjustment.approve` | ✅ | ✅ | ❌ | ❌ | ❌ | adjustments | Phê duyệt biên bản điều chỉnh |
| `reconciliation.manage` | ✅ | ❌ | ❌ | ✅ | ❌ | reconciliation | Đối soát sao kê ngân hàng |
| `recurring.manage` | ✅ | ✅ | ❌ | ❌ | ❌ | recurring | Quản lý hóa đơn định kỳ |
| `report.view` | ✅ | ✅ | ✅ | ✅ | ✅ | reports | Xem báo cáo tài chính |
| `audit.view` | ✅ | ❌ | ❌ | ❌ | ✅ | audit | Xem nhật ký kiểm toán |
| `settings.manage` | ✅ | ❌ | ❌ | ❌ | ❌ | settings | Cấu hình pháp nhân |

### 2.2. Runtime Permission Enforcement Evidence
1. **Endpoint Protection:**
   [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js#L255-L257):
   ```javascript
   router.post('/:id/issue', requireAuth, requirePermission('invoice.issue'), asyncRoute(async (req, res) => { ... }));
   ```
2. **Permission Resolution Mechanism:**
   In [`app/src/routes/auth.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/auth.js):
   - Authenticated user's permissions are resolved dynamically from database join `role_permissions` $\to$ `permissions` on login.
   - For `admin`: receives wildcard `['*']`, authorizing all operations.
   - For `staff`: receives explicit permission set including `invoice.issue`, but strictly omitting `invoice.issue_override` and `customer.unlock`.
   - For unauthorized / unauthenticated requests: returns HTTP 401 `UNAUTHENTICATED` or HTTP 403 `FORBIDDEN`.

---

## 3. FORTIFIED INVOICE ISSUE TRANSACTION MODEL

### 3.1. Synchronous Execution Flow
The fortified endpoint `POST /api/invoices/:id/issue` executes strictly inside a single database transaction:

```text
BEGIN TRANSACTION
  │
  ├─► 1. Lock Target Invoice Row:
  │      SELECT id, customer_id, status, due_date, total::text, e_invoice_code 
  │      FROM public.invoices WHERE id = $1 FOR UPDATE
  │      Assert: invoice exists, status === 'DRAFT'
  │
  ├─► 2. Validate Preconditions:
  │      Assert: items.count >= 1, total > 0, due_date >= CURRENT_DATE
  │
  ├─► 3. Customer Credit & Risk Pre-Issuance Gate:
  │      Call CustomerCreditService.checkInvoiceIssueEligibility(client, { customerId, invoiceTotal })
  │      │
  │      ├─► Locks Customer Row:
  │      │   SELECT id, status, credit_limit::text FROM public.customers WHERE id = $1 FOR UPDATE
  │      │
  │      ├─► Customer Status Check:
  │      │   IF status === 'LOCKED' ──► ABORT with HTTP 409 CUSTOMER_IS_LOCKED
  │      │
  │      ├─► Live Debt Computation (MVCC SELECT, zero invoice locks):
  │      │   SELECT coalesce(sum(total - paid_total - adjusted_total), 0)::numeric(14,2)::text
  │      │   FROM invoices WHERE customer_id = $1 AND status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
  │      │
  │      └─► Credit Limit Enforcement:
  │          IF credit_limit > 0 AND (current_debt + invoice_total) > credit_limit 
  │          ──► ABORT with HTTP 409 CREDIT_LIMIT_EXCEEDED
  │
  ├─► 4. Sequence Generation (Guarded):
  │      SELECT format('INV-%s-%s', to_char(current_date, 'YYYY'), 
  │             lpad(nextval('public.invoice_no_seq')::text, 6, '0')) AS invoice_no
  │      * Guaranteed: nextval is NEVER called on any rejected request!
  │
  ├─► 5. Invoice Mutation:
  │      UPDATE public.invoices 
  │      SET invoice_no = $2, e_invoice_code = $3, status = 'ISSUED', issue_date = current_date 
  │      WHERE id = $1
  │
  ├─► 6. Atomic Forensic Audit Logging (BEFORE COMMIT):
  │      recordAudit(client, {
  │        module: 'invoices',
  │        action: 'INVOICE_ISSUED',
  │        metadata: <DecisionSnapshot>,
  │        throwOnError: true
  │      })
  │      * If audit insertion fails ──► Transaction aborts, entire issuance rolls back!
  │
COMMIT TRANSACTION
```

### 3.2. Strict Lock Hierarchy DAG
To prevent deadlocks across concurrent issuing and payment flows, the canonical lock hierarchy is strictly maintained:

$$\text{Lock Order:} \quad \text{Invoice Row} \quad \longrightarrow \quad \text{Customer Row} \quad \longrightarrow \quad \text{Payment Row}$$

- Inside `POST /api/invoices/:id/issue`:
  1. `invoices` row is locked first (`FOR UPDATE`).
  2. `customers` row is locked second (`FOR UPDATE` inside `checkInvoiceIssueEligibility`).
  3. `invoices` open debt is queried via standard MVCC `SELECT` (no invoice locks).
  4. Reverse lock acquisition (`Customer` $\to$ `Invoice`) is **COMPLETELY PROHIBITED**.

---

## 4. SEQUENCE SEMANTICS & FINANCIAL REJECTION SAFETY

### 4.1. Sequence Leakage Prevention
PostgreSQL sequences (`invoice_no_seq`) are non-transactional and do not roll back upon transaction abort. Therefore:
- In the fortified pipeline, `nextval('public.invoice_no_seq')` is placed **strictly downstream** of:
  1. Invoice DRAFT and line-item verification.
  2. Customer row acquisition.
  3. Customer `LOCKED` status validation.
  4. Customer credit limit breach calculation.
- **Verification Result (Test T09):** When an issuance request fails due to `LOCKED` customer or `CREDIT_LIMIT_EXCEEDED`, sequence `last_value` remains identical before and after the request. Zero sequence values are consumed or leaked.

---

## 5. AUDIT ATOMICITY & FORENSIC SNAPSHOT

### 5.1. In-Transaction Cryptographic Chaining
In compliance with Section 8 of the Master Specification:
- `recordAudit` receives the active transaction `client` (`recordAudit(client, { ..., throwOnError: true })`).
- Audit record insertion and SHA-256 hash chaining occur **before `COMMIT`**.
- If audit recording encounters an error (e.g. database constraint or connection fault), `throwOnError: true` triggers an exception that causes `inTransaction` to execute `ROLLBACK`.
- **Fault-Injection Result (Test T11):** When audit insertion is faulted, the transaction rolls back cleanly: the invoice remains in `DRAFT` status with no `invoice_no` assigned, preserving 100% financial consistency.

### 5.2. Decision-Time Forensic Metadata
The `INVOICE_ISSUED` audit entry records the exact decision-time financial snapshot:
```json
{
  "invoice_id": 1812,
  "invoice_no": "INV-2026-000042",
  "customer_id": 845,
  "customer_status_prior": "ACTIVE",
  "credit_limit": "50000000.00",
  "current_debt_prior": "15000000.00",
  "invoice_total": "20000000.00",
  "projected_debt": "35000000.00",
  "issue_decision": "NORMAL",
  "e_invoice_code": "1C25TND-000042"
}
```
**Exact Arithmetic Invariant Verified (Test T10):**
$$\text{parseToCents}(current\_debt\_prior) + \text{parseToCents}(invoice\_total) = \text{parseToCents}(projected\_debt)$$
Verified with zero floating-point approximation error.

---

## 6. CONCURRENCY VERIFICATION: DOUBLE-ISSUE RACE

### 6.1. High-Concurrency Double-Issue Race Test (T07/T08)
Conducted according to Section 15 of the Frozen Spec:
- **Scenario:** Customer credit limit = $100,000,000.00$; current open debt = $70,000,000.00$.
- **Available credit before test:** $30,000,000.00$.
- **Requests:** Two draft invoices ($A$ and $B$), each with total = $30,000,000.00$, issued concurrently via `Promise.all([issue(A), issue(B)])`.
- **Observed Execution Trace:**
  1. Transaction $A$ locks Invoice $A$, then acquires exclusive lock on Customer.
  2. Transaction $A$ verifies debt: $70\text{M} + 30\text{M} = 100\text{M} \le 100\text{M}$ (Eligible).
  3. Transaction $B$ locks Invoice $B$, then attempts to lock Customer and blocks on row lock.
  4. Transaction $A$ completes mutation, records audit, and commits.
  5. Transaction $B$ unblocks, acquires Customer lock, and reads fresh committed state.
  6. Transaction $B$ recalculates debt: $70\text{M} + 30\text{M} (\text{from } A) = 100\text{M}$.
  7. Projected debt for $B$: $100\text{M} + 30\text{M} = 130\text{M} > 100\text{M}$.
  8. Transaction $B$ aborts with HTTP 409 `CREDIT_LIMIT_EXCEEDED` (`excess_amount: '30000000.00'`).
- **Results:**
  - Exactly **1 success** (HTTP 200).
  - Exactly **1 rejection** (HTTP 409 `CREDIT_LIMIT_EXCEEDED`).
  - Total committed customer debt = $100,000,000.00$ (Zero over-limit breach).
  - Rejected invoice $B$ remains `DRAFT`.
  - **Zero PostgreSQL 40P01 errors were observed in the Gate 3 invoice-issuance concurrency scenario.**

---

## 7. TARGETED TEST EXECUTION MATRIX

Executed via [`scripts/p1_5-gate3-rbac-issue-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_5-gate3-rbac-issue-test.mjs):

| Test ID | Test Scenario | Input / Conditions | Expected Behavior | Status |
|---|---|---|---|---|
| **T00** | RBAC Database Matrix | Query `role_permissions` join | `admin`, `ROLE_BILLING_MANAGER`, `staff` mapped correctly | **PASS** |
| **T00-Auth** | Endpoint Auth Gate | Request without session | HTTP 401 `UNAUTHENTICATED` | **PASS** |
| **T01** | Standard Issue (ACTIVE) | Status `ACTIVE`, debt within limit | HTTP 200, status `ISSUED`, invoice number assigned | **PASS** |
| **T02** | Standard Issue (WARNING) | Status `WARNING`, debt within limit | HTTP 200, status `ISSUED` | **PASS** |
| **T03** | Exact Limit Boundary | Debt + total == credit limit | HTTP 200, status `ISSUED` | **PASS** |
| **T04** | Credit Limit Exceeded | Debt + total exceeds limit by 0.01 | HTTP 409 `CREDIT_LIMIT_EXCEEDED`, `excess = '0.01'` | **PASS** |
| **T05** | Locked Customer Gate | Status `LOCKED` | HTTP 409 `CUSTOMER_IS_LOCKED`, invoice remains DRAFT | **PASS** |
| **T06** | Unlimited Credit | `credit_limit = 0`, large invoice total | HTTP 200, status `ISSUED` | **PASS** |
| **T07/T08** | Concurrent Issue Race | 2 concurrent 30M requests on 30M room | Exactly 1 HTTP 200, 1 HTTP 409, 0 deadlocks | **PASS** |
| **T09** | Sequence Protection | Issue rejected on LOCKED customer | `nextval` zero times; sequence `last_value` unchanged | **PASS** |
| **T10** | Forensic Audit Snapshot | Successful issue | Metadata contains exact decision-time snapshot | **PASS** |
| **T11** | Audit Atomicity | Simulated audit failure | Entire transaction rolled back; invoice remains DRAFT | **PASS** |
| **T12** | Audit Uniqueness | Successful issue | Exactly one `INVOICE_ISSUED` audit log created | **PASS** |

**Targeted Suite Result:** **13/13 TESTS PASSED (100%)**

---

## 8. REGRESSION & INTEGRATION VERIFICATION

1. **Gate 2 Domain Service Suite (`scripts/p1_5-domain-service-test.mjs`):**
   - Result: **18/18 TESTS PASSED (100%)**.
2. **Milestone P1.4 Lifecycle Engine Suite (`scripts/p1_4-overdue-lifecycle-test.mjs`):**
   - Executed all 21 automated lifecycle, concurrency, and idempotent scan tests.
   - Executed all 12 regression test suites:
     - `p0-remediation-test.mjs`: PASS
     - `p1-refund-ledger-test.mjs`: PASS
     - `p1_2-payment-allocation-test.mjs`: PASS
     - `p1_2_1-idempotency-test.mjs`: PASS
     - `p1_2_2-mandatory-idempotency-test.mjs`: PASS
     - `p1_3-auto-settlement-test.mjs`: PASS
     - `p1_3_1-remediation-test.mjs`: PASS
     - `cp2-smoke.mjs`: PASS
     - `extended-features-test.mjs`: PASS
     - `frontend-e2e-test.mjs`: PASS
     - `verify-hardening.ps1`: PASS
     - `verify-audit-chain.mjs`: PASS
   - **All 9 Authoritative Financial Metrics = 0 violations.**
   - Official regression contract: **PASS** (12/12 suites passed, 21/21 tests passed).
   - Known legacy artifact (`remediation-verification.mjs`): excluded from active contract.
   - Known CP2 concurrency defect: carried forward.
3. **Cryptographic Audit Chain Integrity (`scripts/verify-audit-chain.mjs`):**
   - Verified 100% of SHA-256 hash chains across 6,197 total audit records.
   - Result: **VALID (0 tampered or broken hashes)**.

---

## 9. KNOWN CARRY-FORWARD EXCEPTIONS

1. **CP2 40P01 Concurrency Finding:**
   - CP2 payment deadlock remains a known pre-existing P1.2 carry-forward defect (documented in `docs/BILLING_ONE_P1_5_BASELINE_CONCURRENCY_FINDING.md`).
   - The Gate 3 invoice issuance race itself produced zero 40P01 errors.
   - No CP2 remediation was performed during Gate 3. This does not mean the P1.2 CP2 defect was fixed or that system-wide 40P01 is zero.
2. **`remediation-verification.mjs`:**
   - Obsolete Pre-P0 legacy artifact asserting deprecated credit-note cash payment behavior; excluded from active contract.

---

## 10. GIT DIFF & FILE AUDIT (NO UNRELATED MODIFICATIONS)

- **BASELINE COMMIT:** `8fbb8c861cbe46c28f902155e19188978604d76d` (P1.4 Final Closure Baseline)
- **APPROVED GATE 3 MODIFICATIONS:**
  - `app/src/app.js` (Serialize error.details, customer_id, customer_status)
  - `app/src/audit.js` (Support throwOnError: true for transactional audit atomicity)
  - `app/src/errors.js` (Support details parameter in AppError constructor)
  - `app/src/routes/invoices.js` (Integrate CustomerCreditService, lock order, sequence guard, audit)
- **GATE 3 ARTIFACTS:**
  - `scripts/p1_5-gate3-rbac-issue-test.mjs`
  - `docs/BILLING_ONE_P1_5_GATE_3_RBAC_INVOICE_ISSUE_REPORT.md`
- **UNRELATED MODIFICATIONS:** 0

All modified production files are within approved Gate 3 scope. No unrelated production files were modified.

---

## 11. GATE 3 ACCEPTANCE CRITERIA VERIFICATION

| Acceptance Criteria | Required State | Actual State | Verdict |
|---|---|---|---|
| 1. RBAC Permission Resolution | Database role permissions verified | 58 rows verified across 5 roles | **PASS** |
| 2. Standard Issue Permission | Requires `invoice.issue` | Verified at endpoint gate | **PASS** |
| 3. CustomerCreditService Usage | Synchronously invoked in issue flow | Active in `inTransaction` | **PASS** |
| 4. Invoice Row Locked First | `invoices FOR UPDATE` before customer | Enforced in query order | **PASS** |
| 5. Customer Locked Before Decision | `customers FOR UPDATE` before credit math | Enforced inside service | **PASS** |
| 6. LOCKED Customer Rejected | HTTP 409 `CUSTOMER_IS_LOCKED` | Rejection verified; invoice remains DRAFT | **PASS** |
| 7. Credit Breach Rejected | HTTP 409 `CREDIT_LIMIT_EXCEEDED` | Rejection verified with exact details | **PASS** |
| 8. Unlimited Credit | `credit_limit = 0` issues normally | Verified in T06 | **PASS** |
| 9. Exact Boundary Credit | Debt + total == limit issues | Verified in T03 | **PASS** |
| 10. Sequence Protection | `nextval` only called after pass | Verified in T09 (last_value unchanged) | **PASS** |
| 11. Audit Snapshot Complete | Contains all decision-time metadata | Verified in T10 | **PASS** |
| 12. Audit Inside Transaction | `recordAudit(client, ...)` before commit | Verified in code & runtime | **PASS** |
| 13. Audit Failure Atomicity | Audit error rolls back invoice issue | Verified in T11 (invoice remains DRAFT) | **PASS** |
| 14. Concurrent Issue Safety | Race resolves with 1 success + 1 rejection | Verified in T07/T08 | **PASS** |
| 15. Zero Deadlocks in Issue Flow | 0 PostgreSQL 40P01 in issue flow | Zero PostgreSQL 40P01 errors observed in Gate 3 invoice-issuance scenario | **PASS** |
| 16. Regression Contract | Official regression contract passes | Official regression contract: PASS. Known legacy artifact: excluded. Known CP2 concurrency defect: carried forward. | **PASS** |
| 17. Scope Hygiene | Zero override/unlock/scanner/frontend code | Excluded from Gate 3 | **PASS** |
| 18. No Unrelated Modifications | All changes within approved Gate 3 scope | Verified via git status (0 unrelated modifications) | **PASS** |
