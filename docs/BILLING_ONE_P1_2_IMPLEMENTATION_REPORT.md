# BILLING_ONE — P1.2 IMPLEMENTATION REPORT
## CHUẨN HÓA THANH TOÁN, PHÂN BỔ TIỀN VÀ UNAPPLIED CASH (PAYMENT ALLOCATION V2)

- **Phase:** P1.2 — Payment Allocation V2
- **Author:** Senior Backend/Database Engineer
- **Environment:** Production-grade Docker Compose (`billing-web`, `billing-postgres`, `billing-nginx`, `billing-redis`, etc.)
- **Database:** PostgreSQL 16
- **Status:** **COMPLETE — 100% PASS**
- **Date:** 2026-10-07

---

## 1. EXECUTIVE SUMMARY

P1.2 giải quyết triệt để khiếm khuyết cốt lõi trong mô hình tài chính kế toán của hệ thống Billing_One: **Sự phụ thuộc cứng giữa Payment và Invoice (`payments.invoice_id NOT NULL`)**. Trước P1.2, mỗi Payment bị trói buộc vào duy nhất 1 Invoice, khiến hệ thống không thể xử lý các nghiệp vụ tài chính thực tế như:
- Một giao dịch chuyển khoản thanh toán cho nhiều hóa đơn (1 Payment $\rightarrow$ $N$ Invoices).
- Thanh toán trước / nạp tiền / thanh toán chưa xác định hóa đơn (Unapplied Cash).
- Thanh toán vượt quá dư nợ (Overpayment chuyển thành Unapplied Cash thay vì bị ép hoặc ghi nhận sai).
- Phân bổ linh hoạt dòng tiền từ số dư Unapplied Cash cho các hóa đơn phát sinh sau.

P1.2 đã tái cấu trúc mô hình dòng tiền thành công:
1. **Dòng tiền thực tế (Cash Inflow):** Đại diện bởi bảng `public.payments`, gắn với khách hàng (`customer_id`), độc lập hoàn toàn với `invoice_id`.
2. **Nguồn sự thật phân bổ (Source of Truth):** Bảng `public.payment_allocations` là nơi duy nhất xác định số tiền từ Payment nào được áp dụng cho Invoice nào.
3. **Bất biến cốt lõi (Core Invariant):** 
   $$\text{Payment.amount} = \text{Allocated Total} + \text{Unapplied Cash}$$
   $$0 \le \text{Allocated Total} \le \text{Payment.amount}, \quad \text{Unapplied Cash} \ge 0$$
   $$\text{Invoice.paid\_total} = \sum(\text{Allocations})$$
4. **An toàn giao dịch & Đồng thời:** Transaction boundaries nghiêm ngặt, transaction-level advisory locks kết hợp khóa hóa đơn theo thứ tự ID tăng dần để ngăn ngừa tuyệt đối race condition và deadlock.
5. **Least Privilege & Bảo mật:** Giữ vững nguyên tắc append-only trên bảng `public.payments` (H4.2, H4.3 passed 100%).
6. **Di chuyển dữ liệu lịch sử an toàn:** Toàn bộ 279 legacy payments ($1,534,252,250.00$ ₫) đã được phân bổ 1:1 sang `payment_allocations`, đảm bảo không nhân đôi tiền, không làm lệch dù chỉ 1 đồng.

---

## 2. CURRENT ARCHITECTURE BEFORE P1.2

Trước P1.2:
- Bảng `payments` có cột `invoice_id BIGINT NOT NULL`.
- Nghiệp vụ ghi nhận thanh toán `POST /api/invoices/:id/payments` trực tiếp chèn vào `payments` với `invoice_id` và ngay sau đó gọi `UPDATE invoices SET paid_total = paid_total + $amount`.
- Bảng `payment_allocations` tồn tại trong schema ban đầu nhưng chỉ có 66 bản ghi thử nghiệm rời rạc (trong khi có 279 payments), hoàn toàn không đồng bộ và không phải là nguồn sự thật.
- Khách hàng nộp 5.000.000 ₫ để trả 2 hóa đơn (2.000.000 ₫ và 3.000.000 ₫) bị ép phải tách thành 2 giao dịch Payment giả tạo trong hệ thống, làm sai lệch đối soát sao kê ngân hàng (Bank Reconciliation).
- Tiền thừa (Overpayment) bị reject hoặc làm `paid_total > total`.

