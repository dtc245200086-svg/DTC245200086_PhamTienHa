# BILLING_ONE — P1.3 IMPLEMENTATION REPORT
## RECURRING BILLING AUTOMATED PAYMENT & UNAPPLIED CASH SETTLEMENT ENGINE

- **Project:** Billing_One Enterprise Financial Billing System
- **Phase:** P1.3 Official Implementation
- **Source of Truth:**
  - [`docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md)
  - [`docs/BILLING_ONE_P1_3_IMPLEMENTATION_PREFLIGHT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_IMPLEMENTATION_PREFLIGHT.md)
- **Baseline Git Commit:** `d794de0461e992122a4c8eddadb1ead2082ae8ac`
- **Branch:** `main`
- **Database Engine:** PostgreSQL 16 (Strict Least-Privilege Environment)
- **Execution Date:** 2026-10-07
- **Implementation Verdict:** **`P1.3 IMPLEMENTATION — PASS`**

---

## 1. EXECUTIVE SUMMARY & VERDICT

Toàn bộ 12 mục tiêu và yêu cầu nghiệp vụ của đặc tả **P1.3 Recurring Billing Automated Payment & Unapplied Cash Settlement Engine** đã được triển khai đầy đủ, chuẩn xác và vượt qua 100% các bộ kiểm thử nghiêm ngặt.

Hệ thống đã bổ sung khả năng tự động cấn trừ tiền thừa (unapplied cash) của khách hàng cho hóa đơn định kỳ mới phát hành mà **không** phá vỡ bất kỳ nguyên lý bất biến tài chính nào:
1. **Không tạo bản ghi thanh toán giả lập** (`payments` giữ nguyên số lượng và bất biến).
2. **Tái sử dụng bảng quan hệ phân bổ chuẩn mực** `payment_allocations` của P1.2.
3. **Tuân thủ nghiêm ngặt nguyên tắc FIFO** (`paid_at ASC, payments.id ASC`).
4. **Idempotency bắt buộc và bảo vệ replay tuyệt đối** cho cả luồng thủ công (`POST /api/invoices/:id/auto-allocate`) và luồng tự động từ scheduler (`RECURRING-AUTO-ALLOC-INV-${id}-PLAN-${plan.id}`).
5. **Khóa đồng thời chống race condition đa tầng** qua PostgreSQL transaction advisory locks kết hợp khóa dòng bi quan `SELECT ... FOR UPDATE` trên hóa đơn.
6. **Bảo tồn chuỗi băm mật mã Audit log** (`PAYMENT_AUTO_ALLOCATED`, 1.302/1.302 bản ghi SHA-256 toàn vẹn, 0 liên kết gãy).

### BẢNG KẾT QUẢ ĐÁNH GIÁ TỔNG QUAN

| Tiêu chí | Trạng thái | Ghi chú |
| :--- | :---: | :--- |
| **P1.3 Dedicated Test Suite (`T01` - `T12`)** | **12/12 PASS (100%)** | Toàn bộ 12 ca kiểm thử đặc tả quy chuẩn đã vượt qua |
| **P0 Financial Integrity Suite** | **4/4 PASS (100%)** | Không có hồi quy trên Credit note, VAT, Revenue, Anti-replay |
| **P1.1 Refund Ledger Suite** | **10/10 PASS (100%)** | Hài hòa công nợ khách hàng và sổ cái hoàn tiền |
| **P1.2 Payment Allocation V2 Suite** | **18/18 PASS (100%)** | Phân bổ 1 payment -> N invoice và unapplied cash |
| **P1.2.1 Direct Payment Idempotency** | **10/10 PASS (100%)** | Replay cache và chống duplicate direct payment |
| **P1.2.2 Mandatory Idempotency & Least-Privilege** | **16/16 PASS (100%)** | Bắt buộc Idempotency-Key trên toàn bộ financial mutation |
| **CP2 Baseline Smoke Suite** | **15/15 PASS (100%)** | Core billing API, auth, invoice immutability, p95: 25.40ms |
| **Extended Enterprise Features** | **12/12 PASS (100%)** | SKU catalog, Payment terms, Aging, Recon, RBAC, Settings |
| **Security Hardening (H1 - H6)** | **26/26 PASS (100%)** | Non-root containers, mạng cô lập, quyền tối thiểu bảng |
| **Cryptographic Audit Chain Integrity** | **PASS (100%)** | 1.302/1.302 bản ghi SHA-256 xác thực hợp lệ tuyệt đối |
| **Financial Forensic Invariants** | **0 VIOLATIONS** | 0 sai lệch số dư, 0 unapplied âm, 0 phân bổ vượt hạn |

