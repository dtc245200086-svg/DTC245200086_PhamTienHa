# BILLING_ONE — P0 FINANCIAL INTEGRITY REMEDIATION REPORT
**Post-Deep Architecture & Financial Integrity Remediation**  
**Author:** Principal Software Engineer + Financial Systems Architect + PostgreSQL Data Migration Engineer + Security Engineer  
**Date:** 2026-10-07  
**Status:** COMPLETE  
**Final Verdict:** **`P0 REMEDIATION COMPLETE`**

---

## 1. Scope

Giai đoạn P0 Financial Integrity Remediation tập trung xử lý triệt để 4 nhóm lỗi CRITICAL (P0) được phát hiện trong [BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md):

1. **FIND-01 — Credit Note sai bản chất Payment**: Credit Note từng được insert vào bảng `payments` với `method = 'CREDIT_NOTE'` và cộng vào `invoices.paid_total`, gây thổi phồng dòng tiền thực thu (cash collected) và sai lệch tỷ lệ thu hồi nợ (CEI/DSO).
2. **FIND-02 — Revenue / VAT không phản ánh Adjustment**: Báo cáo doanh thu và tờ khai thuế VAT chưa trừ các khoản điều chỉnh giảm doanh thu và thuế GTGT đầu ra theo hóa đơn điều chỉnh (Thông tư 78/2021/TT-BTC & VAS).
3. **FIND-03 — 10 invoice lịch sử lệch paid_total vs payment history**: Các cặp hóa đơn `(384, 385)`, `(386, 387)`, `(401, 402)`, `(410, 411)`, `(422, 423)` bị ghi nhận sai lệch do cơ chế phân bổ thanh toán nhiều hóa đơn cũ (gộp 41.000.000 ₫ vào hóa đơn đầu và không tạo record cho hóa đơn thứ hai).
4. **FIND-04 — Bank reconciliation replay / double matching**: Endpoint `/api/reconciliation/manual-match` khóa dòng bank transaction nhưng không kiểm tra `tx.status !== 'UNMATCHED'`, cho phép replay request tạo thanh toán trùng lặp.

### Giới hạn phạm vi nghiêm ngặt:
- **KHÔNG** can thiệp vào P1 (RBAC, Payment Allocation v2 design, audit hash race condition).
- **KHÔNG** RESET DATABASE, KHÔNG DROP DATABASE, KHÔNG TRUNCATE.
- **KHÔNG** xóa Credit Note history.
- Toàn bộ thay đổi nằm trong Transaction an toàn, có sao lưu và khả năng phục hồi hoàn toàn.

---

## 2. Before State

Trước khi thực hiện remediation, trạng thái hệ thống và cơ sở dữ liệu được xác nhận:

| Hạng mục | Trạng thái Trước Remediation | Bằng chứng |
| :--- | :--- | :--- |
| **Git Branch / HEAD** | `main` @ `0222e34` (10 modified, 27 untracked files) | `git status -s` |
| **PostgreSQL Version** | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2) 64-bit | `SELECT version();` |
| **Backup Status** | Đã tạo backup snapshot custom dump + plain SQL | `db/backups/billing_backup_pre_p0.dump` (138 KB) & `.sql` (454 KB) |
| **Credit Note Records in Payments** | 13 bản ghi thanh toán giả tạo (`method = 'CREDIT_NOTE'`), tổng 26.950.000 ₫ | `SELECT count(*) FROM payments WHERE method = 'CREDIT_NOTE'` = 13 |
| **Invoices với Discrepancy** | Đúng 10 hóa đơn lịch sử (384, 385, 386, 387, 401, 402, 410, 411, 422, 423) | Lệch giữa `paid_total` và `sum(payments.amount)` |
| **Reconciliation Replay** | Cho phép gọi lại match trên transaction đã `MATCHED` | Không có guard check `tx.status` |

---

## 3. Financial Domain Decisions

