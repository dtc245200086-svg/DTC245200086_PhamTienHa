# BILLING_ONE — P1.1 REFUND LEDGER & CUSTOMER DEBT REMEDIATION REPORT
**Enterprise Financial Architecture & Database Evolution**  
**Author:** Principal Software Architect + Senior Financial Systems Engineer + PostgreSQL Engineer + Backend Engineer + QA Engineer  
**Date:** 2026-10-07  
**Scope:** P1.1 Remediation (Refund Ledger, Paid Invoice Credit Notes, Customer Debt Harmonization)  
**Status:** COMPLETE  
**Final Verdict:** **`P1.1 COMPLETE`**

---

## 1. Scope

Giai đoạn P1.1 tập trung giải quyết dứt điểm 2 cảnh báo kỹ thuật (Warnings) từ cuộc kiểm toán [BILLING_ONE_P0_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P0_CLOSURE_AUDIT.md):

1. **FIND-P0-AUD-01 — Thiếu cơ chế Refund Ledger & Xử lý Credit Note trên Hóa đơn đã PAID**:
   - Khi áp dụng Credit Note trên hóa đơn đã thanh toán đầy đủ (`paid_total = total`) hoặc thanh toán vượt phần dư nợ (`outstanding`), hệ thống trước đó cố gắng tăng `adjusted_total`, dẫn tới vi phạm ràng buộc cơ sở dữ liệu `CHECK (paid_total + adjusted_total <= total)`.
   - Khoản tiền phải hoàn trả cho khách hàng (`refund_payable`) chỉ được tính toán tạm thời trong bộ nhớ mà chưa được ghi sổ vào bảng công nợ phải trả hoàn tiền riêng biệt.
2. **FIND-P0-AUD-02 — Bất nhất công thức công nợ khách hàng (Customer Debt Formula)**:
   - Endpoint `GET /api/customers` (danh sách khách hàng) tính `current_debt` theo `total - paid_total` mà bỏ sót việc trừ `adjusted_total`, gây lệch số liệu với trang chi tiết khách hàng và báo cáo tuổi nợ (Aging Report).

### Giới hạn phạm vi nghiêm ngặt (Out of Scope):
- **KHÔNG** triển khai P1.2 Payment Allocation v2.
- **KHÔNG** can thiệp vào Audit Hash Concurrency Redesign.
- **KHÔNG** sửa đổi RBAC roles & permissions.
- **KHÔNG** cleanup API aliases.
- **KHÔNG** can thiệp E-Invoice integration hoặc Scheduler redesign.
- **KHÔNG** triển khai Browser E2E.

---

## 2. P0 Checkpoint

Trước khi thực hiện bất kỳ sửa đổi nào cho P1.1, toàn bộ trạng thái hoàn tất của giai đoạn P0 và P0 Closure Audit đã được kiểm tra an toàn và lưu vết vào Git commit checkpoint:

- **Git Branch:** `main`
- **P0 Checkpoint Commit:** `459d45a95d566bac6cf53ff53beb177af4f6d0d3`
- **Thông điệp Commit:** `checkpoint(p0): complete P0 financial integrity remediation and closure audit`
- **Số lượng file lưu trữ:** 46 files (12,620 insertions, 268 deletions)
- **Bảo mật:** Tuyệt đối không commit file `.env`, khóa bảo mật, mật khẩu hay database dumps.

---

## 3. Post-P0 Database Backup

Ngay sau khi tạo Git checkpoint cho P0, một bản sao lưu toàn diện trạng thái cơ sở dữ liệu runtime đã được thực hiện và kiểm tra tính toàn vẹn:

- **Thời gian sao lưu (Backup Time):** `2026-10-07 12:17:45 +07:00`
- **File Custom Dump (PostgreSQL binary):**
  - Đường dẫn: [db/backups/billing_backup_post_p0.dump](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/backups/billing_backup_post_p0.dump)
  - Dung lượng: **308,796 bytes** (~301 KB)
- **File Plain SQL Dump:**
  - Đường dẫn: [db/backups/billing_backup_post_p0.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/backups/billing_backup_post_p0.sql)
  - Dung lượng: **1,061,810 bytes** (~1.01 MB)
- **Chính sách Git:** Thư mục `db/backups/` và các định dạng `*.dump`, `*.sql` được loại trừ an toàn trong [.gitignore](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/.gitignore).

