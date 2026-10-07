# BILLING_ONE — P1.3.1 REMEDIATION REPORT
## CLOSURE REMEDIATION OF P1.3 AUDIT FINDINGS
### FIND-P1.3-01 & FIND-P1.3-02 CLOSURE VERIFICATION

**Document Version:** 1.0.0  
**Authority:** Senior Financial Systems Engineer + Concurrency Architect  
**Evaluation Date:** October 07, 2026  
**Target Milestone:** P1.3.1 Remediation Closure  
**Baseline Audit Report:** [`docs/BILLING_ONE_P1_3_CLOSURE_AUDIT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_CLOSURE_AUDIT.md)  
**Governing Specification:** [`docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md)  

---

## 1. EXECUTIVE SUMMARY & REMEDIATION STATUS

Báo cáo này xác nhận việc khắc phục triệt để và đóng chính thức toàn bộ **2 phát hiện kiểm toán (Open Findings)** từ đợt kiểm toán độc lập P1.3:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              REMEDIATION SUMMARY STATUS                                │
├─────────────────┬──────────┬──────────────┬───────────────┬────────────────────────────┤
│ Finding ID      │ Mức độ   │ Trạng thái cũ│ Trạng thái mới│ Hành động xử lý            │
├─────────────────┼──────────┼──────────────┼───────────────┼────────────────────────────┤
│ FIND-P1.3-01    │ MEDIUM   │ OPEN         │ CLOSED        │ Chuẩn hóa schema metadata  │
│ FIND-P1.3-02    │ LOW      │ OPEN         │ CLOSED        │ Chuẩn hóa Canonical Lock   │
└─────────────────┴──────────┴──────────────┴───────────────┴────────────────────────────┘
```

- **FIND-P1.3-01 (Audit Metadata Compliance):** **`CLOSED`**  
  Toàn bộ 7 trường bắt buộc theo Mục 12 Đặc tả Chính thức (`invoice_id`, `invoice_no`, `allocated_total`, `allocations_count`, `payment_ids`, `idempotency_key`, `invoice_status`) đã được chuẩn hóa và ghi nhận chính xác 100% vào `public.audit_logs`. Các trường chi tiết mở rộng được bảo toàn, cơ chế Replay tuyệt đối không sinh bản ghi kiểm toán trùng lặp.
- **FIND-P1.3-02 (Lock Order Standardization):** **`CLOSED`**  
  Nghịch đảo thứ tự khóa giữa `allocatePayment` và `autoAllocateUnappliedCash` đã được triệt tiêu hoàn toàn thông qua **Giao thức Khóa Phân tầng Chuẩn tắc (Hierarchical Canonical Lock Protocol)**. Cả hai luồng nghiệp vụ hiện đều tuân thủ thứ tự: **`Invoice (Row Lock, ID ASC) → Payment (Advisory Lock, ID ASC)`**, bảo đảm đồ thị tài nguyên là một đồ thị có hướng phi chu trình (DAG) và loại trừ tuyệt đối nguy cơ Deadlock (`40P01`).

---

## 2. REMEDIATION DETAIL: FIND-P1.3-01 — AUDIT METADATA COMPLIANCE

### 2.1. Vấn đề Phát hiện (Pre-remediation State)
Tại đợt kiểm toán P1.3, đối tượng kết quả trả về từ `autoAllocateUnappliedCash` được đưa trực tiếp vào `audit_logs.metadata`. Điều này dẫn đến sự không tương thích với Mục 12 của Đặc tả:
1. Trường `allocated_total` bị đặt tên là `allocated_from_unapplied`.
2. Thiếu `allocations_count` và mảng ID phẳng `payment_ids: [id1, id2, ...]`.
3. Thiếu `idempotency_key` trong `audit_logs.metadata`.

### 2.2. Giải pháp Triển khai (Remediation Implementation)
Đã chuẩn hóa cả 4 tệp liên quan:
- [`app/src/services/paymentService.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js): Đối tượng `resultPayload` được mở rộng với đầy đủ các thuộc tính chuẩn:
  ```javascript
  const paymentIds = Array.from(new Set(insertedAllocations.map(a => Number(a.payment_id))));
  const resultPayload = {
    success: true,
    invoice_id: Number(invoice.id),
    invoice_no: invoice.invoice_no,
    invoice_status: updatedInvoice.status,
    previous_paid_total: Number(invoice.paid_total).toFixed(2),
    new_paid_total: Number(updatedInvoice.paid_total).toFixed(2),
    allocated_total: roundedTotalAllocated.toFixed(2),
    allocated_from_unapplied: roundedTotalAllocated.toFixed(2), // Giữ lại cho backward compatibility
    allocations_count: insertedAllocations.length,
    payment_ids: paymentIds,
    idempotency_key: cleanIdempotencyKey,
    settlement_type: settlementType,
    allocations: insertedAllocations,
    remaining_unapplied_cash: remainingUnappliedCash,
    is_idempotent_replay: false
  };
  ```
