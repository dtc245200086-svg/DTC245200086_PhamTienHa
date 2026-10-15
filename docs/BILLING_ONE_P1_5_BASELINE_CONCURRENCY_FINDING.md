# BILLING_ONE — P1.5 BASELINE CONCURRENCY FINDING REPORT
## FORENSIC ROOT CAUSE ANALYSIS: POSTGRESQL 40P01 DEADLOCK IN CP2-SMOKE

**Document Version:** 1.0.0 — FORENSIC ROOT CAUSE ANALYSIS  
**Component:** `app/src/services/paymentService.js` (`createPayment` $\to$ `allocatePayment`)  
**Trigger Script:** `scripts/cp2-smoke.mjs` (Lines 258–268)  
**PostgreSQL Error Code:** `40P01` (`deadlock detected`)  
**HTTP Status Output:** `500 INTERNAL_ERROR` (instead of expected `409 CONFLICT`)  
**Baseline Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d` (P1.4 Officially Closed)  
**Date:** October 2026  

---

## 1. INCIDENT DESCRIPTION & EXACT REPRODUCTION

During the baseline regression execution of Gate 0 on `Billing_One`, running `node scripts/cp2-smoke.mjs` intermittently produced:
```
CP2_API_FAIL Expected values to be strictly deep-equal:
+ actual - expected
  [
    201,
+   500
-   409
  ]
```

Server logs from `billing-web-1` recorded:
```json
{
  "ts": "2026-10-07T13:02:24.095Z",
  "level": "error",
  "msg": "error",
  "request_id": "7a926226-12fb-487e-b305-ed72b63a251a",
  "code": "INTERNAL_ERROR",
  "message": "deadlock detected",
  "stack": "error: deadlock detected\n    at /app/node_modules/pg/lib/client.js:694:17\n    at async PaymentService.allocatePayment (/app/src/services/paymentService.js:301:20)\n    at async PaymentService.createPayment (/app/src/services/paymentService.js:185:27)\n    at async /app/src/routes/payments.js:75:14\n    at async inTransaction (/app/src/db.js:18:20)\n    at async /app/src/routes/payments.js:74:20"
}
```

---

## 2. DEEP FORENSIC INVESTIGATION

### 2.1. Code Path Inspection
The failure occurs when two concurrent requests submit payments for the same invoice (`POST /api/invoices/:id/payments`) with distinct idempotency keys:

In `scripts/cp2-smoke.mjs`:
```javascript
// Lines 262-266:
const concurrentBody = { amount: '1000.00', method: 'CARD', paid_at: '2026-10-05', reference: 'CP2-CONCURRENT' };
const concurrentResults = await Promise.all([
  admin.request(`/api/invoices/${concurrentDraft.id}/payments`, { method: 'POST', body: concurrentBody }),
  staff.request(`/api/invoices/${concurrentDraft.id}/payments`, { method: 'POST', body: concurrentBody })
]);
```
Both clients inject distinct idempotency keys (`cp2-test-<timestamp>-<random>`).

In `app/src/services/paymentService.js`:
```javascript
// Step A (line 135): Advisory lock on idempotency key
await client.query(`SELECT pg_advisory_xact_lock(hashtext('idemp_payment'), hashtext($1))`, [cleanIdempotencyKey]);

// Step B (line 161): Insert payment record referencing invoice_id
const payInsert = await client.query(
  `INSERT INTO public.payments (customer_id, invoice_id, amount, ...) VALUES ($1, $2, ...) RETURNING id`,
  [...]
);

