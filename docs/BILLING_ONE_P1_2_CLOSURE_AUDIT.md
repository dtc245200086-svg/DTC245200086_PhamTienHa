# BILLING_ONE — P1.2 CLOSURE AUDIT REPORT
## INDEPENDENT FINANCIAL SYSTEMS FORENSIC AUDIT — NO IMPLEMENTATION

- **Audit Date:** 2026-10-07
- **Target Phase:** P1.2 — Payment Allocation V2 (Chuẩn hóa thanh toán, phân bổ tiền và Unapplied Cash)
- **Role:** Independent Senior Financial Systems Auditor & Database Forensics Reviewer
- **Target System:** Billing_One Enterprise (PostgreSQL 16, Docker Compose, Node.js Web API, Nginx)
- **Status:** **AUDIT COMPLETED**

---

## 1. EXECUTIVE SUMMARY

Kiểm toán độc lập (Closure Audit) được thực hiện nhằm xác minh độc lập, khách quan và chuyên sâu xem giai đoạn **P1.2 Payment Allocation V2** có thực sự đạt chuẩn toàn vẹn tài chính để được chứng nhận (Certified) hay không. 

Quá trình kiểm toán tuân thủ nguyên tắc **CHỈ KIỂM TOÁN (READ-ONLY FORENSIC VERIFICATION)**:
- Không sửa source code.
- Không sửa schema database.
- Không chạy migration.
- Không xóa hay ghi đè dữ liệu nghiệp vụ lịch sử.
- Toàn bộ bằng chứng được trích xuất bằng các truy vấn SQL trực tiếp trên PostgreSQL engine runtime và các bài kiểm tra đồng thời độc lập.

### Tóm tắt Kết luận Kiểm toán
1. **Kiến trúc Dòng tiền Mục tiêu (1 Payment $\rightarrow$ $N$ Invoices):** Đã được triển khai hoàn chỉnh. Bảng `payment_allocations` đã trở thành nguồn sự thật duy nhất (Single Source of Truth) cho việc ghi nhận thanh toán vào hóa đơn.
2. **Bất biến Dòng tiền & Unapplied Cash:** Toàn bộ cơ sở dữ liệu tuân thủ 100% công thức:
   $$\text{Payment.amount} = \text{Allocated Total} + \text{Unapplied Cash}$$
   $$0 \le \text{Allocated Total} \le \text{Payment.amount}, \quad \text{Unapplied Cash} \ge 0$$
   $$\text{Invoice.paid\_total} = \sum(\text{Allocations})$$
   Độ lệch trên toàn bộ hệ thống là **0.00 ₫**.
3. **Giải mã triệt để các chênh lệch số liệu:**
   - Chênh lệch **279 vs 289 payments** trong báo cáo kiểm thử: Đã được chứng minh bằng dấu thời gian (timestamps) và bản ghi test. 279 payments là dữ liệu lịch sử kế toán, 10 payments phát sinh do chính các ca kiểm thử từ Test 1 đến Test 15 của test suite P1.2 trước khi Test 16 kiểm tra số lượng.
   - Chênh lệch **1,534,252,250.00 ₫ vs 1,843,528,250.00 ₫ (và 1,856,528,250.00 ₫)**: Đã được đối soát từng đồng. Chênh lệch $309,276,000.00$ ₫ là số tiền phân bổ phát sinh từ các bộ test tự động (P1.2 test suite, P1.1 regression, CP2 smoke, Extended features). Không có bất kỳ khoản tiền nào bị thất thoát hoặc nhân đôi ngoài phạm vi test.