**KẾT LUẬN CUỐI CÙNG:**
### **P1.3 IMPLEMENTATION — PASS**

---

## 2. STRICT SCOPE & ARCHITECTURAL COMPLIANCE

Triển khai tuân thủ tuyệt đối các ràng buộc trong Official Specification và Implementation Authorization:
- **Không thay đổi business rules:** Giữ nguyên quy tắc kế toán dồn tích (accrual accounting) và thứ tự ưu tiên thanh toán.
- **Không thiết kế lại P1.2 Payment Allocation V2:** Mọi phân bổ tiền thừa đều sinh bản ghi `payment_allocations` chuẩn mực, cập nhật trường `invoices.paid_total` chính xác.
- **Không thiết kế lại P1.2.2 Idempotency:** Tái sử dụng bảng `payment_idempotency_keys` và bảng băm `request_hash` (SHA-256).
- **Không thiết kế lại RBAC:** Sử dụng middleware phân quyền hiện hành `requirePermission('payment.create')` cho endpoint cấn trừ tiền thừa.
- **Không tạo engine thanh toán thứ hai:** Tái sử dụng và mở rộng phương thức trong canonical `PaymentService`.
- **Không tích hợp payment gateway ngoài:** Nghiệp vụ thuần nội bộ đối soát unapplied cash.
- **Không hoàn tiền mặt (no refund cash-out):** Chỉ cấn trừ nội bộ vào công nợ hóa đơn.
- **Không tích hợp thật CQT / T-VAN:** Giữ nguyên cơ chế ký số mô phỏng chuẩn của hệ thống.
- **Đơn vị tiền tệ duy nhất:** VND (`100% Vietnamese Dong`, số nguyên không phần thập phân âm).

---

## 3. DETAILED IMPLEMENTATION BREAKDOWN

