# BILLING_ONE — GLOBAL LOCK GRAPH & CONCURRENCY SPECIFICATION
## EXHAUSTIVE LOCK INVENTORY ACROSS P0 THROUGH P1.5

**Document Version:** 1.0.0 — GLOBAL CONCURRENCY AUDIT  
**Milestone:** P1.5 — Customer Credit Risk Control & Enforcement Engine  
**Baseline Git Commit:** `8fbb8c861cbe46c28f902155e19188978604d76d`  
**Date:** October 2026  

---

## 1. GLOBAL LOCK ACQUISITION INVENTORY (P0 THROUGH P1.5)

Every financial transaction in `Billing_One` has been audited for its explicit row locks, implicit foreign key locks, and advisory locks:

| Flow ID | Flow Name & Endpoint | Transaction Scope | First Lock Acquired | Second Lock Acquired | Third Lock Acquired | Fourth Lock Acquired |
|:---:|---|---|---|---|---|---|
| **F-01** | **Direct Payment on Invoice**<br>`POST /api/invoices/:id/payments` | `inTransaction` | Advisory: `idemp_payment(key)` | Table Row: `payments` (Implicit `FOR KEY SHARE` on `invoices`) | Table Row: `invoices WHERE id = $1 FOR UPDATE` *(Upgrade Conflict in concurrent runs)* | Advisory: `cust_unapplied_pool(c)` $\to$ `payment_lock(p)` |
| **F-02** | **Payment Allocation**<br>`POST /api/payments/:id/allocations` | `inTransaction` | Table Row: `invoices WHERE id = ANY($1) ORDER BY id ASC FOR UPDATE` (Level 1) | Advisory: `cust_unapplied_pool(c)` (Level 2) | Advisory: `payment_lock(p)` (Level 3) | *None* |
| **F-03** | **Unapplied Cash Auto-Allocation**<br>`POST /api/invoices/:id/auto-allocate` | `inTransaction` | Advisory: `idemp_auto_alloc(key)` | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | Advisory: `cust_unapplied_pool(c)` (Level 2) | Advisory: `payment_lock(p)` (Level 3, sorted ASC) |
| **F-04** | **Recurring Billing Cycle**<br>`runRecurringBillingCycle` | Process Advisory + Per Plan | Process Advisory: `88812345` | Table Row: `recurring_plans WHERE id = $1 FOR UPDATE` | Creates DRAFT invoice; triggers F-03 if auto-settle enabled | *None* |
| **F-05** | **Overdue Invoice Scanner**<br>`runOverdueScan` | Process Advisory + Per Invoice | Process Advisory: `88812346` | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | Writes audit log; commits | *None* |
| **F-06** | **Bank Reconciliation Match**<br>`POST /reconciliation/manual-match` | `inTransaction` | Table Row: `bank_transactions WHERE id = $1 FOR UPDATE` | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | *None* | *None* |
| **F-07** | **Credit Note Processing**<br>`POST /api/adjustments/:id/process` | `inTransaction` | Table Row: `invoice_adjustments WHERE id = $1 FOR UPDATE` | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | *None* | *None* |
| **F-08** | **Standard Invoice Issue (P1.5)**<br>`POST /api/invoices/:id/issue` | `inTransaction` | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | Table Row: `customers WHERE id = $1 FOR UPDATE` (Level 2) | *None* | *None* |
| **F-09** | **Manager Override (P1.5)**<br>`POST /api/invoices/:id/issue-override` | `inTransaction` | Advisory: `idemp_override(key)` (Level 0) | Table Row: `invoices WHERE id = $1 FOR UPDATE` (Level 1) | Table Row: `customers WHERE id = $1 FOR UPDATE` (Level 2) | *None* |
| **F-10** | **Manual Customer Unlock (P1.5)**<br>`POST /api/customers/:id/unlock` | `inTransaction` | Advisory: `idemp_unlock(key)` (Level 0) | Table Row: `customers WHERE id = $1 FOR UPDATE` (Level 2) | *None* | *None* |
| **F-11** | **Customer Risk Scanner (P1.5)**<br>`runCustomerRiskScan` | Process Advisory + Per Customer | Process Advisory: `88812347` | Table Row: `customers WHERE id = $1 FOR UPDATE` (Level 2) | Pure MVCC `SELECT` on `invoices` *(Zero `FOR UPDATE`)* | *None* |
| **F-12** | **Customer Profile Update**<br>`PUT /api/customers/:id` | `inTransaction` | Table Row: `customers WHERE id = $1 FOR UPDATE` (Level 2) | *None* | *None* | *None* |

---

## 2. CROSS-ENTITY LOCK DEPENDENCY ANALYSIS

### 2.1. Invoices $\leftrightarrow$ Customers Relationship
Let us examine the directed edges between the two primary business entities:
1. **Invoice Issuance (F-08, F-09):**  
   Acquires `invoices` row lock first $\to$ then acquires `customers` row lock.  
   **Directed Edge:** $\text{Invoice} \to \text{Customer}$.
2. **Customer Risk Scanner (F-11):**  
   Acquires `customers` row lock $\to$ reads open invoices using **pure MVCC `SELECT` without `FOR UPDATE`**.  
   Because no row lock on `invoices` is requested or held, Transaction F-11 never waits on an invoice row lock.  
   **Directed Edge:** $\emptyset$ (Zero dependency edge).
3. **Manual Unlock (F-10) & Profile Update (F-12):**  
   Touch only `customers`. Zero invoice locks requested.  
   **Directed Edge:** $\emptyset$.
4. **All Payment & Settlement Flows (F-01, F-02, F-03, F-05, F-06, F-07):**  
   Acquire invoice row locks. None acquires row locks on `customers` (`customers FOR UPDATE`).  
   **Directed Edge:** $\emptyset$.

### 2.2. Mathematical Conclusion
Across all verified flows in the system:
- There is **strictly ZERO reverse dependency** ($\text{Customer} \to \text{Invoice}$).
- The global lock hierarchy conforms to a Directed Acyclic Graph (DAG):
  $$\text{Level 0 (Advisory Idemp)} \longrightarrow \text{Level 1 (Invoices)} \longrightarrow \text{Level 2 (Customers)} \longrightarrow \text{Level 3 (Payments)}$$

### 2.3. Formal Acceptance Statement
**"No known circular lock dependency exists in the verified flows between Invoices and Customers, and concurrency integration tests must empirically produce zero PostgreSQL 40P01 errors across all P1.5 operations."**