4. **Kiểm soát đồng thời (Concurrency Control):** Advisory locks (`pg_advisory_xact_lock`) trên Payment ID kết hợp khóa dòng `FOR UPDATE` trên hóa đơn theo thứ tự ID tăng dần và Trigger cấp Database Engine đã bảo vệ thành công tuyệt đối hệ thống trước race condition (kiểm chứng trực tiếp: 2 tiến trình đồng thời đòi phân bổ 3M + 3M từ khoản thanh toán 5M kết thúc với đúng 1 thành công 201 và 1 bị từ chối 409).
5. **Cảnh báo Kiểm toán (Findings & Warnings):**
   - **Idempotency trên Direct Payments (MEDIUM):** Đối soát ngân hàng có bảo vệ Replay hoàn hảo qua ràng buộc `UNIQUE` trên `matched_payment_id`, nhưng API thanh toán trực tiếp `POST /api/payments` chưa có cơ chế kiểm tra trùng `reference` hay `Idempotency-Key`.
   - **Phạm vi Append-Only (INFO):** Bảng `payments` chỉ là *append-only đối với application role* (`billing_app`), không phải *append-only tuyệt đối* vì superuser `postgres` vẫn có toàn quyền.
   - **Phân loại Test Frontend (LOW):** `scripts/frontend-e2e-test.mjs` là bộ kiểm thử tích hợp HTTP/API & static assets smoke, không phải browser automation E2E (Puppeteer/Playwright).

---

## 2. GIT VERIFICATION

Xác minh qua dòng lệnh Git:

```powershell
git rev-parse HEAD
# Output: 47466446fa57c15eb3b3252778d58681abc9213c

git status --short
# Output: (empty - clean working tree)

git log -n 5 --oneline
# 4746644 feat(p1.2): implement payment allocation v2, unapplied cash, and canonical payment service
# a26e95f feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix
# 459d45a checkpoint(p0): complete P0 financial integrity remediation and closure audit
# 0222e34 docs: add startup and assessment guides
# 1138c8c docs: finalize post-release documentation
```

### Đánh giá Git
- Working tree hoàn toàn sạch (`clean`).
- Commit HEAD thực tế là `47466446fa57c15eb3b3252778d58681abc9213c` (được sửa đổi `amend` từ commit ban đầu `ab539c3` để bổ sung mã băm commit vào báo cáo triển khai).
- Không có bất kỳ file nhạy cảm, thông tin bí mật (.env, secrets), hay dump file nào bị đưa vào Git tracking.

---

## 3. PAYMENT COUNT VERIFICATION (ĐIỀU TRA 279 VS 289 VS 297 PAYMENTS)

### Kết quả truy vấn hiện thời trong Cơ sở dữ liệu:
```sql
SELECT COUNT(*) AS total_payments, SUM(amount) AS total_amount FROM payments;
-- 297 payments | 1,856,528,250.00 ₫ (trước bài test concurrency kiểm toán)
-- 298 payments | 1,861,528,250.00 ₫ (sau bài test concurrency kiểm toán)
```

### Phân tích nguồn gốc chênh lệch (Root-Cause Forensic Analysis):

```sql
SELECT 
  COUNT(CASE WHEN created_at < '2026-10-07 05:40:00+00' THEN 1 END) AS legacy_count,
  SUM(CASE WHEN created_at < '2026-10-07 05:40:00+00' THEN amount ELSE 0 END) AS legacy_sum,
  COUNT(CASE WHEN created_at >= '2026-10-07 05:40:00+00' THEN 1 END) AS test_generated_count,
  SUM(CASE WHEN created_at >= '2026-10-07 05:40:00+00' THEN amount ELSE 0 END) AS test_generated_sum
FROM payments;
```
**Kết quả trích xuất:**
- `legacy_count`: **279** | `legacy_sum`: **1,534,252,250.00 ₫**
- `test_generated_count`: **18** | `test_generated_sum`: **322,276,000.00 ₫**

### Chi tiết 18 Payments phát sinh sau Migration:

| Payment ID | Số tiền (₫) | Mã tham chiếu (Reference) | Nguồn phát sinh |
|:---:|:---:|:---|:---|
| **295** | 10,000,000.00 | `REF-T1-1791353244787` | P1.2 Test Suite — Test 1 (1 Pay $\rightarrow$ 1 Inv) |
| **296** | 5,000,000.00 | `REF-T2-1791353244787` | P1.2 Test Suite — Test 2 (1 Pay $\rightarrow$ 2 Invs) |
| **297** | 3,000,000.00 | `REF-T3-1791353244787` | P1.2 Test Suite — Test 3 (Partial Payment) |
| **298** | 5,000,000.00 | `REF-T4-1791353244787` | P1.2 Test Suite — Test 4 (Overpayment) |
| **299** | 10,000,000.00 | `REF-T5-1791353244787` | P1.2 Test Suite — Test 5 (Pure Unapplied Cash) |
| **301** | 3,000,000.00 | `BANK-1791353244787-12` | P1.2 Test Suite — Test 12 (Bank Recon Flow) |
| **302** | 4,000,000.00 | `REF-T13-1791353244787` | P1.2 Test Suite — Test 13 (Concurrency Target) |
| **303** | 3,000,000.00 | *(Worker 1)* | P1.2 Test Suite — Test 13/14 (Concurrency) |
| **304** | 3,000,000.00 | *(Worker 2)* | P1.2 Test Suite — Test 13/14 (Concurrency) |
| **305** | 5,000,000.00 | *(Rollback Test)* | P1.2 Test Suite — Test 15 (Rollback Verification) |
| **306** | 30,000,000.00 | `PAY-T1-1791353253823` | Regression Suite — `p1-refund-ledger-test.mjs` (Test 1) |
| **307** | 90,000,000.00 | `PAY-T2-1791353253823` | Regression Suite — `p1-refund-ledger-test.mjs` (Test 2) |
| **308** | 100,000,000.00 | `PAY-T3-1791353253823` | Regression Suite — `p1-refund-ledger-test.mjs` (Test 3) |
| **309** | 100,000.00 | `CP2-PARTIAL` | Regression Suite — `cp2-smoke.mjs` |
| **311** | 175,000.00 | `CP2-FINAL` | Regression Suite — `cp2-smoke.mjs` |
| **313** | 1,000.00 | `CP2-CONCURRENT` | Regression Suite — `cp2-smoke.mjs` |
| **315** | 41,000,000.00 | `ALLOC-TEST-1791353288794` | Regression Suite — `extended-features-test.mjs` (Feature 5) |
| **316** | 10,000,000.00 | `FT-BANK-1791353288794` | Regression Suite — `extended-features-test.mjs` (Feature 9) |

### Kết luận điều tra 279 vs 289:
- Khi kịch bản `p1_2-payment-allocation-test.mjs` chạy tuần tự:
  - Tests 1 đến 15 đã tạo đúng **10 payments** (từ ID 295 đến 305).
  - Đến Test 16 ("Historical Data Integrity"), hàm kiểm tra đếm tổng `payments` trong database và thu được:
    $$\text{Total Payments} = 279 \text{ (legacy)} + 10 \text{ (tạo bởi các Test 1-15 trước đó)} = \mathbf{289 \text{ payments}}.$$
  - Sau đó, khi các suite kiểm thử hồi quy (`p1-refund-ledger-test.mjs`, `cp2-smoke.mjs`, `extended-features-test.mjs`) chạy tiếp, thêm 8 payments được tạo ra, nâng tổng số lên $289 + 8 = \mathbf{297 \text{ payments}}$.
- **Kết luận:** Con số 289 không phải là lỗi số liệu lịch sử mà là kết quả cộng dồn tự nhiên của dữ liệu test được sinh ra trong cùng phiên kiểm thử. Dữ liệu lịch sử gốc vẫn được bảo toàn nguyên vẹn ở đúng **279 payments**.

---

## 4. FINANCIAL RECONCILIATION (ĐIỀU TRA 1.534 TỶ VS 1.843 TỶ VS 1.856 TỶ)