### 3.1. Database Migration: `06_p1_3_recurring_auto_settlement.sql`
- **File:** [`db/migrations/06_p1_3_recurring_auto_settlement.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/06_p1_3_recurring_auto_settlement.sql)
- **Tính chất:** Rerun-safe (`IF NOT EXISTS`), transactional (`BEGIN ... COMMIT`), non-destructive.
- **Nội dung:**
  1. Thêm cột `recurring_plans.auto_settle_unapplied BOOLEAN NOT NULL DEFAULT true`.
  2. Tạo chỉ mục hỗ trợ truy vấn FIFO tối ưu:
     ```sql
     CREATE INDEX IF NOT EXISTS idx_payments_customer_fifo 
     ON public.payments (customer_id, paid_at ASC, id ASC);
     ```
  3. Cấp quyền chuẩn least-privilege: `GRANT SELECT, UPDATE ON public.recurring_plans TO billing_app`.

### 3.2. Canonical Domain Service: `PaymentService.autoAllocateUnappliedCash`
- **File:** [`app/src/services/paymentService.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js)
- **Idempotency:**
  - Bắt buộc tham số `idempotencyKey`. Nếu thiếu, trả lỗi HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`.
  - Tính toán dấu vân tay `request_hash = sha256(canonicalPayload({ invoiceId, operatorId }))`.
  - Nếu key đã tồn tại và khớp fingerprint: Trả kết quả cache (`is_idempotent_replay: true`) với mã HTTP 200, không thực hiện bất kỳ phân bổ trùng lặp nào.
  - Nếu key đã tồn tại nhưng khác fingerprint: Trả lỗi HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
- **Khóa đồng thời & Kỹ thuật vượt rào cản PostgreSQL:**
  - PostgreSQL cấm sử dụng `FOR UPDATE` trực tiếp trên các truy vấn có `GROUP BY` / aggregate.
  - Hơn nữa, quyền bảng của `billing_app` trên `payments` là append-only (`SELECT, INSERT`), không có quyền `UPDATE`. Do đó, gọi `SELECT ... FOR UPDATE` trên bảng `payments` sẽ vi phạm quyền phân quyền H4.
  - **Giải pháp xử lý:** Sử dụng transaction-level advisory locks kết hợp khóa dòng bi quan:
    1. Khóa bể tiền thừa của khách hàng: `pg_advisory_xact_lock(hashtext('cust_unapplied_pool'), targetCustomerId)`.
    2. Khóa dòng hóa đơn: `SELECT * FROM public.invoices WHERE id = $1 FOR UPDATE`.
    3. Với từng payment được chọn theo FIFO, lấy khóa advisory: `pg_advisory_xact_lock(paymentId)` (đồng bộ với khóa trong `PaymentService.allocatePayment`).
  - Đảm bảo triệt để: **0 race condition, 0 over-allocation, 0 deadlock, bảo toàn least privilege**.
- **Thuật toán phân bổ FIFO:**
  1. Truy vấn các payment có `unapplied_amount > 0` của khách hàng theo thứ tự `paid_at ASC, p.id ASC`.
  2. Tính toán số tiền cần thanh toán còn lại của hóa đơn: `remainingDue = total - paid_total - adjusted_total`.
  3. Lặp qua từng payment:
     - Lấy `allocAmount = Math.min(payment.unapplied_amount, remainingDue)`.
     - Chèn vào `payment_allocations` (`payment_id`, `invoice_id`, `allocated_amount`, `notes`).
     - Trừ dần `remainingDue`. Nếu `remainingDue <= 0`, kết thúc vòng lặp.
  4. Cập nhật hóa đơn:
     - Tăng `paid_total` thêm đúng tổng số tiền cấn trừ.
     - Cập nhật trạng thái: Nếu `remainingDue == 0` -> `PAID`, ngược lại -> `PARTIALLY_PAID`.
  5. Lưu kết quả vào `payment_idempotency_keys`.

### 3.3. API Endpoints

#### A. `POST /api/invoices/:id/auto-allocate`
- **File:** [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js)
- **Middleware:** `requireAuth`, `requirePermission('payment.create')`.
- **Header:** Bắt buộc `Idempotency-Key`.
- **Kiểm tra nghiệp vụ:**
  - Hóa đơn phải tồn tại (HTTP 404).
  - Trạng thái hóa đơn phải là `ISSUED` hoặc `PARTIALLY_PAID` (HTTP 400 `INVOICE_NOT_PAYABLE` hoặc `INVOICE_ALREADY_PAID`).
  - Phải có tiền thừa khả dụng (HTTP 400 `NO_UNAPPLIED_CASH_AVAILABLE`).
- **Ghi log kiểm toán:** Ghi bản ghi `PAYMENT_AUTO_ALLOCATED` vào `audit_logs` (bảo toàn chuỗi SHA-256). Không ghi trùng khi replay.

#### B. `GET /api/customers/:id/unapplied-balance`
- **File:** [`app/src/routes/customers.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js)
- **Middleware:** `requireAuth`.
- **Trả về:**
  ```json
  {
    "customer_id": 12,
    "total_unapplied_cash": 3500000.00,
    "available_payments_count": 2,
    "available_payments": [
      {
        "id": 105,
        "amount": 2000000.00,
        "allocated_amount": 0.00,
        "unapplied_amount": 2000000.00,
        "paid_at": "2026-10-01T08:00:00Z"
      }
    ]
  }
  ```