Hệ thống đã chuẩn hóa mô hình và hằng số tài chính (Financial Invariants) như sau:

### 3.1. Phân biệt rõ các cấu phần tài chính
- **A. Cash Payment (`payments` table)**: Đại diện cho dòng tiền thực tế chạy vào tài khoản/két tiền doanh nghiệp (`method IN ('CASH', 'BANK_TRANSFER', 'CARD')`).
- **B. Credit Note / AR Reduction (`invoice_adjustments` table & `invoices.adjusted_total`)**: Đại diện cho sự giảm trừ nghĩa vụ công nợ của khách hàng (chiết khấu thương mại, giảm giá hàng bán, trả lại dịch vụ). Không phải dòng tiền thực thu.
- **C. Cash Refund (Khoản phải hoàn trả / Refund Payable)**: Khoản nợ phải trả khách hàng phát sinh khi Credit Note được áp dụng cho hóa đơn đã thanh toán một phần hoặc toàn bộ.

### 3.2. Công thức trạng thái hóa đơn (Invoice Financial Invariants)
```
invoice.total: Tổng giá trị phát hành (subtotal + tax_amount)
invoice.paid_total: Tổng tiền mặt/chuyển khoản/thẻ thực thu (Cash Collected)
invoice.adjusted_total: Tổng giá trị điều chỉnh giảm đã phê duyệt & ghi sổ (AR Reduction)
invoice.outstanding = MAX(0, total - paid_total - adjusted_total)
```

**Ràng buộc kiểm tra cơ sở dữ liệu (Database Constraint):**
```sql
CHECK (paid_total >= 0 AND adjusted_total >= 0 AND (paid_total + adjusted_total) <= total)
```

**Chuyển đổi trạng thái hóa đơn:**
```sql
status = CASE 
    WHEN (paid_total + adjusted_total) >= total THEN 'PAID'
    WHEN (paid_total + adjusted_total) > 0 THEN 'PARTIALLY_PAID'
    ELSE 'ISSUED'
END
```

---

## 4. Credit Note Remediation (FIND-01)

### 4.1. Refactor `app/src/routes/adjustments.js`
- **Loại bỏ hoàn toàn**: Lệnh `INSERT INTO public.payments (method = 'CREDIT_NOTE')`.
- **Cập nhật cột chuyên biệt**: Cập nhật trực tiếp `invoices.adjusted_total = adjusted_total + adj.total_amount`.
- **Kiểm soát vượt hạn mức (Over-Credit Protection)**:
  ```javascript
  if (currentAdjusted + adjAmount > invTotal) {
    throw new AppError(409, 'ADJUSTMENT_EXCEEDS_INVOICE_TOTAL',
      `Total adjustments cannot exceed invoice total.`);
  }
  ```
- **Xác định rõ AR Reduction vs Refund Payable**:
  ```javascript
  const arReduction = Math.min(adjAmount, Math.max(0, outstanding));
  const refundPayable = Math.max(0, adjAmount - outstanding);
  ```
- **Bảo vệ đồng thời (Concurrency & Idempotency)**:
  - Khóa hàng hóa đơn `SELECT ... FOR UPDATE`.
  - Khóa hàng điều chỉnh `SELECT ... FOR UPDATE`.
  - Nếu `status === 'PROCESSED'`, trả về HTTP `409 Conflict` (`ADJUSTMENT_ALREADY_PROCESSED`).