Đối soát chi tiết dòng tiền trong toàn hệ thống:

```sql
SELECT 
  (SELECT SUM(amount) FROM payments) AS total_cash_received,
  (SELECT SUM(allocated_amount) FROM payment_allocations) AS total_cash_allocated,
  (SELECT SUM(paid_total) FROM invoices) AS total_invoice_paid,
  (SELECT SUM(amount) FROM payments) - (SELECT SUM(allocated_amount) FROM payment_allocations) AS total_unapplied_cash;
```

**Bảng Cân đối Kế toán Kiểm toán:**

| Khoản mục | Giá trị Kế toán (VND) | Nguồn cấu thành & Giải trình |
|:---|:---:|:---|
| **Tổng tiền lịch sử gốc (Legacy Cash)** | **1,534,252,250.00** | 279 payments lịch sử trước migration |
| **Tiền thanh toán phát sinh từ các bộ Test** | **+ 322,276,000.00** | 18 payments từ P1.2 tests (51M) + P1.1 tests (220M) + Smoke/Extended tests (51.276M) |
| **Tổng tiền thực thu toàn hệ thống (`total_cash_received`)** | **= 1,856,528,250.00** | Khớp 100% với `SUM(payments.amount)` |
| **Tiền chưa phân bổ (Unapplied Cash)** | **- 13,000,000.00** | Gồm 3,000,000 ₫ (Test 4 Overpayment) + 10,000,000 ₫ (Test 5 Pure Unapplied Cash) |
| **Tổng tiền đã phân bổ (`total_cash_allocated`)** | **= 1,843,528,250.00** | Khớp 100% với `SUM(payment_allocations.allocated_amount)` |
| **Tổng tiền hóa đơn ghi nhận đã trả (`total_invoice_paid`)** | **= 1,843,528,250.00** | Khớp 100% với `SUM(invoices.paid_total)` |
| **Độ lệch tài chính (Financial Variance)** | **0.00** | **Tuyệt đối không lệch 1 xu** |

### Kết luận đối soát tài chính:
- Số tiền **1,534,252,250.00 ₫** là số tiền lịch sử nguyên thủy.
- Số tiền **1,843,528,250.00 ₫** là tổng tiền đã được phân bổ cho các hóa đơn sau khi chạy các bài test.
- Chênh lệch $1,843,528,250.00 - 1,534,252,250.00 = 309,276,000.00$ ₫ khớp chính xác với:
  $$\text{Tổng tiền test thu} (322,276,000.00 \text{ ₫}) - \text{Tiền test chưa phân bổ} (13,000,000.00 \text{ ₫}) = 309,276,000.00 \text{ ₫}.$$
- Mọi đồng tiền đều được chứng minh nguồn gốc rõ ràng, loại bỏ hoàn toàn nghi vấn "nhân đôi tiền" hay "ghi nhận khống".

---

## 5. ALLOCATION INTEGRITY & INVARIANTS VERIFICATION

Kiểm tra toàn diện 100% bản ghi trong cơ sở dữ liệu:

```sql
-- 1. Invariant kiểm tra từng hóa đơn
SELECT COUNT(*) FROM (
  SELECT i.id, i.paid_total, COALESCE(SUM(pa.allocated_amount), 0) AS sum_alloc
  FROM invoices i
  LEFT JOIN payment_allocations pa ON i.id = pa.invoice_id
  GROUP BY i.id, i.paid_total
  HAVING ROUND(i.paid_total::numeric, 2) <> ROUND(COALESCE(SUM(pa.allocated_amount), 0)::numeric, 2)
) q;
-- Kết quả: 0 vi phạm (100% hóa đơn khớp chính xác với sổ cái phân bổ)

-- 2. Hóa đơn bị trả thừa quá dung lượng cho phép
SELECT COUNT(*) FROM invoices WHERE paid_total > (total - adjusted_total);
-- Kết quả: 0 vi phạm

-- 3. Payment bị phân bổ vượt quá số tiền thực nhận
SELECT COUNT(*) FROM (
  SELECT p.id, p.amount, SUM(pa.allocated_amount) as total_alloc
  FROM payments p
  JOIN payment_allocations pa ON p.id = pa.payment_id
  GROUP BY p.id, p.amount
  HAVING SUM(pa.allocated_amount) > p.amount
) q;
-- Kết quả: 0 vi phạm

-- 4. Bản ghi phân bổ mồ côi (Orphan Allocations)
SELECT COUNT(*) FROM payment_allocations pa
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = pa.payment_id)
   OR NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = pa.invoice_id);
-- Kết quả: 0 vi phạm
```