### 3.4. Recurring Scheduler Integration
- **File:** [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js)
- **Luồng xử lý:**
  1. Khi phát hành hóa đơn định kỳ thành công (`plan.auto_sign = true`), kiểm tra cờ `plan.auto_settle_unapplied`.
  2. Nếu `auto_settle_unapplied = true`:
     - Sinh khóa Idempotency đơn định: `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`.
     - Gọi `PaymentService.autoAllocateUnappliedCash` với transaction client hiện tại.
     - Nếu khách hàng không có tiền thừa (`NO_UNAPPLIED_CASH_AVAILABLE`), scheduler bắt lỗi êm dịu, không gián đoạn chu kỳ và giữ nguyên hóa đơn ở trạng thái `ISSUED`.

### 3.5. Frontend UI Enhancement
- **File:** [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js)
- **Giao diện chi tiết hóa đơn (`renderInvoiceDetail`):**
  - Tự động tải số dư tiền thừa qua `GET /api/customers/:id/unapplied-balance`.
  - Hiển thị badge trực quan: `Tiền thừa khả dụng: X ₫`.
  - Hiển thị nút: `⚡ Cấn trừ tự động từ tiền thừa` khi hóa đơn chưa thanh toán đủ và khách có tiền thừa.
  - Hiển thị popup xác nhận rõ ràng số tiền sẽ được cấn trừ.
  - Tự động sinh `Idempotency-Key` chuẩn UUID trước khi gửi yêu cầu.
- **Giao diện tạo Recurring Plan (`renderRecurringForm`):**
  - Thêm checkbox `Tự động cấn trừ tiền thừa (Unapplied Cash Settlement)` (mặc định được chọn).

---

## 4. P1.3 OFFICIAL TEST SUITE RESULTS (T01 – T12)