---

## 3. ARCHITECTURE AFTER P1.2

```
                       ┌──────────────────────┐
                       │   Bank Transaction   │
                       └──────────┬───────────┘
                                  │ (Reconciliation Match)
                                  ▼
                       ┌──────────────────────┐
                       │       Payment        │
                       │  amount = 5.000.000  │
                       │ customer_id = CUST-1 │
                       └──────────┬───────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         │                                                 │
         ▼                                                 ▼
┌─────────────────────────┐                     ┌─────────────────────────┐
│   Payment Allocation    │                     │   Payment Allocation    │
│    amount = 2.000.000   │                     │    amount = 3.000.000   │
└────────────┬────────────┘                     └────────────┬────────────┘
             │                                                 │
             ▼                                                 ▼
┌─────────────────────────┐                     ┌─────────────────────────┐
│        Invoice A        │                     │        Invoice B        │
│   paid_total += 2.000K  │                     │   paid_total += 3.000K  │
└─────────────────────────┘                     └─────────────────────────┘
```

- **Một Payment $\rightarrow$ Nhiều Allocations $\rightarrow$ Nhiều Invoices.**
- **Unapplied Cash:** Khi tổng phân bổ < `amount`, phần còn lại là Unapplied Cash.
- **Canonical Payment Service:** [app/src/services/paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) là entrypoint tập trung duy nhất thực hiện:
  - `createPayment`: Tạo dòng tiền, tùy chọn phân bổ ngay lập tức.
  - `allocatePayment`: Phân bổ số dư Unapplied Cash cho danh sách hóa đơn với transaction và lock bảo vệ.
  - `getPaymentDetails`: Tính toán động `allocated_total` và `unapplied_amount`.
  - `getInvoiceAllocations`: Lấy toàn bộ lịch sử phân bổ tiền vào hóa đơn.

---

## 4. DATABASE CHANGES

1. **Bảng `public.payments`:**
   - Thêm cột `customer_id BIGINT REFERENCES customers(id) ON DELETE RESTRICT`.
   - Index: `payments_customer_id_idx ON payments(customer_id)`.
   - Chuyển `invoice_id` thành Nullable: `ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL`.
2. **Bảng `public.payment_allocations`:**
   - Thêm cột `created_by BIGINT REFERENCES users(id) ON DELETE SET NULL`.
   - Thêm cột `notes TEXT`.
   - Index tối ưu: `payment_allocations_payment_idx`, `payment_allocations_invoice_idx`, `payment_allocations_created_at_idx`.
   - Check constraint: `CHECK (allocated_amount > 0)`.
3. **Database Trigger Guard (`trg_check_payment_allocation_invariants`):**
   - Đảm bảo ở cấp engine PostgreSQL:
     - `SUM(allocated_amount) <= payments.amount`.
     - `SUM(allocated_amount) <= invoices.total - invoices.adjusted_total`.
4. **Least-Privilege Role Grants:**
   - Cấp quyền chặt chẽ cho `billing_app`: `GRANT SELECT, INSERT ON public.payments TO billing_app` (Không cấp `UPDATE`, `DELETE` để bảo vệ tính bất biến tài chính).
   - `GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO billing_app`.

---

## 5. MIGRATION DETAILS

File migration chuẩn: [db/migrations/03_p1_2_payment_allocation_v2.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/03_p1_2_payment_allocation_v2.sql)

Các bước thực thi tự động trong migration:
1. `ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS customer_id BIGINT;`
2. Backfill `payments.customer_id` từ `invoices.customer_id` đối với tất cả Payment có liên kết invoice.
3. Ràng buộc FK `payments_customer_id_fkey` và Index.
4. `ALTER TABLE public.payments ALTER COLUMN invoice_id DROP NOT NULL;`
5. Thêm `created_by` và `notes` vào `payment_allocations`.
6. **Backfill Legacy Allocations:**
   - Truy vấn tất cả payment có `invoice_id IS NOT NULL` nhưng chưa có trong `payment_allocations`.
   - Insert vào `payment_allocations` với số tiền bằng chính `p.amount`.
   - Kết quả: Đã tạo 213 allocations tương ứng, nâng tổng số allocations từ 66 lên 279 bản ghi, khớp 100% với 279 payments lịch sử ($1,534,252,250.00$ ₫).