- [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js), [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js), [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js):
  Khi ghi nhận sự kiện `PAYMENT_AUTO_ALLOCATED`, đối tượng `metadata` được cấu trúc tường minh:
  ```javascript
  metadata: {
    invoice_id: result.invoice_id,
    invoice_no: result.invoice_no,
    allocated_total: result.allocated_total,
    allocations_count: result.allocations_count,
    payment_ids: result.payment_ids,
    idempotency_key: idempotencyKey,
    invoice_status: result.invoice_status,
    settlement_type: result.settlement_type,
    allocated_from_unapplied: result.allocated_from_unapplied,
    previous_paid_total: result.previous_paid_total,
    new_paid_total: result.new_paid_total,
    allocations: result.allocations,
    remaining_unapplied_cash: result.remaining_unapplied_cash
  }
  ```

### 2.3. Bằng chứng Thực tế (Live Database Verification)
Bản ghi kiểm toán thực tế trong `public.audit_logs`:
```json
{
  "invoice_id": 783,
  "invoice_no": "INV-2026-000616",
  "allocated_total": "2000000.00",
  "allocations_count": 1,
  "payment_ids": [628],
  "idempotency_key": "t11-concurrent-1791363992611-0",
  "invoice_status": "PAID",
  "settlement_type": "FULL",
  "allocated_from_unapplied": "2000000.00",
  "previous_paid_total": "0.00",
  "new_paid_total": "2000000.00",
  "allocations": [
    {
      "allocation_id": 521,
      "payment_id": 628,
      "allocated_amount": "2000000.00",
      "created_at": "2026-10-07T09:06:32.616Z"
    }
  ],
  "remaining_unapplied_cash": "0.00"
}
```
**Kết luận:** Đầy đủ 7/7 thuộc tính quy chuẩn. Tái phát yêu cầu (Idempotent replay) được kiểm tra thực nghiệm sinh đúng 0 bản ghi kiểm toán mới.  
**FIND-P1.3-01 Status:** **`CLOSED`**

---

## 3. REMEDIATION DETAIL: FIND-P1.3-02 — LOCK ORDER STANDARDIZATION

### 3.1. Phân tích Đồ thị Khóa Trước Khắc phục (Lock Graph Before Remediation)

Trước khi chuẩn hóa, hệ thống tồn tại 2 thứ tự khóa đối nghịch:

```
[Flow 1: allocatePayment]          [Flow 2: autoAllocateUnappliedCash]
        │                                         │
        ▼                                         ▼
1. Lock Payment P                         1. Lock Invoice I
   (pg_advisory_xact_lock(P))                (SELECT ... FOR UPDATE)
        │                                         │
        ▼                                         ▼
2. Lock Invoice I                         2. Lock Payment P
   (SELECT ... FOR UPDATE)                   (pg_advisory_xact_lock(P))
```

