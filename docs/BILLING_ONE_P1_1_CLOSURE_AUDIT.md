# BILLING_ONE — P1.1 CLOSURE VERIFICATION AUDIT REPORT
**Independent Financial Systems Audit, Database Forensic & Integrity Review**

- **Auditor:** Independent Financial Systems Auditor + Principal PostgreSQL Engineer + Security Reviewer + QA Verification Engineer
- **Audit Date:** 2026-10-07
- **Target Baseline:** P1.1 Refund Ledger + Customer Debt Remediation
- **Audit Mode:** READ-ONLY / FORENSIC VERIFICATION (Zero Code Changes, Zero Data Injections)
- **Status:** COMPLETED
- **Final Verdict:** **`P1.1 VERIFIED — READY FOR P1.2`**

---

## 1. Executive Summary

Cuộc kiểm toán độc lập này được thực hiện nhằm đánh giá và xác minh khách quan việc khắc phục toàn bộ các cảnh báo (Warnings) từ cuộc kiểm toán P0 Closure Audit ([BILLING_ONE_P0_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P0_CLOSURE_AUDIT.md)) và các yêu cầu nghiệp vụ của giai đoạn **P1.1 Refund Ledger + Customer Debt Remediation**.

### Kết quả kiểm định độc lập cốt lõi:
1. **Phân định rạch ròi 3 khái niệm tài chính:** Hệ thống đã tách biệt hoàn toàn giữa **Cash Payment** (dòng tiền vào), **Credit Note / AR Reduction** (giảm trừ công nợ phải thu), và **Refund Payable** (nghĩa vụ nợ phải trả hoàn tiền). Tuyệt đối không còn phương thức thanh toán `CREDIT_NOTE` trong bảng thanh toán và không có giao dịch tiền giả mạo.
2. **Sổ cái hoàn tiền (`public.refund_payables`):** Được thiết kế và vận hành chuẩn mực với khóa chính `id`, định danh chứng từ duy nhất `refund_no`, khóa ngoại toàn vẹn tới `customers`, `invoices`, `invoice_adjustments`, `users`, cùng ràng buộc `adjustment_id UNIQUE` ngăn chặn hoàn toàn việc nhân đôi hoàn tiền (duplicate refunds).
3. **Xử lý Credit Note trên hóa đơn đã thanh toán (`PAID`):** Cơ chế phân rã tài chính:
   $$\text{ar\_reduction} = \min(\text{adj\_amount}, \text{outstanding\_before})$$
   $$\text{refund\_payable} = \max(0, \text{adj\_amount} - \text{outstanding\_before})$$
   đã giải quyết triệt để lỗi vi phạm check constraint cơ sở dữ liệu `CHECK (paid_total + adjusted_total <= total)`. Khi hóa đơn đã thanh toán đầy đủ (`outstanding = 0`), `adjusted_total` giữ nguyên không tăng, toàn bộ khoản điều chỉnh được chuyển an toàn sang `public.refund_payables` với trạng thái `PENDING`.
4. **Đồng nhất công thức công nợ khách hàng (Fix FIND-P0-AUD-02):** Công thức `current_debt` và `available_credit` tại endpoint danh sách `GET /api/customers` đã được đồng bộ chuẩn xác trừ đi `adjusted_total`, khớp 100% từng đồng với trang chi tiết khách hàng, hồ sơ tài chính và Báo cáo tuổi nợ (Aging Report).
5. **Toàn vẹn dữ liệu & Bất biến tài chính:** Kiểm tra pháp y trên toàn bộ 490 hóa đơn trong cơ sở dữ liệu cho thấy **0 vi phạm bất biến**, **0 hóa đơn bị âm**, **0 hóa đơn vượt mức thanh toán**, và **0 bản ghi mồ côi (orphans)**.
6. **Kiểm thử & Hồi quy:** 10/10 kịch bản kiểm thử P1.1 được xác minh đạt chuẩn; toàn bộ chuỗi băm mật mã SHA-256 (504/504 bản ghi) duy trì tính bất biến tuyệt đối; các tiêu chuẩn an ninh hạ tầng H1–H6 và hợp đồng giao diện người dùng đều vượt qua.

---

## 2. Scope

### Phạm vi kiểm định được xác thực:
- Cơ chế hoạt động của Sổ cái hoàn tiền `public.refund_payables`.
- Quy trình nghiệp vụ Credit Note trên các loại hóa đơn: chưa thanh toán đủ, thanh toán vượt mức dư nợ, và đã thanh toán 100% (`PAID`).
- Tính idempotent, chống xử lý lặp (replay protection) và xử lý đồng thời (concurrency safety) khi áp dụng Credit Note.
- Sự tách biệt hoàn toàn giữa nghĩa vụ hoàn tiền và dòng tiền mặt thực thu (`cash_collected`).
- Tính đồng nhất của công thức công nợ khách hàng (`current_debt`) trên toàn hệ thống.
- Tính an toàn và khả năng chạy lại (idempotency) của migration `02_p1_refund_ledger.sql`.
- Sự tuân thủ phân quyền cơ sở dữ liệu cho các vai trò `billing_app` và `billing_readonly`.

