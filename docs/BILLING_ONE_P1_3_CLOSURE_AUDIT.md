# BILLING_ONE — P1.3 INDEPENDENT CLOSURE AUDIT REPORT
## RECURRING BILLING AUTOMATED PAYMENT & UNAPPLIED CASH SETTLEMENT ENGINE
### INDEPENDENT SENIOR FINANCIAL SYSTEMS AUDITOR REPORT

- **Auditor Role:** Independent Senior Financial Systems Auditor
- **Implementation Milestone:** P1.3 Closure Audit
- **Source of Truth Documents:**
  1. [`docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md)
  2. [`docs/BILLING_ONE_P1_3_IMPLEMENTATION_PREFLIGHT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_IMPLEMENTATION_PREFLIGHT.md)
  3. [`docs/BILLING_ONE_P1_3_IMPLEMENTATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_IMPLEMENTATION_REPORT.md)
- **Baseline Git Commit:** `d794de0461e992122a4c8eddadb1ead2082ae8ac`
- **Audit Execution Date:** 2026-10-07
- **Database Engine:** PostgreSQL 16.15 (Least-Privilege Docker Container)
- **Runtime Environment:** Node.js 24 Alpine, Express 5.1.0, Nginx Unprivileged 1.30.5
- **Audit Mode:** Strict Read-Only / Zero Code Modifications / Independent Runtime & Forensic Verification

---

## EXECUTIVE SUMMARY & FINAL AUDIT VERDICT

Kiểm toán viên độc lập cấp cao hệ thống tài chính (Independent Senior Financial Systems Auditor) đã tiến hành kiểm toán toàn diện giai đoạn **P1.3 Recurring Billing Automated Payment & Unapplied Cash Settlement Engine** sau khi hoàn tất triển khai.

Toàn bộ các bằng chứng trong báo cáo này được thu thập thông qua:
1. Thực thi kiểm thử runtime trực tiếp (live execution) trên môi trường HTTPS / PostgreSQL Docker.
2. Trích xuất và đối soát mã nguồn từ baseline `d794de0461e992122a4c8eddadb1ead2082ae8ac`.
3. Chạy các câu lệnh SQL pháp y (financial forensics) độc lập trên cơ sở dữ liệu `billing`.
4. Xác minh chuỗi kiểm toán mật mã SHA-256 (1.464/1.464 bản ghi toàn vẹn).
5. Tái hiện kiểm thử tương tranh (concurrency & race condition) độc lập.

```text
================================================================================
  FINAL AUDIT VERDICT:
  P1.3 VERIFIED WITH WARNINGS
================================================================================
```

> [!NOTE]
> **TÓM TẮT ĐÁNH GIÁ:**
> - Nghiệp vụ cốt lõi P1.3 đã vận hành chính xác 100%: Tự động cấn trừ tiền thừa (Unapplied Cash) cho hóa đơn định kỳ theo đúng thuật toán FIFO (`paid_at ASC, id ASC`), không tạo bản ghi thanh toán giả (`payments` mới = 0), bảo toàn tuyệt đối 100% các phương trình bất biến tài chính (0 vi phạm).
> - Toàn bộ 12 ca kiểm thử P1.3 và 9 bộ kiểm thử hồi quy kế thừa (P0, P1.1, P1.2, P1.2.1, P1.2.2, CP2 Smoke, Extended Features, Hardening 26/26, Frontend Smoke) đều đạt **100% PASS**.
> - **Cảnh báo (Warnings):**
>   1. `FIND-P1.3-01` (Severity: MEDIUM): Độ lệch cấu trúc thuộc tính `metadata` trong sự kiện `PAYMENT_AUTO_ALLOCATED` tại `audit_logs` so với Đặc tả Mục 12 (`allocated_from_unapplied` thay vì `allocated_total`, mảng đối tượng `allocations` thay vì mảng phẳng `payment_ids`, và thiếu trường `idempotency_key` trong `metadata` của audit log dù đã được lưu trong `payment_idempotency_keys`).
>   2. `FIND-P1.3-02` (Severity: LOW): Nguy cơ nghịch đảo thứ tự khóa (Lock Inversion) giữa `PaymentService.allocatePayment` (khóa Payment trước, Invoice sau) và `PaymentService.autoAllocateUnappliedCash` (khóa Invoice trước, Payment sau).

---

## A. SCOPE COMPLIANCE AUDIT

Đối chiếu chi tiết từng điều khoản đặc tả chính thức:

### 1. Đối chiếu Business Rules (BR-1.3-01 → BR-1.3-10)

| Mã Quy tắc | Tên Quy tắc Đặc tả | Yêu cầu Kỹ thuật | Hiện trạng Kiểm toán Thực tế | Đánh giá |
| :--- | :--- | :--- | :--- | :---: |
| **BR-1.3-01** | Recurring Invoice Auto-Settlement | Hóa đơn định kỳ có `auto_settle_unapplied = true` được tự động tìm kiếm và cấn trừ tiền thừa ngay sau phát hành. | Triển khai trong `scheduler.js` và `recurring.js`: Ngay sau khi cấp số `ISSUED`, hệ thống tự động gọi `autoAllocateUnappliedCash`. Đã kiểm chứng qua T09. | **COMPLIANT** |
| **BR-1.3-02** | Strict FIFO Policy | Tiêu thụ tiền thừa ưu tiên: `paid_at ASC`, sau đó `payment.id ASC`. Không dùng LIFO. | Truy vấn FIFO trong `autoAllocateUnappliedCash` có mệnh đề: `ORDER BY p.paid_at ASC, p.id ASC`. Đã kiểm chứng qua T04 (payment cũ bị trừ cạn trước, payment mới trừ sau). | **COMPLIANT** |
| **BR-1.3-03** | Partial Settlement Support | Tiền thừa không đủ tất toán 100% thì cấn trừ hết số dư, đưa hóa đơn về `PARTIALLY_PAID`. | Thuật toán tính `Math.min(unapplied, remainingToAllocate)`. Hóa đơn chuyển trạng thái `PARTIALLY_PAID`, `settlement_type = 'PARTIAL'`. Đã kiểm chứng qua T03. | **COMPLIANT** |
| **BR-1.3-04** | Zero Over-Allocation | Không phân bổ vượt quá giá trị phải thu còn lại của hóa đơn. | Giới hạn phân bổ bằng `remainingToAllocate`. Trigger `check_payment_allocation_invariants()` bảo vệ mức DB engine. 0 vi phạm dung lượng. Đã kiểm chứng qua T02, T03, T12. | **COMPLIANT** |
| **BR-1.3-05** | Canonical Service Reuse | Background scheduler và Manual API dùng chung domain service, không viết SQL trùng lặp. | Cả `invoices.js`, `recurring.js`, và `scheduler.js` đều gọi trực tiếp `PaymentService.autoAllocateUnappliedCash`. Không có câu lệnh SQL allocation riêng lẻ ở route. | **COMPLIANT** |
| **BR-1.3-06** | Mandatory Idempotency | Mọi thao tác cấn trừ phải có `Idempotency-Key`. Scheduler tạo key tất định; API yêu cầu header. | API chặn thiếu key bằng HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`. Key vượt 255 ký tự trả 400 `INVALID_IDEMPOTENCY_KEY`. Scheduler sinh key tất định. Đã kiểm chứng qua T01. | **COMPLIANT** |
| **BR-1.3-07** | Scheduler Idempotent Replay | Khi scheduler chạy lại cho cùng hóa đơn, phát hiện key đã xử lý và bỏ qua, không nhân đôi tiền. | Kiểm tra `payment_idempotency_keys` với matching request hash, trả `is_idempotent_replay: true`. Scheduler bỏ qua không ghi thêm allocation hay audit. Đã kiểm chứng qua T07, T09. | **COMPLIANT** |
| **BR-1.3-08** | No New Payment Record | Cấn trừ tiền thừa chỉ ghi `payment_allocations`. Tuyệt đối không tạo bản ghi mới trong `payments`. | Hàm `autoAllocateUnappliedCash` chỉ thực hiện `INSERT INTO payment_allocations`. Pháp y DB xác nhận số lượng `payments` mới sinh ra từ cấn trừ = 0. | **COMPLIANT** |
| **BR-1.3-09** | Mandatory Audit Trail | Mọi phân bổ thành công ghi nhận sự kiện `PAYMENT_AUTO_ALLOCATED` vào chuỗi băm SHA-256. | Sự kiện được ghi qua `recordAudit`. Chuỗi SHA-256 xác thực hợp lệ 1.464 bản ghi. Tuy nhiên, phát hiện sai lệch schema thuộc tính metadata (xem `FIND-P1.3-01`). | **COMPLIANT WITH WARNING** |
| **BR-1.3-10** | Zero Regression | 100% các bộ test P0, P1.1, P1.2, P1.2.1, P1.2.2 và 26 chốt an ninh H1–H6 tiếp tục PASS. | Kiểm toán viên tự chạy lại toàn bộ 10 bộ kiểm thử hồi quy. 100% đều PASS. | **COMPLIANT** |

### 2. Đối chiếu Yêu cầu Chức năng FR-1.3-01
- Hàm `PaymentService.autoAllocateUnappliedCash` đáp ứng đầy đủ chữ ký:
  `autoAllocateUnappliedCash(client, { customerId, invoiceId, recordedBy, idempotencyKey, source })`
- Quy trình thực thi:
  1. Kiểm tra tính hợp lệ và chiều dài `Idempotency-Key` (bắt buộc, max 255 chars).
  2. Băm fingerprint SHA-256 của payload: `{ action: 'AUTO_ALLOCATE', invoiceId: String(cleanInvoiceId) }`.
  3. Kiểm tra replay trong `payment_idempotency_keys` $\rightarrow$ matching trả HTTP 200 cached; mismatch trả HTTP 409.
  4. Khóa bi quan `invoices FOR UPDATE`.
  5. Khóa advisory trên unapplied pool của khách hàng và từng candidate payment.
  6. Truy vấn số dư unapplied cash theo thứ tự FIFO (`ORDER BY p.paid_at ASC, p.id ASC`).
  7. Phân bổ tuần tự, chèn vào `payment_allocations` với ghi chú tương ứng theo `source`.
  8. Cập nhật `paid_total` và trạng thái `PAID` / `PARTIALLY_PAID` trên `invoices`.
  9. Lưu kết quả cache vào `payment_idempotency_keys`.

### 3. Đối chiếu Acceptance Criteria
- [x] Migration `06_p1_3_recurring_auto_settlement.sql` an toàn, idempotent, rerun-safe.
- [x] Hàm `PaymentService.autoAllocateUnappliedCash` hoạt động chuẩn xác theo FIFO.
- [x] Endpoint `POST /api/invoices/:id/auto-allocate` có bảo vệ `Idempotency-Key`.
- [x] Endpoint `GET /api/customers/:id/unapplied-balance` trả về đúng số dư tiền thừa.
- [x] Background scheduler tự động cấn trừ tiền thừa khi phát hành hóa đơn định kỳ.
- [x] Không tạo bản ghi `payments` mới khi cấn trừ tiền thừa.
- [x] Phân bổ tự động phát sinh bản ghi kiểm toán SHA-256 trong `audit_logs`.
- [x] 12/12 ca kiểm thử P1.3 đạt PASS 100%.
- [x] 10 bộ kiểm thử hồi quy duy trì PASS 100%.
- [x] Pháp y tài chính xác nhận **0 vi phạm bất biến**.

---

## B. DATABASE AUDIT

Kiểm toán viên đã chạy các truy vấn cấu trúc trực tiếp trên PostgreSQL catalog:

### 1. Cột `auto_settle_unapplied` trên `public.recurring_plans`
```sql
SELECT column_name, data_type, column_default, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'recurring_plans' AND column_name = 'auto_settle_unapplied';
```
- **Kết quả thực tế:**
  - `column_name`: `auto_settle_unapplied`
  - `data_type`: `boolean`
  - `column_default`: `true`
  - `is_nullable`: `NO` (NOT NULL được cưỡng chế tuyệt đối)
- **Đánh giá:** Hoàn toàn chính xác theo đặc tả Mục 10.

### 2. Chỉ mục tối ưu hóa FIFO trên `public.payments`
```sql
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'payments' AND indexname LIKE '%fifo%';
```
- **Kết quả thực tế:**
  - `indexname`: `idx_payments_customer_fifo`
  - `indexdef`: `CREATE INDEX idx_payments_customer_fifo ON public.payments USING btree (customer_id, paid_at, id)`
- **Đánh giá:** Chỉ mục composite phủ đúng 3 trường `(customer_id, paid_at ASC, id ASC)`.

### 3. Kiểm tra tính Rerun-Safe của Migration
Kiểm toán viên đã thực thi lại tệp `db/migrations/06_p1_3_recurring_auto_settlement.sql` trên cơ sở dữ liệu đang hoạt động:
```text
BEGIN
DO
NOTICE:  relation "idx_payments_customer_fifo" already exists, skipping
CREATE INDEX
DO
NOTICE:  MIGRATION 06 VERIFIED: recurring_plans.auto_settle_unapplied and idx_payments_customer_fifo are present.
COMMIT
```
- **Kết quả:** Quá trình rerun thực hiện trơn tru, mệnh đề `IF NOT EXISTS` và `DO $$` kiểm tra không gây bất kỳ lỗi nào, không làm gián đoạn hệ thống.

### 4. Kiểm tra Biến động Schema ngoài Scope
So sánh catalog database và `git status db/`:
- Chỉ có duy nhất 1 migration mới: `db/migrations/06_p1_3_recurring_auto_settlement.sql`.
- Không có bất kỳ thay đổi phá hủy (destructive schema change) nào trên các bảng hiện hữu.

---

## C. PAYMENT SERVICE AUDIT

Thẩm tra việc thực thi mã nguồn hàm `PaymentService.autoAllocateUnappliedCash` ([`app/src/services/paymentService.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js)):

1. **Mandatory Idempotency:**
   - Dòng 482-488: Kiểm tra nghiêm ngặt `!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0` $\rightarrow$ ném lỗi HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`.
   - Giới hạn chiều dài: `cleanIdempotencyKey.length > 255` $\rightarrow$ ném lỗi HTTP 400 `INVALID_IDEMPOTENCY_KEY`.
2. **Request Fingerprint & Payload Mismatch:**
   - Dòng 495: `const requestHash = computeAutoAllocateRequestFingerprint(cleanInvoiceId);`
   - Dòng 57: `computeAutoAllocateRequestFingerprint` tạo SHA-256 từ `{ action: 'AUTO_ALLOCATE', invoiceId: String(invoiceId) }`.
   - Dòng 513-516: Nếu key đã tồn tại nhưng `keyRow.request_hash !== requestHash`, ném lỗi HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
3. **Replay Response:**
   - Dòng 517-520: Nếu key đã tồn tại và khớp hash, trả về nguyên vẹn `{ ...keyRow.response_body, is_idempotent_replay: true }`.
4. **Không tạo Payment mới:**
   - Dòng 620-625: Chỉ thực hiện `INSERT INTO public.payment_allocations`. Không có bất kỳ lệnh INSERT nào vào bảng `payments`.
5. **Thứ tự phân bổ FIFO:**
   - Dòng 565-575: Truy vấn lấy danh sách payments có `unapplied_amount > 0` với sắp xếp `ORDER BY p.paid_at ASC, p.id ASC`.
   - Vòng lặp phân bổ (dòng 593-607) duyệt tuần tự theo danh sách này, trừ dần số tiền cần cấn trừ `remainingToAllocate`.
6. **Full vs Partial Settlement:**
   - Full Settlement: Khi tổng unapplied cash $\ge$ outstanding, hóa đơn được cập nhật trạng thái `PAID`, `settlement_type = 'FULL'`.
   - Partial Settlement: Khi tổng unapplied cash $<$ outstanding, cấn trừ toàn bộ tiền thừa khả dụng, hóa đơn chuyển sang `PARTIALLY_PAID`, `settlement_type = 'PARTIAL'`.
7. **Already-Paid & Zero-Unapplied Handling:**
   - Dòng 546-556: Nếu hóa đơn đã ở trạng thái `PAID` hoặc `outstanding <= 0.0001`, ném lỗi HTTP 400 `INVOICE_ALREADY_PAID`.
   - Dòng 578-580 & 609-611: Nếu khách hàng không có khoản tiền thừa nào khả dụng, ném lỗi HTTP 400 `NO_UNAPPLIED_CASH_AVAILABLE`.

---

## D. API AUDIT

### 1. `POST /api/invoices/:id/auto-allocate` ([`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js))
- **Xác thực & Phân quyền:**
  - Route được bảo vệ bởi 2 middleware: `requireAuth` và `requirePermission('payment.create')`.
  - Người dùng ẩn danh bị chặn với HTTP 401 `UNAUTHENTICATED`.
  - Người dùng không có quyền `payment.create` bị chặn với HTTP 403 `FORBIDDEN`.
- **Ràng buộc Idempotency:**
  - Sử dụng hàm `extractAndRequireIdempotencyKey(req)`. Nếu thiếu header `Idempotency-Key`, lập tức trả về HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`.
- **Giao dịch Nguyên tử (Atomicity):**
  - Toàn bộ lời gọi service được bọc trong `inTransaction(async (client) => { ... })`. Khi có bất kỳ lỗi nào xảy ra (mismatch, validation, zero cash), toàn bộ giao dịch bị rollback, bảo đảm **Zero DB Mutation on rejected key**.
- **Ngữ nghĩa HTTP (HTTP Semantics):**
  - Lần đầu thực thi thành công: Trả về HTTP `201 Created`.
  - Replay thành công (cùng key, cùng payload): Trả về HTTP `200 OK` kèm `is_idempotent_replay: true`.
  - Xung đột payload: Trả về HTTP `409 Conflict`.
  - Lỗi nghiệp vụ (hóa đơn đã trả, không có tiền thừa): Trả về HTTP `400 Bad Request`.

### 2. `GET /api/customers/:id/unapplied-balance` ([`app/src/routes/customers.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js))
- **Bảo mật & Phân quyền:**
  - Kế thừa middleware cấp router: `router.use(requireAuth)`. Bắt buộc phiên đăng nhập hợp lệ.
- **Tính chất Read-Only:**
  - Chỉ thực hiện câu lệnh SELECT, không khóa hàng, không làm thay đổi trạng thái dữ liệu.
- **Cấu trúc Dữ liệu Trả về:**
  - Trả về đúng định dạng: `customer_id`, `customer_name`, `total_unapplied_cash`, `available_payments_count`, và mảng danh sách `payments` (với các trường `id`, `amount`, `allocated_amount`, `unapplied_amount`, `paid_at`, `method`, `reference`).

---

## E. SCHEDULER AUDIT

Thẩm tra việc tích hợp trong Background Scheduler ([`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js)) và Manual Trigger Route ([`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js)):

1. **Thứ tự Thực thi (Issue Before Allocation):**
   - Hóa đơn định kỳ được tạo nháp (`DRAFT`), sau đó bước `auto_sign` cấp số hóa đơn chính thức (`invoice_no`) và đưa về trạng thái `ISSUED`.
   - Chỉ sau khi hóa đơn đã đạt trạng thái `ISSUED` thì logic cấn trừ tiền thừa mới được kích hoạt.
2. **Cấu hình Cờ `auto_settle_unapplied`:**
   - Khi `plan.auto_settle_unapplied = false`: Hệ thống bỏ qua bước cấn trừ, hóa đơn phát hành giữ nguyên trạng thái `ISSUED`, không trừ tiền thừa của khách hàng (Đã kiểm chứng qua T10).
   - Khi `plan.auto_settle_unapplied = true`: Hệ thống tự động kích hoạt cấn trừ (Đã kiểm chứng qua T09).
3. **Quy tắc Sinh Khóa Tất định (Deterministic Key Derivation):**
   - Cấu trúc khóa:
     $$\text{autoAllocKey} = \text{RECURRING-AUTO-ALLOC-INV-}\{\text{createdInvoice.id}\}\text{-PLAN-}\{\text{plan.id}\}$$
   - Khóa là tất định tuyệt đối, không chứa hàm thời gian ngẫu nhiên (`Date.now()`).
4. **An toàn khi Scheduler Rerun:**
   - Nếu chu kỳ định kỳ chạy lại cho cùng một hóa đơn, lời gọi `autoAllocateUnappliedCash` với khóa tất định sẽ nhận diện được bản ghi trong `payment_idempotency_keys` và trả về `is_idempotent_replay: true`.
   - Scheduler kiểm tra `if (!allocResult.is_idempotent_replay)` trước khi ghi log kiểm toán, ngăn ngừa việc nhân đôi log kiểm toán hoặc nhân đôi phân bổ tiền.
5. **Xử lý Trường hợp Khách hàng Không có Tiền thừa:**
   - Bắt êm dịu lỗi `allocErr.code === 'NO_UNAPPLIED_CASH_AVAILABLE'`, ghi log INFO và tiếp tục chu trình bình thường mà không làm hỏng giao dịch phát hành hóa đơn định kỳ.

---

## F. CONCURRENCY & LOCK ORDERING AUDIT

Kiểm toán viên đã phân tích chuyên sâu kiến trúc khóa đồng thời và thực hiện kiểm chứng thực nghiệm:

### 1. Phân tích Khóa Đa Tầng (Multi-Tier Locking Analysis)
Trong `autoAllocateUnappliedCash`:
- **Bước 1:** Lấy khóa cố vấn 64-bit cấp giao dịch trên Idempotency Key:
  `SELECT pg_advisory_xact_lock(hashtext('idemp_auto_alloc'), hashtext($1))`
- **Bước 2:** Lấy khóa dòng bi quan trên hóa đơn thụ hưởng:
  `SELECT ... FROM invoices WHERE id = $1 FOR UPDATE`
- **Bước 3:** Lấy khóa cố vấn trên bể tiền thừa của khách hàng:
  `SELECT pg_advisory_xact_lock(hashtext('cust_unapplied_pool'), targetCustomerId)`
- **Bước 4:** Lấy khóa cố vấn trên từng payment candidate theo thứ tự ID tăng dần:
  `SELECT pg_advisory_xact_lock(pId)`

### 2. Thẩm tra Nguy cơ Nghịch đảo Thứ tự Khóa (Lock Inversion Risk)
Kiểm toán viên so sánh thứ tự chiếm khóa giữa 2 phương thức phân bổ trong `PaymentService`:
- Trong `allocatePayment` (P1.2):
  1. Chiếm khóa advisory trên Payment: `pg_advisory_xact_lock(paymentId)`
  2. Chiếm khóa dòng trên Invoice: `SELECT ... FROM invoices FOR UPDATE`
- Trong `autoAllocateUnappliedCash` (P1.3):
  1. Chiếm khóa dòng trên Invoice: `SELECT ... FROM invoices FOR UPDATE`
  2. Chiếm khóa advisory trên Payment: `pg_advisory_xact_lock(paymentId)`

> [!WARNING]
> **PHÁT HIỆN KIẾN TRÚC (`FIND-P1.3-02`):**
> Thứ tự chiếm khóa bị nghịch đảo (Inverse Lock Acquisition Order):
> - Luồng A chạy `allocatePayment` khóa Payment $P$ trước rồi chờ khóa Invoice $I$.
> - Luồng B chạy `autoAllocateUnappliedCash` khóa Invoice $I$ trước rồi chờ khóa Payment $P$.
> Nếu hai luồng này diễn ra đồng thời tại cùng một mili-giây, PostgreSQL sẽ phát hiện Deadlock (`40P01`) sau thời gian `deadlock_timeout` và chủ động rollback một trong hai giao dịch.
> Trong thực tế vận hành, xác suất xảy ra xung đột này rất thấp vì hóa đơn mới sinh ra thường được cấn trừ ngay trước khi kế toán viên thao tác phân bổ thủ công từ màn hình thanh toán. Tuy nhiên, đây là một điểm cần ghi nhận kiến trúc.

### 3. Thẩm tra Thực nghiệm Chuyên biệt Ca Kiểm thử T11

Yêu cầu kiểm toán đặc biệt:
> *Nếu 5 request concurrent cho cùng target trả: `[201, 400, 400, 400, 400]`*  
> *Phải xác định rõ:*  
> *- request 1 allocation thật*  
> *- 4 request còn lại là replay hợp lệ? hoặc 4 request thực sự thất bại do invoice đã PAID?*  
> *Nếu là trường hợp thứ hai, đánh giá đây có phải deviation so với BR-1.3-07 hay không.*

#### Kết quả điều tra thực nghiệm của Kiểm toán viên:
1. **Kiểm tra mã nguồn kịch bản kiểm thử T11 (`scripts/p1_3-auto-settlement-test.mjs`):**
   ```javascript
   // T11 tạo 5 request đồng thời với 5 Idempotency Key HOÀN TOÀN KHÁC NHAU:
   headers: { 'Idempotency-Key': `t11-concurrent-${Date.now()}-${i}` }
   ```
2. **Cơ chế diễn ra tại Runtime:**
   - Vì 5 request có **5 khóa Idempotency khác nhau**, chúng được coi là **5 yêu cầu độc lập**, KHÔNG PHẢI là replay của nhau.
   - Request đầu tiên chiếm được khóa dòng hóa đơn (`FOR UPDATE`), thấy hóa đơn ở trạng thái `ISSUED`, thực hiện cấn trừ 2.000.000 ₫ và cập nhật hóa đơn sang `PAID`. Request này hoàn tất và trả về **HTTP 201 Created**.
   - 4 request tiếp theo tuần tự chiếm được khóa dòng hóa đơn, đọc thấy hóa đơn hiện tại đã là `PAID`. Mã nguồn tại dòng 546-548 của `paymentService.js` kích hoạt:
     ```javascript
     if (invoice.status === 'PAID') {
       throw new AppError(400, 'INVOICE_ALREADY_PAID', `Invoice ${invoice.invoice_no} is already fully paid.`);
     }
     ```
   - Do đó, 4 request này **thực sự thất bại do hóa đơn đã PAID**, trả về **HTTP 400 `INVOICE_ALREADY_PAID`**.
3. **Kiểm tra đối chứng: Nếu 5 request đồng thời gửi CÙNG MỘT KHÓA Idempotency:**
   Kiểm toán viên đã xây dựng kịch bản kiểm tra độc lập gửi 5 request đồng thời với **cùng một Idempotency-Key**:
   - **Kết quả trả về:**
     $$\text{Statuses} = [201, 200, 200, 200, 200]$$
     $$\text{Replay Flags} = [\text{false}, \text{true}, \text{true}, \text{true}, \text{true}]$$
   - Request đầu tiên tạo phân bổ (201). Cả 4 request còn lại đợi khóa advisory trên idempotency key, sau đó đọc cache và trả về **HTTP 200 OK Idempotent Replay**.

#### Đánh giá Tuân thủ BR-1.3-07:
- **Quy tắc BR-1.3-07** quy định: *"Khi một chu kỳ định kỳ chạy lại cho cùng một hóa đơn, hệ thống phát hiện idempotency key đã xử lý và bỏ qua, tuyệt đối không nhân đôi phân bổ."*
- Khi chạy lại với **cùng một khóa**, hệ thống hoạt động hoàn toàn chính xác theo cơ chế Idempotent Replay (trả về HTTP 200 / `is_idempotent_replay: true`).
- Ca kiểm thử T11 kiểm tra tình huống **5 luồng khác nhau cùng tranh chấp cấn trừ một hóa đơn (khóa khác nhau)**: Hệ thống ngăn chặn thành công việc cấn trừ kép bằng cách cho 1 luồng thành công và từ chối 4 luồng còn lại với lỗi `INVOICE_ALREADY_PAID`.
- **Kết luận:** **Đây KHÔNG PHẢI là deviation so với BR-1.3-07**, mà là hành vi chính xác và an toàn tuyệt đối của hệ thống nhằm bảo vệ hóa đơn không bị phân bổ vượt mức (Xem chi tiết tại `FIND-P1.3-03`).

---

## G. IDEMPOTENCY AUDIT

1. **Khóa Advisory Cấp Giao dịch:**
   - Trước khi kiểm tra bảng dữ liệu, hàm chiếm khóa `pg_advisory_xact_lock(hashtext('idemp_auto_alloc'), hashtext(cleanIdempotencyKey))`.
   - Khóa tự động giải phóng khi transaction commit hoặc rollback.
2. **Dấu vân tay Yêu cầu (Request Fingerprint):**
   - Fingerprint được tính toán qua SHA-256 đối với cấu trúc chuẩn: `{ action: 'AUTO_ALLOCATE', invoiceId: String(cleanInvoiceId) }`.
3. **Phản hồi từ Cache (Idempotent Replay):**
   - Đã kiểm chứng qua T07 và bài test độc lập: Gửi lại cùng key trả HTTP 200, nội dung phản hồi giống hệt lần đầu, kèm cờ `is_idempotent_replay: true`.
   - Không sinh thêm bất kỳ bản ghi `payment_allocations` nào.
4. **Bảo vệ Xung đột Payload (Payload Conflict):**
   - Đã kiểm chứng qua T08: Sử dụng lại cùng một khóa cho một hóa đơn khác bị từ chối ngay lập tức với HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
5. **Quyền hạn Bảng `payment_idempotency_keys`:**
   - Role `billing_app` chỉ có quyền `SELECT, INSERT`.
   - Các thao tác `UPDATE` và `DELETE` trên bảng này bị cấm tuyệt đối (đã kiểm chứng qua T15 và T16 của suite P1.2.2).

---

## H. AUDIT CHAIN AUDIT

1. **Hành động Audit Mới:**
   - Tên hành động: `PAYMENT_AUTO_ALLOCATED`
   - Module: `payments`
   - Severity: `INFO`
   - Actor: Tên người dùng thực hiện (Manual) hoặc `'SystemScheduler'` (Cron).
   - Target Ref: Mã hóa đơn (Ví dụ: `INV-2026-000551`).
2. **Bảo vệ Chống Nhân đôi Log:**
   - Khi request được xác định là Idempotent Replay (`is_idempotent_replay: true`), hệ thống bỏ qua việc gọi `recordAudit`, bảo đảm không làm phình chuỗi kiểm toán.
3. **Xác thực Toàn vẹn Chuỗi Mật mã SHA-256:**
   Kiểm toán viên đã gọi trực tiếp endpoint `POST /api/audit/verify`:
   ```json
   {
     "verified": true,
     "valid": true,
     "verified_count": 1464,
     "total_records": 1464,
     "message": "Toàn vẹn chuỗi kiểm toán SHA-256: 100% bản ghi (1464) đã được xác thực an toàn tuyệt đối."
   }
   ```
   - **Kết quả:** Toàn bộ **1.464/1.464 bản ghi** đều có liên kết băm SHA-256 hợp lệ, 0 liên kết gãy.
4. **Phát hiện Lệch Schema Metadata (`FIND-P1.3-01`):**
   - Bảng `audit_logs.metadata` thực tế lưu trữ:
     `{"allocated_from_unapplied": "...", "allocations": [{"allocation_id": ..., "payment_id": ...}], ...}`
   - Thay vì các trường theo văn bản Đặc tả Mục 12:
     `{"allocated_total": "...", "payment_ids": [...], "idempotency_key": "..."}`.
   - Chi tiết được phân tích tại Mục M (`FIND-P1.3-01`).

---

## I. FINANCIAL FORENSICS AUDIT

Kiểm toán viên đã trực tiếp thực thi các truy vấn pháp y tài chính độc lập trên cơ sở dữ liệu PostgreSQL `billing`:

```sql
SELECT 
  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
  ) s1) AS over_allocated_payments,

  (SELECT count(*) FROM (
    SELECT p.id, (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied
    FROM public.payments p
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
    GROUP BY p.id, p.amount
    HAVING (p.amount - coalesce(sum(pa.allocated_amount), 0)) < -0.001
  ) s2) AS negative_unapplied_payments,

  (SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum
    FROM public.invoices i
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id
    GROUP BY i.id, i.paid_total
    HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
  ) s3) AS invoice_allocation_mismatches,

  (SELECT count(*) FROM public.invoices WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violations,

  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,

  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations,

  (SELECT count(*) FROM (
    SELECT idempotency_key, count(*) 
    FROM public.payment_idempotency_keys 
    WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%' 
    GROUP BY idempotency_key HAVING count(*) > 1
  ) dup_keys) AS duplicate_scheduler_keys,

  (SELECT count(*) FROM (
    SELECT invoice_id, payment_id, notes, count(*) 
    FROM public.payment_allocations 
    WHERE notes = 'Tự động cấn trừ theo chu kỳ thuê bao định kỳ'
    GROUP BY invoice_id, payment_id, notes HAVING count(*) > 1
  ) dup_sched_allocs) AS duplicate_scheduler_allocations,

  (SELECT count(*) FROM public.payments 
   WHERE reference LIKE '%AUTO-ALLOC%' OR notes LIKE '%cấn trừ%') AS new_payments_by_p1_3;
```

### Bảng Kết quả Pháp y Độc lập

| Chỉ số Pháp y Tài chính | Ngưỡng Vi phạm | Kết quả Thực tế | Đánh giá Kiểm toán |
| :--- | :---: | :---: | :---: |
| **Payment Over-Allocation** (`over_allocated_payments`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Negative Unapplied Cash** (`negative_unapplied_payments`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Invoice Allocation Mismatch** (`invoice_allocation_mismatches`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Collectible Capacity Violation** (`collectible_capacity_violations`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Non-Positive Payment Amount** (`non_positive_payments`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Non-Positive Allocation Amount** (`non_positive_allocations`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Duplicate Scheduler Keys** (`duplicate_scheduler_keys`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **Duplicate Scheduler Allocations** (`duplicate_scheduler_allocations`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |
| **New Payments Generated by P1.3** (`new_payments_by_p1_3`) | $> 0$ | **0** | **PASS (Bảo toàn 100%)** |

---

## J. SECURITY, RBAC & LEAST PRIVILEGE AUDIT

1. **Phân quyền Database Role `billing_app`:**
   - Quyền trên `public.payments`: `SELECT, INSERT` (Append-Only tuyệt đối). Lệnh `UPDATE` hoặc `DELETE` bị chặn bởi PostgreSQL engine.
   - Quyền trên `public.payment_idempotency_keys`: `SELECT, INSERT` (Bị cấm `UPDATE, DELETE`).
   - Quyền trên `public.payment_allocations`: `SELECT, INSERT`.
   - Quyền trên `public.recurring_plans`: `SELECT, INSERT, UPDATE`.
   - Quyền trên `public.invoices`: `SELECT, INSERT, UPDATE`.
2. **Bảo vệ Endpoint Phân quyền Ứng dụng:**
   - `POST /api/invoices/:id/auto-allocate` yêu cầu bắt buộc quyền `payment.create`. Role `admin` và role `staff` (mặc định có `payment.create`) được phép thực hiện; các role khác hoặc phiên không hợp lệ bị từ chối.
   - `GET /api/customers/:id/unapplied-balance` yêu cầu bắt buộc đăng nhập `requireAuth`.
3. **Hardening Check H1–H6:**
   - Toàn bộ 26 chốt chặn bảo mật hạ tầng và Docker isolation tiếp tục đạt **26/26 PASS**.

---

## K. INDEPENDENT REGRESSION AUDIT RESULTS

Kiểm toán viên đã trực tiếp thực thi toàn bộ 10 bộ kiểm thử hiện có của dự án. Không sử dụng kết quả trích dẫn từ báo cáo triển khai:

| STT | Bộ Kiểm thử (Suite Name) | Tệp Thực thi | Số Ca Kiểm thử | Kết quả Thực tế | Đánh giá |
| :---: | :--- | :--- | :---: | :---: | :---: |
| 1 | **P1.3 Dedicated Auto-Settlement Suite** | `scripts/p1_3-auto-settlement-test.mjs` | 12 | **12/12 PASS** | **100% PASS** |
| 2 | **P1.2.2 Mandatory Idempotency & Hardening** | `scripts/p1_2_2-mandatory-idempotency-test.mjs` | 16 | **16/16 PASS** | **100% PASS** |
| 3 | **P1.2.1 Direct Payment Idempotency** | `scripts/p1_2_1-idempotency-test.mjs` | 10 | **10/10 PASS** | **100% PASS** |
| 4 | **P1.2 Payment Allocation V2 Suite** | `scripts/p1_2-payment-allocation-test.mjs` | 18 | **18/18 PASS** | **100% PASS** |
| 5 | **P1.1 Refund Ledger & Credit Note Suite** | `scripts/p1-refund-ledger-test.mjs` | 10 | **10/10 PASS** | **100% PASS** |
| 6 | **P0 Financial Integrity Suite** | `scripts/p0-remediation-test.mjs` | 4 | **4/4 PASS** | **100% PASS** |
| 7 | **CP2 Baseline Smoke Suite** | `scripts/cp2-smoke.mjs` | 15 | **15/15 PASS** | **100% PASS (p95: 22.31ms)** |
| 8 | **Extended Enterprise Features Suite** | `scripts/extended-features-test.mjs` | 12 | **12/12 PASS** | **100% PASS** |
| 9 | **Frontend Static & Route Smoke Suite** | `scripts/frontend-e2e-test.mjs` | 23 routes | **23/23 PASS** | **100% PASS (Zero 404)** |
| 10 | **Security Hardening Verification (H1–H6)** | `scripts/verify-hardening.ps1` | 26 | **26/26 PASS** | **100% PASS** |

---

## L. GIT & CODE SCOPE AUDIT

Đối chiếu Git diff đối với baseline commit `d794de0461e992122a4c8eddadb1ead2082ae8ac`:

### 1. Thống kê Tệp Thay đổi (Files Changed)
```text
 app/public/app.js                  |  51 ++++++-
 app/src/routes/customers.js        |   8 ++
 app/src/routes/invoices.js         |  40 ++++++
 app/src/routes/payments.js         |   2 +-
 app/src/routes/recurring.js        |  54 +++++--
 app/src/scheduler.js               |  52 +++++++
 app/src/services/paymentService.js | 288 +++++++++++++++++++++++++++++++++++++
 7 files changed, 481 insertions(+), 14 deletions(-)
```

### 2. Danh mục Tệp Mới (Untracked Files)
- `db/migrations/06_p1_3_recurring_auto_settlement.sql` (Migration duy nhất cho P1.3)
- `scripts/p1_3-auto-settlement-test.mjs` (Bộ test chuyên biệt cho P1.3)
- Các tài liệu dự án liên quan (`BILLING_ONE_P1_3_*`).

### 3. Đánh giá Phạm vi (Scope Confinement)
- Toàn bộ các thay đổi trong 7 tệp mã nguồn đều phục vụ trực tiếp cho các yêu cầu P1.3:
  - `payments.js`: Xuất hàm tiện ích `extractAndRequireIdempotencyKey`.
  - `customers.js`: Bổ sung route `GET /api/customers/:id/unapplied-balance`.
  - `invoices.js`: Bổ sung route `POST /api/invoices/:id/auto-allocate`.
  - `recurring.js`: Bổ sung cấu hình `auto_settle_unapplied` và gọi cấn trừ trong trigger endpoint.
  - `scheduler.js`: Bổ sung logic tự động cấn trừ khi phát hành hóa đơn định kỳ.
  - `paymentService.js`: Bổ sung `autoAllocateUnappliedCash`, `getCustomerUnappliedBalance`, và hàm băm fingerprint.
  - `app.js`: Bổ sung hiển thị số dư, nút cấn trừ, và checkbox cấu hình.
- **Xác nhận:** Không có bất kỳ thay đổi nào nằm ngoài phạm vi (Out of Scope) của P1.3.

---

## M. AUDIT FINDINGS

Kiểm toán viên ghi nhận 5 phát hiện kiểm toán chi tiết:

---

### FIND-P1.3-01: Discrepancy in `audit_logs.metadata` Schema for `PAYMENT_AUTO_ALLOCATED`
- **Severity:** `MEDIUM`
- **Status:** `OPEN`
- **Evidence:**
  Trong văn bản Đặc tả Chính thức Mục 12 ([`docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md)), cấu trúc `metadata` của sự kiện kiểm toán `PAYMENT_AUTO_ALLOCATED` được quy định:
  ```json
  {
    "invoice_id": 105,
    "invoice_no": "INV-2026-000105",
    "allocated_total": "2500000.00",
    "allocations_count": 1,
    "payment_ids": [415],
    "idempotency_key": "RECURRING-AUTO-ALLOC-INV-105-PLAN-3",
    "invoice_status": "PAID"
  }
  ```
  Trong mã nguồn triển khai thực tế (`invoices.js`, `recurring.js`, `scheduler.js`), hệ thống gán trực tiếp đối tượng kết quả trả về từ `autoAllocateUnappliedCash` vào trường `metadata`:
  ```json
  {
    "success": true,
    "invoice_id": 715,
    "invoice_no": "INV-2026-000551",
    "invoice_status": "PAID",
    "previous_paid_total": "0.00",
    "new_paid_total": "2000000.00",
    "allocated_from_unapplied": "2000000.00",
    "settlement_type": "FULL",
    "allocations": [
      {
        "allocation_id": 465,
        "payment_id": 555,
        "allocated_amount": "2000000.00",
        "created_at": "..."
      }
    ],
    "remaining_unapplied_cash": "0.00",
    "is_idempotent_replay": false
  }
  ```
  **Sự khác biệt cụ thể:**
  1. Trường `allocated_total` bị đổi tên thành `allocated_from_unapplied`.
  2. Trường `payment_ids: [...]` và `allocations_count` được thay thế bằng mảng đối tượng chi tiết `allocations: [{ payment_id, ... }]`.
  3. Trường `idempotency_key` bị thiếu trong trường `metadata` của bảng `audit_logs` (mặc dù đã được lưu trong bảng `payment_idempotency_keys`).
- **Impact:**
  - Không ảnh hưởng đến tính toàn vẹn tài chính hoặc chuỗi băm SHA-256 (chuỗi băm vẫn tính toán hợp lệ trên dữ liệu thực tế).
  - Tuy nhiên, nếu có hệ thống bên ngoài hoặc công cụ tuân thủ (compliance parser) phụ thuộc cứng vào cấu trúc schema đặc tả của Mục 12 thì sẽ gặp lỗi thiếu trường `idempotency_key` hoặc sai tên trường `allocated_total`.
- **Recommendation:**
  Trong chu kỳ bảo trì tiếp theo, bổ sung trường `idempotency_key` vào `resultPayload` của `autoAllocateUnappliedCash` và chuẩn hóa tên trường để tương thích 100% với đặc tả.

---

### FIND-P1.3-02: Inverse Lock Acquisition Order between `allocatePayment` and `autoAllocateUnappliedCash`
- **Severity:** `LOW`
- **Status:** `OPEN`
- **Evidence:**
  - `PaymentService.allocatePayment` (P1.2):
    1. Chiếm khóa advisory trên payment: `pg_advisory_xact_lock(paymentId)`
    2. Chiếm khóa dòng bi quan trên invoice: `SELECT ... FROM invoices FOR UPDATE`
  - `PaymentService.autoAllocateUnappliedCash` (P1.3):
    1. Chiếm khóa dòng bi quan trên invoice: `SELECT ... FROM invoices FOR UPDATE`
    2. Chiếm khóa advisory trên unapplied pool của khách hàng: `pg_advisory_xact_lock(hashtext('cust_unapplied_pool'), targetCustomerId)`
    3. Chiếm khóa advisory trên candidate payments: `pg_advisory_xact_lock(pId)`
- **Impact:**
  - Tồn tại khả năng xảy ra deadlock (lỗi `40P01`) nếu một nhân viên kế toán bấm phân bổ thủ công từ màn hình Payment cho hóa đơn $I$ đúng vào mili-giây mà scheduler hoặc kế toán khác bấm cấn trừ tự động cho chính hóa đơn $I$.
  - PostgreSQL sẽ tự động ngắt một giao dịch sau `deadlock_timeout` và rollback an toàn mà không làm hỏng dữ liệu tài chính.
- **Recommendation:**
  Chuẩn hóa thứ tự khóa trên toàn bộ các phương thức của `PaymentService`: Luôn chiếm khóa advisory trên khách hàng/payment trước hoặc luôn khóa Invoice trước.

---

### FIND-P1.3-03: Clarification of Test T11 Concurrency Outcome
- **Severity:** `INFO`
- **Status:** `CLOSED`
- **Evidence:**
  - Trong bộ kiểm thử `scripts/p1_3-auto-settlement-test.mjs`, kịch bản T11 gửi 5 request đồng thời với 5 Idempotency Key khác nhau, trả về kết quả `[201, 400, 400, 400, 400]`.
  - Kiểm toán viên đã xác minh: Request đầu tiên cấn trừ thành công đưa hóa đơn về `PAID`; 4 request còn lại không phải là replay mà là 4 yêu cầu độc lập mới bị từ chối chính xác vì hóa đơn đã thanh toán xong (`INVOICE_ALREADY_PAID`).
  - Khi gửi 5 request đồng thời với cùng 1 Idempotency Key, hệ thống trả về đúng `[201, 200, 200, 200, 200]` (1 thành công, 4 replay).
- **Impact:**
  - Xác nhận T11 chứng minh khả năng chống Race Condition và ngăn chặn Over-allocation tuyệt đối khi nhiều luồng cùng gửi yêu cầu thanh toán độc lập.
  - Không vi phạm quy tắc BR-1.3-07.

---

### FIND-P1.3-04: Qualification of `scripts/frontend-e2e-test.mjs`
- **Severity:** `INFO`
- **Status:** `CLOSED`
- **Evidence:**
  - Tệp `scripts/frontend-e2e-test.mjs` kiểm tra HTTP 200 cho các tệp tĩnh HTML, CSS, JS, trích xuất biểu thức chính quy các endpoint trong `app.js` và kiểm tra quyền gọi API qua HTTP fetch.
  - Tệp này không khởi chạy trình duyệt thật (như Playwright hay Puppeteer) để click nút hay kiểm tra giao diện DOM tương tác.
- **Impact:**
  - Cần định danh chính xác tệp này là **HTTP & Static Asset Integration Smoke Test**, không gọi là End-to-End Browser Test.

---

### FIND-P1.3-05: Nginx Login Rate Limiting during Automated Test Suites
- **Severity:** `INFO`
- **Status:** `CLOSED`
- **Evidence:**
  - Nginx cấu hình `limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m; limit_req zone=login burst=5 nodelay;` trên `/api/auth/login`.
  - Khi chạy liên tiếp nhiều bộ kiểm thử lớn trong thời gian dưới 1 phút, các yêu cầu đăng nhập liên tiếp chạm ngưỡng rate-limit và nhận về phản hồi HTML lỗi HTTP 429.
- **Impact:**
  - Đây là tính năng bảo vệ an ninh chống tấn công brute-force theo đúng thiết kế (Hardening H5).
  - Trong môi trường kiểm thử CI/CD, cần duy trì token phiên đăng nhập dùng chung hoặc thêm khoảng nghỉ 2–3 giây giữa các bộ kiểm thử.

---

## N. AUDIT SUMMARY TABLE

```
┌──────────────────────────────────────────┬──────────────┬─────────────────────────┐
│ KIỂM TRA MỤC TIÊU                        │ KẾT QUẢ      │ GHI CHÚ KIỂM TOÁN       │
├──────────────────────────────────────────┼──────────────┼─────────────────────────┤
│ 1. Spec Compliance (BR-01 → BR-10)       │ PASS         │ 10/10 Quy tắc đạt chuẩn │
│ 2. Functional Spec (FR-1.3-01)           │ PASS         │ Đầy đủ 9 bước quy chuẩn │
│ 3. Database Schema & Migration 06        │ PASS         │ NOT NULL, FIFO Index    │
│ 4. Domain Service (PaymentService)       │ PASS         │ FIFO, Idemp, No-New-Pay │
│ 5. API Endpoints (Auto-alloc & Balance)  │ PASS         │ Auth, RBAC, Semantics   │
│ 6. Scheduler Integration                 │ PASS         │ Deterministic Key, Safe │
│ 7. Concurrency & Race Condition Guard    │ PASS         │ 0 Over-alloc, 0 âm tiền │
│ 8. Cryptographic Audit Chain Integrity   │ PASS (100%)  │ 1.464/1.464 toàn vẹn    │
│ 9. Financial Forensic Invariants         │ 0 VIOLATION  │ 0 sai lệch trên toàn DB │
│ 10. Regression Suites (10/10 Suites)     │ 100% PASS    │ Toàn bộ 10 bộ test PASS │
│ 11. Security Hardening (H1 → H6)         │ 26/26 PASS   │ Least Privilege duy trì │
│ 12. Git Scope Confinement                │ IN-SCOPE     │ Không có code ngoài lề  │
└──────────────────────────────────────────┴──────────────┴─────────────────────────┘
```

---

## O. FINAL AUDIT CONCLUSION & SIGN-OFF

Căn cứ vào kết quả kiểm toán độc lập:
1. Toàn bộ các yêu cầu nghiệp vụ và kỹ thuật cốt lõi của **P1.3 Recurring Billing Automated Payment & Unapplied Cash Settlement Engine** đã được triển khai hoàn chỉnh, hoạt động chuẩn xác và bảo toàn tuyệt đối 100% các phương trình bất biến tài chính.
2. Không phát hiện bất kỳ sai lệch công nợ, số dư âm, hay phân bổ vượt mức nào trên toàn bộ cơ sở dữ liệu.
3. Toàn bộ 10 bộ kiểm thử chuyên biệt và kiểm thử hồi quy đều đạt tỷ lệ thành công 100%.
4. Hai phát hiện kiểm toán `FIND-P1.3-01` (độ lệch thuộc tính metadata trong audit log) và `FIND-P1.3-02` (nghịch đảo thứ tự khóa) không gây rủi ro phá vỡ tính đúng đắn của dữ liệu tài chính tại thời điểm hiện tại và được ghi nhận ở mức cảnh báo để cải tiến trong chu kỳ tới.

```text
================================================================================
  OFFICIAL AUDIT SIGN-OFF:
  P1.3 VERIFIED WITH WARNINGS
================================================================================
```

*Báo cáo kiểm toán độc lập hoàn tất. Không thực hiện chỉnh sửa mã nguồn.*
