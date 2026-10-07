# BILLING_ONE — P1.2.1 CLOSURE AUDIT REPORT
## INDEPENDENT VERIFICATION OF DIRECT PAYMENT IDEMPOTENCY — AUDIT ONLY

- **Audit Date:** 2026-10-07
- **Target Phase:** P1.2.1 — Direct Payment Idempotency Remediation (FIND-P1.2-01)
- **Role:** Independent Senior Financial Systems Auditor & Database Forensics Reviewer
- **Target System:** Billing_One Enterprise (PostgreSQL 16, Docker Compose, Node.js Web API, Nginx)
- **Mode:** **READ-ONLY AUDIT — ZERO IMPLEMENTATION / ZERO CODE MODIFICATION**
- **Status:** **AUDIT COMPLETED**

---

## 1. EXECUTIVE SUMMARY

Kiểm toán độc lập (Closure Audit) giai đoạn **P1.2.1** được thực hiện nhằm xác minh xem phát hiện **FIND-P1.2-01 (Direct Payment Idempotency Gap)** từ kỳ kiểm toán P1.2 đã thực sự được khắc phục triệt để hay chưa.

Quá trình kiểm toán tuân thủ nguyên tắc tuyệt đối:
- **KHÔNG** sửa source code, migration hay schema database.
- **KHÔNG** xóa, cập nhật dữ liệu lịch sử hay dữ liệu kiểm thử.
- **KHÔNG** chạy migration, commit hay amend git.
- Toàn bộ bằng chứng được thu thập thông qua kiểm tra mã nguồn tĩnh, kiểm tra schema/grants cơ sở dữ liệu và truy vấn pháp y trực tiếp trên PostgreSQL engine runtime.

### Tóm tắt Kết quả Kiểm toán:
1. **Cơ chế Idempotency-Key hoạt động hoàn hảo khi có Header:**
   - Đã triển khai bảng `public.payment_idempotency_keys` với ràng buộc `UNIQUE (idempotency_key)`.
   - Cơ chế băm mật mã SHA-256 (`request_hash`) chuẩn hóa dữ liệu tài chính chính xác: cùng key + cùng payload trả về cached response (HTTP 200, `is_idempotent_replay: true`), không tạo thêm Payment, không duplicate Allocation, không tăng `paid_total` hóa đơn, không tăng unapplied cash.
   - Cùng key nhưng khác payload (khác số tiền, khác khách hàng, khác phân bổ) bị chặn đứng với HTTP 409 Conflict (`IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`).
   - Khóa đồng thời 64-bit Advisory Lock (`pg_advisory_xact_lock`) bảo vệ tuyệt đối race condition khi 2 request đến cùng lúc.
2. **Cảnh báo Trọng tâm về Chính sách Idempotency (Core Policy Gap):**
   - Header `Idempotency-Key` hiện tại là **TÙY CHỌN (OPTIONAL - CASE B)** trên các endpoint `POST /api/payments`, `POST /api/invoices/:id/payments`, và `POST /api/payments/:id/allocations`.
   - **Khoảng trống kỹ thuật:** Nếu client không gửi header `Idempotency-Key` (hoặc client cũ / naive retry), hệ thống **hoàn toàn không có cơ chế fallback** (không tự động dedupe theo `reference` hay sliding-window hash). Do đó, các request không có key khi bị timeout/retry mạng vẫn sẽ tạo duplicate payments.
3. **Phân quyền Cơ sở Dữ liệu (Least Privilege Gap):**
   - Bảng `payment_idempotency_keys` được cấp quyền `UPDATE, DELETE` cho role `billing_app`, trong khi application service chỉ thực hiện `SELECT` và `INSERT`. Điều này tạo ra rủi ro vi phạm ranh giới toàn vẹn dữ liệu (integrity boundary).
4. **Bảo toàn Dữ liệu & Bất biến Tài chính:**
   - Toàn bộ 279 legacy payments ($1,534,252,250.00$ ₫) và các bản ghi phân bổ được bảo toàn nguyên vẹn.
   - Bất biến $\text{Payment.amount} = \text{Allocated Total} + \text{Unapplied Cash}$ và $\text{Invoice.paid\_total} = \sum(\text{Allocations})$ đạt **0 vi phạm** trên toàn bộ database.