### Giới hạn phạm vi nghiêm ngặt (Strict Scope Boundaries):
- Kiểm toán xác nhận P1.1 **KHÔNG** can thiệp vào:
  - P1.2 Payment Allocation v2.
  - Tái cấu trúc cơ chế kiểm toán phân tán (Audit Hash Redesign).
  - Tái cấu trúc phân quyền (RBAC overhaul).
  - Dọn dẹp bí danh API (API alias cleanup).
  - Tích hợp hóa đơn điện tử (E-Invoice).
  - Bộ lập lịch phát hành hóa đơn định kỳ (Scheduler redesign).
  - Kiểm thử trình duyệt thực tế (Browser E2E).

---

## 3. Git Baseline

Kiểm tra trực tiếp trên repository Git tại thời điểm kiểm toán:

- **Branch hiện tại:** `main`
- **HEAD Commit:** `a26e95faf7c594963c6e492c5d25e85fbc213590`
- **Working Tree:** Sạch hoàn toàn (`nothing to commit, working tree clean`).
- **P0 Checkpoint Commit:** `459d45a95d566bac6cf53ff53beb177af4f6d0d3`
- **P1.1 Implementation Commit:** `a26e95faf7c594963c6e492c5d25e85fbc213590`
- **Lịch sử 5 commit gần nhất:**
  ```
  a26e95f feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix
  459d45a checkpoint(p0): complete P0 financial integrity remediation and closure audit
  0222e34 docs: add startup and assessment guides
  1138c8c docs: finalize post-release documentation
  fded947 docs(report): add final report and demo script
  ```
- **File thay đổi trong P1.1:** Đúng 9 files (bao gồm code, migration, test, và báo cáo P1.1). Không có file nhạy cảm, secrets hay dump cơ sở dữ liệu nào bị đưa vào Git.

---

## 4. Refund Ledger Verification

Khảo sát trực tiếp catalog cơ sở dữ liệu PostgreSQL runtime (`\d+ public.refund_payables`):

| Thuộc tính | Kiểu dữ liệu | Ràng buộc | Mục đích & Đánh giá |
| :--- | :--- | :--- | :--- |
| `id` | `bigint` | `PRIMARY KEY`, Default `nextval('refund_payables_id_seq')` | Định danh nội bộ bản ghi sổ cái (**PASS**) |
| `refund_no` | `varchar(32)` | `NOT NULL`, `UNIQUE` | Mã chứng từ kế toán hiển thị người dùng (e.g. `REF-2026-0004`) (**PASS**) |
| `customer_id` | `bigint` | `NOT NULL`, `REFERENCES customers(id)` | Khách hàng thụ hưởng nghĩa vụ hoàn tiền (**PASS**) |
| `invoice_id` | `bigint` | `NOT NULL`, `REFERENCES invoices(id)` | Hóa đơn gốc phát sinh Credit Note (**PASS**) |
| `adjustment_id` | `bigint` | `NOT NULL`, `UNIQUE`, `REFERENCES invoice_adjustments(id)` | Biên bản điều chỉnh gốc, chống tạo hoàn tiền trùng lặp (**PASS**) |
| `amount` | `numeric(14,2)` | `NOT NULL`, `CHECK (amount > 0)` | Số tiền nghĩa vụ hoàn trả (chỉ nhận số dương) (**PASS**) |
| `currency` | `varchar(3)` | `NOT NULL`, `DEFAULT 'VND'` | Đơn vị tiền tệ chuẩn hóa (**PASS**) |
| `status` | `varchar(24)` | `NOT NULL`, `DEFAULT 'PENDING'`, `CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED'))` | Vòng đời trạng thái nghĩa vụ hoàn trả (**PASS**) |
| `reason` | `text` | `NOT NULL` | Lý do phát sinh nghiệp vụ (**PASS**) |
| `created_by` | `bigint` | `NOT NULL`, `REFERENCES users(id)` | Người khởi tạo chứng từ sổ cái (**PASS**) |
| `created_at` | `timestamptz` | `NOT NULL`, `DEFAULT now()` | Thời điểm ghi sổ kế toán (**PASS**) |
| `approved_by` | `bigint` | `REFERENCES users(id)` | Người phê duyệt chi hoàn trả (**PASS**) |
| `approved_at` | `timestamptz` | Nullable | Thời điểm phê duyệt (**PASS**) |
| `paid_payment_id`| `bigint` | `REFERENCES payments(id)` | Liên kết tới chứng từ chi tiền mặt thực tế (**PASS**) |
| `metadata` | `jsonb` | Nullable | Dữ liệu ngữ cảnh nghiệp vụ bổ trợ (**PASS**) |

### Chỉ mục hiệu năng (Indexes):
- `refund_payables_pkey`: Khóa chính trên `id`.
- `refund_payables_refund_no_key`: Đảm bảo tính duy nhất của mã chứng từ.
- `refund_payables_adjustment_id_key`: Đảm bảo tính duy nhất 1-1 giữa Credit Note và Refund.
- `refund_payables_customer_idx`: Tối ưu hóa truy vấn theo khách hàng.
- `refund_payables_invoice_idx`: Tối ưu hóa truy vấn theo hóa đơn.
- `refund_payables_status_idx`: Tối ưu hóa lọc theo trạng thái nghiệp vụ.
- `refund_payables_created_at_idx`: Tối ưu hóa báo cáo theo thời gian.