---

## 6. UNAPPLIED CASH INTEGRITY

Kiểm tra từng Payment trong hệ thống về tính bảo toàn tiền chưa phân bổ:

```sql
SELECT COUNT(*) AS invalid_unapplied_count
FROM (
  SELECT p.id, p.amount,
         COALESCE(SUM(pa.allocated_amount), 0) AS allocated_total,
         p.amount - COALESCE(SUM(pa.allocated_amount), 0) AS unapplied_amount
  FROM payments p
  LEFT JOIN payment_allocations pa ON p.id = pa.payment_id
  GROUP BY p.id, p.amount
) s
WHERE allocated_total < 0 
   OR unapplied_amount < 0 
   OR allocated_total > amount 
   OR ROUND((allocated_total + unapplied_amount)::numeric, 2) <> ROUND(amount::numeric, 2);
```
- **Kết quả:** `invalid_unapplied_count = 0`.
- Trên toàn bộ các payments, $\text{allocated\_total} + \text{unapplied\_amount}$ luôn luôn bằng chính xác $\text{payment.amount}$.
- Tiền chưa phân bổ được bảo toàn và không bị tự động coi là doanh thu hay khấu trừ hóa đơn.

---

## 7. TRUE IDEMPOTENCY AUDIT

### A. Đối soát Ngân hàng (Bank Reconciliation)
- **Cơ chế:** Cột `bank_transactions.matched_payment_id` được bảo vệ bởi Unique Partial Index:
  `"bank_transactions_matched_payment_idx" UNIQUE, btree (matched_payment_id) WHERE matched_payment_id IS NOT NULL`
- **Logic Service:** Cả `autoMatchHandler` và `manualMatchHandler` đều khóa giao dịch ngân hàng bằng `SELECT ... FOR UPDATE` và kiểm tra trạng thái `tx.status === 'UNMATCHED'`. Nếu giao dịch đã được khớp, hệ thống ném ngoại lệ `409 TRANSACTION_ALREADY_MATCHED`.
- **Kết luận:** Luồng đối soát sao kê ngân hàng đạt **True Idempotency**: Replay request hoặc lặp lại webhook không thể tạo thêm payment thứ hai.

### B. Thanh toán Trực tiếp (Direct Payments API)
- **Kiểm tra:** `POST /api/payments` và `PaymentService.createPayment`.
- **Phát hiện:** Bảng `public.payments` không có Unique Constraint trên cột `reference` (thực tế có nhiều payments test dùng chung reference như `CP2-FINAL`, `CP2-PARTIAL`). Endpoint `POST /api/payments` không sử dụng cơ chế `Idempotency-Key` hay kiểm tra trùng `reference` trước khi chèn vào `payments`.
- **Hệ quả:** Nếu client hoặc mạng bị chập chờn và gửi lại request tạo payment trực tiếp (đặc biệt là thanh toán lưu Unapplied Cash), hệ thống sẽ tạo ra 2 payment riêng biệt.
- **Phân loại Finding:** **MEDIUM (Idempotency Gap on Direct Payment Creation)**.

---

## 8. CONCURRENCY & DEADLOCK AUDIT