7. Tạo function và trigger kiểm soát bất biến: `check_payment_allocation_invariants()`.
8. Thiết lập quyền phân quyền (Grant & Revoke) cho các role `billing_app`, `billing_readonly`.

---

## 6. PAYMENT SEMANTICS

- Một Payment đại diện cho **tiền thực tế đã vào tài khoản / quỹ**.
- Payment thuộc về một khách hàng (`customer_id`).
- `amount > 0` bắt buộc.
- Payment không trực tiếp làm tăng `paid_total` của Invoice chỉ vì nó tồn tại; nó chỉ làm tăng `paid_total` khi có bản ghi trong `payment_allocations`.
- Payment là đối tượng **Append-Only** (không sửa, không xóa).

---

## 7. ALLOCATION SEMANTICS

- Mỗi Allocation là một liên kết: `Payment ID` $\rightarrow$ `Invoice ID` $\rightarrow$ `allocated_amount`.
- Bắt buộc `allocated_amount > 0`.
- Tổng các `allocated_amount` của một Payment không bao giờ được vượt quá `payment.amount`.
- Phân bổ cho một Invoice không bao giờ được vượt quá số tiền còn nợ:
  $$\text{Invoice Outstanding} = \text{Invoice.total} - \text{Invoice.paid\_total} - \text{Invoice.adjusted\_total}$$
- Khi phân bổ thành công cho Invoice, `Invoice.paid_total` tăng tương ứng và trạng thái Invoice tự động cập nhật:
  - Nếu `outstanding == 0`: Trạng thái chuyển thành `PAID`.
  - Nếu `outstanding > 0`: Trạng thái chuyển thành `PARTIALLY_PAID`.

---

## 8. UNAPPLIED CASH SEMANTICS

- Định nghĩa:
  $$\text{Unapplied Cash} = \text{Payment.amount} - \sum_{\text{allocations}} \text{allocated\_amount}$$
- Khi khách hàng trả tiền trước hoặc thanh toán nhiều hơn tổng dư nợ các hóa đơn, phần chênh lệch được bảo lưu trọn vẹn dưới dạng `unapplied_amount`.
- Unapplied Cash **KHÔNG** được tính là doanh thu của hóa đơn (Invoice Revenue) hay giảm trừ công nợ của bất kỳ hóa đơn nào cho đến khi được phân bổ rõ ràng.
- Endpoint `POST /api/payments/:id/allocations` cho phép phân bổ dần số dư `unapplied_amount` vào các hóa đơn mới theo thời gian.

---

## 9. BANK RECONCILIATION INTEGRATION

Tất cả các luồng khớp giao dịch sao kê ngân hàng trong [app/src/routes/reconciliation.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js) (cả Auto-Match và Manual-Match) đã được tích hợp qua `PaymentService.createPayment`:
1. Khi phát hiện giao dịch ngân hàng khớp hóa đơn:
   - Hệ thống tạo 1 Payment gắn với khách hàng của hóa đơn, tham chiếu giao dịch ngân hàng.
   - Hệ thống tự động tạo Allocation tương ứng cho hóa đơn đó.
   - Cập nhật liên kết `bank_transactions.matched_payment_id` và `matched_invoice_id`.
2. Trường hợp Replay Protection:
   - Ràng buộc duy nhất `bank_transactions_matched_payment_idx` ngăn chặn tuyệt đối một giao dịch ngân hàng bị đối soát và tạo thanh toán hai lần.
   - Thử nghiệm khớp lại giao dịch đã matched trả về lỗi 409 Conflict.

---

## 10. LEGACY DATA MIGRATION FINDINGS

Kiểm tra số liệu trước và sau migration:
- **Số lượng payments trước migration:** 279 payments ($1,534,252,250.00$ ₫).
- **Số lượng allocations trước migration:** 66 allocations ($301,757,250.00$ ₫).
- **Số allocations được backfill an toàn:** 213 allocations ($1,232,495,000.00$ ₫).
- **Tổng số allocations sau migration:** 279 allocations ($1,534,252,250.00$ ₫).
- **Độ lệch tài chính (Financial Variance):** **0.00 ₫ (Khớp 100%)**.
- Không có bất kỳ khoản tiền nào bị nhân đôi hoặc bị mất mát.