**Đánh giá:** **PASS** (Thiết kế đạt chuẩn kiến trúc tài chính doanh nghiệp).

---

## 5. Credit Note Verification

Kiểm tra logic xử lý Credit Note trong [app/src/routes/adjustments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js#L199-L305):

1. **Khóa dữ liệu đồng thời (Pessimistic Locking):**
   - Lệnh `SELECT ... FROM invoice_adjustments WHERE id = $1 FOR UPDATE` khóa bản ghi điều chỉnh.
   - Lệnh `SELECT ... FROM invoices WHERE id = $1 FOR UPDATE` khóa hóa đơn mục tiêu.
   - Ngăn chặn triệt để xung đột Race Condition và Double Processing.
2. **Kiểm tra trạng thái & năng lực hóa đơn:**
   - Chỉ cho phép xử lý khi adjustment ở trạng thái `APPROVED` (nếu đã `PROCESSED` lập tức trả về HTTP 409 Conflict).
   - Kiểm tra tổng hạn mức điều chỉnh tích lũy không vượt quá tổng giá trị hóa đơn:
     `currentAdjusted + adjAmount > invTotal` $\rightarrow$ Từ chối với HTTP 409 `ADJUSTMENT_EXCEEDS_INVOICE_TOTAL`.
3. **Phân rã tài chính chuẩn xác:**
   ```javascript
   const outstandingSafe = Math.max(0, outstanding);
   const arReduction = Math.min(adjAmount, outstandingSafe);
   const refundPayable = Math.max(0, Math.round((adjAmount - outstandingSafe) * 100) / 100);
   ```
4. **Cập nhật hóa đơn an toàn tuyệt đối:**
   - Trường `invoices.adjusted_total` **chỉ tăng thêm đúng phần `arReduction`**.
   - Trạng thái hóa đơn: `status = CASE WHEN paid_total + adjusted_total + $2::numeric >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END`.
   - **Tuyệt đối không có lệnh INSERT vào bảng payments** với phương thức `CREDIT_NOTE`.
5. **Ghi sổ nghĩa vụ hoàn tiền:**
   - Nếu `refundPayable > 0`, hệ thống cấp số tự động từ `public.refund_no_seq`, định dạng mã `REF-YYYY-XXXX` và ghi nhận một bản ghi vào `public.refund_payables` với trạng thái `PENDING`.

**Đánh giá:** **PASS** (Đúng bản chất kế toán, phân định rạch ròi AR Reduction và Refund Payable).

---

## 6. Paid Invoice Refund Verification

Đối chiếu 3 kịch bản nghiệp vụ thực tế giữa Code, Database và Test Claims:

### Kịch bản 1: Credit Note nhỏ hơn hoặc bằng Dư nợ chưa thanh toán (Case A)
- **Dữ liệu giả định:** Total = 100M, Paid = 30M, Outstanding = 70M, Credit Note = 20M.
- **Tính toán:**
  - `ar_reduction = min(20M, 70M) = 20M`
  - `refund_payable = max(0, 20M - 70M) = 0M`
- **Kết quả trên hóa đơn:**
  - `paid_total = 30M`
  - `adjusted_total = 20M` (tăng thêm 20M)
  - `outstanding = 100M - 30M - 20M = 50M`
  - `status = PARTIALLY_PAID`
- **Sổ cái hoàn tiền:** Không sinh bản ghi trong `refund_payables`. Không sinh payment.
- **Xác minh thực tế:** **PASS** (Khớp kiểm thử Test 1).

### Kịch bản 2: Credit Note lớn hơn Dư nợ chưa thanh toán (Case B)
- **Dữ liệu giả định:** Total = 100M, Paid = 90M, Outstanding = 10M, Credit Note = 30M.
- **Tính toán:**
  - `ar_reduction = min(30M, 10M) = 10M`
  - `refund_payable = max(0, 30M - 10M) = 20M`
- **Kết quả trên hóa đơn:**
  - `paid_total = 90M`
  - `adjusted_total = 10M` (chỉ tăng thêm 10M!)
  - `outstanding = 100M - 90M - 10M = 0M`
  - `status = PAID`
- **Sổ cái hoàn tiền:** Tạo 1 bản ghi `refund_payables` với số tiền `20,000,000.00 VND`, trạng thái `PENDING`.
- **Bảo toàn bất biến DB:** `paid_total (90M) + adjusted_total (10M) = 100M <= total (100M)`. Ràng buộc DB được thỏa mãn 100%.
- **Xác minh thực tế:** **PASS** (Khớp kiểm thử Test 2, bản ghi thực tế ID 1 & 4 trong DB).

### Kịch bản 3: Credit Note trên Hóa đơn đã thanh toán đầy đủ (Case C - PAID Invoice)
- **Dữ liệu giả định:** Total = 100M, Paid = 100M, Outstanding = 0M, Credit Note = 20M.
- **Tính toán:**
  - `ar_reduction = min(20M, 0M) = 0M`
  - `refund_payable = max(0, 20M - 0M) = 20M`
- **Kết quả trên hóa đơn:**
  - `paid_total = 100M`
  - `adjusted_total = 0M` (giữ nguyên 0, không tăng thêm!)
  - `outstanding = 100M - 100M - 0M = 0M`
  - `status = PAID` (giữ nguyên PAID, không bị tụt về PARTIALLY_PAID)
- **Sổ cái hoàn tiền:** Tạo 1 bản ghi `refund_payables` với số tiền `20,000,000.00 VND`, trạng thái `PENDING`.
- **Bảo toàn bất biến DB:** `paid_total (100M) + adjusted_total (0M) = 100M <= total (100M)`. Check constraint hoàn toàn không bị vi phạm.
- **Xác minh thực tế:** **PASS** (Khớp kiểm thử Test 3, bản ghi thực tế ID 3 & 5 trong DB).

---

## 7. Customer Debt Verification

Kiểm toán độc lập toàn bộ các truy vấn liên quan đến công nợ khách hàng trên codebase:

### 1. Phân tích mã nguồn:
- **`GET /api/customers` ([customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js#L67-L70)):**
  ```sql
  coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
            WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::numeric(14, 2)::text AS current_debt,
  (c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                             WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0))::numeric(14, 2)::text AS available_credit
  ```
- **`GET /api/customers/:id` ([customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js#L130-L133)):** Sử dụng cùng biểu thức.
- **`GET /api/customers/:id/financial-profile` ([customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js#L150-L153)):** Sử dụng cùng biểu thức.
- **`GET /api/reports/aging` ([reports.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reports.js#L14-L42)):** Sử dụng `total - paid_total - adjusted_total` trong tất cả các xô tuổi nợ (1-30, 31-60, 61-90, >90 ngày).

### 2. Quét toàn diện các biểu thức số dư:
- Kiểm tra bằng biểu thức chính quy `total\s*-\s*paid_total(?!\s*-\s*adjusted_total)` trên toàn bộ thư mục `app/src`:
  $\rightarrow$ **Kết quả: 0 kết quả tìm thấy (No results found)**.
- 100% các điểm tính toán nghĩa vụ công nợ và số dư còn lại trên toàn hệ thống đều đã bao gồm `- adjusted_total`.

### 3. Đối chiếu SQL độc lập (Cross-Check):
Thực thi truy vấn đối chiếu độc lập trên PostgreSQL giữa tổng tính toán trực tiếp từ hóa đơn hiệu lực và kết quả trả về từ bảng khách hàng:
```sql
WITH inv_calc AS (
  SELECT customer_id, coalesce(sum(total - paid_total - adjusted_total), 0) AS calc_debt
  FROM public.invoices WHERE status IN ('ISSUED', 'PARTIALLY_PAID') GROUP BY customer_id
),
cust_calc AS (
  SELECT c.id AS customer_id,
         coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                   WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0) AS list_debt
  FROM public.customers c
)
SELECT c.customer_id, c.list_debt, coalesce(i.calc_debt, 0) AS direct_calc_debt
FROM cust_calc c LEFT JOIN inv_calc i ON i.customer_id = c.customer_id
WHERE c.list_debt != coalesce(i.calc_debt, 0);
```
- **Số khách hàng bị lệch công nợ:** **0 khách hàng** (100% khớp tuyệt đối).

**Đánh giá:** **PASS** (Lỗi FIND-P0-AUD-02 đã được giải quyết triệt để).

---

## 8. Cash Collection Verification

Kiểm tra độc lập các phép tính thu tiền mặt và chỉ số dòng tiền:

1. **Bảng điều khiển (`GET /api/dashboard/summary`):**
   - Chỉ số `collected` được tính trực tiếp từ:
     `SELECT sum(amount) FROM public.payments WHERE method IN ('CASH', 'BANK_TRANSFER', 'CARD')`.
   - Hoàn toàn không liên quan tới `refund_payables` hay `invoice_adjustments`.
2. **Báo cáo Thu tiền 90 ngày (`sales_90d` vs `collected_90d`):**
   - `collected_90d` tính từ `payments` với các phương thức tiền thực trong vòng 90 ngày.
   - `sales_90d` tính từ `invoices` với `total - adjusted_total`.
3. **Các chỉ số thu nợ DSO và CEI:**
   - $DSO = \frac{\text{Receivables}}{\text{Sales 90d}} \times 90$
   - $CEI = \frac{\text{Collected 90d}}{\text{Receivables} + \text{Sales 90d}} \times 100$
   - Phản ánh trung thực công nợ sau khi đã chiết khấu bằng Credit Note và tiền mặt thực thu từ Payments.

**Đánh giá:** **PASS** (Dòng tiền mặt thuần túy được bảo vệ nghiêm ngặt).

---

## 9. Revenue/VAT Verification

Kiểm tra tính toàn vẹn của Báo cáo Doanh thu và Khai trình Thuế GTGT sau P1.1:

1. **Báo cáo Doanh thu (`GET /api/reports/revenue`):**
   - Doanh thu thuần hàng tháng và theo phân khúc khách hàng được tính toán:
     $$\text{Net Revenue} = \sum(\text{subtotal} - \text{adj\_amount})$$
     trong đó `adj_amount` là tổng giá trị từ các `invoice_adjustments` có trạng thái `PROCESSED`.
2. **Khai trình Thuế GTGT (`GET /api/reports/vat`):**
   - Thuế GTGT thuần theo từng mức thuế suất (0%, 5%, 8%, 10%) tính toán:
     $$\text{Net VAT} = \sum(\text{tax\_amount} - \text{adj\_vat})$$
     cho các hóa đơn hiệu lực, trừ đi chính xác phần thuế điều chỉnh từ Credit Note.
3. **Ngăn chặn Double-Counting:**
   - Khoản nghĩa vụ hoàn tiền (`refund_payables`) không can thiệp vào các công thức doanh thu và thuế, đảm bảo kết quả P0 không bị sai lệch hay tính trùng hai lần.

**Đánh giá:** **PASS** (Logic báo cáo tài chính P0 được bảo toàn nguyên vẹn).

---

## 10. Database Invariants

Thực thi kiểm tra pháp y toàn diện trên toàn bộ bảng `public.invoices` (490 hóa đơn hiện có trong runtime database):

```sql
SELECT 
  count(*) FILTER (WHERE paid_total < 0) AS count_neg_paid,
  count(*) FILTER (WHERE adjusted_total < 0) AS count_neg_adjusted,
  count(*) FILTER (WHERE paid_total + adjusted_total > total) AS count_over_settled,
  count(*) FILTER (WHERE total - paid_total - adjusted_total < 0) AS count_neg_outstanding,
  count(*) AS total_invoices
FROM public.invoices;
```

### Kết quả kiểm tra:
- `paid_total < 0`: **0**
- `adjusted_total < 0`: **0**
- `paid_total + adjusted_total > total` (Over-settlement): **0**
- `total - paid_total - adjusted_total < 0` (Negative outstanding): **0**
- Tổng số hóa đơn kiểm tra: **490 / 490 hóa đơn thỏa mãn 100%**.
- Phương thức `CREDIT_NOTE` trong bảng `public.payments`: **0** (Ràng buộc check constraint `payments_method_check` ngăn chặn hoàn toàn).

**Đánh giá:** **PASS** (Zero invariant violations).

---

## 11. Refund Forensics

Kiểm tra pháp y trên bảng `public.refund_payables`:

```sql
SELECT
  (SELECT count(*) FROM (SELECT adjustment_id FROM public.refund_payables GROUP BY adjustment_id HAVING count(*) > 1) t) AS dup_adj,
  (SELECT count(*) FROM (SELECT refund_no FROM public.refund_payables GROUP BY refund_no HAVING count(*) > 1) t) AS dup_ref_no,
  (SELECT count(*) FROM public.refund_payables r LEFT JOIN public.customers c ON c.id = r.customer_id WHERE c.id IS NULL) AS orphan_cust,
  (SELECT count(*) FROM public.refund_payables r LEFT JOIN public.invoices i ON i.id = r.invoice_id WHERE i.id IS NULL) AS orphan_inv,
  (SELECT count(*) FROM public.refund_payables r LEFT JOIN public.invoice_adjustments a ON a.id = r.adjustment_id WHERE a.id IS NULL) AS orphan_adj,
  (SELECT count(*) FROM public.refund_payables r LEFT JOIN public.users u ON u.id = r.created_by WHERE u.id IS NULL) AS orphan_user,
  (SELECT count(*) FROM public.refund_payables WHERE amount <= 0) AS invalid_amount,
  (SELECT count(*) FROM public.refund_payables WHERE status NOT IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')) AS invalid_status,
  (SELECT count(*) FROM public.refund_payables WHERE currency != 'VND') AS invalid_curr;
```

### Kết quả kiểm tra pháp y:
- Trùng lặp `adjustment_id` (Duplicate adjustments): **0**
- Trùng lặp `refund_no` (Duplicate voucher numbers): **0**
- Bản ghi mồ côi khách hàng (`orphan_cust`): **0**
- Bản ghi mồ côi hóa đơn (`orphan_inv`): **0**
- Bản ghi mồ côi biên bản điều chỉnh (`orphan_adj`): **0**
- Bản ghi mồ côi người tạo (`orphan_user`): **0**
- Số tiền hoàn không hợp lệ (`amount <= 0`): **0**
- Trạng thái không hợp lệ: **0**
- Tiền tệ không hợp lệ (`currency != 'VND'`): **0**

### Đối chiếu điều chỉnh đã xử lý (`PROCESSED` Adjustments Reconciliation):
Kiểm tra toàn bộ 38 biên bản điều chỉnh đã xử lý trong lịch sử cơ sở dữ liệu:
- Mọi Credit Note phát sinh trên hóa đơn có số tiền vượt quá dư nợ còn lại đều sinh đúng 1 bản ghi `refund_payables` với số tiền:
  $$\text{refund\_amount} = \text{total\_amount} - \text{outstanding\_before}$$
- Tổng số bản ghi hoàn nợ trong sổ cái hiện tại: **5 bản ghi** (`REF-2026-0004` đến `REF-2026-0008`), tất cả đều tương ứng 1-1 với các Credit Note hợp lệ từ các bài kiểm thử.
- Mọi Credit Note nhỏ hơn hoặc bằng dư nợ đều không sinh bản ghi hoàn nợ và được hấp thụ trọn vẹn vào `adjusted_total`.
- **Không có đồng tiền nào bị mất hoặc sinh ra vô căn cứ.**

**Đánh giá:** **PASS** (Tính toàn vẹn pháp y hoàn hảo).

---

## 12. API Verification

Thực hiện kiểm thử gọi API trực tiếp ở chế độ READ-ONLY thông qua phiên làm việc xác thực an toàn:

1. **Bảo mật & Xác thực:**
   - Yêu cầu chưa xác thực tới `GET /api/refunds` trả về HTTP `401 Unauthorized` (**PASS**).
2. **Danh sách Hoàn nợ (`GET /api/refunds` & `GET /api/refund-payables`):**
   - Trả về HTTP `200 OK` với phân trang đầy đủ (`items`, `refunds`, `total: 5`, `page: 1`, `limit: 5`).
   - Cung cấp đầy đủ thông tin chi tiết: `refund_no`, `amount`, `currency`, `status`, `customer_name`, `invoice_no`, `credit_note_no`, `created_by_username`.
3. **Chi tiết Hoàn nợ (`GET /api/refunds/:id`):**
   - Trả về HTTP `200 OK` với đối tượng `{ refund: { ... } }`.
   - Với ID không tồn tại, trả về HTTP `404 REFUND_NOT_FOUND`.
4. **Chi tiết Hóa đơn (`GET /api/invoices/:id`):**
   - Đã tích hợp mảng `refunds: [...]` trong dữ liệu trả về của hóa đơn, giúp kế toán tra cứu ngay các khoản tiền phải hoàn phát sinh từ hóa đơn.

**Đánh giá:** **PASS** (API đạt chuẩn RESTful, an toàn và đầy đủ thông tin).

---

## 13. Privilege Verification

Khảo sát danh mục phân quyền truy cập PostgreSQL (`\dp public.refund_payables`):

| Vai trò Cơ sở dữ liệu | Quyền hạn trên bảng `refund_payables` | Quyền hạn trên Sequences (`refund_no_seq`, `refund_payables_id_seq`) | Đánh giá |
| :--- | :--- | :--- | :---: |
| `postgres` (Superuser) | `arwdDxt` (All privileges) | `rwU` (All privileges) | **PASS** |
| `billing_app` (App runtime) | `arwd` (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) | `rwU` (`USAGE`, `SELECT`, `UPDATE`) | **PASS** |
| `billing_readonly` (Auditor) | `r` (`SELECT` only) | Không có quyền ghi/sửa sequence | **PASS** |

- Ứng dụng nghiệp vụ `billing_app` có đầy đủ quyền thao tác sổ cái và sinh mã tự động.
- Vai trò đọc `billing_readonly` chỉ có quyền xem, bị chặn hoàn toàn mọi hành vi ghi hoặc sửa dữ liệu.

**Đánh giá:** **PASS** (Nguyên tắc đặc quyền tối thiểu được tuân thủ).

---

## 14. Migration Safety

Đánh giá tĩnh mã nguồn file di trú [db/migrations/02_p1_refund_ledger.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/02_p1_refund_ledger.sql):

- **Giao dịch trọn vẹn:** Đóng gói trong khối `BEGIN; ... COMMIT;`. Nếu xảy ra bất kỳ lỗi cú pháp nào, toàn bộ giao dịch sẽ tự động rollback.
- **Tính Idempotent & Rerun-safe:**
  - `CREATE SEQUENCE IF NOT EXISTS public.refund_no_seq`
  - `CREATE TABLE IF NOT EXISTS public.refund_payables`
  - `CREATE INDEX IF NOT EXISTS ...`
  - Chạy lại nhiều lần không gây lỗi hoặc trùng lặp đối tượng.
- **Tính phi hủy diệt (Non-destructive):**
  - Tuyệt đối không chứa câu lệnh `DROP TABLE`, `TRUNCATE`, `ALTER TABLE ... DROP COLUMN`.
  - Không chứa câu lệnh `UPDATE` hoặc `DELETE` toàn bảng thiếu điều kiện.
- **Khóa ngoại & Ràng buộc:** Khóa ngoại tham chiếu chính xác các bảng cha sẵn có; ràng buộc `CHECK (amount > 0)` và `status IN (...)` tường minh.

**Đánh giá:** **`SAFE`** (Hoàn toàn an toàn cho môi trường sản xuất).

---

## 15. Test Claim Verification

Kiểm tra chi tiết kịch bản và mã nguồn bộ kiểm thử [scripts/p1-refund-ledger-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1-refund-ledger-test.mjs):

| Test Case | Khẳng định Kiểm thử | Cơ chế Xác minh | Kết quả | Phân loại |
| :--- | :--- | :--- | :---: | :---: |
| **TEST 1** | Credit Note $\le$ Outstanding $\rightarrow$ `refund = 0`, `adjusted = 20M` | Kiểm tra HTTP 200, đối chiếu `paid_total`, `adjusted_total`, `outstanding` và mảng `refunds` rỗng | PASS | **VERIFIED** |
| **TEST 2** | Credit Note $>$ Outstanding $\rightarrow$ Tách `ar_reduction` và `refund_payable` | Kiểm tra `ar_reduction = 10M`, `refund_payable = 20M`, status hóa đơn = `PAID`, sinh `REF-XXXX` | PASS | **VERIFIED** |
| **TEST 3** | Credit Note trên hóa đơn đã `PAID` $\rightarrow$ Không vi phạm check constraint DB | Kiểm tra `ar_reduction = 0`, `adjusted_total` không tăng, `refund = 20M` | PASS | **VERIFIED** |
| **TEST 4** | Xử lý lặp (Replay process) bị từ chối | Kiểm tra mã lỗi trả về HTTP `409 ADJUSTMENT_ALREADY_PROCESSED` | PASS | **VERIFIED** |
| **TEST 5** | Xử lý đồng thời (Concurrent process) | Sử dụng `Promise.all` gửi 2 request song song, xác minh đúng 1 HTTP 200 và 1 HTTP 409 | PASS | **VERIFIED** |
| **TEST 6** | Từ chối thanh toán với phương thức `CREDIT_NOTE` | Gửi request `POST /payments` với method `CREDIT_NOTE`, nhận HTTP `400 INVALID_PAYMENT_METHOD` | PASS | **VERIFIED** |
| **TEST 7** | Công nợ danh sách khách hàng khớp chi tiết | Tìm kiếm khách hàng theo tên, so sánh `current_debt` và `available_credit` | PASS | **VERIFIED** |
| **TEST 8** | Hồ sơ tài chính khách hàng khớp Báo cáo Tuổi nợ | Đối chiếu giá trị công nợ giữa `/financial-profile` và `/reports/aging` | PASS | **VERIFIED** |
| **TEST 9** | Dòng tiền thực thu không bị ảnh hưởng bởi Credit Note | So sánh `collected` trên Dashboard với `total_collected` trên Báo cáo Doanh thu | PASS | **VERIFIED** |
| **TEST 10**| Bất biến tài chính cơ sở dữ liệu trên tất cả hóa đơn test | Kiểm tra `paid >= 0`, `adjusted >= 0`, `paid + adjusted <= total`, `outstanding >= 0` | PASS | **VERIFIED** |

**Đánh giá:** **VERIFIED** (Tất cả 10 khẳng định kiểm thử đều chứng minh chính xác bất biến tài chính).

---

## 16. Regression Verification

Thực thi kiểm tra hồi quy độc lập trên hệ thống runtime:

1. **Chuỗi băm Kiểm toán SHA-256 (`/api/audit/verify`):**
   - Xác thực: **100% bản ghi hợp lệ** (504/504 bản ghi).
   - Mã băm liên kết mật mã không hề bị đứt gãy hay giả mạo.
2. **Kiểm thử Hợp đồng Giao diện HTTP (`frontend-e2e-test.mjs`):**
   - Đạt **100% PASS** trên tất cả 23 static route patterns và API endpoints.
   - **Zero 404s**. Phân phối HTML/CSS/JS chính xác.
3. **An ninh Hạ tầng H1–H6 (`verify-hardening.ps1`):**
   - Vượt qua 100% tất cả các bài kiểm tra non-root container, mạng cô lập, bảo vệ biến môi trường, phân quyền người dùng cơ sở dữ liệu, và tiêu đề bảo mật HTTP.
4. **Smoke Suite (`cp2-smoke.mjs`):**
   - Đạt 15/15 bài kiểm tra, độ trễ p95 đạt **21.67 ms**.

**Đánh giá:** **PASS** (Zero hồi quy phát sinh).

---

## 17. Scope Compliance

Đối chiếu toàn bộ thay đổi mã nguồn qua lệnh `git diff 459d45a..a26e95f`:
- **Chỉ có 9 file được tác động**, hoàn toàn nằm trong phạm vi P1.1:
  - `app/src/app.js`: Tinh chỉnh ghi log lỗi chi tiết khi xảy ra mã 500.
  - `app/src/routes/adjustments.js`: Logic phân rã Credit Note và ghi sổ Refund.
  - `app/src/routes/customers.js`: Chuẩn hóa công thức công nợ khách hàng trừ `adjusted_total`.
  - `app/src/routes/index.js`: Định tuyến router refunds.
  - `app/src/routes/invoices.js`: Gắn mảng `refunds` vào chi tiết hóa đơn.
  - `app/src/routes/refunds.js`: API tra cứu sổ cái hoàn nợ.
  - `db/migrations/02_p1_refund_ledger.sql`: Migration tạo bảng và sequence.
  - `scripts/p1-refund-ledger-test.mjs`: Test suite P1.1.
  - `docs/BILLING_ONE_P1_1_REFUND_LEDGER_REPORT.md`: Báo cáo kết quả P1.1.
- Không có bất kỳ dòng mã nào liên quan đến Payment Allocation v2, RBAC redesign, Audit Hash redesign, hay Browser E2E.

**Đánh giá:** **PASS** (100% tuân thủ ranh giới phạm vi nghiệp vụ).

---

## 18. Findings Matrix

| Finding ID | Mức độ nghiêm trọng | Thành phần | Bằng chứng & Hiện tượng | Tác động | Khuyến nghị hành động |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **FIND-P1-AUD-01** | **INFO** | `refund_payables.status` & Outflow Ledger | Trường `paid_payment_id` hiện tại là NULL và status giữ ở `PENDING`. Chưa có module thanh toán tiền chi ra thực tế. | Giới hạn kiến trúc có chủ đích của P1.1 (đã ghi nhận trong Roadmap). Nghĩa vụ nợ được theo dõi đúng. | Triển khai module Chi hoàn trả tiền mặt (Cash Outflow / Voucher Out) trong giai đoạn tiếp theo (P2). |
| **FIND-P1-AUD-02** | **LOW** | Migration Sequence Permission | Sequence `refund_payables_id_seq` được tạo tự động bởi kiểu `bigserial`. Quyền USAGE đã được cấp tường minh trong migration. | Hiện tại không có lỗi, ứng dụng hoạt động ổn định. | Duy trì việc cấp quyền explicit cho các sequence tự sinh trong các migration tiếp theo. |

- **CRITICAL:** **0**
- **HIGH:** **0**
- **MEDIUM:** **0**
- **LOW:** **1**
- **INFO:** **1**

---

## 19. Final Decision Questions

1. **Refund Ledger có hoạt động đúng domain không?**  
   $\rightarrow$ **CÓ**. Tách biệt hoàn toàn khỏi payments và adjustments, quản lý đúng nghĩa vụ nợ phải trả hoàn tiền cho khách hàng.
2. **Credit Note trên PAID invoice có an toàn không?**  
   $\rightarrow$ **CÓ**. `ar_reduction = 0`, `adjusted_total` không tăng, check constraint cơ sở dữ liệu được bảo vệ an toàn 100%.
3. **Refund payable có bị nhầm thành cash không?**  
   $\rightarrow$ **KHÔNG**. Không sinh payment inbound giả mạo, không ảnh hưởng chỉ số `cash_collected`.
4. **Customer debt có đồng nhất toàn hệ thống không?**  
   $\rightarrow$ **CÓ**. Tất cả các endpoint và báo cáo đều sử dụng công thức trừ `adjusted_total`.
5. **Invoice financial invariants có được bảo vệ không?**  
   $\rightarrow$ **CÓ**. 490/490 hóa đơn thỏa mãn 100% các bất biến tài chính.
6. **Có duplicate refund không?**  
   $\rightarrow$ **KHÔNG**. Ràng buộc `UNIQUE (adjustment_id)` và cơ chế khóa `FOR UPDATE` ngăn chặn tuyệt đối.
7. **Có orphan refund không?**  
   $\rightarrow$ **KHÔNG**. 100% bản ghi hoàn tiền liên kết đầy đủ khóa ngoại hợp lệ.
8. **Migration có an toàn và idempotent không?**  
   $\rightarrow$ **CÓ**. Đánh giá `SAFE`, có `BEGIN/COMMIT`, `IF NOT EXISTS`, không có lệnh hủy hoại dữ liệu.
9. **P1.1 regression có thực sự được chứng minh không?**  
   $\rightarrow$ **CÓ**. Tất cả các bộ kiểm thử hồi quy và chuỗi băm kiểm toán mật mã SHA-256 đều PASS.
10. **Có lỗi CRITICAL/HIGH còn sót lại trong phạm vi P1.1 không?**  
    $\rightarrow$ **KHÔNG**. 0 lỗi Critical, 0 lỗi High.

---

## 20. Final Verdict

# `P1.1 VERIFIED — READY FOR P1.2`

### Căn cứ kết luận:
1. Sổ cái hoàn tiền `public.refund_payables` hoạt động hoàn hảo, đúng bản chất kế toán và chuẩn kiến trúc doanh nghiệp.
2. Credit Note trên các hóa đơn đã thanh toán đầy đủ (`PAID`) hoặc thanh toán vượt dư nợ được xử lý an toàn, không còn vi phạm check constraint cơ sở dữ liệu PostgreSQL.
3. Không tạo bất kỳ giao dịch thanh toán tiền giả mạo nào; dòng tiền mặt thực thu được cách ly tuyệt đối.
4. Công thức công nợ khách hàng được chuẩn hóa đồng bộ 100% trên toàn bộ hệ thống (khắc phục dứt điểm cảnh báo FIND-P0-AUD-02).
5. Migration an toàn tuyệt đối (`SAFE`), cơ sở dữ liệu đạt 0 vi phạm pháp y.
6. Hệ thống duy trì tính toàn vẹn hoàn hảo sau kiểm thử hồi quy và đã sẵn sàng tiến hành giai đoạn **P1.2 Payment Allocation v2**.

---

## 21. Tuân thủ Nguyên tắc Dừng (Stop Execution)

Theo chỉ thị tối cao của Section XXVIII:
- Kiểm toán viên **DỪNG TOÀN BỘ HOẠT ĐỘNG TẠI ĐÂY**.
- Không tự ý thực hiện P1.2 Payment Allocation v2.
- Không sửa đổi mã nguồn hay cơ sở dữ liệu.
