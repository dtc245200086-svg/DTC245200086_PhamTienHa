# BÁO CÁO TRIỂN KHAI P1.2.2 — MANDATORY PAYMENT IDEMPOTENCY & LEAST-PRIVILEGE HARDENING

- **Hệ thống:** Billing_One Enterprise Financial Core
- **Phiên bản:** P1.2.2
- **Người thực hiện:** Senior Backend/Database Engineer
- **Thời gian hoàn tất:** 2026-10-07
- **Mục tiêu:** Remediation dứt điểm hai finding còn tồn tại từ P1.2.1 Closure Audit:
  1. `FIND-P1.2.1-01` (Medium): Keyless Direct Payment Deduplication Gap.
  2. `FIND-P1.2.1-02` (Low): Excessive Grants on Idempotency Table (`public.payment_idempotency_keys`).

---

## 1. FINDING REMEDIATION

### A. FIND-P1.2.1-01 — Keyless Direct Payment Deduplication Gap (Medium)
- **Vấn đề trước P1.2.2:** Khi gọi `POST /api/payments`, `POST /api/invoices/:id/payments`, hoặc các endpoint phân bổ mà không truyền `Idempotency-Key`, hệ thống vẫn thực thi thanh toán bình thường ("No key $\rightarrow$ execute normally"). Nếu client gặp lỗi mạng sau khi server xử lý xong và thực hiện retry mà không có key, giao dịch bị lặp tạo ra duplicate Payment và lạm phát tiền mặt.
- **Giải pháp P1.2.2:**
  - Bắt buộc `Idempotency-Key` (hoặc header tương thích ngược `X-Idempotency-Key` / thuộc tính `body.idempotency_key`) trên mọi endpoint có khả năng tạo đột biến tài chính (`POST /api/payments`, `POST /api/invoices/:id/payments`, `POST /api/payments/:id/allocations`, `POST /api/payments/allocate`).
  - Request thiếu key bị từ chối ngay lập tức với **HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`**, bảo đảm **Zero Financial Effect**: Không tạo Payment, không tạo Allocation, không thay đổi Invoice, không thay đổi Unapplied Cash, không ghi audit log.
  - Tại tầng service (`PaymentService.createPayment` & `PaymentService.allocatePayment`), kiểm tra và bắt buộc `idempotencyKey` để ngăn chặn bất kỳ caller nội bộ nào bỏ qua chốt chặn idempotency.

### B. FIND-P1.2.1-02 — Excessive Grants on Idempotency Table (Low)
- **Vấn đề trước P1.2.2:** Migration 04 đã cấp `GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_idempotency_keys TO billing_app`. Tuy nhiên bảng Idempotency Key về bản chất là nhật ký ghi nhận append-only; application role không bao giờ được phép sửa đổi (`UPDATE`) hoặc xóa (`DELETE`) các bản ghi khóa.
- **Giải pháp P1.2.2:**
  - Tạo và thực thi Migration 05: [db/migrations/05_p1_2_2_idempotency_hardening.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/05_p1_2_2_idempotency_hardening.sql).
  - Thu hồi toàn bộ quyền `UPDATE, DELETE` khỏi `billing_app`: `REVOKE UPDATE, DELETE ON public.payment_idempotency_keys FROM billing_app;`.
  - Cấp quyền tối thiểu: `billing_app` chỉ có `SELECT, INSERT`; `billing_readonly` chỉ có `SELECT`.
  - Kiểm tra và xác nhận mã nguồn ứng dụng 100% không có bất kỳ câu lệnh `UPDATE` hay `DELETE` nào trên bảng `payment_idempotency_keys`.

---

## 2. BEFORE / AFTER POLICY MATRIX

| Tiêu chí | Trước P1.2.2 (P1.2.1) | Sau P1.2.2 | Ghi chú an toàn |
| :--- | :--- | :--- | :--- |
| **Yêu cầu Idempotency Key** | Tùy chọn (Optional). Không truyền key vẫn tạo Payment | **Bắt buộc (Mandatory)** trên mọi endpoint thanh toán / phân bổ | Loại bỏ hoàn toàn lỗ hổng duplicate thanh toán do thiếu key |
| **Hành vi khi thiếu Key** | Thực thi giao dịch bình thường | Trả về **HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`** | **Zero mutation**: DB hoàn toàn nguyên vẹn |
| **Thứ tự xác thực (Error Ordering)** | Validate payload trước, key sau | **Validate Idempotency Key trước tiên** | Request thiếu key + amount = 0 luôn trả về `IDEMPOTENCY_KEY_REQUIRED` |
| **Xung đột Header & Body Key** | Âm thầm ưu tiên header | Trả về **HTTP 400 `CONFLICTING_IDEMPOTENCY_KEYS`** | Không cho phép âm thầm chọn key khi client truyền mâu thuẫn |
| **Độ dài & Định dạng Key** | Kiểm tra cơ bản | Bắt buộc 1–255 ký tự, không chứa ký tự điều khiển; format khuyến nghị: UUID v4 | Chống injection và tràn buffer |
| **Quyền của role `billing_app` trên `payment_idempotency_keys`** | `SELECT, INSERT, UPDATE, DELETE` | **Chỉ `SELECT, INSERT`** (Đã thu hồi `UPDATE, DELETE`) | Least privilege: Nhật ký append-only bất biến |
| **Quyền của role `billing_readonly`** | `SELECT` | **Chỉ `SELECT`** | Không có quyền ghi |
| **Bank Reconciliation Auto/Manual Match** | Không truyền key tường minh vào PaymentService | Truyền key xác định: `BANK-TX-MATCH-${tx.id}` | Đảm bảo 1 bank transaction $\leftrightarrow$ đúng 1 canonical payment |