**Kịch bản Deadlock (Cycle):**
- Giao dịch $T_1$ chạy `allocatePayment(P, [I])`: Giữ khóa $P$, chờ khóa $I$.
- Giao dịch $T_2$ chạy `autoAllocateUnappliedCash(I)`: Giữ khóa $I$, chờ khóa $P$.
- Wait-For Graph hình thành chu trình: $T_1 \to T_2 \to T_1$.
- PostgreSQL kích hoạt deadlock detector và ngắt một transaction với lỗi `40P01`.

### 3.2. Thiết kế Giao thức Khóa Phân tầng Chuẩn tắc (Hierarchical Canonical Lock Protocol)

Để triệt tiêu hoàn toàn deadlock cycle, toàn bộ các tài nguyên dùng chung trong hệ thống được phân cấp nghiêm ngặt thành 4 tầng thứ bậc:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CANONICAL HIERARCHICAL LOCK PROTOCOL                        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Level 0: Idempotency Key Advisory Lock                                      │
│          pg_advisory_xact_lock(hashtext('idemp_...'), hashtext(key))        │
├─────────────────────────────────────────────────────────────────────────────┤
│ Level 1: Invoice Row Locks (Parent Resource)                                │
│          SELECT ... FROM public.invoices WHERE id = ...                     │
│          ORDER BY id ASC FOR UPDATE                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ Level 2: Customer Unapplied Pool Advisory Lock (Pool Resource)              │
│          pg_advisory_xact_lock(hashtext('cust_unapplied_pool'), custId)     │
├─────────────────────────────────────────────────────────────────────────────┤
│ Level 3: Payment Advisory Locks (Child Resource)                            │
│          pg_advisory_xact_lock(hashtext('payment_lock'), paymentId::integer)│
│          (Luôn sắp xếp và chiếm theo thứ tự pId ASC)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Quy tắc Thứ tự Bắt buộc:
1. **Level 0 (Idempotency):** Chiếm đầu tiên để tuần tự hóa các request trùng key.
2. **Level 1 (Invoices):** Mọi hóa đơn liên quan đến giao dịch phải được khóa **trước khi** can thiệp vào Payments. Nếu giao dịch nhắm vào nhiều hóa đơn, các hóa đơn bắt buộc phải được sắp xếp tăng dần theo ID (`ORDER BY id ASC`).
3. **Level 2 (Customer Pool):** Chỉ dùng trong `autoAllocateUnappliedCash` để tuần tự hóa việc quét pool tiền thừa giữa các hóa đơn của cùng một khách hàng.
4. **Level 3 (Payments):** Sau khi đã giữ toàn bộ khóa hóa đơn cần thiết, tiến trình mới được chiếm khóa trên các khoản thanh toán.
   - Sử dụng khóa Advisory 2 tham số có namespace rõ ràng: `hashtext('payment_lock')` kết hợp với `paymentId::integer`.
   - Bảo toàn nguyên tắc **Least Privilege**: Role `billing_app` chỉ có quyền `SELECT, INSERT` trên `payments`, không cần và không được cấp quyền `UPDATE/DELETE`.
   - Nếu có nhiều khoản thanh toán ứng viên, bắt buộc sắp xếp và chiếm khóa theo thứ tự ID tăng dần (`p1 < p2 < ...`).

### 3.3. Đồ thị Khóa Sau Khắc phục (Lock Graph After Remediation)

```
[Flow 1: allocatePayment]          [Flow 2: autoAllocateUnappliedCash]
        │                                         │
        ▼                                         ▼
1. Lock Invoices (Level 1)                1. Lock Invoice (Level 1)
   (ORDER BY id ASC FOR UPDATE)              (SELECT ... FOR UPDATE)
        │                                         │
        ▼                                         ▼
2. Lock Payment P (Level 3)               2. Lock Cust Pool (Level 2)
   (hashtext('payment_lock'), P)             (hashtext('cust_unapplied_pool'))
                                                  │
                                                  ▼
                                          3. Lock Candidate Payments (Level 3)
                                             (ORDER BY pId ASC)
```