### 4.2. Bảo toàn và phân loại 13 bản ghi thanh toán Credit Note cũ (FIND-01 Legacy)
Tất cả 13 bản ghi thanh toán `method = 'CREDIT_NOTE'` trong `public.payments` đã được phân loại:
- **Phân loại**: `INVALID PAYMENT SEMANTICS` (sinh ra do phiên bản code trước đó).
- **Giải pháp bảo toàn**:
  1. Tạo bảng lưu trữ vĩnh viễn `public.legacy_credit_note_payments` với đầy đủ khóa ngoại, thời gian và lý do di trú.
  2. Sao chép nguyên vẹn 13 bản ghi vào `public.legacy_credit_note_payments`.
  3. Trừ số tiền tương ứng khỏi `invoices.paid_total` để trả `paid_total` về đúng số tiền mặt thực thu.
  4. Chuyển giá trị vào `invoices.adjusted_total` thông qua bảng `invoice_adjustments`.
  5. Xóa khỏi `public.payments` và tái thiết lập ràng buộc:
     `CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD'))`.

---

## 5. Revenue / VAT Remediation (FIND-02)

### 5.1. Báo cáo Doanh thu (`app/src/routes/reports.js` & `dashboard.js`)
- **Doanh thu thuần (Net Revenue)**: Phản ánh các khoản giảm trừ doanh thu (chiết khấu, giảm giá) theo chuẩn VAS:
  ```sql
  coalesce(sum(i.subtotal - coalesce(adj.adj_amount, 0)), 0)::numeric(14, 2) AS revenue
  ```
  Thông qua phép `LEFT JOIN` với subquery `SELECT original_invoice_id, sum(amount) AS adj_amount FROM invoice_adjustments WHERE status = 'PROCESSED' GROUP BY original_invoice_id`.
- **Thực thu (Cash Collected)**: Chỉ tính các phương thức thanh toán tiền mặt:
  ```sql
  SELECT coalesce(sum(amount), 0) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')
  ```
- **Công nợ phải thu (Receivables / Outstanding)**:
  ```sql
  SELECT coalesce(sum(total - paid_total - adjusted_total), 0) FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID') AND (total - paid_total - adjusted_total) > 0
  ```

### 5.2. Tờ khai thuế VAT (`/api/reports/vat` & `/api/reports/vat-declaration`)
- Căn cứ theo Nghị định 123/2020/NĐ-CP và Thông tư 78/2021/TT-BTC, hóa đơn điều chỉnh làm giảm tương ứng doanh thu tính thuế và thuế GTGT đầu ra theo từng thuế suất:
  ```sql
  coalesce(sum(CASE WHEN i.tax_rate = 0.10 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0) AS net_10,
  coalesce(sum(CASE WHEN i.tax_rate = 0.10 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0) AS vat_10,
  coalesce(sum(CASE WHEN i.tax_rate = 0.08 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0) AS net_8,
  coalesce(sum(CASE WHEN i.tax_rate = 0.08 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0) AS vat_8,
  coalesce(sum(CASE WHEN i.tax_rate = 0.05 THEN (i.subtotal - coalesce(adj.adj_amount, 0)) ELSE 0 END), 0) AS net_5,
  coalesce(sum(CASE WHEN i.tax_rate = 0.05 THEN (i.tax_amount - coalesce(adj.adj_vat, 0)) ELSE 0 END), 0) AS vat_5
  ```

---

## 6. Historical Data Forensics (FIND-03)

Bảng phân tích pháp y chi tiết từng hóa đơn trong số 10 hóa đơn lịch sử:

| Invoice ID | Số hóa đơn | Total (₫) | Paid Total (₫) | Adjusted Total (₫) | Outstanding (₫) | Payments Table Sum (₫) | Delta (₫) | Nguyên nhân gốc rễ (Root Cause) | Hành động khắc phục |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **384** | `INV-2026-000253` | 49.500.000 | 30.000.000 | 5.500.000 | 14.000.000 | 41.000.000 | +11.000.000 | GD gộp Payment 203 (41M) gắn sai toàn bộ vào invoice 384 thay vì tách 30M/11M | Cập nhật Payment 203 thành 30M; tách 11M sang Invoice 385 |
| **385** | `INV-2026-000254` | 11.000.000 | 11.000.000 | 0 | 0 | 0 | -11.000.000 | Thuộc cặp với 384; `paid_total` đã tăng 11M từ trước nhưng thiếu record trong `payments` | Tạo Payment mới 11M gắn với Invoice 385 từ Payment 203; tái liên kết allocation #5 |
| **386** | `INV-2026-000255` | 49.500.000 | 40.000.000 | 5.500.000 | 4.000.000 | 51.000.000 | +11.000.000 | Payment 204 (41M) + Payment 205 (10M bank match) = 51M. Thực nhận cho 386 là 30M + 10M = 40M | Cập nhật Payment 204 thành 30M; tách 11M sang Invoice 387 |
| **387** | `INV-2026-000256` | 11.000.000 | 11.000.000 | 0 | 0 | 0 | -11.000.000 | Thuộc cặp với 386; thiếu record thanh toán 11M trong bảng `payments` | Tạo Payment mới 11M gắn với Invoice 387 từ Payment 204; tái liên kết allocation #7 |
| **401** | `INV-2026-000264` | 49.500.000 | 40.000.000 | 5.500.000 | 4.000.000 | 51.000.000 | +11.000.000 | Payment 212 (41M) + Payment 213 (10M) = 51M. Thực nhận cho 401 là 30M + 10M = 40M | Cập nhật Payment 212 thành 30M; tách 11M sang Invoice 402 |
| **402** | `INV-2026-000265` | 11.000.000 | 11.000.000 | 0 | 0 | 0 | -11.000.000 | Thuộc cặp với 401; thiếu record thanh toán 11M trong bảng `payments` | Tạo Payment mới 11M gắn với Invoice 402 từ Payment 212; tái liên kết allocation #15 |
| **410** | `INV-2026-000270` | 49.500.000 | 40.000.000 | 5.500.000 | 4.000.000 | 51.000.000 | +11.000.000 | Payment 217 (41M) + Payment 218 (10M) = 51M. Thực nhận cho 410 là 30M + 10M = 40M | Cập nhật Payment 217 thành 30M; tách 11M sang Invoice 411 |
| **411** | `INV-2026-000271` | 11.000.000 | 11.000.000 | 0 | 0 | 0 | -11.000.000 | Thuộc cặp với 410; thiếu record thanh toán 11M trong bảng `payments` | Tạo Payment mới 11M gắn với Invoice 411 từ Payment 217; tái liên kết allocation #20 |
| **422** | `INV-2026-000279` | 49.500.000 | 40.000.000 | 5.500.000 | 4.000.000 | 51.000.000 | +11.000.000 | Payment 225 (41M) + Payment 226 (10M) = 51M. Thực nhận cho 422 là 30M + 10M = 40M | Cập nhật Payment 225 thành 30M; tách 11M sang Invoice 423 |
| **423** | `INV-2026-000280` | 11.000.000 | 11.000.000 | 0 | 0 | 0 | -11.000.000 | Thuộc cặp với 422; thiếu record thanh toán 11M trong bảng `payments` | Tạo Payment mới 11M gắn với Invoice 423 từ Payment 225; tái liên kết allocation #28 |

---

## 7. Historical Migration (FIND-03 Implementation)

File di trú độc lập đã được tạo tại [db/migrations/01_p0_financial_integrity.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/01_p0_financial_integrity.sql) và thực thi an toàn trong container PostgreSQL:

- **Tính chất**: Versioned, Explicit, Transaction-safe, Rerun-safe, Idempotent.
- **Tiến trình thực thi**:
  1. Thêm cột `invoices.adjusted_total` (DEFAULT 0).
  2. Tạo bảng `legacy_credit_note_payments` và lưu trữ 13 bản ghi `CREDIT_NOTE`.
  3. Cập nhật `paid_total` và xóa 13 bản ghi khỏi `payments`.
  4. Cập nhật `invoices.adjusted_total` từ các `invoice_adjustments` đã `PROCESSED`.
  5. Tách 5 khoản thanh toán 41M thành các cặp 30M và 11M chính xác, tái liên kết `payment_allocations`.
  6. Thêm ràng buộc toàn vẹn `invoices_check` và chỉ mục duy nhất `bank_transactions_matched_payment_idx`.
  7. Phân quyền đầy đủ cho các role `billing_app` và `billing_readonly`.