---

## 3. API BEHAVIOR CHANGE

### A. Endpoint chịu ảnh hưởng trực tiếp
1. `POST /api/payments` (Ghi nhận thanh toán trực tiếp / thanh toán kèm phân bổ).
2. `POST /api/invoices/:id/payments` (Ghi nhận thanh toán cho một hóa đơn cụ thể).
3. `POST /api/payments/:id/allocations` (Phân bổ số tiền chưa phân bổ `unapplied_amount` của thanh toán hiện hữu).
4. `POST /api/payments/allocate` (Phân bổ thanh toán tổng cho nhiều hóa đơn).

### B. Hành vi khi Request thiếu Key
- **Mã phản hồi:** HTTP 400 Bad Request.
- **Cấu trúc JSON phản hồi:**
```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REQUIRED",
    "message": "Idempotency-Key header is required for payment mutations.",
    "request_id": "7809618b-5975-408a-b8bb-692ae82c0df6"
  }
}
```
- **Hệ quả trên Database:** Hoàn toàn bằng không (Zero financial effect):
  - Không tạo dòng mới trong `payments`.
  - Không tạo dòng mới trong `payment_allocations`.
  - Không thay đổi `paid_total` hoặc `status` trong `invoices`.
  - Không thay đổi công nợ `current_debt` của khách hàng.
  - Không ghi log giả mạo trong `audit_logs`.

### C. Chính sách Header Canonical & Tương thích ngược
- **Canonical Header:** `Idempotency-Key`.
- **Nguồn tương thích ngược được hỗ trợ:** `X-Idempotency-Key` (header), `idempotency_key` (JSON body).
- **Quy tắc phát hiện xung đột:** Nếu client cung cấp key ở nhiều nguồn (ví dụ cả header `Idempotency-Key` và `body.idempotency_key`), hệ thống đối chiếu giá trị:
  - Nếu trùng khớp: Chấp nhận key.
  - Nếu khác biệt: Từ chối ngay lập tức với **HTTP 400 `CONFLICTING_IDEMPOTENCY_KEYS`**, không âm thầm lựa chọn một trong hai.

---

## 4. IDEMPOTENCY ENFORCEMENT & FINGERPRINT SEMANTICS

### A. Luồng thực thi nguyên tử (Atomic Transaction Flow)
```text
BEGIN TRANSACTION;
  1. Validate sự hiện diện và tính hợp lệ của Idempotency-Key (1 - 255 chars).
  2. Tính toán hàm băm mật mã SHA-256 Request Fingerprint từ payload tài chính.
  3. Chiếm PostgreSQL Advisory Lock cấp giao dịch:
     SELECT pg_advisory_xact_lock(hashtext('idemp_payment'), hashtext(cleanKey));
  4. Kiểm tra sự tồn tại của key trong public.payment_idempotency_keys:
     - Nếu đã tồn tại VÀ request_hash khớp -> Trả về cached response (HTTP 200, is_idempotent_replay: true).
     - Nếu đã tồn tại VÀ request_hash khác -> Quăng AppError(409, 'IDEMPOTENCY_KEY_PAYLOAD_MISMATCH').
  5. Validate các trường tài chính (amount > 0, method hợp lệ, hóa đơn hợp lệ).
  6. INSERT INTO public.payments (...).
  7. Thực hiện phân bổ thanh toán (nếu có) thông qua allocatePayment(..., { skipIdempotencyCheck: true }).
  8. Cập nhật hóa đơn đích (status, paid_total) và tính toán unapplied_amount.
  9. INSERT INTO public.payment_idempotency_keys (idempotency_key, request_hash, payment_id, response_status, response_body, created_by).
COMMIT;
```