### 3.4. Chứng minh Toán học Không Tạo Chu trình (Deadlock-Free Proof)

Gọi $R$ là tập hợp tất cả các tài nguyên trong hệ thống và định nghĩa quan hệ thứ tự riêng phần nghiêm ngặt $<$ trên $R$:
$$\text{Level 0} < \text{Level 1} < \text{Level 2} < \text{Level 3}$$
Trong đó:
- Với $I_a, I_b \in \text{Level 1}$: $I_a < I_b \iff a < b$ (theo ID hóa đơn).
- Với $P_a, P_b \in \text{Level 3}$: $P_a < P_b \iff a < b$ (theo ID khoản thanh toán).

**Bổ đề:**
Mọi giao dịch $T$ trong hệ thống chỉ chiếm tài nguyên theo thứ tự đơn điệu tăng dần đối với quan hệ $<$. Một khi giao dịch đã giữ tài nguyên ở Level $\ge 1$, nó không bao giờ yêu cầu tài nguyên ở Level thấp hơn, và không bao giờ yêu cầu tài nguyên cùng Level có chỉ số ID nhỏ hơn tài nguyên cùng Level đã chiếm.

**Chứng minh:**
Giả sử phản chứng tồn tại chu trình deadlock giữa $n$ giao dịch:
$$T_1 \to T_2 \to \dots \to T_n \to T_1$$
Theo định nghĩa wait-for graph: $T_i \to T_{i+1}$ có nghĩa $T_i$ đang chờ tài nguyên $r_i$ do $T_{i+1}$ nắm giữ, trong khi $T_{i+1}$ đang chờ (hoặc yêu cầu) tài nguyên $r_{i+1}$.
Vì mọi giao dịch đều tuân thủ thứ tự nghiêm ngặt $<$, tài nguyên $r_i$ được chiếm trước khi $T_{i+1}$ yêu cầu $r_{i+1}$, nên:
$$r_1 < r_2 < \dots < r_n < r_1$$
Theo tính chất bắc cầu của quan hệ thứ tự nghiêm ngặt:
$$r_1 < r_1$$
Điều này mâu thuẫn với tính phi phản xạ ($r \not< r, \forall r$).  
Do đó, chu trình deadlock không thể tồn tại. **Q.E.D.**

**FIND-P1.3-02 Status:** **`CLOSED`**

---

## 4. CONCURRENCY & REMEDIATION TEST EVIDENCE

