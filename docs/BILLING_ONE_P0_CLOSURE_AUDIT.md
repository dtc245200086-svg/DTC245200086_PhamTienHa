# BILLING_ONE — P0 CLOSURE VERIFICATION AUDIT REPORT
**Independent Financial Systems & Architectural Verification**  
**Auditor Roles:** Independent Financial Systems Auditor + Principal PostgreSQL Engineer + Security Reviewer  
**Date:** 2026-10-07  
**Scope:** Verification of P0 Financial Integrity Remediation (FIND-01, FIND-02, FIND-03, FIND-04)  
**Audit Mode:** READ-ONLY (No code, database, or test alterations)  
**Final Verdict:** **`P0 VERIFIED WITH WARNINGS`**

---

## 1. Executive Summary

Cuộc kiểm toán độc lập này được thực hiện nhằm xác minh khách quan, thực chứng và đa chiều việc khắc phục 4 nhóm lỗi CRITICAL (P0) đã được báo cáo trong [BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md) và [BILLING_ONE_P0_REMEDIATION_REPORT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P0_REMEDIATION_REPORT.md).

Cuộc kiểm toán tuân thủ nguyên tắc tối cao: **READ-ONLY**, không thực hiện bất kỳ lệnh sửa đổi mã nguồn, cập nhật cơ sở dữ liệu hay điều chỉnh bài kiểm thử nào.

### Tóm tắt kết quả kiểm chứng:
1. **4/4 P0 Critical Findings** đã được giải quyết triệt để tại tầng cơ sở dữ liệu và tầng ứng dụng:
   - **FIND-01**: 0 bản ghi thanh toán `CREDIT_NOTE` trong bảng `public.payments`. 13 bản ghi thanh toán cũ đã được phân loại và lưu trữ an toàn trong `public.legacy_credit_note_payments`. Cột `invoices.adjusted_total` đã tách bạch hoàn toàn giảm trừ công nợ khỏi dòng tiền thực thu.
   - **FIND-02**: Báo cáo doanh thu thuần và tờ khai thuế VAT đã phản ánh đúng các khoản giảm trừ từ hóa đơn điều chỉnh (`invoice_adjustments` trạng thái `PROCESSED`). 0 hiện tượng double-counting.
   - **FIND-03**: Toàn bộ 10 hóa đơn lịch sử (384, 385, 386, 387, 401, 402, 410, 411, 422, 423) đạt sai lệch tài chính **Delta = 0.00 ₫** giữa `paid_total` và tổng tiền thanh toán thực tế.
   - **FIND-04**: Cơ chế khóa dòng giao dịch ngân hàng `FOR UPDATE`, kiểm tra điều kiện `tx.status === 'UNMATCHED'` và chỉ mục duy nhất `bank_transactions_matched_payment_idx` tại PostgreSQL đã ngăn chặn 100% nguy cơ replay hoặc double-matching.
2. **Hệ thống Invariant tài chính**: 100% đạt chuẩn trên toàn bộ cơ sở dữ liệu (0 giá trị âm, 0 vi phạm số dư, 0 bản ghi mồ côi).
3. **Phát hiện cảnh báo (Warnings)**:
   - Phát hiện 1 điểm giới hạn kiến trúc (Medium): Việc áp dụng Credit Note trên hóa đơn đã thanh toán đầy đủ (`paid_total = total`) sẽ kích hoạt vi phạm ràng buộc `invoices_check` do hệ thống chưa có cơ chế ghi nhận sổ cái hoàn tiền mặt (`refund ledger`).
   - Phát hiện 1 điểm bất nhất nhỏ (Low): Endpoint `GET /api/customers` (danh sách khách hàng) tính `current_debt` chưa trừ `adjusted_total`, trong khi endpoint chi tiết khách hàng đã trừ chuẩn xác.

---

## 2. P0 Finding Closure Status