### B. Cấu trúc Cryptographic Fingerprint
Fingerprint được tính toán bằng `crypto.createHash('sha256')` trên chuỗi JSON đã chuẩn hóa của các trường cốt lõi:
- **Tạo Payment (`computePaymentRequestFingerprint`):**
  - `customerId`: Chuẩn hóa String hoặc null.
  - `invoiceId`: Chuẩn hóa String hoặc null.
  - `amount`: Chuẩn hóa `Number(amount).toFixed(2)`.
  - `method`: Chuẩn hóa chữ in hoa cắt khoảng trắng (ví dụ `BANK_TRANSFER`).
  - `paidAt`: Chuẩn hóa Date string cắt khoảng trắng.
  - `reference`: Chuẩn hóa String cắt khoảng trắng hoặc null.
  - `allocations`: Mảng `{ invoiceId, amount }` được sắp xếp tăng dần theo `invoiceId` để tránh sai lệch thứ tự mảng.
- **Phân bổ tiền (`computeAllocationRequestFingerprint`):**
  - `paymentId`: Chuẩn hóa String ID của khoản thanh toán cha.
  - `allocations`: Mảng `{ invoiceId, amount }` được sắp xếp tăng dần theo `invoiceId`.

---

## 5. BẢO MẬT PHÂN QUYỀN LEAST-PRIVILEGE (FIND-P1.2.1-02)

### A. Migration 05
- Tệp di trú: [db/migrations/05_p1_2_2_idempotency_hardening.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/05_p1_2_2_idempotency_hardening.sql).
- Nội dung cốt lõi:
```sql
REVOKE UPDATE, DELETE ON public.payment_idempotency_keys FROM billing_app;
GRANT SELECT, INSERT ON public.payment_idempotency_keys TO billing_app;
GRANT SELECT ON public.payment_idempotency_keys TO billing_readonly;
```

### B. Kết quả thẩm tra thực tế từ PostgreSQL
Truy vấn `information_schema.role_table_grants` trên bảng `payment_idempotency_keys`:
```text
     grantee      | privilege_type 
------------------+----------------
 postgres         | INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
 billing_app      | INSERT
 billing_app      | SELECT
 billing_readonly | SELECT
```
- Thử nghiệm thực thi lệnh `UPDATE` bằng role `billing_app`: **BỊ CHẶN** (`ERROR: permission denied for table payment_idempotency_keys`).
- Thử nghiệm thực thi lệnh `DELETE` bằng role `billing_app`: **BỊ CHẶN** (`ERROR: permission denied for table payment_idempotency_keys`).
- Thử nghiệm thực thi lệnh `INSERT` bằng role `billing_app`: **THÀNH CÔNG**.
- Thử nghiệm thực thi lệnh `SELECT` bằng role `billing_readonly`: **THÀNH CÔNG**.
- Thử nghiệm thực thi lệnh `INSERT` bằng role `billing_readonly`: **BỊ CHẶN** (`ERROR: permission denied for table payment_idempotency_keys`).

---

## 6. CALLER MIGRATION & BACKWARD COMPATIBILITY

Để bảo đảm tính tương thích ngược và không gây đứt gãy luồng người dùng/hệ thống, tất cả internal callers đã được nâng cấp đồng bộ:

1. **Giao diện Web Frontend (`app/public/app.js`):**
   - Form ghi nhận thanh toán hóa đơn tại `#/invoices/:id` tự động sinh mã UUID duy nhất thông qua `crypto.randomUUID()` và đính kèm vào header `Idempotency-Key`.
2. **Đối soát ngân hàng (`app/src/routes/reconciliation.js`):**
   - `autoMatchHandler`: Khi khớp tự động và gọi `PaymentService.createPayment`, tự động truyền `idempotencyKey: `BANK-TX-MATCH-${tx.id}``.
   - `manualMatchHandler`: Khi khớp thủ công và gọi `PaymentService.createPayment`, tự động truyền `idempotencyKey: `BANK-TX-MATCH-${txId}``.
   - Đảm bảo 1 giao dịch sao kê ngân hàng chỉ có thể tạo chính xác 1 thanh toán duy nhất, không thể lặp lại hay nhân đôi.