// Step C (line 185): Call allocatePayment
await this.allocatePayment(client, { paymentId: paymentRow.id, allocations: effectiveAllocations, ... });
```

In `allocatePayment` (`paymentService.js` line 301):
```javascript
// Step D: Lock target invoice row
const invRes = await client.query(
  `SELECT id, ... FROM public.invoices WHERE id = ANY($1::bigint[]) ORDER BY id ASC FOR UPDATE`,
  [uniqueInvoiceIds]
);
```

### 2.2. PostgreSQL Foreign Key Row-Locking Mechanics
In `public.payments`, column `invoice_id` has a foreign key constraint:
```sql
CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id)
```
In PostgreSQL, whenever a transaction inserts a row into a child table (`payments`) referencing a parent key (`invoices`), PostgreSQL automatically acquires a **`FOR KEY SHARE`** row lock on the referenced tuple in `public.invoices` to guarantee that the parent row cannot be deleted or have its primary key modified before the child transaction commits.

### 2.3. The Circular Wait / Lock Upgrade Race
When Transaction A (`admin`) and Transaction B (`staff`) execute concurrently:

1. **Transaction A** executes `INSERT INTO payments (invoice_id = 1683)`.
   - PostgreSQL acquires `FOR KEY SHARE` lock on tuple `invoices(1683)`.
2. **Transaction B** executes `INSERT INTO payments (invoice_id = 1683)`.
   - PostgreSQL acquires `FOR KEY SHARE` lock on tuple `invoices(1683)`.
   - *Note:* In PostgreSQL, multiple transactions can simultaneously hold `FOR KEY SHARE` on the same tuple.
3. **Transaction A** advances to `allocatePayment` and executes:
   `SELECT ... FROM public.invoices WHERE id = 1683 FOR UPDATE`.
   - `FOR UPDATE` requires an `EXCLUSIVE` lock on tuple `invoices(1683)`.
   - `FOR UPDATE` conflicts with all `KEY SHARE` locks held by *other* transactions.
   - Transaction A must wait for Transaction B to release its `KEY SHARE` lock. **Transaction A blocks.**
4. **Transaction B** advances to `allocatePayment` and executes:
   `SELECT ... FROM public.invoices WHERE id = 1683 FOR UPDATE`.
   - Transaction B attempts to upgrade its lock on tuple `invoices(1683)` to `FOR UPDATE`.
   - Transaction B must wait for Transaction A to release its `KEY SHARE` lock. **Transaction B blocks.**
5. **Deadlock:**
   - Transaction A is waiting for Transaction B.
   - Transaction B is waiting for Transaction A.
   - Both are waiting on the *exact same tuple* `invoices(1683)`.
6. **Detector Abort:**
   After `deadlock_timeout` (1 second), the PostgreSQL deadlock detector detects the cycle and terminates one transaction with error code **`40P01`**.

---

## 3. FINDING CLASSIFICATION

| Classification Criterion | Analysis & Evidence |
|---|---|
| **Category** | **D. Real financial concurrency defect in Milestone P1.2 baseline** |
| **Component** | `app/src/services/paymentService.js` (`createPayment` $\to$ `allocatePayment`) |
| **Root Cause** | Inversion between PostgreSQL implicit foreign key lock (`KEY SHARE` during `INSERT INTO payments`) and application row lock (`FOR UPDATE` on `invoices`). |
| **Financial State Impact** | **Zero Data Corruption.** The transaction terminated by PostgreSQL is rolled back completely. The winning transaction commits cleanly. Invoices are never over-allocated and double payments do not occur. |
| **P1.5 Interaction Risk** | **Zero Impact.** Milestone P1.5 introduces credit control on invoice issuance (`POST /api/invoices/:id/issue`), customer status governance, and customer risk scanning. P1.5 does not modify `createPayment` or payment allocation flows, and P1.5 invoice issuance exclusively targets `DRAFT` invoices (which cannot receive payments). |

---

## 4. BASELINE RECOVERY & REMEDIATION PROPOSAL (FOR MILESTONE P1.2 DEBT)

To eliminate the lock-upgrade deadlock in `createPayment`:
`PaymentService.createPayment` should acquire `SELECT ... FROM invoices WHERE id = $1 FOR UPDATE` **BEFORE** executing `INSERT INTO payments`:
- Transaction A locks the invoice `FOR UPDATE`.
- Transaction B blocks at the very beginning of the flow before inserting into `payments`.
- Transaction A inserts into `payments` and completes allocation.
- Transaction B unblocks, sees the updated invoice state, and cleanly rejects with HTTP 409 `PAYMENT_EXCEEDS_OUTSTANDING`.

*Policy Constraint:* Per user instruction, **no production code modification may be performed during Gate 0**. This finding is formally recorded as a **Pre-Existing Baseline Concurrency Defect** from Milestone P1.2.