---

## 11. FINANCIAL INVARIANTS

| Invariant | Công thức kiểm chứng | Kết quả kiểm tra | Trạng thái |
|---|---|---|---|
| **Payment Integrity** | `payments.amount > 0` | 0 vi phạm trên toàn bộ DB | **VALID** |
| **Allocation Integrity** | `payment_allocations.allocated_amount > 0` | 0 vi phạm trên toàn bộ DB | **VALID** |
| **Zero Orphan Allocations** | Mọi allocation đều trỏ tới Payment và Invoice hợp lệ | 0 vi phạm | **VALID** |
| **Payment Capacity** | $\sum(\text{Allocations}) \le \text{Payment.amount}$ | 0 vi phạm | **VALID** |
| **Cash Conservation** | $\text{Allocated Total} + \text{Unapplied Cash} = \text{Payment.amount}$ | 0 vi phạm | **VALID** |
| **Invoice Capacity** | `paid_total <= total - adjusted_total` | 0 vi phạm | **VALID** |
| **Invoice Ledger Equivalence** | `Invoice.paid_total == SUM(allocated_amount)` | 0 vi phạm | **VALID** |
| **Bank Replay Protection** | Mỗi `bank_transaction` chỉ có tối đa 1 `matched_payment_id` | 0 vi phạm | **VALID** |

---

## 12. TEST RESULTS (18 MANDATORY BUSINESS TEST CASES)

Bộ kiểm thử mục tiêu P1.2: [scripts/p1_2-payment-allocation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs)

```
===============================================================
       BILLING_ONE P1.2 PAYMENT ALLOCATION V2 TEST SUITE       
Testing 1 Payment -> N Invoices, Unapplied Cash, & Concurrency 
===============================================================

--- TEST 1: 1 Payment -> 1 Invoice ---
[PASS] Test 1: 1 Payment -> 1 Invoice successfully settled.

--- TEST 2: 1 Payment -> 2 Invoices (5M -> 2M + 3M) ---
[PASS] Test 2: Exactly 1 Payment distributed to 2 Invoices with zero unapplied cash.

--- TEST 3: Partial payment (Invoice 8M, Payment 3M) ---
[PASS] Test 3: Partial payment keeps invoice in PARTIALLY_PAID with correct outstanding.

--- TEST 4: Payment exceeds invoice outstanding (5M -> Alloc 2M, Unapplied 3M) ---
[PASS] Test 4: Overpayment correctly leaves 3M as unapplied cash.

--- TEST 5: Pure unapplied cash (Payment 10M, 0 Allocations) ---
[PASS] Test 5: Pure payment created with 100% unapplied cash balance.

--- TEST 6: Subsequent allocation from unapplied cash ---
[PASS] Test 6: Subsequent allocations consumed unapplied cash down to exactly 0.

--- TEST 7: Over-allocation rejection ---
[PASS] Test 7: Over-allocating beyond available payment cash rejected with 409.

--- TEST 8: Zero/negative allocation rejection ---
[PASS] Test 8: Zero allocation amount rejected with 400.

--- TEST 9: Non-existent invoice rejection ---
[PASS] Test 9: Non-existent invoice rejected with 404.

--- TEST 10: Non-existent payment rejection ---
[PASS] Test 10: Non-existent payment rejected with 404.

--- TEST 11: Idempotent payment application ---
[PASS] Test 11: Fully paid invoice cannot receive duplicate payments.

--- TEST 12: Bank reconciliation canonical Payment & Allocation flow ---
[PASS] Test 12: Bank reconciliation integrated into canonical Payment & Allocation flow.

--- TEST 13: Concurrency protection on Payment unapplied amount ---
[PASS] Test 13: Concurrent allocations safely prevented over-allocating payment.

--- TEST 14: Concurrency protection on Invoice capacity ---
[PASS] Test 14: Concurrent allocation safely locked invoice from exceeding total capacity.

--- TEST 15: Transaction Rollback Atomicity ---
[PASS] Test 15: Transaction rollback ensures all-or-nothing allocation atomicity.

--- TEST 16: Historical Data Integrity & Allocation Reconciliation ---
[PASS] Test 16: Historical payments count verified (289 total payments).

--- TEST 17: Customer debt harmonization ---
[PASS] Test 17: Customer debt strictly harmonized at 10000000.00 ₫.

--- TEST 18: Reporting & Cash Collection Invariants ---
[PASS] Test 18: Reporting pure cash collected (1585252250.00 ₫) is perfectly consistent.

===============================================================
ALL 18 P1.2 PAYMENT ALLOCATION V2 TESTS PASSED WITH 100% SUCCESS!
===============================================================
```