3. **Các bộ kiểm thử hồi quy (`scripts/`):**
   - `scripts/cp2-smoke.mjs`, `scripts/extended-features-test.mjs`, `scripts/p1_2-payment-allocation-test.mjs`, `scripts/p1-refund-ledger-test.mjs`, `scripts/p0-remediation-test.mjs`: Lớp `ApiClient` được nâng cấp để tự động đính kèm `Idempotency-Key` khi thực hiện các yêu cầu `POST` tới endpoint thanh toán/phân bổ nếu test case không truyền key tùy chỉnh.

---

## 7. TEST MATRIX RESULTS (16 MANDATORY TESTS + 4 BONUS CHECKS)

Bộ kiểm thử chuyên biệt [scripts/p1_2_2-mandatory-idempotency-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_2-mandatory-idempotency-test.mjs) đã được tạo và thực thi trực tiếp qua HTTPS:

```text
===============================================================
  BILLING_ONE P1.2.2 MANDATORY IDEMPOTENCY & HARDENING SUITE   
       Verifying FIND-P1.2.1-01 & FIND-P1.2.1-02 (16 Tests)    
===============================================================

--- TEST 1: No Idempotency-Key on POST /api/payments is rejected ---
[PASS] Test 1: Keyless direct payment rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero DB mutation.

--- TEST 2: No Idempotency-Key on invoice payment is rejected ---
[PASS] Test 2: Keyless invoice payment rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero invoice change.

--- TEST 3: No Idempotency-Key on allocation mutation is rejected ---
[PASS] Test 3: Keyless allocation requests rejected with 400 IDEMPOTENCY_KEY_REQUIRED and zero allocation effect.

--- TEST 4: Valid key on first request succeeds with 201 ---
[PASS] Test 4: First request succeeded with 201, created payment #387.

--- TEST 5: Same key + same payload returns cached response ---
[PASS] Test 5: Replay safely returned HTTP 200 cached response, exactly 1 payment preserved.

--- TEST 6: Same key + different amount rejected with 409 ---
[PASS] Test 6: Reusing key with different amount correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.

--- TEST 7: Same key + different customer rejected with 409 ---
[PASS] Test 7: Reusing key with different customer correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.

--- TEST 8: Same key + different allocation rejected with 409 ---
[PASS] Test 8: Reusing key with different allocation correctly rejected with 409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH.

--- TEST 9: Concurrent same-key requests yield exactly 1 payment ---
Concurrent statuses: [201,200,200,200,200] (201s: 1, 200s: 4)
[PASS] Test 9: 5 concurrent requests with identical key produced exactly 1 payment in DB.

--- TEST 10: Failed transaction rolls back key; valid retry succeeds ---
[PASS] Test 10: Failed transaction rolled back key; retry with valid payload succeeded with 201.

--- TEST 11: Successful request + 3 retries yields exactly 1 payment ---
[PASS] Test 11: 3 consecutive retries returned exact cached response with zero payment inflation.

--- TEST 12: Unapplied cash with retries does not inflate customer unapplied cash ---
[PASS] Test 12: Unapplied cash retried 3 times; customer unapplied cash increased by exactly 1 payment amount.

--- TEST 13: Invoice payment with retries does not duplicate allocation or paid_total ---
[PASS] Test 13: Invoice payment retried twice; exactly 1 allocation and correct paid_total maintained.

--- TEST 14: Bank replay regression -> deterministic key protects against double matching ---
[PASS] Test 14: Bank transaction matching generated deterministic idempotency key and prevented replay.

--- TEST 15: billing_app role CANNOT UPDATE payment_idempotency_keys ---
ERROR:  permission denied for table payment_idempotency_keys
[PASS] Test 15: UPDATE on payment_idempotency_keys correctly denied for role billing_app.

--- TEST 16: billing_app role CANNOT DELETE from payment_idempotency_keys ---
ERROR:  permission denied for table payment_idempotency_keys
[PASS] Test 16: DELETE on payment_idempotency_keys correctly denied for role billing_app.

--- BONUS CHECKS: Source conflicts, empty key, max length, error ordering ---
[PASS] Bonus 1: Conflicting keys between header and body rejected with 400 CONFLICTING_IDEMPOTENCY_KEYS.
[PASS] Bonus 2: Whitespace-only key rejected with 400 IDEMPOTENCY_KEY_REQUIRED.
[PASS] Bonus 3: Excessive key length rejected with 400 INVALID_IDEMPOTENCY_KEY.
[PASS] Bonus 4: Error ordering validated: IDEMPOTENCY_KEY_REQUIRED is checked before payload attributes.

===============================================================
  ALL 16 P1.2.2 MANDATORY IDEMPOTENCY & HARDENING TESTS PASSED!
===============================================================
```