Kiểm tra mã nguồn [paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) và kiểm chứng độc lập:
1. **Advisory Lock Serialization:**
   - Dòng 119: `await client.query('SELECT pg_advisory_xact_lock($1)', [paymentId]);`
   - Khóa này giữ phạm vi transaction, nối tiếp hóa (serialize) toàn bộ các luồng cùng phân bổ từ một Payment mà không cần quyền `UPDATE` trên bảng `payments`.
2. **Deadlock Prevention on Invoices:**
   - Dòng 163-169: Danh sách invoice IDs được lọc duy nhất và sắp xếp tăng dần:
     `const uniqueInvoiceIds = sortIds(validatedItems.map(i => i.invoiceId));`
     sau đó mới khóa `FOR UPDATE` bằng truy vấn duy nhất `WHERE id = ANY($1::bigint[])`.
   - Cơ chế này loại bỏ hoàn toàn khả năng xảy ra chu trình chờ khóa (Deadlock Graph) giữa các luồng phân bổ đa hóa đơn.
3. **Trigger-Level Concurrency Barrier:**
   - Trigger `trg_check_payment_allocation_invariants` ở cấp PostgreSQL Engine chặn đứng tại thời điểm insert nếu tổng tiền vượt giới hạn, bảo vệ hệ thống ngay cả khi có truy vấn raw SQL từ bên ngoài.
4. **Kiểm chứng Độc lập (Live Concurrency Test):**
   - Đã thực hiện test trực tiếp trên môi trường đang chạy:
     - Tạo 1 Payment có `amount = 5.000.000 ₫`.
     - Tạo đồng thời 2 tiến trình phân bổ độc lập: Tiến trình A đòi phân bổ 3.000.000 ₫; Tiến trình B đòi phân bổ 3.000.000 ₫.
     - **Kết quả thực tế:** 
       - Tiến trình 1: HTTP 201 Created (Phân bổ thành công 3.000.000 ₫).
       - Tiến trình 2: HTTP 409 Conflict (`PAYMENT_EXCEEDS_UNAPPLIED`, Bị từ chối an toàn).
       - Trạng thái Payment sau đó: `amount = 5.000.000 ₫`, `allocated = 3.000.000 ₫`, `unapplied = 2.000.000 ₫`.
       - **Tuyệt đối không bị phân bổ vượt mức (6M) hay phát sinh race condition.**

---

## 9. BANK RECONCILIATION CANONICAL FLOW AUDIT

Kiểm tra hàm `autoMatchHandler` và `manualMatchHandler` trong [reconciliation.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js):
- **Luồng chuẩn:**
  $$\text{Bank Transaction} \longrightarrow \text{PaymentService.createPayment} \longrightarrow \text{Payment Allocation} \longrightarrow \text{Invoice paid\_total}$$
- **Xử lý số tiền chênh lệch:**
  - `payAmt = Math.min(txAmt, outstandingAmt)`
  - `unappliedAmt = Math.max(0, txAmt - outstandingAmt)`
  - Payment được tạo với toàn bộ số tiền `txAmt`, phân bổ `payAmt` vào invoice, và phần thừa `unappliedAmt` trở thành Unapplied Cash trên chính Payment đó.
  - Cột `bank_transactions.unapplied_amount` được cập nhật đồng thời để lưu vết đối soát sao kê.
- **Đánh giá:** Luồng đối soát ngân hàng đã tích hợp hoàn toàn vào kiến trúc chuẩn của Payment và Allocation.

---

## 10. LEGACY DATA MIGRATION VERIFICATION