---

## 13. REGRESSION RESULTS

| Test Suite | File / Command | Số lượng test | Kết quả | Ghi chú |
|---|---|---|---|---|
| **P1.2 Core Suite** | `scripts/p1_2-payment-allocation-test.mjs` | 18 | **18/18 PASS** | Multi-allocation, Unapplied cash, Concurrency, Rollback |
| **P1.1 Refund Ledger** | `scripts/p1-refund-ledger-test.mjs` | 10 | **10/10 PASS** | Credit Note, Paid Invoice, Refund Payables |
| **CP2 Smoke Suite** | `scripts/cp2-smoke.mjs` | 15 | **15/15 PASS** | Core billing API, Session, Auth, Invoices |
| **Extended Features** | `scripts/extended-features-test.mjs` | 12 | **12/12 PASS** | All 12 Enterprise modules (Recon, Aging, DSO, etc.) |
| **Security Hardening** | `scripts/verify-hardening.ps1` | 21 | **21/21 PASS** | H1-H6, Append-only `payments` (H4.2, H4.3) |
| **Frontend E2E** | `scripts/frontend-e2e-test.mjs` | 23 routes | **23/23 PASS** | Zero 404s, Static shell & JS bundle verified |
| **Audit Hash Trail** | `GET /api/audit/verify` | 600 records | **100% VALID** | Toàn vẹn chuỗi băm mật mã SHA-256 |

---

## 14. API CHANGES

1. **`POST /api/payments`:**
   - Hỗ trợ tạo Payment gắn với `customer_id`.
   - Cho phép truyền kèm mảng `allocations: [{ invoice_id, amount }]` hoặc không truyền (để lưu Unapplied Cash).
2. **`POST /api/payments/:id/allocations` / `POST /api/payments/allocate`:**
   - Phân bổ số dư chưa gán của Payment vào danh sách hóa đơn.
   - Xử lý trong transaction, áp dụng advisory lock trên payment và `FOR UPDATE` trên invoices (theo thứ tự ID tăng dần để chống deadlock).
3. **`GET /api/payments/:id`:**
   - Trả về chi tiết: `amount`, `allocated_total`, `unapplied_amount`, danh sách allocations (kèm invoice code, invoice total), và thông tin bank transaction nếu có.
4. **`GET /api/payments`:**
   - Liệt kê thanh toán kèm `allocated_total`, `unapplied_amount`, và `customer_name`.
5. **`POST /api/invoices/:id/payments`:**
   - Giữ tương thích ngược hoàn toàn (Backward Compatible). Đằng sau hậu trường, route này chuyển đổi yêu cầu thành cuộc gọi canonical `PaymentService.createPayment` với 1 allocation tương ứng.

---

## 15. FRONTEND CHANGES

File: [app/public/app.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js)
- Cập nhật hàm `renderPayments`:
  - Cột Khách hàng: Hiển thị tên khách hàng gắn với Payment.
  - Cột Tổng tiền: Hiển thị tổng số tiền thực nhận.
  - Cột Đã phân bổ: Hiển thị `allocated_total`.
  - Cột Unapplied Cash: Hiển thị `unapplied_amount` kèm badge cảnh báo/thông tin (màu vàng cảnh báo nếu còn tiền chưa phân bổ, màu xám nhạt nếu đã phân bổ hết).
  - Không còn hiển thị Payment như thể nó chỉ thuộc về duy nhất một hóa đơn.

---

## 16. KNOWN LIMITATIONS

1. **Giao dịch nhiều đồng tiền tệ (Multi-currency):** Phiên bản hiện tại tập trung chuẩn hóa trên đồng VND theo chuẩn kế toán Việt Nam. Việc phân bổ giữa các đồng tiền tệ khác nhau (USD/VND exchange rate revaluation tại thời điểm allocation) được để lại cho phase Multi-Currency chuyên biệt.
2. **Hủy phân bổ (De-allocation / Re-allocation):** Do bảng `payments` và `payment_allocations` tuân thủ nguyên tắc kế toán dồn tích (Accrual Ledger), việc hủy phân bổ cần được thực hiện qua bút toán đảo (Reversal Allocation) thay vì trực tiếp xóa dòng; điều này sẽ được cung cấp trong màn hình Dispute/Reversal chuyên sâu.