---

## 8. FULL REGRESSION SUITE RESULTS

| Bộ kiểm thử | File thực thi | Kết quả | Ghi chú |
| :--- | :--- | :--- | :--- |
| **P1.2.2 Mandatory Idempotency** | `scripts/p1_2_2-mandatory-idempotency-test.mjs` | **16/16 PASS (100%)** | 16 tests quy chuẩn + 4 bonus checks |
| **P1.2.1 Idempotency Suite** | `scripts/p1_2_1-idempotency-test.mjs` | **10/10 PASS (100%)** | Replay cache, advisory lock, fingerprint mismatch |
| **P1.2 Payment Allocation V2** | `scripts/p1_2-payment-allocation-test.mjs` | **18/18 PASS (100%)** | 1 to N allocation, unapplied cash, lock order |
| **P1.1 Refund Ledger** | `scripts/p1-refund-ledger-test.mjs` | **10/10 PASS (100%)** | Refund payable, debt harmonization, invariants |
| **P0 Financial Integrity** | `scripts/p0-remediation-test.mjs` | **4/4 PASS (100%)** | Credit note semantics, bank anti-replay, invariants |
| **CP2 Baseline Smoke Suite** | `scripts/cp2-smoke.mjs` | **15/15 PASS (100%)** | Core billing API, session, invoices, p95: 25.82ms |
| **Extended Enterprise Features** | `scripts/extended-features-test.mjs` | **12/12 PASS (100%)** | SKUs, terms, allocations, audit, reports |
| **Security Hardening (H1–H6)** | `scripts/verify-hardening.ps1` | **20/20 PASS (100%)** | Non-root containers, isolated networks, role grants |
| **Cryptographic Audit Chain** | `POST /api/audit/verify` | **PASS (100%)** | 941/941 bản ghi SHA-256 xác thực toàn vẹn |

---

## 9. FINANCIAL FORENSICS & INVARIANTS

Sau khi thực thi toàn bộ các ca kiểm thử, truy vấn kiểm toán tài chính chuyên sâu được chạy trực tiếp trên PostgreSQL:

```sql
SELECT 
  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,
  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations,
  (SELECT count(*) FROM public.payment_allocations pa WHERE NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.id = pa.payment_id)) AS orphan_alloc_payment,
  (SELECT count(*) FROM public.payment_allocations pa WHERE NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = pa.invoice_id)) AS orphan_alloc_invoice,
  (SELECT count(*) FROM (
    SELECT pa.payment_id FROM public.payment_allocations pa
    JOIN public.payments p ON p.id = pa.payment_id
    GROUP BY pa.payment_id, p.amount
    HAVING sum(pa.allocated_amount) > p.amount + 0.001
  ) sub) AS payment_over_allocations,
  (SELECT count(*) FROM (
    SELECT pa.invoice_id FROM public.payment_allocations pa
    JOIN public.invoices i ON i.id = pa.invoice_id
    GROUP BY pa.invoice_id, i.total
    HAVING sum(pa.allocated_amount) > i.total + 0.001
  ) sub) AS invoice_over_allocations,
  (SELECT count(*) FROM public.invoices i
   WHERE i.paid_total != coalesce((SELECT sum(allocated_amount) FROM public.payment_allocations WHERE invoice_id = i.id), 0)
  ) AS invoice_paid_total_mismatches,
  (SELECT count(*) FROM public.invoices WHERE paid_total + adjusted_total > total + 0.001) AS invoice_capacity_violations;
```

### Kết quả Forensics
```text
 non_positive_payments         | 0
 non_positive_allocations      | 0
 orphan_alloc_payment          | 0
 orphan_alloc_invoice          | 0
 payment_over_allocations      | 0
 invoice_over_allocations      | 0
 invoice_paid_total_mismatches | 0
 invoice_capacity_violations   | 0
```
$\rightarrow$ **Vi phạm bất biến tài chính:** **0 vi phạm (Zero Invariant Violations)**.