| Finding ID | Mô tả lỗi gốc | Biện pháp Remediation đã thực hiện | Bằng chứng Kiểm chứng Độc lập | Trạng thái Closure |
| :--- | :--- | :--- | :--- | :---: |
| **FIND-01** | Credit Note được insert vào `payments` với `method = 'CREDIT_NOTE'` làm thổi phồng tiền mặt và sai tỷ lệ DSO/CEI. | Thêm cột `invoices.adjusted_total`. Xóa bỏ logic ghi `payments` khi xử lý Credit Note. Archive 13 records cũ vào `legacy_credit_note_payments`. | • `SELECT count(*) FROM payments WHERE method = 'CREDIT_NOTE'` = **0**.<br>• 13 records lưu tại `legacy_credit_note_payments`.<br>• Ràng buộc `payments_method_check` chỉ chấp nhận `('CASH', 'BANK_TRANSFER', 'CARD')`. | **VERIFIED & CLOSED** |
| **FIND-02** | Báo cáo Doanh thu & Tờ khai VAT không trừ các khoản điều chỉnh từ Credit Note. | Refactor [reports.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reports.js) & [dashboard.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/dashboard.js) dùng `LEFT JOIN` với subquery tổng hợp `invoice_adjustments` đã `PROCESSED`. | • Tổng điều chỉnh ghi nhận qua report khớp chính xác 100% với tổng điều chỉnh `PROCESSED` (87.500.000 ₫ net, 8.750.000 ₫ VAT).<br>• Không xảy ra nhân đôi dòng (0 double counting). | **VERIFIED & CLOSED** |
| **FIND-03** | 10 hóa đơn lịch sử bị lệch `paid_total` do gộp thanh toán 41M vào hóa đơn đầu và bỏ quên hóa đơn sau. | Tách 5 giao dịch 41M thành các cặp 30M và 11M tương ứng cho từng hóa đơn trong migration [01_p0_financial_integrity.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/01_p0_financial_integrity.sql). | • 10/10 hóa đơn có `paid_total == sum(payments.amount)`.<br>• Sai lệch tài chính **Delta = 0.00 ₫**.<br>• Tổng tiền thực thu toàn hệ thống bảo toàn tuyệt đối. | **VERIFIED & CLOSED** |
| **FIND-04** | Endpoint `/api/reconciliation/manual-match` cho phép replay request khớp trùng giao dịch ngân hàng đã match. | Khóa hàng `FOR UPDATE`, kiểm tra `tx.status !== 'UNMATCHED'` trả về HTTP 409 `TRANSACTION_ALREADY_MATCHED`. Thêm UNIQUE INDEX `bank_transactions_matched_payment_idx`. | • Kiểm tra catalog `pg_indexes` xác nhận index duy nhất tồn tại và kích hoạt.<br>• Kiểm tra mã nguồn [reconciliation.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js#L189) xác nhận guard clause chặt chẽ.<br>• Không có bank transaction nào gắn với > 1 payment. | **VERIFIED & CLOSED** |

---

## 3. Credit Note Verification

### 3.1. Phân loại và Kiểm tra Cơ sở dữ liệu
- **Số lượng bản ghi `CREDIT_NOTE` trong bảng `public.payments`**:
  ```sql
  SELECT count(*) FROM public.payments WHERE method = 'CREDIT_NOTE';
  -- Kết quả: 0 (ĐẠT)
  ```
- **Bảng lưu trữ lịch sử di trú `public.legacy_credit_note_payments`**:
  - Số lượng bản ghi lưu trữ: **13 bản ghi**.
  - Tổng số tiền lưu trữ: **26.950.000,00 ₫**.
  - Đầy đủ thông tin đối soát: `id`, `invoice_id`, `amount`, `method`, `paid_at`, `reference`, `recorded_by`, `created_at`, `migrated_at`, `migration_reason`.

### 3.2. Kiểm tra các hóa đơn có Credit Note đã xử lý (`PROCESSED`)
Truy vấn độc lập trên 16 hóa đơn đang có điều chỉnh `PROCESSED`:
```sql
SELECT i.id, i.invoice_no, i.status, i.total, i.paid_total, i.adjusted_total, 
       (i.total - i.paid_total - i.adjusted_total) AS outstanding, 
       sum(a.total_amount) AS sum_adj_table, 
       (i.adjusted_total = sum(a.total_amount)) AS is_equal
FROM public.invoices i 
JOIN public.invoice_adjustments a ON a.original_invoice_id = i.id 
WHERE a.status = 'PROCESSED' 
GROUP BY i.id, i.invoice_no, i.status, i.total, i.paid_total, i.adjusted_total;
```
**Kết quả kiểm tra:**
- **16/16 hóa đơn** có `adjusted_total == sum_adj_table` (`is_equal = true`).
- **100% hóa đơn** thỏa mãn: `paid_total >= 0`, `adjusted_total >= 0`, `paid_total + adjusted_total <= total`.
- Với các hóa đơn được thanh toán toàn bộ qua Credit Note (ví dụ hóa đơn 426, 427, 429, 433, 450): `paid_total = 0.00 ₫`, `adjusted_total = 1.100.000,00 ₫`, `total = 1.100.000,00 ₫`, `outstanding = 0.00 ₫`, trạng thái `PAID`. Tiền mặt thực thu không bị tăng ảo.

### 3.3. Phân tích Rủi ro Biên độ: Credit Note trên Hóa đơn Đã thanh toán (Paid Invoice Edge Case)
Khi phân tích mã nguồn [app/src/routes/adjustments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js#L240-L254):
```javascript
const arReduction = Math.min(adjAmount, Math.max(0, outstanding));
const refundPayable = Math.max(0, adjAmount - outstanding);

const updatedInvRes = await client.query(
  `UPDATE public.invoices
   SET adjusted_total = adjusted_total + $2::numeric,
       status = CASE WHEN paid_total + adjusted_total + $2::numeric >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
   WHERE id = $1 ...`
);
```
**Nhận định kiểm toán:**
- Nếu một hóa đơn đã thanh toán 100% (`paid_total = total`), `outstanding = 0`.
- Khi áp dụng một Credit Note giá trị `X` (`adjAmount = X`):
  - `arReduction = 0`, `refundPayable = X`.
  - Tuy nhiên câu lệnh SQL vẫn cố gắng cộng: `adjusted_total = adjusted_total + X`.
  - Lúc này: `paid_total + adjusted_total = total + X > total`.
  - Ràng buộc cơ sở dữ liệu `CHECK ((paid_total + adjusted_total) <= total)` sẽ **chặn và báo lỗi SQL (Constraint Violation)**.
- **Hệ quả**: Hệ thống hiện tại ngăn chặn được việc làm sai lệch tài chính (không để tổng vượt quá hóa đơn), nhưng **chưa thể xử lý Credit Note cho hóa đơn đã thanh toán đầy đủ** vì chưa có bảng hoặc cột ghi nhận nghiệp vụ hoàn tiền nợ khách (`refund ledger / cash refund`).
- **Phân loại**: **WARNING (Medium Risk)** — Cần triển khai module Refund chuyên biệt trong giai đoạn P1/P2.

---

## 4. Cash vs AR Reduction & Revenue/VAT Verification

### 4.1. Dòng tiền thực thu (Cash Collected)
Kiểm tra tất cả các câu truy vấn tính tiền thu trong [dashboard.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/dashboard.js) và [reports.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reports.js):
- Toàn bộ đều áp dụng mệnh đề lọc phương thức tiền mặt:
  ```sql
  WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')
  ```
- Kiểm tra dữ liệu thực tế trong bảng `public.payments`:
  - `BANK_TRANSFER`: 188 giao dịch — 516.816.250,00 ₫
  - `CASH`: 35 giao dịch — 6.125.000,00 ₫
  - `CARD`: 35 giao dịch — 35.000,00 ₫
  - `Khác`: 0 giao dịch.
  - **Tổng tiền mặt thực thu**: **522.976.250,00 ₫**.
- **Kết luận**: Tuyệt đối không còn hiện tượng tính Credit Note vào dòng tiền mặt thực thu.

### 4.2. Doanh thu thuần và Thuế VAT (Revenue & VAT Reconciliation)
Thực hiện phép đối chiếu READ-ONLY độc lập phân rã theo trạng thái hóa đơn:

```sql
SELECT i.status, 
       count(i.id) AS invoices_count, 
       sum(i.subtotal) AS gross_subtotal, 
       sum(coalesce(adj.adj_amount, 0)) AS processed_adj_amount, 
       sum(i.subtotal - coalesce(adj.adj_amount, 0)) AS net_subtotal, 
       sum(i.tax_amount) AS gross_vat, 
       sum(coalesce(adj.adj_vat, 0)) AS processed_adj_vat, 
       sum(i.tax_amount - coalesce(adj.adj_vat, 0)) AS net_vat, 
       sum(i.total) AS gross_total, 
       sum(coalesce(adj.adj_total, 0)) AS processed_adj_total, 
       sum(i.total - coalesce(adj.adj_total, 0)) AS net_total 
FROM public.invoices i 
LEFT JOIN (
    SELECT original_invoice_id, 
           sum(amount) AS adj_amount, 
           sum(vat_amount) AS adj_vat, 
           sum(total_amount) AS adj_total 
    FROM public.invoice_adjustments 
    WHERE status = 'PROCESSED' 
    GROUP BY original_invoice_id
) adj ON adj.original_invoice_id = i.id 
GROUP BY i.status 
ORDER BY i.status;
```

**Kết quả đối chiếu:**

| Trạng thái Hóa đơn | Số lượng | Gross Subtotal (₫) | Giảm trừ Net (₫) | Net Revenue (₫) | Gross VAT (₫) | Giảm trừ VAT (₫) | Net VAT (₫) | Gross Total (₫) | Net Total (₫) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **CANCELLED** | 35 | 350.000,00 | 0,00 | 350.000,00 | 0,00 | 0,00 | 0,00 | 350.000,00 | 350.000,00 |
| **DRAFT** | 149 | 7.528.200,00 | 0,00 | 7.528.200,00 | 752.500,00 | 0,00 | 752.500,00 | 8.280.700,00 | 8.280.700,00 |
| **ISSUED** | 64 | 142.500.000,00 | 0,00 | 142.500.000,00 | 13.750.000,00 | 0,00 | 13.750.000,00 | 156.250.000,00 | 156.250.000,00 |
| **PAID** | 139 | 113.335.000,00 | 5.000.000,00 | 108.335.000,00 | 10.130.000,00 | 500.000,00 | 9.630.000,00 | 123.465.000,00 | 117.965.000,00 |
| **PARTIALLY_PAID**| 79 | 572.975.000,00 | 82.500.000,00 | 490.475.000,00 | 57.297.500,00 | 8.250.000,00 | 49.047.500,00 | 630.272.500,00 | 539.522.500,00 |
| **TỔNG HỢP** | **466** | **836.688.200,00**| **87.500.000,00**| **749.188.200,00**| **81.930.000,00**| **8.750.000,00**| **73.180.000,00**| **918.618.200,00**| **822.368.200,00**|

**Kiểm chứng độc lập:**
- Truy vấn trực tiếp tổng các điều chỉnh `PROCESSED` từ bảng `public.invoice_adjustments`:
  - `sum(amount)` = **87.500.000,00 ₫** (Khớp chính xác với cột Giảm trừ Net)
  - `sum(vat_amount)` = **8.750.000,00 ₫** (Khớp chính xác với cột Giảm trừ VAT)
  - `sum(total_amount)` = **96.250.000,00 ₫** (Khớp chính xác với tổng giảm trừ)
- Do phép gom nhóm được thực hiện qua subquery `GROUP BY original_invoice_id` trước khi `LEFT JOIN` với bảng `invoices`, **hoàn toàn không có hiện tượng duplicate rows hay double-counting**.

---

## 5. Historical 10-Invoice Forensic Recheck

Kiểm tra pháp y độc lập trên đúng 10 hóa đơn lịch sử phát hiện trong Deep Audit:

| Invoice ID | Invoice No | Total (₫) | Paid Total (₫) | Adjusted (₫) | Outstanding (₫) | Payment Sum (₫) | Alloc Sum (₫) | Bank Trace / Source Reference | Verdict |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- | :---: |
| **384** | `INV-2026-000253` | 49.500.000,00 | 30.000.000,00 | 5.500.000,00 | 14.000.000,00 | 30.000.000,00 | 30.000.000,00 | Pay #203 (30M) via `ALLOC-TEST-1791294709141` | **MATCHED (Delta = 0)** |
| **385** | `INV-2026-000254` | 11.000.000,00 | 11.000.000,00 | 0,00 | 0,00 | 11.000.000,00 | 11.000.000,00 | Pay #256 (11M) split from #203 (`ALLOC-TEST-1791294709141`) | **MATCHED (Delta = 0)** |
| **386** | `INV-2026-000255` | 49.500.000,00 | 40.000.000,00 | 5.500.000,00 | 4.000.000,00 | 40.000.000,00 | 30.000.000,00 | Pay #204 (30M) + Pay #205 (10M bank tx #1 `FT-BANK-1791294807611`) | **MATCHED (Delta = 0)** |
| **387** | `INV-2026-000256` | 11.000.000,00 | 11.000.000,00 | 0,00 | 0,00 | 11.000.000,00 | 11.000.000,00 | Pay #257 (11M) split from #204 (`ALLOC-TEST-1791294807611`) | **MATCHED (Delta = 0)** |
| **401** | `INV-2026-000264` | 49.500.000,00 | 40.000.000,00 | 5.500.000,00 | 4.000.000,00 | 40.000.000,00 | 30.000.000,00 | Pay #212 (30M) + Pay #213 (10M bank tx #2 `FT-BANK-1791295182794`) | **MATCHED (Delta = 0)** |
| **402** | `INV-2026-000265` | 11.000.000,00 | 11.000.000,00 | 0,00 | 0,00 | 11.000.000,00 | 11.000.000,00 | Pay #258 (11M) split from #212 (`ALLOC-TEST-1791295182794`) | **MATCHED (Delta = 0)** |
| **410** | `INV-2026-000270` | 49.500.000,00 | 40.000.000,00 | 5.500.000,00 | 4.000.000,00 | 40.000.000,00 | 30.000.000,00 | Pay #217 (30M) + Pay #218 (10M bank tx #3 `FT-BANK-1791295535494`) | **MATCHED (Delta = 0)** |
| **411** | `INV-2026-000271` | 11.000.000,00 | 11.000.000,00 | 0,00 | 0,00 | 11.000.000,00 | 11.000.000,00 | Pay #259 (11M) split from #217 (`ALLOC-TEST-1791295535494`) | **MATCHED (Delta = 0)** |
| **422** | `INV-2026-000279` | 49.500.000,00 | 40.000.000,00 | 5.500.000,00 | 4.000.000,00 | 40.000.000,00 | 30.000.000,00 | Pay #225 (30M) + Pay #226 (10M bank tx #4 `FT-BANK-1791298099298`) | **MATCHED (Delta = 0)** |
| **423** | `INV-2026-000280` | 11.000.000,00 | 11.000.000,00 | 0,00 | 0,00 | 11.000.000,00 | 11.000.000,00 | Pay #260 (11M) split from #225 (`ALLOC-TEST-1791298099298`) | **MATCHED (Delta = 0)** |

**Ghi chú kiểm toán về Allocation Sum:**
- Với các hóa đơn 386, 401, 410, 422: `Payment Sum = 40.000.000,00 ₫`, trong khi `Alloc Sum = 30.000.000,00 ₫`.
- **Nguyên nhân**: Khoản thanh toán 10.000.000 ₫ được sinh ra từ module Bank Reconciliation (`/api/reconciliation/manual-match`). Thiết kế hiện tại của module này ghi trực tiếp vào `public.payments` và liên kết với `public.bank_transactions`, không ghi bản ghi vào bảng phụ `public.payment_allocations`.
- `invoices.paid_total` hoàn toàn bằng với `sum(payments.amount)` trên **100% 10 hóa đơn** (Delta = 0).

---

## 6. Payment Traceability Audit

Kiểm tra truy xuất nguồn gốc dòng tiền đối với 5 khoản thanh toán được điều chỉnh và 5 khoản thanh toán mới được sinh ra trong migration:

### 6.1. Bảng đối chiếu nguồn gốc thanh toán (Payment Traceability Matrix)

| Pair No | Payment ID Gốc (Sau điều chỉnh) | Payment ID Mới (Được sinh ra) | Hóa đơn Đích | Số tiền (₫) | Mã tham chiếu (Reference) | Nguồn giao dịch gốc (Origin Trace) |
| :---: | :---: | :---: | :---: | :---: | :--- | :--- |
| **1** | **#203** (30M) | — | 384 | 30.000.000,00 | `ALLOC-TEST-1791294709141` | Giao dịch phân bổ 41M ngày 2026-10-06 |
|  | — | **#256** (11M) | 385 | 11.000.000,00 | `ALLOC-TEST-1791294709141` | Tách từ Payment #203 cùng metadata |
| **2** | **#204** (30M) | — | 386 | 30.000.000,00 | `ALLOC-TEST-1791294807611` | Giao dịch phân bổ 41M ngày 2026-10-06 |
|  | — | **#257** (11M) | 387 | 11.000.000,00 | `ALLOC-TEST-1791294807611` | Tách từ Payment #204 cùng metadata |
| **3** | **#212** (30M) | — | 401 | 30.000.000,00 | `ALLOC-TEST-1791295182794` | Giao dịch phân bổ 41M ngày 2026-10-06 |
|  | — | **#258** (11M) | 402 | 11.000.000,00 | `ALLOC-TEST-1791295182794` | Tách từ Payment #212 cùng metadata |
| **4** | **#217** (30M) | — | 410 | 30.000.000,00 | `ALLOC-TEST-1791295535494` | Giao dịch phân bổ 41M ngày 2026-10-06 |
|  | — | **#259** (11M) | 411 | 11.000.000,00 | `ALLOC-TEST-1791295535494` | Tách từ Payment #217 cùng metadata |
| **5** | **#225** (30M) | — | 422 | 30.000.000,00 | `ALLOC-TEST-1791298099298` | Giao dịch phân bổ 41M ngày 2026-10-06 |
|  | — | **#260** (11M) | 423 | 11.000.000,00 | `ALLOC-TEST-1791298099298` | Tách từ Payment #225 cùng metadata |

### 6.2. Kết luận Traceability:
- **0 duplicate money**: Tổng tiền 5 cặp thanh toán trước và sau di trú luôn là 205.000.000,00 ₫ (5 x 41M).
- **0 phantom payment**: Toàn bộ 5 payment mới (256–260) đều kế thừa chính xác `reference`, `recorded_by`, `paid_at`, `method` và được cập nhật ghi chú rõ ràng nguồn gốc phân bổ.
- **Tái liên kết Allocation chính xác**: Các bản ghi `payment_allocations` (id = 5, 7, 15, 20, 28) đã được chuyển `payment_id` sang trỏ đúng vào các payment mới 256, 257, 258, 259, 260.

---

## 7. Bank Reconciliation Verification

### 7.1. Trạng thái cơ sở dữ liệu
Truy vấn bảng `public.bank_transactions`:
- Tổng số giao dịch `MATCHED`: 11 giao dịch (gắn với 11 payment id duy nhất).
- Tổng số giao dịch `PARTIALLY_MATCHED`: 2 giao dịch (gắn với 2 payment id duy nhất).
- Số lượng payment bị gắn trùng với > 1 bank transaction: **0**.

### 7.2. Kiểm tra chỉ mục duy nhất (UNIQUE Index Check)
Truy vấn danh mục hệ thống PostgreSQL `pg_indexes`:
```sql
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'bank_transactions' AND indexname = 'bank_transactions_matched_payment_idx';
```
**Kết quả:**
- `indexdef`: `CREATE UNIQUE INDEX bank_transactions_matched_payment_idx ON public.bank_transactions USING btree (matched_payment_id) WHERE (matched_payment_id IS NOT NULL)`
- Chỉ mục duy nhất tồn tại và đang hoạt động, đảm bảo ở mức vật lý không một giao dịch thanh toán nào có thể bị khớp lặp.

### 7.3. Kiểm tra logic xử lý trong `app/src/routes/reconciliation.js`
- Đoạn mã xử lý tại dòng 173–192:
  ```javascript
  const txRes = await client.query(
    `SELECT id, description, amount::text, reference, tx_date, bank_name, bank_account, status
     FROM public.bank_transactions WHERE id = $1 FOR UPDATE`,
    [txId]
  );
  if (!txRes.rowCount) throw new AppError(404, 'TRANSACTION_NOT_FOUND', 'Bank transaction was not found.');
  const tx = txRes.rows[0];

  if (tx.status !== 'UNMATCHED') {
    throw new AppError(409, 'TRANSACTION_ALREADY_MATCHED', `Bank transaction is already ${tx.status} and cannot be matched again.`);
  }
  ```
- **Xác thực**: Giao dịch ngân hàng được khóa với `FOR UPDATE`, kiểm tra tức thời `tx.status !== 'UNMATCHED'`. Bất kỳ request thứ hai hoặc concurrent request nào đều lập tức nhận mã lỗi `409 Conflict`.

---

## 8. Database Invariants Verification

Đã thực thi một truy vấn kiểm tra toàn diện 11 chỉ số bất biến tài chính trên toàn bộ database:

```sql
SELECT
  (SELECT count(*) FROM public.invoices WHERE paid_total < 0) AS neg_paid,
  (SELECT count(*) FROM public.invoices WHERE adjusted_total < 0) AS neg_adj,
  (SELECT count(*) FROM public.invoices WHERE (paid_total + adjusted_total) > total) AS over_settled,
  (SELECT count(*) FROM public.invoices WHERE (total - paid_total - adjusted_total) < 0) AS neg_outstanding,
  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_pos_payments,
  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_pos_allocs,
  (SELECT count(*) FROM (SELECT payment_id, sum(allocated_amount) AS sum_alloc FROM public.payment_allocations GROUP BY payment_id) a JOIN public.payments p ON p.id = a.payment_id WHERE a.sum_alloc > p.amount) AS over_alloc_payments,
  (SELECT count(*) FROM public.payments WHERE invoice_id NOT IN (SELECT id FROM public.invoices)) AS orphan_payments,
  (SELECT count(*) FROM public.payment_allocations WHERE invoice_id NOT IN (SELECT id FROM public.invoices) OR payment_id NOT IN (SELECT id FROM public.payments)) AS orphan_allocs,
  (SELECT count(*) FROM public.invoice_adjustments WHERE original_invoice_id NOT IN (SELECT id FROM public.invoices)) AS orphan_adjustments,
  (SELECT count(*) FROM public.payments WHERE method = 'CREDIT_NOTE') AS credit_notes_in_payments;
```

**Kết quả thu được:**
```
 neg_paid | neg_adj | over_settled | neg_outstanding | non_pos_payments | non_pos_allocs | over_alloc_payments | orphan_payments | orphan_allocs | orphan_adjustments | credit_notes_in_payments 
----------+---------+--------------+-----------------+------------------+----------------+---------------------+-----------------+---------------+--------------------+--------------------------
        0 |       0 |            0 |               0 |                0 |              0 |                   0 |               0 |             0 |                  0 |                        0
```
- **Kiểm tra đối chiếu toàn bộ hóa đơn**:
  ```sql
  SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(p.amount), 0) AS pay_sum
    FROM public.invoices i
    LEFT JOIN public.payments p ON p.invoice_id = i.id
    GROUP BY i.id, i.paid_total
    HAVING i.paid_total <> coalesce(sum(p.amount), 0)
  ) sub;
  -- Kết quả: 0
  ```
- **100% hóa đơn** trên toàn cơ sở dữ liệu có `paid_total` bằng chính xác tổng các khoản thanh toán thực thu.

---

## 9. Migration Safety Review

Đánh giá tĩnh mã SQL tại [db/migrations/01_p0_financial_integrity.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/01_p0_financial_integrity.sql):

1. **Transaction Wrapping**: Toàn bộ script được bao bọc trong một transaction duy nhất (`BEGIN ... COMMIT;`). Bất kỳ lỗi nào sẽ tự động rollback toàn bộ, không để lại trạng thái nửa vời.
2. **Idempotency & Rerun Safety**:
   - Thêm cột sử dụng `ADD COLUMN IF NOT EXISTS`.
   - Tạo bảng sử dụng `CREATE TABLE IF NOT EXISTS`.
   - Di chuyển bản ghi credit note sử dụng `ON CONFLICT (id) DO NOTHING`.
   - Khắc phục 10 hóa đơn lịch sử được bảo vệ bằng guard clause:
     `IF EXISTS (SELECT 1 FROM public.payments WHERE id = 203 AND amount = 41000000.00) THEN ... END IF;`
     Do payment 203 đã được cập nhật thành 30M, nếu chạy lần thứ hai, toàn bộ các khối lệnh `DO $$` này sẽ được bỏ qua an toàn tuyệt đối.
3. **Explicit WHERE & Safety**: Không có lệnh `UPDATE` hoặc `DELETE` không điều kiện nào. Tất cả đều có mệnh đề `WHERE` rõ ràng hoặc `FROM (subquery)`.
4. **Constraint Safety**: Ràng buộc `invoices_check` và index `bank_transactions_matched_payment_idx` được thiết lập sau khi dữ liệu đã được làm sạch, đảm bảo tính nhất quán trọn vẹn.

---

## 10. Test Claim Verification

Đối chiếu các tuyên bố trong Báo cáo P0 Remediation với mã kiểm thử thực tế và cơ sở dữ liệu:

| Tuyên bố trong Báo cáo P0 | File kiểm thử thực tế | Bản chất kỹ thuật | Trạng thái Kiểm chứng |
| :--- | :--- | :--- | :---: |
| **P0 Targeted Test Suite** | [scripts/p0-remediation-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p0-remediation-test.mjs) | Kiểm thử tích hợp kịch bản 100M/20M/30M, Replay 409, Concurrent Match, Concurrent Process, Overpayment. | **VERIFIED** |
| **Enterprise Features Suite** | [scripts/extended-features-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/extended-features-test.mjs) | 12 Feature modules (Products, Terms, Allocations, Reports, Adjustments, Reconciliation, RBAC). | **VERIFIED** |
| **CP2 Smoke Test** | [scripts/cp2-smoke.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/cp2-smoke.mjs) | 15 Smoke checks kiểm tra các luồng nghiệp vụ cơ bản Đề 18. | **VERIFIED** |
| **Infrastructure Hardening** | [scripts/verify-hardening.ps1](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-hardening.ps1) | Kiểm tra cấu hình an ninh Docker container (Non-root, DB RBAC, Secrets, Headers). | **VERIFIED** |
| **Frontend Test** | [scripts/frontend-e2e-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/frontend-e2e-test.mjs) | **Lưu ý kiểm toán**: Đây là bài kiểm thử **Contract & Asset Integration** (kiểm tra phân phối static assets HTML/CSS/JS, scan các API route của frontend và kiểm tra phản hồi HTTP qua fetch). **KHÔNG PHẢI là Headless Browser E2E** (Playwright/Cypress/Puppeteer). | **PARTIALLY VERIFIED**<br>*(Đạt về mặt API Contract, làm rõ bản chất test)* |
| **Audit Chain Verification** | `/api/audit/verify` | Kiểm tra chuỗi băm mật mã SHA-256 trên toàn bộ bảng `public.audit_logs`. Kết quả: **374/374 bản ghi hợp lệ (100%)**. | **VERIFIED** |

---

## 11. Findings Matrix

| Finding ID | Mức độ nghiêm trọng | Vị trí phát hiện | Mô tả chi tiết | Khuyến nghị hành động |
| :--- | :---: | :--- | :--- | :--- |
| **FIND-P0-AUD-01** | **MEDIUM** | [app/src/routes/adjustments.js#L246](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js#L246) | **Giới hạn xử lý Credit Note trên Hóa đơn Đã thanh toán đầy đủ:**<br>Nếu hóa đơn đã `PAID` (`paid_total = total`), việc áp dụng Credit Note sẽ cố gắng tăng `adjusted_total`, dẫn tới vi phạm ràng buộc `invoices_check`. Khoản phải hoàn trả (`refund_payable`) được tính toán trong bộ nhớ nhưng chưa được lưu trữ vào bảng sổ cái hoàn tiền (`refund ledger`). | Xây dựng bảng `refund_payables` và quy trình chi hoàn tiền mặt (Cash Refund Outflow) ở giai đoạn P1/P2. |
| **FIND-P0-AUD-02** | **LOW** | [app/src/routes/customers.js#L67](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js#L67) | **Bất nhất công thức công nợ trong danh sách khách hàng:**<br>Endpoint `GET /api/customers` tính `current_debt` theo `sum(total - paid_total)` mà chưa trừ `adjusted_total`. Trong khi `GET /api/customers/:id` và `GET /:id/financial-profile` đã trừ `adjusted_total`. | Cập nhật câu query trong `GET /api/customers` đồng bộ công thức `(total - paid_total - adjusted_total)` trong giai đoạn bảo trì tiếp theo. |
| **FIND-P0-AUD-03** | **INFO** | [app/src/routes/reconciliation.js#L212](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js#L212) | **Thanh toán từ Đối soát Ngân hàng không tạo bản ghi `payment_allocations`:**<br>Khác với thanh toán trực tiếp qua hóa đơn, các khoản thanh toán tạo từ manual-match đối soát ngân hàng ghi trực tiếp vào `payments` nhưng không ghi vào `payment_allocations`. | Chuẩn hóa bảng `payment_allocations` trở thành master allocation ledger cho mọi hình thức thanh toán trong thiết kế Payment Allocation v2. |
| **FIND-P0-AUD-04** | **INFO** | [db/migrations/01_p0_financial_integrity.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/01_p0_financial_integrity.sql) | **Migration SQL không ghi nhận trực tiếp vào `audit_logs`:**<br>Do bảng `audit_logs` có chuỗi băm SHA-256 ứng dụng quản lý, file migration không chèn dòng log vào `audit_logs` mà lưu vết qua bảng `legacy_credit_note_payments` và cột `notes`. | Hoàn toàn hợp lý để bảo toàn tính toàn vẹn của chuỗi băm kiểm toán mật mã. |

---

## 12. Final Verdict

Căn cứ trên các bằng chứng pháp y khách quan thu thập được từ mã nguồn, danh mục PostgreSQL và dữ liệu thực tế:

# `P0 VERIFIED WITH WARNINGS`

### Rationale:
1. **P0 Findings Closure**: Cả 4 lỗi P0 (FIND-01, FIND-02, FIND-03, FIND-04) đã được khắc phục đúng bản chất, đạt bằng chứng pháp y 100%, 0 sai lệch số dư trên toàn bộ cơ sở dữ liệu.
2. **Lý do gắn Warnings**:
   - Tồn tại giới hạn kiến trúc khi xử lý Credit Note trên hóa đơn đã thanh toán đầy đủ do chưa có cơ chế hoàn tiền mặt (`refund ledger`) (FIND-P0-AUD-01).
   - Tồn tại điểm lệch công thức tính công nợ tại endpoint danh sách khách hàng `GET /api/customers` (FIND-P0-AUD-02).
   - Làm rõ bản chất của bài test frontend là API Contract Integration chứ không phải Headless Browser E2E.

**Hệ thống đảm bảo tính toàn vẹn tài chính, an toàn tuyệt đối và sẵn sàng để lập kế hoạch cho giai đoạn P1.**

---
*(Tuân thủ mục 15: Kết thúc kiểm toán độc lập, giữ nguyên trạng mã nguồn và cơ sở dữ liệu, không thực hiện hành động ngoài phạm vi).*