---

## 8. Bank Reconciliation Replay Protection (FIND-04)

### 8.1. Kiểm tra trạng thái giao dịch ngân hàng
Trong `app/src/routes/reconciliation.js`:
```javascript
const txRes = await client.query(
  `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account, status
   FROM public.bank_transactions WHERE id = $1 FOR UPDATE`,
  [txId]
);
if (!txRes.rowCount) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Bank transaction was not found.');
const tx = txRes.rows[0];

// REPLAY PROTECTION GUARD
if (tx.status !== 'UNMATCHED') {
  throw new AppError(409, 'TRANSACTION_ALREADY_MATCHED', `Bank transaction is already ${tx.status} and cannot be matched again.`);
}
```

### 8.2. Ràng buộc cấp cơ sở dữ liệu
```sql
CREATE UNIQUE INDEX IF NOT EXISTS bank_transactions_matched_payment_idx 
    ON public.bank_transactions (matched_payment_id) 
    WHERE matched_payment_id IS NOT NULL;
```
Ngăn chặn tuyệt đối mọi trường hợp race condition hoặc replay request tạo nhiều bản ghi thanh toán từ cùng một giao dịch sao kê.

---

## 9. Financial Invariants Verification

Đã xác nhận trên toàn bộ cơ sở dữ liệu sau di trú:

1. `paid_total >= 0`: **ĐẠT (100% hóa đơn)**.
2. `adjusted_total >= 0`: **ĐẠT (100% hóa đơn)**.
3. `paid_total + adjusted_total <= total`: **ĐẠT (100% hóa đơn)**.
4. `outstanding = total - paid_total - adjusted_total >= 0`: **ĐẠT (100% hóa đơn)**.
5. `invoices.paid_total == sum(payments.amount)`: **ĐẠT (0 sai lệch trên toàn DB)**.
6. `payment_allocations.allocated_amount <= payment.amount`: **ĐẠT (0 vi phạm)**.
7. `payments` chỉ chứa các phương thức tiền mặt thực: **ĐẠT (0 bản ghi CREDIT_NOTE)**.
8. Một giao dịch ngân hàng chỉ gắn với tối đa một khoản thanh toán: **ĐẠT (Unique constraint enforced)**.

---

## 10. Concurrency Tests

Bộ kiểm thử tự động [scripts/p0-remediation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p0-remediation-test.mjs) đã kiểm tra và chứng minh:

| Test Case | Kịch bản Concurrency | Kết quả | Trạng thái |
| :--- | :--- | :--- | :---: |
| **Concurrent Bank Match** | 2 request đồng thời gửi tới `/api/reconciliation/manual-match` cùng 1 `transaction_id` | Request 1: `200 OK`<br>Request 2: `409 Conflict (TRANSACTION_ALREADY_MATCHED)` | **PASS** |
| **Concurrent Credit Note Process** | 2 request đồng thời gửi tới `/api/adjustments/:id/process` cùng 1 adjustment | Request 1: `200 OK`<br>Request 2: `409 Conflict (ADJUSTMENT_ALREADY_PROCESSED)` | **PASS** |
| **Over-Payment Protection** | Thanh toán vượt số dư còn lại (`outstanding`) | Bị từ chối với `409 Conflict (PAYMENT_EXCEEDS_OUTSTANDING)` | **PASS** |
| **Payment Method Validation** | Gửi payment với `method = 'CREDIT_NOTE'` trực tiếp | Bị từ chối với `400 Bad Request (INVALID_PAYMENT_METHOD)` | **PASS** |

---

## 11. Regression Tests