---

## 10. FILES MODIFIED / CREATED

| Đường dẫn tệp | Loại thao tác | Mô tả |
| :--- | :--- | :--- |
| [db/migrations/05_p1_2_2_idempotency_hardening.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/05_p1_2_2_idempotency_hardening.sql) | Tạo mới | Migration thu hồi quyền `UPDATE, DELETE` trên `payment_idempotency_keys` khỏi `billing_app` |
| [app/src/services/paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) | Chỉnh sửa | Bắt buộc `idempotencyKey` tại `createPayment` và `allocatePayment`, hỗ trợ `skipIdempotencyCheck` cho lệnh phân bổ nội bộ |
| [app/src/routes/payments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js) | Chỉnh sửa | Bổ sung hàm `extractAndRequireIdempotencyKey`, bắt buộc key trên 4 endpoint đột biến thanh toán/phân bổ |
| [app/src/routes/reconciliation.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js) | Chỉnh sửa | Truyền deterministic `idempotencyKey: BANK-TX-MATCH-${tx.id}` khi khớp ngân hàng |
| [app/public/app.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js) | Chỉnh sửa | Frontend form thanh toán hóa đơn tự động sinh và đính kèm `Idempotency-Key` UUID |
| [scripts/p1_2_2-mandatory-idempotency-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_2-mandatory-idempotency-test.mjs) | Tạo mới | Bộ kiểm thử 16 ca nghiệm thu P1.2.2 + 4 ca kiểm tra bonus |
| [scripts/cp2-smoke.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/cp2-smoke.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi thực hiện thanh toán |
| [scripts/extended-features-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/extended-features-test.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi phân bổ thanh toán |
| [scripts/p1_2-payment-allocation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi phân bổ thanh toán |
| [scripts/p1-refund-ledger-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1-refund-ledger-test.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi thực hiện thanh toán |
| [scripts/p0-remediation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p0-remediation-test.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi thực hiện thanh toán |
| [scripts/remediation-verification.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/remediation-verification.mjs) | Chỉnh sửa | `ApiClient` hỗ trợ đính kèm `Idempotency-Key` khi thực hiện thanh toán |
| [docs/BILLING_ONE_P1_2_2_PRECHECKPOINT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_2_PRECHECKPOINT.md) | Tạo mới | Pre-checkpoint ghi nhận trạng thái baseline trước P1.2.2 |

---

## 11. GIT HEAD THỰC TẾ

- **Baseline HEAD trước P1.2.2:** `c63f338bc2951d60cc42456e5743453c923449a1`
- **P1.2.2 Commit HEAD:** `42b2d7375f2b5bfcd0324405499d7bb8d03f30c5`
- **Lệnh kiểm tra:** `git rev-parse HEAD`

---

## 12. KNOWN LIMITATIONS & SCOPE BOUNDARIES

1. **TTL / Dọn dẹp bản ghi Idempotency Key:** Hiện tại các bản ghi trong `payment_idempotency_keys` được lưu trữ vĩnh viễn nhằm phục vụ kiểm toán tài chính. Công việc triển khai cron job tự động dọn dẹp các key quá hạn (ví dụ sau 90 ngày) được để lại cho phase vận hành quy mô lớn sau này, tuân thủ đúng yêu cầu không tạo cleanup job ngoài phạm vi trong P1.2.2.
2. **Tuyệt đối không vi phạm ranh giới phạm vi:**
   - KHÔNG triển khai P1.3.
   - KHÔNG thay đổi kiến trúc Recurring hay E-invoice.
   - KHÔNG can thiệp cấu trúc phân bổ Payment Allocation V2 ngoài phạm vi idempotency.
   - KHÔNG xóa/reset bất kỳ dữ liệu tài chính lịch sử nào trong database.

---

## 13. FINAL VERDICT

> ### **P1.2.2 COMPLETE — READY FOR CLOSURE AUDIT**
> 
> Toàn bộ hai finding `FIND-P1.2.1-01` (Keyless Direct Payment Deduplication Gap) và `FIND-P1.2.1-02` (Excessive Grants on Idempotency Table) đã được khắc phục triệt để. Toàn bộ 16 ca kiểm thử nghiệm thu P1.2.2 cùng 100% các suite kiểm thử hồi quy (P1.2.1, P1.2, P1.1, P0, CP2, Extended Features, Security Hardening, Audit Chain) đều đạt PASS tuyệt đối với 0 vi phạm bất biến tài chính.