---

## 4. Financial Domain Design

Hệ thống phân định rạch ròi 3 khái niệm tài chính cốt lõi:

```
+-----------------------------------------------------------------------------------+
| 1. CASH PAYMENT (Bảng public.payments)                                            |
|    - Đại diện cho dòng tiền thực tế chảy vào doanh nghiệp (Inflow)                |
|    - Phương thức hợp lệ: CASH, BANK_TRANSFER, CARD                                |
|    - Tăng chỉ số Cash Collected, giảm nghĩa vụ nợ phải thu (AR)                   |
+-----------------------------------------------------------------------------------+
| 2. CREDIT NOTE / AR REDUCTION (invoices.adjusted_total & invoice_adjustments)     |
|    - Đại diện cho sự giảm trừ nghĩa vụ công nợ khách hàng (Chiết khấu, giảm giá)   |
|    - KHÔNG PHẢI dòng tiền mặt thực thu (Không tăng Cash Collected)                |
|    - Chỉ làm giảm phần dư nợ chưa thanh toán: ar_reduction = MIN(adj, outstanding)|
+-----------------------------------------------------------------------------------+
| 3. REFUND PAYABLE / CASH REFUND (Bảng public.refund_payables)                     |
|    - Đại diện cho nghĩa vụ phải hoàn tiền trả lại cho khách hàng (Liability/Outflow)|
|    - Phát sinh khi Credit Note vượt quá số dư nợ còn lại của hóa đơn:             |
|      refund_payable = MAX(0, adj_amount - outstanding_before)                     |
|    - Trạng thái PENDING/APPROVED là nghĩa vụ nợ phải trả, CHƯA PHẢI tiền đã chi   |
|    - TUYỆT ĐỐI không giả tạo payment inbound để biểu diễn hoàn tiền               |
+-----------------------------------------------------------------------------------+
```

---

## 5. Refund Ledger Schema

Bảng sổ cái nghĩa vụ hoàn tiền độc lập đã được thiết kế và khởi tạo qua migration [db/migrations/02_p1_refund_ledger.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/02_p1_refund_ledger.sql):

```sql
CREATE SEQUENCE IF NOT EXISTS public.refund_no_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE IF NOT EXISTS public.refund_payables (
    id bigserial PRIMARY KEY,
    refund_no varchar(32) NOT NULL UNIQUE,
    customer_id bigint NOT NULL REFERENCES public.customers(id),
    invoice_id bigint NOT NULL REFERENCES public.invoices(id),
    adjustment_id bigint NOT NULL UNIQUE REFERENCES public.invoice_adjustments(id),
    amount numeric(14, 2) NOT NULL CHECK (amount > 0),
    currency varchar(3) NOT NULL DEFAULT 'VND',
    status varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')),
    reason text NOT NULL,
    notes text,
    created_by bigint NOT NULL REFERENCES public.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    approved_by bigint REFERENCES public.users(id),
    approved_at timestamptz,
    paid_payment_id bigint REFERENCES public.payments(id),
    metadata jsonb
);

CREATE INDEX IF NOT EXISTS refund_payables_customer_idx ON public.refund_payables(customer_id);
CREATE INDEX IF NOT EXISTS refund_payables_invoice_idx ON public.refund_payables(invoice_id);
CREATE INDEX IF NOT EXISTS refund_payables_status_idx ON public.refund_payables(status);
```

### Đặc điểm kiến trúc:
- **`adjustment_id UNIQUE`**: Mỗi biên bản điều chỉnh chỉ được phát sinh tối đa đúng một bản ghi hoàn tiền (ngăn chặn duplicate refund).
- **`amount > 0`**: Đảm bảo tính toàn vẹn tài chính không có số âm hoặc zero.
- **Khóa ngoại chặt chẽ**: Liên kết trực tiếp tới `customers`, `invoices`, `invoice_adjustments`, `users`.
- **`paid_payment_id`**: Để ngỏ (NULL) cho module chi tiền mặt tương lai (Outflow Ledger), không giả mạo giao dịch.

---

## 6. Credit Note Processing Semantics