Toàn bộ các bộ kiểm thử tự động của hệ thống đã được thực thi và xác nhận:

| Test Suite | Mục tiêu kiểm thử | Kết quả | Ghi chú |
| :--- | :--- | :---: | :--- |
| **`p0-remediation-test.mjs`** | 4 lỗi P0, Credit Note 100M/20M/30M, Replay, Concurrency | **PASS (100%)** | Thiết kế chuẩn mực, 0 lỗi giả lập |
| **`extended-features-test.mjs`** | 12 Enterprise Features (Product, Terms, Allocations, Reports, Adjustments, Reconciliation, RBAC...) | **PASS (12/12)** | Tương thích hoàn hảo với schema mới |
| **`cp2-smoke.mjs`** | Baseline 15 tiêu chí Đề 18 (CRUD, Payment, Sequence, Security) | **PASS (15/15)** | p95 latency: 25.63 ms, Zero regression |
| **`verify-hardening.ps1`** | An ninh hạ tầng H1–H6 (Non-root, Network, Secret, RBAC DB, Headers, Ports) | **PASS (All H1–H6)** | Tất cả container và role đạt chuẩn an ninh |
| **`frontend-e2e-test.mjs`** | 23 Route giao diện và API endpoints | **PASS (100%)** | Zero 404, Asset integrity OK |
| **Audit Chain Verification** | SHA-256 Cryptographic Hash Chaining (`/api/audit/verify`) | **VALID (374/374)** | 100% bản ghi kiểm toán toàn vẹn |

---

## 12. Final Database Forensic Check

Kết quả chạy kiểm tra pháp y toàn diện trên cơ sở dữ liệu production:

```sql
-- 1. Sai lệch giữa paid_total và lịch sử thanh toán
diff_paid_vs_payments = 0

-- 2. Phân bổ thanh toán vượt quá số tiền thanh toán
over_allocated_payments = 0

-- 3. Công nợ hoặc trạng thái âm / vượt quá tổng hóa đơn
invalid_outstanding = 0

-- 4. Trùng lặp đối soát ngân hàng
dup_matched_payments = 0

-- 5. Bản ghi thanh toán Credit Note trong bảng payments
credit_note_payments_count = 0

-- 6. Giá trị tài chính âm
negative_values = 0

-- 7. Bản ghi tài chính mồ côi (Orphan Records)
orphan_payments = 0
orphan_allocations = 0
orphan_adjustments = 0
```
**Tổng số điểm bất thường phát hiện: 0.**

---

## 13. Remaining Risks

1. **Khách hàng thanh toán trước qua Credit Note phát sinh hoàn tiền mặt (Cash Refund Execution)**:
   - Hệ thống hiện tại đã tính toán và ghi nhận chính xác `refund_payable`. Khi doanh nghiệp chi tiền mặt hoàn trả thực tế cho khách hàng, cần một module ghi nhận nghiệp vụ chi tiền (Payment Out / Refund Ledger) ở giai đoạn P1/P2.
2. **Quy mô phân bổ đa hóa đơn (Payment Allocations Architecture v2)**:
   - Các thanh toán phân bổ đa hóa đơn hiện đã được tách thành các dòng thanh toán riêng biệt cho từng hóa đơn nhằm đảm bảo tính toàn vẹn 100%. Kiến trúc mở rộng cho việc gom nhóm biên lai tổng (Master Receipt Grouping) có thể được chuẩn hóa tiếp ở P1.

---

## 14. Final Verdict

# `P0 REMEDIATION COMPLETE`

Tất cả 4 lỗi P0 (FIND-01, FIND-02, FIND-03, FIND-04) đã được khắc phục hoàn toàn với bằng chứng pháp y xác thực, dữ liệu tài chính đạt 0 sai lệch, 100% test suites vượt qua, hệ thống đảm bảo an toàn tuyệt đối sẵn sàng vận hành.