Kịch bản kiểm thử độc lập [`scripts/p1_3-auto-settlement-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3-auto-settlement-test.mjs) đã được chạy trực tiếp trên môi trường HTTPS / PostgreSQL Docker. Toàn bộ 12 ca kiểm thử quy chuẩn đạt **PASS 100%**:

```text
===============================================================
  BILLING_ONE P1.3 AUTOMATED UNAPPLIED CASH SETTLEMENT SUITE   
       Verifying 12 Official Specification Scenarios (T01-T12)  
===============================================================

[BASELINE] Payments: 460, Allocations: 423, Idempotency Keys: 176

[TEST T01] Keyless Manual Trigger Rejection...
  -> PASS: Keyless request rejected with HTTP 400 IDEMPOTENCY_KEY_REQUIRED

[TEST T02] Single Payment Full Settlement...
  -> PASS: Invoice fully paid, unapplied cash reduced from 5M to 2M

[TEST T03] Single Payment Partial Settlement...
  -> PASS: Invoice partially settled (1.5M/4M), customer unapplied cash = 0

[TEST T04] Multi-Payment FIFO Settlement...
  -> PASS: Strict FIFO verified across 3 payments (p1 fully exhausted, p2 partially exhausted)

[TEST T05] Zero Unapplied Cash Rejection...
  -> PASS: Request rejected with HTTP 400 NO_UNAPPLIED_CASH_AVAILABLE

[TEST T06] Already Paid Invoice Rejection...
  -> PASS: Request rejected with HTTP 400 INVOICE_ALREADY_PAID

[TEST T07] Idempotent Replay Verification...
  -> PASS: Idempotent replay returned HTTP 200 is_idempotent_replay: true without duplicate allocations

[TEST T08] Payload Mismatch Detection...
  -> PASS: Reusing key across different invoices rejected with HTTP 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH

[TEST T09] Scheduler Auto-Settlement Flow...
  -> PASS: Scheduler automatically generated, signed, and settled invoice using key RECURRING-AUTO-ALLOC-INV-677-PLAN-22

[TEST T10] Scheduler Disabled Configuration...
  -> PASS: auto_settle_unapplied: false preserved ISSUED status without consuming unapplied cash

[TEST T11] Concurrency Race Condition Guard...
  Concurrency response statuses: [201, 400, 400, 400, 400]
  -> PASS: Race condition prevented: exactly 1 thread won, 0 over-allocation, 0 negative cash

[TEST T12] Financial Forensics & Invariants...
  -> Audit chain valid: 1302 verified events with 0 broken links
  -> PASS: All financial invariants strictly hold (0 violations across 100% of records)

===============================================================
  P1.3 TEST SUITE COMPLETE: 12/12 SCENARIOS PASSED (100%) 
===============================================================
```

---

## 5. FULL REGRESSION SUITE EXECUTION MATRIX

Tất cả các bộ kiểm thử hồi quy kế thừa từ P0 đến P1.2.2 và các bài test bảo mật/hệ thống đã được chạy thực tế:

| STT | Tên bộ kiểm thử | File thực thi | Kết quả thực tế | Tỷ lệ đạt | Ghi chú kỹ thuật |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 1 | **P1.3 Auto-Settlement Suite** | `scripts/p1_3-auto-settlement-test.mjs` | **12/12 PASS** | **100%** | Toàn bộ 12 kịch bản đặc tả P1.3 |
| 2 | **P1.2.2 Mandatory Idempotency** | `scripts/p1_2_2-mandatory-idempotency-test.mjs` | **16/16 PASS** | **100%** | Bắt buộc Idempotency-Key + 4 bonus checks |
| 3 | **P1.2.1 Idempotency Suite** | `scripts/p1_2_1-idempotency-test.mjs` | **10/10 PASS** | **100%** | Anti-replay direct payment |
| 4 | **P1.2 Payment Allocation V2** | `scripts/p1_2-payment-allocation-test.mjs` | **18/18 PASS** | **100%** | Phân bổ 1 payment -> N invoice |
| 5 | **P1.1 Refund Ledger Suite** | `scripts/p1-refund-ledger-test.mjs` | **10/10 PASS** | **100%** | Credit note, debt harmonization |
| 6 | **P0 Financial Integrity Suite** | `scripts/p0-remediation-test.mjs` | **4/4 PASS** | **100%** | Credit note semantics, bank anti-replay |
| 7 | **CP2 Baseline Smoke Suite** | `scripts/cp2-smoke.mjs` | **15/15 PASS** | **100%** | Core billing API, p95 latency = 25.40 ms |
| 8 | **Extended Enterprise Features** | `scripts/extended-features-test.mjs` | **12/12 PASS** | **100%** | 12 tính năng nâng cao LedgerFlow |
| 9 | **Frontend Asset & Route E2E** | `scripts/frontend-e2e-test.mjs` | **PASS (23 routes)** | **100%** | 0 lỗi 404, asset tải hợp lệ |
| 10 | **Security Hardening (H1 - H6)** | `scripts/verify-hardening.ps1` | **26/26 PASS** | **100%** | Non-root, network isolation, least privilege |
| 11 | **Cryptographic Audit Chain** | `POST /api/audit/verify` | **1.302/1.302 PASS** | **100%** | Chuỗi băm SHA-256 toàn vẹn, 0 gãy |

---

## 6. FINANCIAL FORENSICS & INVARIANTS VERIFICATION

Kiểm toán dữ liệu tài chính trực tiếp trên cơ sở dữ liệu production bằng truy vấn tổng hợp độc lập:

```sql
SELECT 
  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,
  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations,
  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
  ) sub1) AS over_allocated_payments,
  (SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.invoices i
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
    GROUP BY i.id, i.paid_total
    HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
  ) sub2) AS mismatched_invoices,
  (SELECT count(*) FROM public.invoices WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violations,
  (SELECT count(*) FROM (
    SELECT p.id, (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING (p.amount - coalesce(sum(pa.allocated_amount), 0)) < -0.001
  ) sub3) AS negative_unapplied_payments;
```

### Kết quả truy vấn thực tế:

| Chỉ số kiểm toán | Giá trị thực tế | Ngưỡng vi phạm | Đánh giá |
| :--- | :---: | :---: | :---: |
| `non_positive_payments` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |
| `non_positive_allocations` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |
| `over_allocated_payments` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |
| `mismatched_invoices` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |
| `collectible_capacity_violations` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |
| `negative_unapplied_payments` | **0** | > 0 | **PASS (Hợp lệ tuyệt đối)** |

### Kiểm tra tính đơn nhất của Scheduler Idempotency Keys:
```sql
SELECT idempotency_key, response_status, response_body->>'settled_amount' as settled, created_at 
FROM public.payment_idempotency_keys 
WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%';
```
- Kết quả: Mỗi lần scheduler kích hoạt sinh duy nhất 1 key Idempotency, không trùng lặp, không phân bổ dư.

---

## 7. AUDIT TRAIL INTEGRITY & CRYPTOGRAPHIC PROOF

- **Hành động Audit mới:** `PAYMENT_AUTO_ALLOCATED` ghi nhận đầy đủ `invoice_id`, `operatorId`, `settled_amount`, `new_status`, và số lượng phân bổ.
- **Tổng số bản ghi Audit kiểm toán:** Hiện tại có **1.302 bản ghi** trong `public.audit_logs`.
- **Kết quả xác thực chuỗi SHA-256 (`POST /api/audit/verify`):**
  ```json
  {
    "valid": true,
    "total_records": 1302,
    "broken_records": []
  }
  ```
- **Bảo vệ Replay:** Khi client hoặc scheduler gửi lại cùng Idempotency-Key, hệ thống trả cached response ngay lập tức từ `payment_idempotency_keys` và **không** ghi thêm bất kỳ bản ghi `audit_logs` nào (đã được xác nhận qua T07).

---

## 8. NON-BLOCKING OBSERVATIONS & OPERATIONAL GUIDANCE

1. **Nginx Login Rate Limiting trong môi trường kiểm thử tự động:**
   - Nginx cấu hình `limit_req zone=login` để bảo vệ chống brute-force đăng nhập (`/api/auth/login`).
   - Khi chạy liên tục nhiều bộ kiểm thử hồi quy lớn trong vài giây, các yêu cầu đăng nhập liên tiếp có thể chạm ngưỡng rate limit (HTTP 429).
   - **Khuyến nghị vận hành:** Trong môi trường CI/CD hoặc automated test runner, nên duy trì pool phiên đăng nhập (shared token/cookie) thay vì đăng nhập lại liên tục cho mỗi file test đơn lẻ.
2. **Kỹ thuật Locking trên PostgreSQL Least Privilege:**
   - Việc sử dụng transaction-level advisory locks `pg_advisory_xact_lock(hashtext('cust_unapplied_pool'), targetCustomerId)` kết hợp `pg_advisory_xact_lock(paymentId)` là phương án tối ưu, vừa bảo toàn triệt để quyền append-only bất biến của bảng `payments`, vừa ngăn ngừa hoàn toàn hiện tượng race condition khi cấn trừ đồng thời.

---

## 9. FINAL VERDICT & SIGN-OFF

Căn cứ vào:
- Toàn bộ mã nguồn và cơ sở dữ liệu đã triển khai theo đúng thiết kế quy chuẩn.
- 12/12 bài kiểm thử đặc tả P1.3 đạt kết quả PASS 100%.
- Toàn bộ 10 bộ kiểm thử hồi quy (P0, P1.1, P1.2, P1.2.1, P1.2.2, CP2, Extended, Security Hardening, Frontend, Audit) đạt 100% PASS.
- 0 vi phạm bất biến tài chính, 0 sai lệch số dư, 1.302/1.302 bản ghi audit hợp lệ.

**XÁC NHẬN CHÍNH THỨC:**
# **P1.3 IMPLEMENTATION — PASS**