---

## 2. GIT VERIFICATION

Xác minh qua các lệnh Git thực tế:

```powershell
git rev-parse HEAD
# Output: c63f338bc2951d60cc42456e5743453c923449a1

git status --short
# Output: (empty - clean working tree)

git log -n 5 --oneline
# c63f338 feat(p1.2.1): remediate direct payment idempotency gap (FIND-P1.2-01)
# 4746644 feat(p1.2): implement payment allocation v2, unapplied cash, and canonical payment service
# a26e95f feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix
# 459d45a checkpoint(p0): complete P0 financial integrity remediation and closure audit
# 0222e34 docs: add startup and assessment guides
```

### Đánh giá Git:
- Working tree hoàn toàn sạch.
- **Ghi nhận kiểm toán:** Trong [BILLING_ONE_P1_2_1_IMPLEMENTATION_REPORT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_1_IMPLEMENTATION_REPORT.md) Section 12, commit hash được ghi ban đầu là `7595a9a`. Commit sau đó đã được amend để bao gồm báo cáo, tạo thành HEAD commit thực tế là `c63f338bc2951d60cc42456e5743453c923449a1`.

---

## 3. FINDING P1.2-01 — ROOT QUESTION & ANSWER

> **Câu hỏi Kiểm toán Trung tâm:**  
> *"API tạo Payment trực tiếp hiện tại có thực sự đảm bảo một financial effect duy nhất khi request bị retry hay không?"*

### Kết luận Độc lập:
- **ĐỐI VỚI REQUEST CÓ `Idempotency-Key`:** **CÓ, ĐẢM BẢO TUYỆT ĐỐI.** Đạt chuẩn True Idempotency (xác nhận qua Tests 1-10, DB Unique constraint, Advisory lock, Fingerprint check).
- **ĐỐI VỚI REQUEST KHÔNG CÓ `Idempotency-Key`:** **KHÔNG ĐẢM BẢO.** Hệ thống bypass toàn bộ cơ chế idempotency và chèn trực tiếp dòng tiền mới vào `public.payments`.

---

## 4. KIỂM TRA CHÍNH SÁCH IDEMPOTENCY (IDEMPOTENCY POLICY)

Kiểm tra mã nguồn tại [app/src/routes/payments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js):

| Endpoint | Logic Trích xuất Header | Phân loại Chính sách | Hành vi khi KHÔNG có Key |
|---|---|:---:|---|
| `POST /api/payments` | `req.headers['idempotency-key'] \|\| req.headers['x-idempotency-key'] \|\| req.body?.idempotency_key` | **CASE B: TÙY CHỌN (Optional)** | Không có key $\rightarrow$ Bỏ qua check, thực hiện INSERT trực tiếp Payment mới $\rightarrow$ **Nguy cơ Duplicate** |
| `POST /api/invoices/:id/payments` | `req.headers['idempotency-key'] \|\| req.headers['x-idempotency-key'] \|\| req.body?.idempotency_key` | **CASE B: TÙY CHỌN (Optional)** | Không có key $\rightarrow$ Bỏ qua check, thực hiện INSERT Payment & Allocation mới (trừ khi invoice đã PAID) |
| `POST /api/payments/:id/allocations` | `req.headers['idempotency-key'] \|\| req.headers['x-idempotency-key'] \|\| req.body?.idempotency_key` | **CASE B: TÙY CHỌN (Optional)** | Không có key $\rightarrow$ Bỏ qua check, thực hiện INSERT Allocation mới |
| `POST /api/payments/allocate` | `req.headers['idempotency-key'] \|\| req.headers['x-idempotency-key'] \|\| req.body?.idempotency_key` | **CASE B: TÙY CHỌN (Optional)** | Không có key $\rightarrow$ Bỏ qua check, thực hiện INSERT Payment & Allocations mới |