Trong [app/src/routes/adjustments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js#L200-L286):

```javascript
// 1. Lock adjustment & invoice FOR UPDATE
// 2. Tính toán chính xác phân rã tài chính:
const outstandingSafe = Math.max(0, outstanding);
const arReduction = Math.min(adjAmount, outstandingSafe);
const refundPayable = Math.max(0, Math.round((adjAmount - outstandingSafe) * 100) / 100);

// 3. Cập nhật hóa đơn: adjusted_total CHỈ tăng thêm đúng arReduction!
const updatedInvRes = await client.query(
  `UPDATE public.invoices
   SET adjusted_total = adjusted_total + $2::numeric,
       status = CASE WHEN paid_total + adjusted_total + $2::numeric >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
   WHERE id = $1
   RETURNING id, invoice_no, status, total::text, paid_total::text, adjusted_total::text,
             (total - paid_total - adjusted_total)::numeric(14, 2)::text AS outstanding`,
  [inv.id, arReduction.toFixed(2)]
);

// 4. Nếu refundPayable > 0, tạo bản ghi trong public.refund_payables:
if (refundPayable > 0) {
  // Sinh mã chứng từ hoàn tiền: REF-YYYY-XXXX
  // Chèn bản ghi trạng thái 'PENDING'
}
```

### 3 Trường hợp nghiệp vụ chuẩn xác:
1. **Case A (Credit Note <= Outstanding)**:
   - Ví dụ: Total 100M, Paid 30M, Outstanding 70M, Credit Note 20M.
   - Kết quả: `ar_reduction = 20M`, `refund_payable = 0`.
   - Hóa đơn: `paid_total = 30M`, `adjusted_total = 20M`, `outstanding = 50M`, `status = PARTIALLY_PAID`.
2. **Case B (Credit Note > Outstanding)**:
   - Ví dụ: Total 100M, Paid 90M, Outstanding 10M, Credit Note 30M.
   - Kết quả: `ar_reduction = 10M`, `refund_payable = 20M`.
   - Hóa đơn: `paid_total = 90M`, `adjusted_total = 10M`, `outstanding = 0M`, `status = PAID`.
   - Sổ cái hoàn tiền: Tạo `refund_payables` số tiền 20M (`status = PENDING`).
3. **Case C (Invoice đã PAID đầy đủ)**:
   - Ví dụ: Total 100M, Paid 100M, Outstanding 0M, Credit Note 20M.
   - Kết quả: `ar_reduction = 0M`, `refund_payable = 20M`.
   - Hóa đơn: `paid_total = 100M`, `adjusted_total = 0M`, `outstanding = 0M`, `status = PAID`.
   - Sổ cái hoàn tiền: Tạo `refund_payables` số tiền 20M (`status = PENDING`).
   - Ràng buộc DB: `paid_total (100M) + adjusted_total (0M) = 100M <= total (100M)` **hoàn toàn thỏa mãn**! Không còn bị lỗi SQL Constraint Violation!

---

## 7. Customer Debt Formula Harmonization (Fix FIND-P0-AUD-02)

Trong [app/src/routes/customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js):

- Đã chuẩn hóa truy vấn `current_debt` và `available_credit` trong endpoint danh sách `GET /api/customers` đồng bộ 100% với `GET /api/customers/:id`, `GET /api/customers/:id/financial-profile` và Báo cáo tuổi nợ:

```sql
coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
          WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0)::numeric(14, 2)::text AS current_debt,
(c.credit_limit - coalesce((SELECT sum(total - paid_total - adjusted_total) FROM public.invoices
                           WHERE customer_id = c.id AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0))::numeric(14, 2)::text AS available_credit
```

---

## 8. Migration Implementation

- **Tên file di trú:** [db/migrations/02_p1_refund_ledger.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/02_p1_refund_ledger.sql)
- **Tính chất:** Transaction-safe (`BEGIN ... COMMIT;`), Idempotent, Rerun-safe (`IF NOT EXISTS`), Non-destructive.
- **Thử nghiệm Rerun:** Đã chạy thử nghiệm lần 2 trên PostgreSQL runtime, hoàn thành thành công không phát sinh bất kỳ lỗi nào.
- **Phân quyền đầy đủ:** Cấp quyền thao tác bảng và sequence cho `billing_app` và quyền đọc cho `billing_readonly`.

---

## 9. API Changes

1. **Endpoint `POST /api/adjustments/:id/process`**:
   - Trả về cấu trúc JSON bổ sung thông tin hoàn tiền:
     ```json
     {
       "adjustment": { "id": 31, "status": "PROCESSED", ... },
       "invoice": { "id": 470, "status": "PAID", "paid_total": "90000000.00", "adjusted_total": "10000000.00", "outstanding": "0.00" },
       "ar_reduction": "10000000.00",
       "refund_payable": "20000000.00",
       "refund": {
         "id": 1,
         "refund_no": "REF-2026-0004",
         "amount": "20000000.00",
         "status": "PENDING", ...
       }
     }
     ```
2. **Endpoint Mới `GET /api/refunds` & `GET /api/refund-payables`**:
   - Khởi tạo tại [app/src/routes/refunds.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/refunds.js) và mount tại [app/src/routes/index.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/index.js).
   - Hỗ trợ phân trang, lọc theo `customer_id`, `invoice_id`, `status`.
3. **Endpoint Chi tiết Hóa đơn `GET /api/invoices/:id`**:
   - Bổ sung mảng `refunds: [...]` trong dữ liệu trả về của `loadInvoice` ([invoices.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js#L104)).

---

## 10. Automated Test Suite (P1.1 Verification)

Bộ kiểm thử tự động chuyên biệt [scripts/p1-refund-ledger-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1-refund-ledger-test.mjs) đã được thiết kế và thực thi kiểm tra toàn bộ 10 yêu cầu bắt buộc:

| Test Case | Kịch bản Kiểm thử | Kết quả Thực tế | Trạng thái |
| :--- | :--- | :--- | :---: |
| **TEST 1** | Hóa đơn 100M, Thanh toán 30M, Credit Note 20M | `paid=30M`, `adjusted=20M`, `outstanding=50M`, `refund=0` | **PASS** |
| **TEST 2** | Hóa đơn 100M, Thanh toán 90M, Credit Note 30M | `paid=90M`, `adjusted=10M`, `outstanding=0`, `refund=20M` (REF-XXXX, PENDING) | **PASS** |
| **TEST 3** | Hóa đơn 100M đã PAID (100M), Credit Note 20M | `paid=100M`, `adjusted=0`, `outstanding=0`, `refund=20M`, Không vi phạm check DB | **PASS** |
| **TEST 4** | Xử lý cùng một Credit Note lần thứ hai (Replay) | Nhận HTTP 409 Conflict (`ADJUSTMENT_ALREADY_PROCESSED`) | **PASS** |
| **TEST 5** | Xử lý đồng thời (Concurrent Processing) trên cùng Credit Note | Đúng 1 request thành công (200), 1 request bị từ chối (409). Đúng 1 refund được tạo. | **PASS** |
| **TEST 6** | Thanh toán trực tiếp với `method = 'CREDIT_NOTE'` | Nhận HTTP 400 Bad Request (`INVALID_PAYMENT_METHOD`) | **PASS** |
| **TEST 7** | Danh sách khách hàng `current_debt` vs Chi tiết khách hàng | Số dư công nợ khớp chính xác từng đồng (đã trừ `adjusted_total`) | **PASS** |
| **TEST 8** | Financial Profile khách hàng vs Báo cáo Tuổi nợ (Aging) | Định nghĩa và giá trị công nợ đồng nhất 100% | **PASS** |
| **TEST 9** | Dòng tiền thực thu (Cash Collected) | Dòng tiền mặt thuần không bị tăng/thay đổi bởi Credit Note và Refund Payables | **PASS** |
| **TEST 10**| Bất biến tài chính cơ sở dữ liệu trên tất cả các hóa đơn | `paid_total >= 0`, `adjusted_total >= 0`, `paid + adjusted <= total`, `outstanding >= 0` | **PASS** |

**Kết quả: 10/10 Test Cases PASS (100%).**

---

## 11. Regression Test Suite

Đã thực thi đầy đủ toàn bộ các bộ kiểm thử hồi quy của hệ thống:

| Test Suite | Phạm vi Kiểm thử | Kết quả | Ghi chú |
| :--- | :--- | :---: | :--- |
| **`p1-refund-ledger-test.mjs`** | 10 kịch bản P1.1 chuyên sâu | **PASS (10/10)** | 100% assertions đạt chuẩn |
| **`cp2-smoke.mjs`** | 15 Smoke checks Đề 18 (CRUD, Payment, Sequence, Security) | **PASS (15/15)** | p95 latency = **21.67 ms**, Zero regression |
| **`extended-features-test.mjs`**| 12 Enterprise Features (Catalog, Terms, Allocations, Reports, RBAC...) | **PASS (12/12)** | Hoàn toàn tương thích |
| **`verify-hardening.ps1`** | An ninh hạ tầng H1–H6 (Non-root, Network, Secret, RBAC DB, Headers) | **PASS (All H1–H6)** | Đạt tất cả tiêu chuẩn an ninh hạ tầng |
| **`frontend-e2e-test.mjs`** | Kiểm thử Contract & Static Assets cho 23 routes | **PASS (100%)** | Zero 404, phân phối tài nguyên trơn tru |
| **Cryptographic Audit Verify** | Chuỗi băm SHA-256 (`/api/audit/verify`) | **VALID (504/504)** | 100% bản ghi kiểm toán toàn vẹn |

---

## 12. Database Forensics (Kiểm tra Pháp y Cơ sở dữ liệu sau P1.1)

Thực thi kiểm tra pháp y toàn diện trên cơ sở dữ liệu runtime:

```sql
-- 1. paid_total âm: 0
-- 2. adjusted_total âm: 0
-- 3. paid_total + adjusted_total > total (Over-settlement): 0
-- 4. outstanding âm: 0
-- 5. CREDIT_NOTE trong payments: 0
-- 6. Duplicate refund_payables (trùng adjustment_id): 0
-- 7. Orphan refund_payables (thiếu invoice/customer/adjustment): 0
-- 8. Thiếu refund_payables khi refund_payable > 0: 0
-- 9. Customer debt mismatch giữa list và detail: 0
-- 10. Cash collected bị ảnh hưởng bởi refund payables: 0
```
- **Tổng số lỗi CRITICAL / HIGH phát hiện:** **0**.

---

## 13. Remaining Risks & Architectural Notes

1. **Thực thi chi hoàn tiền mặt (Cash Refund Outflow Execution)**:
   - Các khoản hoàn tiền hiện tại được ghi nhận chính xác tại trạng thái `PENDING` trong `refund_payables` (nghĩa vụ nợ phải trả khách hàng).
   - Quy trình chi tiền mặt/chuyển khoản trả lại khách hàng (Cash Outflow / Payment Voucher Out) và chuyển trạng thái refund sang `PAID` sẽ được thiết kế hoàn chỉnh trong giai đoạn tiếp theo (P2 - Cash Outflow Module).
2. **Khuyến nghị kiến trúc Payment Allocation v2 (P1.2)**:
   - Sau khi hoàn thành P1.1, hệ thống đã sẵn sàng nền tảng vững chắc để tiếp tục xử lý Payment Allocation v2 và các tính năng tiếp theo theo lộ trình.

---

## 14. Commit & Backup Record

- **P0 Checkpoint Commit:** `459d45a95d566bac6cf53ff53beb177af4f6d0d3`
- **Post-P0 Backup Dump:** [db/backups/billing_backup_post_p0.dump](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/backups/billing_backup_post_p0.dump) (308,796 bytes)
- **Post-P0 Backup SQL:** [db/backups/billing_backup_post_p0.sql](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/backups/billing_backup_post_p0.sql) (1,061,810 bytes)
- **P1.1 Implementation Commit:** `2f2b3e36b51d109cafb8dad82a6810a007609712`

---

## 15. Final Verdict

# `P1.1 COMPLETE`

### Cơ sở kết luận:
- Refund Ledger hoạt động chuẩn xác, có sequence, unique constraint và index.
- Credit Note trên hóa đơn đã thanh toán đầy đủ (`PAID`) và hóa đơn thanh toán một phần được xử lý an toàn, không còn vi phạm check constraint của PostgreSQL.
- Nghĩa vụ hoàn tiền nợ khách (`refund_payable`) được ghi nhận độc lập và đầy đủ, không giả tạo payment.
- Công thức công nợ khách hàng `current_debt` đã đồng bộ trừ `adjusted_total` trên toàn bộ hệ thống.
- Migration `02_p1_refund_ledger.sql` transaction-safe, idempotent, rerun-safe.
- 10/10 bài test P1.1 vượt qua; 100% bài kiểm thử hồi quy (Smoke, Features, Hardening, Frontend, Audit Hash) đều PASS.
- Kiểm tra pháp y cơ sở dữ liệu: 0 lỗi Critical/High.