Đã xây dựng và thực thi thành công 100% bộ kiểm thử tự động chuyên biệt [`scripts/p1_3_1-remediation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3_1-remediation-test.mjs):

```
======================================================================
   BILLING_ONE P1.3.1 CLOSURE REMEDIATION VERIFICATION SUITE         
   Verifying FIND-P1.3-01 (Audit Metadata) & FIND-P1.3-02 (Lock Order)
======================================================================

[SUITE 1] FIND-P1.3-01: Audit Metadata Compliance & No-Replay-Duplicate...
  -> PASS: All 7 required audit metadata fields verified, replay generates zero duplicate audit entries

[SUITE 2] Concurrency: autoAllocate vs autoAllocate (Same Idempotency Key)...
  Statuses: [201, 200, 200, 200, 200, 200, 200, 200]
  -> PASS: Same key concurrency fully serialized (1 created, 7 replayed, 0 duplicate allocations, 0 deadlocks)

[SUITE 3] Concurrency: autoAllocate vs autoAllocate (Different Keys, Same Invoice)...
  Statuses: [201, 400, 400, 400, 400, 400, 400, 400]
  -> PASS: Different keys on same invoice serialized via Invoice Row Lock (1 winner, 7 clean rejections)

[SUITE 4] FIND-P1.3-02 Cross-Flow Concurrency: allocatePayment() VS autoAllocateUnappliedCash()...
    Round 1: Manual status: 409, Auto status: 201
    Round 2: Manual status: 409, Auto status: 201
    Round 3: Manual status: 409, Auto status: 201
    Round 4: Manual status: 409, Auto status: 201
    Round 5: Manual status: 409, Auto status: 201
  -> PASS: 5/5 Cross-flow race condition rounds succeeded with ZERO 40P01 deadlocks, zero over-allocation

[SUITE 5] Concurrency: Two Different Invoices Sharing Same Customer Payments...
  -> PASS: Two competing invoices safely consumed 100% of customer cash without deadlock or over-allocation

[SUITE 6] Concurrency: Rollback after Lock Acquisition Verification...
  -> PASS: Transaction rollback cleanly released row locks and advisory locks immediately

[SUITE 7] Comprehensive Financial Forensics & Cryptographic Audit Verification...
  -> Audit chain valid: 2,336 verified records with ZERO broken links
  -> PASS: 100% Financial Forensics Invariants strictly preserved across the entire database

======================================================================
  P1.3.1 REMEDIATION SUITE COMPLETE: 7/7 SUITES PASSED (100%) 
======================================================================
```

---

## 5. FULL REGRESSION TEST RESULTS

Toàn bộ 11 bộ kiểm thử hệ thống và hồi quy đã được thực thi thực tế trên môi trường Docker Production:

| STT | Tên bộ kiểm thử | File / Endpoint thực thi | Kết quả thực tế | Tỷ lệ đạt | Ghi chú kỹ thuật |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 1 | **P1.3.1 Remediation Suite** | `scripts/p1_3_1-remediation-test.mjs` | **7/7 PASS** | **100%** | Concurrency cross-flow, metadata assertions |
| 2 | **P1.3 Dedicated Suite** | `scripts/p1_3-auto-settlement-test.mjs` | **16/16 PASS** | **100%** | Mở rộng T01-T16: Concurrency, locks, invariants & metadata |
| 3 | **P1.2.2 Mandatory Idempotency** | `scripts/p1_2_2-mandatory-idempotency-test.mjs` | **16/16 PASS** | **100%** | Idempotency-Key validation + 4 bonus checks |
| 4 | **P1.2.1 Direct Payment Idempotency**| `scripts/p1_2_1-idempotency-test.mjs` | **10/10 PASS** | **100%** | Anti-replay direct payment |
| 5 | **P1.2 Payment Allocation V2** | `scripts/p1_2-payment-allocation-test.mjs` | **18/18 PASS** | **100%** | Phân bổ đa hóa đơn, bảo toàn P1.2 |
| 6 | **P1.1 Refund Ledger Suite** | `scripts/p1-refund-ledger-test.mjs` | **10/10 PASS** | **100%** | Credit note, debt harmonization |
| 7 | **P0 Financial Integrity Suite** | `scripts/p0-remediation-test.mjs` | **4/4 PASS** | **100%** | Credit note semantics, bank anti-replay |
| 8 | **CP2 Baseline Smoke Suite** | `scripts/cp2-smoke.mjs` | **15/15 PASS** | **100%** | p95 latency = **21.15 ms** (< 100 ms) |
| 9 | **Extended Enterprise Features** | `scripts/extended-features-test.mjs` | **12/12 PASS** | **100%** | 12 tính năng nâng cao LedgerFlow |
| 10 | **Frontend Smoke & Asset E2E** | `scripts/frontend-e2e-test.mjs` | **23/23 routes** | **100%** | 0 lỗi 404, static assets hợp lệ |
| 11 | **Security Hardening (H1 - H6)** | `scripts/verify-hardening.ps1` | **26/26 PASS** | **100%** | Least privilege, non-root, network isolation |
| 12 | **Cryptographic Audit Chain** | `POST /api/audit/verify` | **2.336/2.336 PASS** | **100%** | 100% chuỗi băm hợp lệ, 0 gãy liên kết |

---

## 6. FINANCIAL FORENSICS & INVARIANTS VERIFICATION

Kiểm toán dữ liệu tài chính trực tiếp trên cơ sở dữ liệu PostgreSQL sau khi chạy toàn bộ các bài test tương tranh và hồi quy:

```sql
SELECT 
  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.payments p 
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id 
    GROUP BY p.id, p.amount 
    HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
  ) sub) AS payment_over_allocation,

  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.payments p 
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id 
    GROUP BY p.id, p.amount 
    HAVING p.amount - coalesce(sum(pa.allocated_amount), 0) < -0.001
  ) sub) AS negative_unapplied,

  (SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.invoices i 
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id 
    GROUP BY i.id, i.paid_total 
    HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
  ) sub) AS invoice_allocation_mismatch,

  (SELECT count(*) FROM public.invoices 
   WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violation,

  (SELECT count(*) FROM (
    SELECT invoice_id 
    FROM public.payment_allocations 
    WHERE notes LIKE 'Tự động cấn trừ theo chu kỳ%' 
    GROUP BY invoice_id, payment_id 
    HAVING count(*) > 1
  ) sub) AS duplicate_scheduler_allocation;
```

### Kết quả Thực thi Truy vấn Pháp y:
```text
 payment_over_allocation | negative_unapplied | invoice_allocation_mismatch | collectible_capacity_violation | duplicate_scheduler_allocation 
-------------------------+--------------------+-----------------------------+--------------------------------+--------------------------------
                       0 |                  0 |                           0 |                              0 |                              0
```

- **Payment Over-allocation:** **`0`** (Không có khoản thanh toán nào bị phân bổ vượt quá số tiền thực nhận).
- **Negative Unapplied Cash:** **`0`** (Không có khoản thanh toán nào bị âm tiền chưa phân bổ).
- **Invoice Allocation Mismatch:** **`0`** (100% `paid_total` của hóa đơn bằng đúng tổng các khoản phân bổ).
- **Collectible Capacity Violation:** **`0`** (100% hóa đơn tuân thủ `paid_total + adjusted_total <= total`).
- **Duplicate Scheduler Allocation:** **`0`** (Zero phân bổ trùng lặp từ Scheduler).
- **Deadlock Occurrences (PostgreSQL 40P01):** **`0`** (Zero deadlock phát sinh trong toàn bộ quá trình kiểm thử).

---

## 7. AUDIT CHAIN CRYPTOGRAPHIC VERIFICATION

Kết quả xác thực mật mã toàn vẹn chuỗi `audit_logs` thông qua endpoint `POST /api/audit/verify`:

```json
{
  "verified": true,
  "valid": true,
  "verified_count": 2336,
  "total_records": 2336,
  "message": "Toàn vẹn chuỗi kiểm toán SHA-256: 100% bản ghi (2336) đã được xác thực an toàn tuyệt đối."
}
```

- **Tổng số bản ghi kiểm toán:** 2.336 bản ghi.
- **Tỷ lệ hợp lệ:** 100.0%.
- **Số liên kết gãy (Broken Links):** 0.

---

## 8. FINAL REMEDIATION VERDICT

Căn cứ vào kết quả kiểm thử thực nghiệm, phân tích toán học về đồ thị khóa và kiểm toán pháp y dữ liệu:
1. Phát hiện **FIND-P1.3-01** (Độ lệch metadata trong audit log) đã được chuẩn hóa và **CLOSED**.
2. Phát hiện **FIND-P1.3-02** (Nghịch đảo thứ tự khóa và nguy cơ deadlock) đã được chuẩn hóa theo Canonical Lock Order và **CLOSED**.
3. Toàn bộ 11 bộ kiểm thử hồi quy đạt tỷ lệ thành công 100%.
4. Không có bất kỳ vi phạm bất biến tài chính hay lỗi PostgreSQL 40P01 nào xảy ra.

```text
================================================================================
  FINAL REMEDIATION VERDICT:
  P1.3.1 REMEDIATION — READY FOR RE-AUDIT
================================================================================
```