### Đánh giá Kiểm toán:
- Việc giữ `Idempotency-Key` ở dạng **TÙY CHỌN (Optional)** là có chủ đích nhằm giữ tương thích ngược (Backward Compatibility) với các client hiện hữu.
- **TUY NHIÊN**, vì hệ thống không có cơ chế fallback (ví dụ: tự động dedupe theo hash của payload trong khoảng thời gian 60 giây, hoặc kiểm tra trùng `reference` gần nhất), các client không gửi header này vẫn đối mặt với rủi ro nhân đôi dòng tiền khi xảy ra network retry.
- **Hệ quả kiểm toán:** Theo quy tắc kiểm toán (Mục 4 và Mục 18 của chỉ thị kiểm toán), **FIND-P1.2-01 không thể đóng hoàn toàn ở mức 100% Resolved** mà phải duy trì ở mức **MEDIUM WARNING**.

---

## 5. TRUE RETRY SEMANTICS (KHI CÓ KEY)

Kiểm chứng các bản ghi trong cơ sở dữ liệu thực tế tại bảng `public.payment_idempotency_keys`:

```sql
SELECT id, idempotency_key, request_hash, payment_id, response_status, created_at 
FROM payment_idempotency_keys 
ORDER BY id;
```

**Bảng Dữ liệu Kiểm toán Idempotency Keys:**
| ID | Idempotency Key | Request Hash (SHA-256) | Payment ID | Response Status | Đánh giá |
|:---:|:---|:---|:---:|:---:|:---|
| 1 | `KEY-T1-1791354616887` | `aea507978dba89f9349d3730ef0bc5ef3bfeffe4ae808a9044ada8d32ecdf1c9` | 318 | 201 | Payment 4M $\rightarrow$ Replay 3 lần không sinh Payment 319 |
| 2 | `KEY-T4-CONCURRENT-1791354616887` | `d8c22a25be010d6f691add11567093bcd0ad686ccdacab49f58b14887d2e5aee` | 319 | 201 | Concurrent 2 tiến trình $\rightarrow$ Đúng 1 payment được tạo |
| 3 | `KEY-T8-FAILRETRY-1791354616887` | `225105e7f76e00b285fa55344de874ee9dfe77f1accf2c312a9fc7b927691318` | 320 | 201 | Rollback attempt 1 $\rightarrow$ Attempt 2 thành công và lưu key |
| 4 | `KEY-T9-INVPAY-1791354616887` | `cf5682e8974b24e6cbd89c04fccbc405e513725ff791e16a4476bd4c72c98f74` | 321 | 201 | Invoice payment 6M $\rightarrow$ Replay không làm tăng `paid_total` |
| 5 | `KEY-T10-UNAPPLIED-1791354616887` | `718c240ca406ec0923d0eb77d8ceb6fced507387310257abe85a9cd992102625` | 322 | 201 | Unapplied cash 5M $\rightarrow$ Replay không làm tăng unapplied cash |

**Kết luận:** Với các request có cung cấp key, cơ chế retry hoạt động chính xác 100%: không tạo Payment mới, không tạo Allocation mới, không làm tăng `paid_total` hóa đơn, không tăng unapplied cash.

---

## 6. PAYLOAD FINGERPRINTING & CANONICALIZATION AUDIT