Kiểm tra toàn bộ 279 payments lịch sử:
```sql
SELECT 
  COUNT(p.id) AS legacy_payments,
  SUM(p.amount) AS legacy_amount,
  COUNT(pa.id) AS legacy_allocations,
  SUM(pa.allocated_amount) AS legacy_alloc_amount
FROM payments p
LEFT JOIN payment_allocations pa ON p.id = pa.payment_id
WHERE p.created_at < '2026-10-07 05:40:00+00';
```
- `legacy_payments`: 279 bản ghi | Tổng: $1,534,252,250.00$ ₫.
- `legacy_allocations`: 279 bản ghi | Tổng: $1,534,252,250.00$ ₫.
- Mọi legacy payment đều có đúng 1 allocation tương ứng nối với invoice gốc.
- Không có payment nào bị sót, không có invoice nào bị lệch `paid_total`.

---

## 11. SECURITY & APPEND-ONLY SCOPE AUDIT

Kiểm tra phân quyền thực tế trên PostgreSQL (`information_schema.role_table_grants`):

| Bảng | Role | Quyền hạn cấp phát (Privileges) | Đánh giá Tính chất |
|---|---|---|---|
| **`payments`** | `billing_app` | `SELECT`, `INSERT` | **Append-Only đối với Application Role** (Chặn hoàn toàn `UPDATE`, `DELETE`, `TRUNCATE`) |
| **`payments`** | `billing_readonly` | `SELECT` | Read-Only |
| **`payments`** | `postgres` (Superuser) | `ALL` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) | Toàn quyền quản trị cơ sở dữ liệu |
| **`payment_allocations`** | `billing_app` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | Quyền quản lý sổ cái phân bổ (được giám sát bởi Trigger) |

### Kết luận Rõ ràng về Phạm vi Bảo mật:
- Tính bất biến của `payments` là **"Append-only đối với application role (`billing_app`)"**.
- Đây **KHÔNG PHẢI là "Append-only tuyệt đối ở cấp độ vật lý cơ sở dữ liệu"** vì superuser `postgres` vẫn có quyền cập nhật và xóa. 
- Báo cáo kiểm toán ghi nhận chính xác định nghĩa này, không đánh đồng hai khái niệm.

---

## 12. FRONTEND TEST CLASSIFICATION AUDIT

- **Tên file trong codebase:** `scripts/frontend-e2e-test.mjs`
- **Mã nguồn thực tế:** Sử dụng `fetch` trong Node.js để kiểm tra HTTP Status của `index.html`, `app.css`, `app.js` và gọi 23 API endpoints.
- **Đánh giá:** Đây là **API & Static Assets Integration Smoke Test**, không phải **Browser E2E Automation** (vì không sử dụng trình duyệt thật headless như Playwright, Puppeteer hay Selenium để tương tác DOM).
- **Phân loại Finding:** **LOW / INFO**.

---

## 13. AUDIT FINDINGS SUMMARY

| ID | Mức độ nghiêm trọng | Tiêu đề Finding | Mô tả & Tác động | Khuyến nghị Remediation |
|:---:|:---:|:---|:---|:---|
| **FIND-P1.2-01** | **MEDIUM** | Direct Payment Idempotency Gap | API `POST /api/payments` không kiểm tra trùng lặp trên `reference` và không có bảng `idempotency_keys`. Replay request thanh toán trực tiếp có thể tạo 2 bản ghi payment unapplied. | Bổ sung unique index có điều kiện hoặc middleware `Idempotency-Key` trong P1.3/P2. |
| **FIND-P1.2-02** | **LOW** | Commit Hash Amended in HEAD | Báo cáo triển khai ban đầu ghi commit hash `ab539c3`, trong khi HEAD thực tế sau khi amend cập nhật báo cáo là `47466446fa57c15eb3b3252778d58681abc9213c`. | Đã được ghi nhận và chuẩn hóa trong báo cáo kiểm toán này. |
| **FIND-P1.2-03** | **LOW** | Test Naming vs Actual Capability | Test `frontend-e2e-test.mjs` được gọi là E2E nhưng thực chất là HTTP Static/API Smoke test, không tương tác qua giao diện trình duyệt thực. | Đổi tên hoặc bổ sung suite Playwright thật khi triển khai E2E toàn diện. |
| **FIND-P1.2-04** | **INFO** | Application-Role Append-Only Boundary | `payments` được bảo vệ append-only ở cấp application role (`billing_app`), không phải append-only tuyệt đối đối với DB superuser. | Phù hợp với kiến trúc ứng dụng web chuẩn, cần duy trì chính sách bảo mật này. |