---

## 17. FILES CHANGED

- [app/src/services/paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) *(New - Canonical Payment & Allocation Service)*
- [db/migrations/03_p1_2_payment_allocation_v2.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/03_p1_2_payment_allocation_v2.sql) *(New - Database Migration V2)*
- [scripts/p1_2-payment-allocation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs) *(New - Test Suite 18 Cases)*
- [docs/BILLING_ONE_P1_2_PRE_IMPLEMENTATION_CHECKPOINT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_PRE_IMPLEMENTATION_CHECKPOINT.md) *(New - Pre-implementation Baseline)*
- [docs/BILLING_ONE_P1_2_IMPLEMENTATION_REPORT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_IMPLEMENTATION_REPORT.md) *(New - This Report)*
- [app/src/routes/payments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js) *(Modified - Migration to canonical service)*
- [app/src/routes/invoices.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js) *(Modified - Query payments via allocations)*
- [app/src/routes/reconciliation.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js) *(Modified - Bank match flow via canonical service)*
- [app/src/routes/customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js) *(Modified - Link payments via customer_id & allocations)*
- [app/public/app.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js) *(Modified - UI reflects unapplied cash & multi-allocations)*

---

## 18. MIGRATION FILE

Đường dẫn: [db/migrations/03_p1_2_payment_allocation_v2.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/03_p1_2_payment_allocation_v2.sql)

Tóm tắt logic SQL:
- Đảm bảo tính lặp lại (Idempotent): Sử dụng `IF NOT EXISTS` và `ON CONFLICT DO NOTHING`.
- Backfill `customer_id` trên `payments` từ `invoices`.
- Bỏ ràng buộc `NOT NULL` trên `payments.invoice_id`.
- Backfill toàn bộ dữ liệu lịch sử vào `payment_allocations`.
- Trigger `trg_check_payment_allocation_invariants` xác thực dung lượng phân bổ tức thời.

---

## 19. GIT COMMIT / HEAD THỰC TẾ

- **Pre-P1.2 HEAD Commit:** `a26e95f` (`feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix`)
- **Working Tree State:** Clean, all tests passing.
- **P1.2 Commit Hash:** `ab539c3` (`feat(p1.2): implement payment allocation v2, unapplied cash, and canonical payment service`)

---

## 20. FINAL VERDICT

# **P1.2 VERDICT: COMPLETE & CERTIFIED**

Hệ thống thanh toán, phân bổ tiền và quản lý Unapplied Cash của Billing_One đã hoàn thành 100% các tiêu chí nghiệm thu của P1.2:
- [x] Một Payment có thể phân bổ cho $N$ Invoices.
- [x] Payment không còn phụ thuộc bắt buộc vào một Invoice.
- [x] `payment_allocations` là nguồn sự thật duy nhất của việc gán tiền vào hóa đơn.
- [x] Partial payment hoạt động chuẩn mực.
- [x] Overpayment chuyển thành Unapplied Cash chính xác.
- [x] Unapplied Cash được theo dõi chặt chẽ, không bị ghi nhận nhầm là doanh thu hóa đơn.
- [x] $\text{allocated\_total} \le \text{payment.amount}$.
- [x] $\text{allocated\_total} + \text{unapplied} = \text{payment.amount}$ được bảo đảm trên toàn hệ thống.
- [x] `Invoice.paid_total` nhất quán 100% với allocations.
- [x] Bank reconciliation sử dụng luồng chuẩn Payment + Allocation.
- [x] Không duplicate Payment khi replay sao kê.
- [x] Concurrency protection chống race condition và deadlock đã được kiểm chứng.
- [x] Toàn bộ dữ liệu lịch sử được di chuyển an toàn mà không nhân đôi tiền.
- [x] Toàn bộ các bộ kiểm thử P1.2, P1.1, CP2 Smoke, Extended Features, Hardening, và Frontend E2E đều đạt tỷ lệ vượt qua **100%**.