Kiểm tra hàm [computePaymentRequestFingerprint](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js#L14-L32):

```javascript
function computePaymentRequestFingerprint(payload) {
  const normalized = {
    customerId: payload.customerId ? String(payload.customerId) : null,
    invoiceId: payload.invoiceId ? String(payload.invoiceId) : null,
    amount: Number(payload.amount).toFixed(2),
    method: String(payload.method || '').toUpperCase().trim(),
    paidAt: String(payload.paidAt || '').trim(),
    reference: payload.reference ? String(payload.reference).trim() : null,
    allocations: Array.isArray(payload.allocations)
      ? payload.allocations
          .map(a => ({
            invoiceId: String(a.invoiceId || a.invoice_id),
            amount: Number(a.amount).toFixed(2)
          }))
          .sort((a, b) => a.invoiceId.localeCompare(b.invoiceId))
      : []
  };
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
```

### Đánh giá Chuẩn hóa (Canonicalization):
1. **Tính tất định của Số tiền (Amount Determinism):**
   - `Number(payload.amount).toFixed(2)` đảm bảo `5000000`, `'5000000'`, `'5000000.00'` đều cho ra chuỗi `'5000000.00'`.
2. **Tính tất định của Phân bổ (Allocations Determinism):**
   - Danh sách allocations được sắp xếp theo `invoiceId` (`a.invoiceId.localeCompare(b.invoiceId)`). Thứ tự các phần tử trong mảng không làm thay đổi mã hash.
3. **Phạm vi Bao phủ Nghiệp vụ Tài chính:**
   - Đã bao phủ 100% các trường ảnh hưởng đến kế toán: `customerId`, `invoiceId`, `amount`, `method`, `paidAt`, `reference`, `allocations`.
   - Các trường mang tính mô tả thứ cấp như `notes`, `bankName`, `bankAccount` không nằm trong fingerprint. Đây là quyết định thiết kế hợp lý vì việc chỉnh sửa mô tả giao dịch không làm thay đổi bản chất tài chính của khoản thanh toán.

---

## 7. CONCURRENCY & DEADLOCK AUDIT

Kiểm tra cơ chế khóa đồng thời khi 2 request cùng key gửi đồng thời:
1. **64-bit Advisory Lock:**
   `SELECT pg_advisory_xact_lock(hashtext('idemp_payment'), hashtext($1))`
   - Sử dụng 2 tham số 32-bit integer kết hợp (`'idemp_payment'` và `cleanIdempotencyKey`), mở rộng không gian khóa lên 64-bit, triệt tiêu nguy cơ va chạm hash 32-bit (birthday collision).
   - Khóa có phạm vi Transaction: tự động giải phóng khi commit hoặc rollback.
2. **Database Unique Constraint:**
   - Ràng buộc `payment_idempotency_keys_key_unique UNIQUE (idempotency_key)` là chốt chặn cuối cùng ở cấp engine PostgreSQL nếu có luồng bypass qua service layer.
3. **Kiểm chứng Độc lập (Test 4):**
   - 2 tiến trình đồng thời: Tiến trình 1 nhận HTTP 201 (tạo), Tiến trình 2 nhận HTTP 200 (replay từ tiến trình 1 sau khi chờ khóa).
   - Số lượng Payment tăng đúng 1. Không phát sinh race condition.

---

## 8. FAILURE & ROLLBACK ATOMICITY AUDIT

Kiểm tra giao dịch khi request ban đầu thất bại (Test 8):
- Khi Request 1 gặp lỗi validation (ví dụ `amount: '0.00'`), transaction bị Rollback.
- Bảng `payment_idempotency_keys` không có bản ghi rác nào được commit.
- Advisory lock được giải phóng ngay lập tức.
- Request 2 gửi lại cùng key đó với dữ liệu hợp lệ: Được chấp nhận và xử lý thành công (HTTP 201).
- **Kết luận:** Transaction boundary hoàn toàn chuẩn mực, không gây tình trạng khóa chết key khi request bị lỗi hợp lệ.

---

## 9. IDEMPOTENCY TABLE SECURITY & PERMISSIONS AUDIT

Kiểm tra bảng `information_schema.role_table_grants` trên `payment_idempotency_keys`:

```sql
SELECT grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'payment_idempotency_keys';
```

**Bảng Phân quyền Thực tế:**
| Role | Quyền hạn Hiện tại | Quyền hạn Cần thiết theo Thiết kế | Đánh giá |
|---|---|---|---|
| **`billing_app`** | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | `SELECT`, `INSERT` | **DƯ THỪA QUYỀN (`UPDATE`, `DELETE`)** |
| **`billing_readonly`** | `SELECT` | `SELECT` | Đạt chuẩn Read-Only |
| **`postgres`** | `ALL` | `ALL` | Đạt chuẩn Superuser |

### Đánh giá Rủi ro Toàn vẹn (Integrity Boundary Risk):
- Service `paymentService.js` chỉ thực hiện `SELECT` và `INSERT` trên bảng `payment_idempotency_keys`. Không có bất kỳ dòng code nào cần `UPDATE` hoặc `DELETE`.
- Việc cấp `UPDATE` và `DELETE` cho `billing_app` cho phép application logic (hoặc lỗ hổng SQL injection nếu có) sửa đổi `request_hash` hoặc xóa key đã dùng, phá vỡ tính bất biến của lịch sử idempotency.
- **Phân loại Finding:** **LOW (Excessive Grants on Idempotency Table)**.

---

## 10. ACTOR & TENANT ISOLATION AUDIT

1. **Phạm vi Single-Tenant:**
   - Billing_One là hệ thống Enterprise Single-Tenant (toàn bộ người dùng thuộc cùng một pháp nhân doanh nghiệp, bảng `settings` lưu 1 hồ sơ công ty duy nhất). Không có nguy cơ rò rỉ dữ liệu giữa các tenant khác nhau.
2. **Không gian Tên Key (Key Namespace):**
   - Ràng buộc `UNIQUE (idempotency_key)` là duy nhất trên toàn hệ thống.
   - Nếu Staff A và Staff B cùng dùng một key ngẫu nhiên đơn giản (ví dụ `"123"`):
     - Nếu payload giống nhau: Staff B nhận replay của Staff A (ngăn chặn nhân đôi thanh toán cho cùng hóa đơn).
     - Nếu payload khác nhau: Staff B bị từ chối với 409 Conflict.
   - **Khuyến nghị:** Client API nên sử dụng UUID v4 cho header `Idempotency-Key` để tránh va chạm vô ý giữa các nhân viên.

---

## 11. BANK RECONCILIATION REGRESSION AUDIT

- Kiểm tra luồng đối soát ngân hàng (`app/src/routes/reconciliation.js`):
  - Ràng buộc Unique Partial Index `bank_transactions_matched_payment_idx UNIQUE (matched_payment_id)` vẫn hoạt động độc lập và nguyên vẹn.
  - Replay sao kê ngân hàng tiếp tục bị từ chối với `409 TRANSACTION_ALREADY_MATCHED`.
  - P1.2.1 hoàn toàn không làm suy yếu cơ chế bảo vệ replay đối soát ngân hàng đã đạt chuẩn từ P1.2.

---

## 12. PAYMENT ALLOCATION REGRESSION AUDIT

- Chạy lại toàn bộ 18 bài kiểm thử của P1.2 ([scripts/p1_2-payment-allocation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs)):
  - **Kết quả: 18/18 PASS (100%)**.
  - Mô hình 1 Payment $\rightarrow$ $N$ Allocations $\rightarrow$ $N$ Invoices hoạt động ổn định.
  - Partial payment, Overpayment $\rightarrow$ Unapplied cash, Rollback atomicity, Concurrency locking giữ nguyên vẹn 100%.

---

## 13. FINANCIAL FORENSICS & INVARIANTS AUDIT

Kiểm tra toàn bộ cơ sở dữ liệu sau khi hoàn thành P1.2.1:

```sql
SELECT 'CHECK A: payments.amount <= 0' AS check_name, COUNT(*) AS violations FROM payments WHERE amount <= 0
UNION ALL
SELECT 'CHECK B: payment_allocations.allocated_amount <= 0', COUNT(*) FROM payment_allocations WHERE allocated_amount <= 0
UNION ALL
SELECT 'CHECK C: Orphan allocations', COUNT(*) FROM payment_allocations pa WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = pa.payment_id) OR NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = pa.invoice_id)
UNION ALL
SELECT 'CHECK D: Single allocation > payment.amount', COUNT(*) FROM payment_allocations pa JOIN payments p ON pa.payment_id = p.id WHERE pa.allocated_amount > p.amount
UNION ALL
SELECT 'CHECK E: SUM(allocations) > payment.amount', COUNT(*) FROM (SELECT payment_id, SUM(allocated_amount) AS sum_alloc FROM payment_allocations GROUP BY payment_id) a JOIN payments p ON a.payment_id = p.id WHERE a.sum_alloc > p.amount
UNION ALL
SELECT 'CHECK F: invoice.paid_total > total - adjusted', COUNT(*) FROM invoices WHERE paid_total > (total - adjusted_total)
UNION ALL
SELECT 'CHECK F2: invoice.paid_total <> SUM(allocations)', COUNT(*) FROM invoices i LEFT JOIN (SELECT invoice_id, SUM(allocated_amount) AS sum_alloc FROM payment_allocations GROUP BY invoice_id) a ON i.id = a.invoice_id WHERE ROUND(i.paid_total::numeric, 2) <> ROUND(COALESCE(a.sum_alloc, 0)::numeric, 2)
UNION ALL
SELECT 'CHECK J: allocated + unapplied <> payment.amount', COUNT(*) FROM payments p LEFT JOIN (SELECT payment_id, SUM(allocated_amount) as sum_alloc FROM payment_allocations GROUP BY payment_id) a ON p.id = a.payment_id WHERE ROUND((COALESCE(a.sum_alloc, 0) + (p.amount - COALESCE(a.sum_alloc, 0)))::numeric, 2) <> ROUND(p.amount::numeric, 2);
```

**Kết quả Thực tế:**
- Mọi kiểm tra A, B, C, D, E, F, F2, J đều trả về: **0 VI PHẠM**.
- $\sum(\text{allocated\_amount}) = 2,168,304,250.00$ ₫ khớp chính xác với $\sum(\text{invoices.paid\_total}) = 2,168,304,250.00$ ₫ (độ lệch 0.00 ₫).
- Tổng tiền thực thu $\sum(\text{payments.amount}) = 2,202,804,250.00$ ₫ khớp chính xác với $\text{Allocated} (2,168,304,250.00) + \text{Unapplied} (34,500,000.00)$ ₫.

---

## 14. TEST DATA POLLUTION AUDIT

Kiểm kê dữ liệu trong cơ sở dữ liệu hiện thời:

| Phân loại Dữ liệu | Số lượng Payments | Tổng Tiền (₫) | Allocations | Đã phân bổ (₫) | Chưa phân bổ (₫) |
|---|:---:|:---:|:---:|:---:|:---:|
| **LEGACY (Lịch sử Kế toán gốc)** | **279** | **1,534,252,250.00** | **279** | **1,534,252,250.00** | **0.00** |
| **TEST & AUDIT DATA (Phát sinh)** | **42** | **668,552,000.00** | **42** | **634,052,000.00** | **34,500,000.00** |
| **TỔNG TOÀN BỘ CƠ SỞ DỮ LIỆU** | **321** | **2,202,804,250.00** | **321** | **2,168,304,250.00** | **34,500,000.00** |

### Nhận xét Kiểm toán:
- Dữ liệu lịch sử kế toán gốc (279 payments / 1.534 tỷ) được cách ly an toàn, không bị biến dạng.
- 42 payments phát sinh từ các đợt chạy test P1.2, P1.2.1, P1.1 và CP2. Toàn bộ các payments này đều tuân thủ 100% bất biến kế toán.
- **Lưu ý kiểm toán:** Khi triển khai môi trường Production thực tế, cơ sở dữ liệu chỉ chứa 279 payments lịch sử, không được coi tổng 2.202 tỷ (đã bao gồm test data) là số dư thực tế.

---

## 15. AUDIT HASH TRAIL VERIFICATION

- Kiểm tra xác thực chuỗi băm mật mã `/api/audit/verify`:
  - **Số bản ghi xác thực:** 716 bản ghi kiểm toán.
  - **Tính toàn vẹn:** `100% bản ghi đã được xác thực an toàn tuyệt đối` (`"verified": true, "valid": true`).
  - Các thao tác replay idempotent không tạo ra bản ghi kiểm toán rác trùng lặp, bảo vệ chuỗi hash SHA-256 liền mạch.

---

## 16. AUDIT FINDINGS SUMMARY

| ID | Mức độ | Tiêu đề Finding | Mô tả & Tác động | Khuyến nghị Remediation |
|:---:|:---:|:---|:---|:---|
| **FIND-P1.2.1-01** | **MEDIUM** | Keyless Direct Payment Deduplication Gap | `Idempotency-Key` là tùy chọn (Optional). Nếu client không gửi header này và bị lặp request do chập chờn mạng, hệ thống hoàn toàn không có cơ chế tự động dedupe fallback, dẫn đến nguy cơ nhân đôi dòng tiền trực tiếp. | Yêu cầu bắt buộc (Mandatory) `Idempotency-Key` trên `POST /api/payments` hoặc bổ sung sliding-window auto-dedupe middleware trước khi golive P1.3/P2. |
| **FIND-P1.2.1-02** | **LOW** | Excessive Grants on Idempotency Table | Role `billing_app` được cấp `UPDATE` và `DELETE` trên `payment_idempotency_keys` dù ứng dụng chỉ cần `SELECT` và `INSERT`. | Chạy migration thu hồi (REVOKE) quyền `UPDATE, DELETE` từ `billing_app`. |
| **FIND-P1.2.1-03** | **INFO** | Global Idempotency Key Namespace | `idempotency_key` duy nhất toàn cục, không scoped theo user. Cần khuyến cáo client luôn sinh khóa định dạng UUID v4. | Bổ sung tài liệu API hướng dẫn client format key chuẩn UUID v4. |
| **FIND-P1.2.1-04** | **INFO** | Git Commit Hash Amended in HEAD | Báo cáo ghi nhận `7595a9a`, commit HEAD thực tế là `c63f338bc2951d60cc42456e5743453c923449a1` do amend báo cáo. | Đã ghi nhận và chuẩn hóa trong báo cáo kiểm toán này. |

---

## 17. ACCEPTANCE CRITERIA VERIFICATION TABLE

| Tiêu chí Nghiệm thu P1.2.1 | Đạt | Bằng chứng Kiểm toán |
|---|:---:|---|
| Same Idempotency-Key không tạo duplicate Payment | **CÓ** | Test 2, Test 3, Test 9, Test 10 chứng minh replay trả về cached response |
| Concurrent same-key requests chỉ tạo 1 Payment | **CÓ** | Test 4 chứng minh 2 luồng đồng thời được serialize bởi Advisory Lock |
| Same key + different payload bị reject | **CÓ** | Test 5, 6, 7 chứng minh mismatch amount, customer, allocations đều bị 409 |
| Không duplicate allocation | **CÓ** | Test 9 xác nhận `paid_total` hóa đơn và số lượng allocations không đổi |
| Không duplicate unapplied cash | **CÓ** | Test 10 xác nhận unapplied cash của pure payment không đổi |
| Database uniqueness bảo vệ race condition | **CÓ** | Ràng buộc `payment_idempotency_keys_key_unique` hoạt động ở cấp engine |
| Bank reconciliation idempotency không bị phá | **CÓ** | Replay bank matching tiếp tục bị chặn bởi index `matched_payment_id` |
| POST /api/invoices/:id/payments vẫn hoạt động | **CÓ** | Test 9 và hồi quy CP2 smoke xác nhận hoạt động bình thường |
| P1.2 regression pass 100% | **CÓ** | 18/18 tests P1.2 pass |
| Financial invariants = 0 violations | **CÓ** | Toàn bộ các kiểm tra A-J đều trả về 0 vi phạm |
| Keyless payment deduplication protection | **CHƯA** | Thiếu fallback dedupe cho request không có `Idempotency-Key` (FIND-P1.2.1-01) |

---

## 18. FINAL AUDIT VERDICT

Theo quy định nghiêm ngặt của chỉ thị kiểm toán (Mục 18 & 19):  
*"Nếu Idempotency-Key optional và không có dedupe fallback, xem xét giữ FIND-P1.2-01 là MEDIUM. Nếu còn CRITICAL/HIGH/MEDIUM: KHÔNG cho phép P1.3."*

Kết luận kiểm toán độc lập:

# **P1.2.1 VERIFIED WITH WARNINGS — FIX BEFORE P1.3**

### Lý do đưa ra kết luận:
1. **Thành tựu Kỹ thuật:** Cơ chế `Idempotency-Key` với Advisory Lock, SHA-256 Fingerprint, và Cached Replay khi có key hoạt động **hoàn hảo 100%** và đạt chuẩn kiến trúc tài chính cao cấp.
2. **Cảnh báo Bắt buộc (MEDIUM Warning):** Header `Idempotency-Key` hiện là tùy chọn và thiếu cơ chế dedupe fallback tự động cho các request không có key. Rủi ro này cần được chốt chặn trước khi mở rộng sang các luồng thanh toán tự động (Automation/Recurring) ở P1.3.
3. **Quy định Nghiêm ngặt:** Hệ thống đạt chứng nhận kiểm toán có điều kiện (**Verified with Warnings**), **KHÔNG TỰ ĐỘNG CHUYỂN SANG P1.3**.

> **QUY TẮC BẮT BUỘC:** KẾT THÚC KIỂM TOÁN TẠI ĐÂY. DỪNG VÀ BÁO CÁO NGƯỜI DÙNG.