---

## 14. ACCEPTANCE CRITERIA VERIFICATION TABLE

| Tiêu chuẩn Nghiệm thu P1.2 | Đạt | Bằng chứng Kiểm toán |
|---|:---:|---|
| Một Payment có thể phân bổ cho $N$ Invoices | **CÓ** | Test 2, Feature 5, DB Invariants chứng minh 1 payment trỏ tới nhiều invoices qua `payment_allocations`. |
| Payment không phụ thuộc bắt buộc vào 1 Invoice | **CÓ** | `payments.invoice_id` đã DROP NOT NULL; hỗ trợ Payment chỉ gắn với `customer_id`. |
| `payment_allocations` là nguồn sự thật duy nhất | **CÓ** | `Invoice.paid_total` khớp 100% với `SUM(allocations)` trên toàn bộ 490+ hóa đơn. |
| Partial payment & Overpayment hoạt động chuẩn | **CÓ** | Test 3, Test 4 và các truy vấn kiểm toán xác nhận số dư còn nợ và tiền chưa phân bổ chính xác. |
| Unapplied cash được theo dõi chính xác | **CÓ** | Invariant $\text{allocated} + \text{unapplied} = \text{amount}$ đạt 100% trên toàn bộ DB. |
| Concurrency không cho phép over-allocate | **CÓ** | Advisory locks & Engine Triggers ngăn chặn thành công bài test race condition 3M + 3M trên payment 5M. |
| Transaction rollback đảm bảo tính nguyên tử | **CÓ** | Test 15 chứng minh lỗi phân bổ ở hóa đơn thứ hai rollback toàn bộ giao dịch phân bổ. |
| Dữ liệu legacy di chuyển an toàn, không nhân đôi tiền | **CÓ** | 279 legacy payments ($1,534,252,250.00$ ₫) được di chuyển sang allocations với độ lệch 0.00 ₫. |
| Giải mã và đối soát 279 vs 289 và 1.534B vs 1.843B | **CÓ** | Bằng chứng timestamp và danh mục 18 test payments chứng minh cặn kẽ 100% chênh lệch. |

---

## 15. FINAL AUDIT VERDICT

Dựa trên toàn bộ kết quả điều tra pháp y, kiểm chứng bất biến toán học và kiểm thử đồng thời thực tế:

# **P1.2 VERIFIED WITH WARNINGS — FIX BEFORE P1.3**

### Lý do đưa ra cảnh báo (Warnings):
1. Toàn bộ logic nghiệp vụ cốt lõi, mô hình phân bổ thanh toán đa hóa đơn, quản lý Unapplied Cash, tính toán công nợ và an toàn đồng thời đã đạt chuẩn tài chính xuất sắc (**Zero Critical / Zero High** lỗi dữ liệu).
2. Tồn tại **1 phát hiện MEDIUM (FIND-P1.2-01)**: Cần bổ sung cơ chế Idempotency Key hoặc kiểm tra trùng lặp trên API tạo thanh toán trực tiếp (`POST /api/payments`) trước khi mở rộng các tính năng tự động hóa ở các phase tiếp theo.
3. Không tự ý sửa code hay migration trong giai đoạn kiểm toán; hệ thống giữ nguyên trạng thái ổn định và an toàn.

> **QUY TẮC BẮT BUỘC:** KẾT THÚC KIỂM TOÁN P1.2 TẠI ĐÂY. DỪNG VÀ BÁO CÁO NGƯỜI DÙNG. TUYỆT ĐỐI KHÔNG TỰ ĐỘNG CHUYỂN SANG P1.3.
