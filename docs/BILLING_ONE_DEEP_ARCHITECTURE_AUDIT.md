# BILLING_ONE — DEEP ARCHITECTURE & FINANCIAL INTEGRITY AUDIT REPORT

**Document Reference:** `docs/BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md`  
**Audit Date:** 2026-10-07  
**Auditor Roles:** Principal Software Architect, Senior Backend Engineer, Financial Systems Engineer, Security Auditor  
**Audit Target:** Billing_One Enterprise Management Platform (Post LedgerFlow Integration & Remediation Phase)  
**Baseline State:** Docker 12 containers UP, PostgreSQL 16.15 healthy, working tree commit `0222e34` (with uncommitted working tree changes)  
**Audit Methodology:** Deep Static Code Analysis, PostgreSQL Relational Algebra & Data Forensic Verification, Financial Ledger Invariant Analysis, Security Concurrency Modeling.  
**Strict Mandate:** AUDIT-ONLY. Zero code modifications, zero schema migrations, zero database mutations.  
**Final Verdict:** **NOT READY — CRITICAL FINANCIAL/SECURITY ISSUES**

---

## 1. Executive Summary

Đợt kiểm toán kiến trúc chuyên sâu và tính toàn vẹn tài chính (**Deep Architecture & Financial Integrity Audit**) đã được tiến hành trên toàn bộ mã nguồn, cấu trúc cơ sở dữ liệu và hành vi runtime của hệ thống **Billing_One**.

Mục tiêu cốt lõi của cuộc kiểm toán này là **không phụ thuộc mù quáng vào các tuyên bố "100% PASS" hay "100% REMEDIATED"** trong các báo cáo trước đó (`BILLING_ONE_REMEDIATION_FINAL_REPORT.md`), mà đối chiếu trực tiếp giữa:
$$\text{Design} \longleftrightarrow \text{Implementation} \longleftrightarrow \text{Database Schema} \longleftrightarrow \text{Runtime Behavior} \longleftrightarrow \text{Accounting Principles}$$

### Phát hiện Trọng yếu (Key High-Severity Findings):
1. **Sai lệch Bản chất Kế toán của Credit Note (CRITICAL FINANCIAL INTEGRITY FLAW):**
   - Để "sửa lỗi" Credit Note không trừ nợ (F-02), bản sửa lỗi đã chèn bản ghi vào bảng `payments` với `method = 'CREDIT_NOTE'` và tăng `paid_total += total_amount`.
   - **Hậu quả thảm khốc:** Mọi truy vấn đo lường dòng tiền (`/dashboard/summary`, `/reports/collection-metrics`) đều dùng lệnh `SUM(payments.amount)` mà không loại trừ `CREDIT_NOTE`. Toàn bộ số tiền giảm giá, hàng bán bị trả lại, hoặc chiết khấu được **tính nhầm thành "TIỀN MẶT ĐÃ THU" (*Cash Collected*)**!
   - Đồng thời, Báo cáo Doanh thu (`/reports/revenue-analytics`) và Báo cáo Thuế GTGT (`/reports/vat-declaration`) truy vấn trực tiếp từ bảng `invoices` mà **không hề khấu trừ Credit Note**, dẫn đến việc báo cáo khống doanh thu và khai thừa thuế GTGT đầu ra.
2. **Dữ liệu Lịch sử Bị Bất đồng bộ Nghiêm trọng (HISTORICAL LEDGER INCONSISTENCY):**
   - Kiểm tra pháp y dữ liệu thực tế phát hiện **10 hóa đơn** (các ID: 384, 385, 386, 387, 401, 402, 410, 411, 422, 423) có số dư `paid_total` hoàn toàn không khớp với lịch sử thanh toán trong `payments`.
   - Cụ thể: 5 hóa đơn (vd: ID 402, 423) có trạng thái `PAID` với `paid_total = 11.000.000 ₫` nhưng có **0 bản ghi thanh toán nào** trong bảng `payments`. Ngược lại, 5 hóa đơn (vd: ID 401, 422) có tổng tiền thanh toán trong `payments` là 51.000.000 ₫ trong khi `paid_total` chỉ ghi 40.000.000 ₫!
   - Các bản ghi bị lỗi do mã nguồn cũ trước đợt remediation chưa từng được chạy dữ liệu bù trừ (*reconciliation migration*).
3. **Lỗ hổng Khớp nối Ngân hàng Nhân đôi (DOUBLE RECONCILIATION / REPLAY VULNERABILITY):**
   - Trong `app/src/routes/reconciliation.js`, endpoint `POST /reconciliation/manual-match` khóa giao dịch ngân hàng nhưng **hoàn toàn không kiểm tra `tx.status`**. Một giao dịch ngân hàng đã ở trạng thái `MATCHED` có thể bị gọi khớp lặp đi lặp lại vô số lần cho nhiều hóa đơn khác nhau, tự động sinh các khoản thanh toán ảo.
4. **Race Condition Gây Đứt gãy Chuỗi Băm Kiểm toán (AUDIT HASH CHAIN FORK):**
   - Hàm `recordAudit` trong `app/src/audit.js` truy vấn `SELECT hash ... ORDER BY id DESC LIMIT 1` mà **không có bất kỳ khóa giao dịch hay khóa bảng nào** (`NO table lock / advisory lock`).
   - Hai request ghi nhật ký đồng thời sẽ lấy cùng một `prev_hash`, dẫn tới phân nhánh chuỗi băm. Khi chạy `GET /api/audit/verify`, thuật toán duyệt tuần tự sẽ báo lỗi `PREV_HASH_CHAIN_BROKEN` và phát báo động giả về can thiệp dữ liệu.
5. **Đứt gãy Mô hình Miền Phân bổ Thanh toán (PAYMENT ALLOCATION DRIFT):**
   - Bảng `payments.invoice_id` vẫn giữ ràng buộc `NOT NULL`, buộc hệ thống phải xé lẻ 1 giao dịch ngân hàng thành nhiều dòng `payments` con độc lập. Các dòng trong `payment_allocations` trở thành bản sao 1-1 thừa thãi, không thể hiện đúng quan hệ 1-N của dòng tiền thực tế và không lưu trữ được tiền chưa phân bổ (*Unapplied Cash*) tại tầng thanh toán.
6. **Bản chất Hóa đơn Điện tử & Test E2E:**
   - E-Invoice: **100% Mô phỏng nội bộ (*SIMULATION ONLY*)**, không có chữ ký số, không kết nối T-VAN hay Tổng cục Thuế.
   - Frontend E2E Test: **Chỉ là HTTP Integration / Static Smoke Test**, không hề điều khiển trình duyệt hay kiểm tra tương tác DOM thực tế.

---

## 2. Audit Scope

Kiểm toán bao phủ toàn diện 100% các thành phần của hệ thống Billing_One:
- **Tài liệu đặc tả:** `AGENT_MASTER_INSTRUCTIONS.md`, `BILLING_ONE_TARGET_ARCHITECTURE.md`, `BILLING_ONE_DOMAIN_MODEL.md`, `BILLING_ONE_DATABASE_EVOLUTION.md`, `BILLING_ONE_FEATURE_ROADMAP.md`, `LEDGERFLOW_TO_BILLING_ONE_GAP_ANALYSIS.md`, `BILLING_ONE_REMEDIATION_FINAL_REPORT.md`, `BILLING_ONE_POST_IMPLEMENTATION_AUDIT.md`.
- **Mã nguồn Backend (`app/src/`):** `app.js`, `server.js`, `db.js`, `logger.js`, `metrics.js`, `validation.js`, `audit.js`, `scheduler.js` và 11 routers trong `routes/` (`auth.js`, `customers.js`, `invoices.js`, `payments.js`, `adjustments.js`, `reconciliation.js`, `recurring.js`, `reports.js`, `products.js`, `payment-terms.js`, `rbac.js`, `settings.js`, `dashboard.js`, `index.js`).
- **Giao diện Frontend (`app/public/`):** `index.html`, `app.js`, `styles.css`.
- **Cơ sở dữ liệu (`db/init/` & PostgreSQL 16.15 Runtime):** `01-schema.sql`, `02-roles.sh`, `03-seed.sh`, `04-evolution.sql`, `05-remediation.sql`.
- **Bộ kiểm thử & Scripts (`scripts/`):** `verify-hardening.ps1`, `frontend-e2e-test.mjs`, `cp2-smoke.mjs`, `extended-features-test.mjs`, `remediation-verification.mjs`, `init-audit-hashes.js`.
- **Hạ tầng Container:** `docker-compose.yml`, `nginx/`, các cấu hình mạng và tài nguyên.

---

## 3. Baseline & Git Integrity

- **Git Branch:** `main` (Up to date with `origin/main`).
- **HEAD Commit:** `0222e34` (*"docs: add startup and assessment guides"*).
- **Working Tree State:** Bất đồng bộ với Git repository:
  - **10 files modified:** `app/public/app.js`, `app/public/styles.css`, `app/src/metrics.js`, `app/src/routes/auth.js`, `app/src/routes/customers.js`, `app/src/routes/index.js`, `app/src/routes/invoices.js`, `app/src/routes/payments.js`, `app/src/server.js`, `app/src/validation.js`.
  - **27 files untracked:** Bao gồm `app/src/audit.js`, `app/src/scheduler.js`, 7 route files mới, 2 tệp migration `04-evolution.sql`, `05-remediation.sql`, tài liệu thiết kế và scripts kiểm thử.
- **Docker Runtime State:**
  - Container `billing-web-1` được build vào thời điểm `2026-10-07T01:43:57Z`.
  - Kiểm tra tệp nội bộ container: Tất cả các file modified và untracked nói trên đã được nướng (*baked*) vào image `billing-web`. Do đó, runtime đang chạy chính xác mã nguồn của working tree hiện tại.
  - Tuy nhiên, việc **chưa commit vào Git** tạo ra rủi ro nghiêm trọng về quản lý cấu hình: Nếu người vận hành chạy `git restore` hoặc checkout sang branch khác, toàn bộ mã nguồn của giai đoạn LedgerFlow và Remediation sẽ bị mất vĩnh viễn khỏi working tree.

---

## 4. Architecture Consistency

So sánh giữa Bản thiết kế mục tiêu (*Target Architecture & Domain Model*) và Triển khai thực tế (*Actual Implementation & Database*):

| Vùng Kiến Trúc | Thiết Kế Mục Tiêu (Design) | Hiện Trạng Code (Implementation) | Cơ Sở Dữ Liệu (DB Schema) | Runtime Behavior | Đánh Giá (Verdict) |
|:---|:---|:---|:---|:---|:---:|
| **Invoice Lifecycle** | State machine: DRAFT → ISSUED → PAID/CANCELLED. Bất biến khi phát hành | Khóa bi quan `SELECT FOR UPDATE`, cấm sửa item khi ISSUED | Sequence `invoice_no_seq`, CHECK constraints | Đúng thiết kế, chặn sửa đổi dòng hàng sau khi phát hành | **PASS** |
| **Credit Note / Adjustment** | Giảm trừ doanh thu/công nợ (Contra-revenue/AR reduction) hoặc hoàn tiền | Ghi nhận như một khoản thanh toán `payments (method=CREDIT_NOTE)` | Bảng `invoice_adjustments`, `payments_method_check` | **Làm sai lệch báo cáo dòng tiền, tính nhầm chiết khấu thành tiền thu** | **CRITICAL** |
| **Payment Allocation** | 1 Payment ngân hàng phân bổ N Invoices qua `PaymentAllocation` | Tách 1 giao dịch thành N dòng `payments`, tạo `allocations` 1-1 giả tạo | `payments.invoice_id NOT NULL` ép buộc quan hệ 1-1 | Xé lẻ thanh toán, không hỗ trợ tiền chưa phân bổ ở cấp payment | **SEMANTICALLY WRONG** |
| **Reconciliation** | Khớp lệnh ngân hàng tự động/thủ công, lưu vết tiền thừa (*unapplied cash*) | Có lưu `unapplied_amount`, nhưng `manual-match` không check `status` | `bank_transactions.unapplied_amount` tồn tại | Cho phép khớp lại nhiều lần 1 giao dịch ngân hàng đã MATCHED | **HIGH RISK** |
| **Recurring Scheduler** | Chạy nền tự động, phân tán an toàn, chống duplicate | Dùng `pg_try_advisory_lock(88812345)` và transaction row lock | Bảng `recurring_plans` có `next_run_date`, `completed_cycles` | Hoạt động an toàn đa container; thuế suất bị hardcode 10% | **ACCEPTABLE (WARN)**|
| **RBAC** | Phân quyền hạt nhân theo danh mục 19 quyền, kiểm tra qua middleware | Đã có `requirePermission`, nhưng nhiều route vẫn dùng `requireRole('admin')` | 5 roles, 19 perms, 54 mappings | Admin bypass tất cả; một số route bỏ ngỏ không kiểm tra quyền | **PARTIALLY CORRECT**|
| **Audit Hash Chain** | Chuỗi băm SHA-256 bất biến, chống giả mạo, phát hiện can thiệp | Tính hash SHA-256 liên kết `prev_hash`, nhưng thiếu lock khi insert | Cột `hash`, `prev_hash`, `canonical_data` | Dễ bị fork chuỗi khi có request đồng thời; cấp quyền UPDATE/DELETE cho web | **HIGH RISK** |
| **Financial Reporting** | Báo cáo tuổi nợ, DSO, CEI, Doanh thu, Thuế phản ánh đúng nghiệp vụ | DSO/CEI dùng tổng tiền payments (bị thổi phồng bởi Credit Note) | Không tính giảm trừ từ `invoice_adjustments` | Báo cáo doanh thu và thuế GTGT bị đội khống | **CRITICAL** |
| **E-Invoice** | Tuân thủ Nghị định 123/TT78, chuẩn bị tích hợp cổng T-VAN | Tự sinh mã dạng chuỗi `1C25TND-XXXXXX` | Cột `e_invoice_code` dạng chuỗi | Hoàn toàn là mô phỏng, không có chữ ký số hay kết nối cơ quan thuế | **SIMULATION ONLY** |
| **Frontend/API** | API RESTful chuẩn, thống nhất định danh trường | Dual-mount routers (`/recurring` & `/recurring-plans`, v.v.), alias fields | Database dùng tên chuẩn | Hoạt động an toàn nhưng gánh nặng nợ kỹ thuật lớn | **TECHNICAL DEBT** |

---

## 5. Database Integrity Audit

### 5.1. Rà soát Schema, Khóa Ngoại và Ràng buộc Toàn vẹn (17 Bảng)
- **Độ chính xác số học (Decimal Precision):** Toàn bộ các trường giá trị tiền tệ trong 17 bảng (`invoices`, `invoice_items`, `payments`, `payment_allocations`, `invoice_adjustments`, `recurring_plans`, `bank_transactions`) đều tuân thủ chặt chẽ định dạng `NUMERIC(14,2)`. Không sử dụng kiểu số thực (`REAL`/`DOUBLE PRECISION`).
- **Khóa ngoại & Hành vi Cascade:**
  - `invoice_items` → `invoices`: `ON DELETE CASCADE` (Hợp lý cho draft).
  - `payments` → `invoices`: `ON DELETE RESTRICT` (Ngăn chặn xóa mất dấu vết thanh toán).
  - `payment_allocations` → `payments`: `ON DELETE CASCADE`.
  - `payment_allocations` → `invoices`: `ON DELETE RESTRICT`.
  - `invoice_adjustments` → `invoices`: `ON DELETE RESTRICT`.
  - Không phát hiện bản ghi mồ côi (*Zero orphan records*).

### 5.2. Phát hiện Dữ liệu Thực tế Bị Sai lệch (Historical Ledger Inconsistency)
Chạy câu lệnh kiểm toán tính nhất quán số dư:
```sql
SELECT i.id, i.invoice_no, i.paid_total, coalesce(sum(p.amount), 0) AS sum_payments
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id, i.invoice_no, i.paid_total
HAVING i.paid_total <> coalesce(sum(p.amount), 0);
```

**Kết quả thực tế từ PostgreSQL:**
```
 id  |   invoice_no    | paid_total  | sum_payments | Chênh lệch (VND)
-----+-----------------+-------------+--------------+------------------
 402 | INV-2026-000265 | 11000000.00 |            0 | -11.000.000 (Không có payment)
 401 | INV-2026-000264 | 40000000.00 |  51000000.00 | +11.000.000 (Thừa payment)
 385 | INV-2026-000254 | 11000000.00 |            0 | -11.000.000 (Không có payment)
 384 | INV-2026-000253 | 30000000.00 |  41000000.00 | +11.000.000 (Thừa payment)
 387 | INV-2026-000256 | 11000000.00 |            0 | -11.000.000 (Không có payment)
 386 | INV-2026-000255 | 40000000.00 |  51000000.00 | +11.000.000 (Thừa payment)
 411 | INV-2026-000271 | 11000000.00 |            0 | -11.000.000 (Không có payment)
 410 | INV-2026-000270 | 40000000.00 |  51000000.00 | +11.000.000 (Thừa payment)
 423 | INV-2026-000280 | 11000000.00 |            0 | -11.000.000 (Không có payment)
 422 | INV-2026-000279 | 40000000.00 |  51000000.00 | +11.000.000 (Thừa payment)
```

**Nguyên nhân gốc rễ:**
Trước đợt remediation F-09, code phân bổ thanh toán đa hóa đơn đã tạo duy nhất 1 bản ghi thanh toán gắn vào hóa đơn đầu tiên với toàn bộ số tiền của đợt phân bổ (ví dụ: thanh toán 41.000.000 ₫ gắn vào Invoice 401, sau đó cập nhật Invoice 401 nợ trừ 30.000.000 ₫ và Invoice 402 nợ trừ 11.000.000 ₫).
Mặc dù code mới trong `payments.js` đã được viết lại, **nhưng 10 hóa đơn này chưa từng được chạy dữ liệu sửa sai**. Cơ sở dữ liệu đang mang theo 10 bản ghi vi phạm tính toàn vẹn tài chính kế toán!

---

## 6. Financial Integrity: Credit Note & Adjustment Financial Semantics

### 6.1. Bản chất Kế toán vs Hiện trạng Triển khai
Trong kế toán tài chính doanh nghiệp:
- **Hóa đơn gốc (Invoice):** Phản ánh Doanh thu (Doanh thu bán hàng và Cung cấp dịch vụ) và Phải thu khách hàng (Nợ TK 131 / Có TK 511, Có TK 3331).
- **Hóa đơn điều chỉnh / Biên bản giảm trừ (Credit Note):** Là một khoản **Giảm trừ doanh thu** (Nợ TK 521 / Nợ TK 3331 / Có TK 131). Nó làm giảm nghĩa vụ thanh toán của khách hàng, giảm doanh thu và giảm nghĩa vụ thuế GTGT.
- **Thanh toán (Payment):** Là một giao dịch chuyển dịch dòng tiền tài chính (Nợ TK 111, 112 / Có TK 131).

### 6.2. Cơ chế Sửa lỗi Sai lầm tại `app/src/routes/adjustments.js`
Đoạn mã xử lý khi kế toán bấm `Process` Credit Note:
```javascript
// Dòng 232-237
const paymentRes = await client.query(
  `INSERT INTO public.payments (invoice_id, amount, method, paid_at, reference, notes, recorded_by)
   VALUES ($1, $2::numeric, 'CREDIT_NOTE', current_date, $3, $4, $5)
   RETURNING id, amount::text, method, paid_at, reference`,
  [inv.id, adj.total_amount, adj.credit_note_no, `Cấn trừ công nợ theo ${adj.credit_note_no} (${adj.adjustment_type})`, req.user.id]
);

// Dòng 241-247
const updatedInvRes = await client.query(
  `UPDATE public.invoices
   SET paid_total = paid_total + $2::numeric,
       status = CASE WHEN paid_total + $2::numeric >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END
   WHERE id = $1 ...`
);
```

### 6.3. Bảng Phân tích Tác động Tài chính Cụ thể:

| Câu Hỏi Kiểm Toán | Kỳ Vọng Kế Toán (Accounting Expectation) | Thực Tế Triển Khai Trong Code | Đánh Giá Rủi Ro |
|:---|:---|:---|:---:|
| **Nghĩa vụ khách hàng giảm bao nhiêu?** | Giảm đúng bằng $X$ (tổng tiền Credit Note) | Giảm đúng $X$ (thông qua tăng `paid_total`) | **TẠM CHẤP NHẬN** |
| **Doanh thu có giảm hay không?** | **BẮT BUỘC GIẢM** $X$ (trước thuế) | **KHÔNG GIẢM**. `invoices.subtotal` giữ nguyên. Báo cáo doanh thu tính nguyên vẹn | **CRITICAL** |
| **Thuế GTGT đầu ra có giảm không?** | **BẮT BUỘC GIẢM** tương ứng phần thuế của Credit Note | **KHÔNG GIẢM**. Báo cáo thuế GTGT đọc từ `invoices.tax_amount` | **CRITICAL** |
| **Tiền thu (Cash Collected) có bị tăng?** | **TUYỆT ĐỐI KHÔNG TĂNG** (Credit Note là phi tiền mặt) | **BỊ TĂNG THÊM $X$**. `/dashboard/summary` và `/reports/collection-metrics` tính Credit Note là tiền thu! | **CRITICAL** |
| **`paid_total` có thay đổi không?** | Không được tăng `paid_total`. Phải giảm `total` hoặc ghi nhận vào cột `adjusted_total` | `paid_total` bị cộng thêm $X$. Hóa đơn được chuyển sang `PAID` | **SEMANTICALLY WRONG** |
| **Lịch sử thanh toán có bị giả mạo?** | Bảng thanh toán chỉ chứa dòng tiền thật | Xuất hiện bản ghi thanh toán giả với `method = 'CREDIT_NOTE'` | **SEMANTICALLY WRONG** |
| **Chỉ số DSO / CEI có bị sai?** | DSO phản ánh đúng vòng quay thu hồi tiền | CEI bị thổi phồng khống vì tử số (Tiền thu) bị cộng thêm tiền giảm giá | **HIGH** |
| **Hóa đơn đã thanh toán có thể hoàn tiền?** | Phải cho phép xuất Credit Note hoàn tiền cho hóa đơn đã `PAID` | **BỊ CHẶN LỖI 409**. Dòng 226: `if (adjAmount > outstanding) throw ...`. Hóa đơn đã PAID có `outstanding=0` nên không thể process Credit Note! | **HIGH** |
| **Credit Note có thể double-apply?** | Phải Idempotent | Đã chặn: Kiểm tra `status !== 'APPROVED'` (chỉ xử lý 1 lần, lần 2 trả về 409) | **PASS** |

**Kết luận chuyên môn về Credit Note:** **SEMANTICALLY WRONG & CRITICAL FINANCIAL REPORTING FLAW**.

---

## 7. Payment + Payment Allocation Model

### 7.1. Cấu trúc Mô hình Miền
Mô hình miền chuẩn Enterprise thiết kế:
$$\text{Bank Statement Transaction} \xrightarrow{1:1} \text{Payment (Thực thể Thanh toán)} \xrightarrow{1:N} \text{PaymentAllocation} \xrightarrow{N:1} \text{Invoice}$$

Trong đó:
- `Payment.amount` = Tổng số tiền thực nhận từ ngân hàng hoặc khách hàng.
- $\sum \text{PaymentAllocation.allocated\_amount} \le \text{Payment.amount}$.
- $\text{Unapplied Amount} = \text{Payment.amount} - \sum \text{allocated\_amount}$.

### 7.2. Điểm Gãy Kiến Trúc Trong `app/src/routes/payments.js`
Ràng buộc database từ Core V1:
```sql
CREATE TABLE public.payments (
    ...
    invoice_id bigint NOT NULL REFERENCES public.invoices(id) ON DELETE RESTRICT,
    amount numeric(14, 2) NOT NULL CHECK (amount > 0)
);
```
Vì cột `payments.invoice_id` mang ràng buộc **`NOT NULL`**, hệ thống không thể lưu trữ một khoản thanh toán cấp khách hàng độc lập với hóa đơn.

Khi gọi `POST /api/payments/allocate` với tổng tiền 5.000.000 ₫ phân bổ cho Invoice A (2.000.000 ₫) và Invoice B (3.000.000 ₫), mã nguồn xử lý như sau (dòng 173-221):
```javascript
for (const item of validatedAllocations) {
  // Chèn 1 dòng payment con riêng biệt cho từng hóa đơn
  const payRes = await client.query(
    `INSERT INTO public.payments (invoice_id, amount, method, ...) VALUES ($1, $2, ...)`,
    [item.invoiceId, item.amount, ...]
  );
  // Chèn 1 dòng allocation 1-1 thừa thãi
  await client.query(
    `INSERT INTO public.payment_allocations (payment_id, invoice_id, allocated_amount) VALUES ($1, $2, $3)`,
    [payRes.rows[0].id, item.invoiceId, item.amount]
  );
}
```

### 7.3. Đánh Giá Hậu Quả Kiến Trúc:
1. **Mất dấu giao dịch gốc:** Một giao dịch thanh toán duy nhất từ ngân hàng bị biến thành $N$ dòng thanh toán con rời rạc trong bảng `payments`. Khi kế toán viên đối chiếu sao kê tài khoản ngân hàng, họ không tìm thấy một bản ghi thanh toán nào có giá trị 5.000.000 ₫ trong bảng `payments`.
2. **Bảng `payment_allocations` mất đi giá trị phân bổ:** Bảng này chỉ lưu các cặp `(payment_id, invoice_id, allocated_amount)` trong đó `allocated_amount` luôn bằng `payment.amount`. Không hề có quan hệ 1-N thật sự.
3. **Không hỗ trợ tiền chưa phân bổ (Unallocated Payment):** Dòng 165 kiểm tra bắt buộc:
   `if (Math.abs(sumAllocated - Number(totalAmount)) > 0.01) throw ALLOCATION_SUM_MISMATCH`.
   Nếu khách hàng chuyển 6.000.000 ₫ nhưng chỉ muốn phân bổ 5.000.000 ₫ cho hóa đơn hiện tại, hệ thống từ chối giao dịch. Tiền thừa không thể được lưu trữ tại thực thể Payment.

---

## 8. Invoice Financial Invariants

### 8.1. Công thức và Ràng buộc Tính toán
- $line\_total = \text{round}(quantity \times unit\_price \times (1 - discount\_percent / 100), 2)$ (Đúng).
- $subtotal = \sum line\_total$ (Đúng).
- $tax\_amount = \text{round}(subtotal \times invoice.tax\_rate, 2)$ (Đúng trong phạm vi flat tax rate).
- $total = subtotal + tax\_amount$ (Đúng).
- $outstanding = total - paid\_total$ (Đúng).

### 8.2. Rủi ro Thuế suất dòng hàng (Item-level VAT vs Invoice VAT)
Trong `db/init/04-evolution.sql` dòng 37, hệ thống đã thêm cột:
`ALTER TABLE public.invoice_items ADD COLUMN IF NOT EXISTS vat_rate numeric(5, 4) DEFAULT 0.10;`
Tuy nhiên, trong `app/src/routes/invoices.js`:
- Hàm `insertItems` (dòng 42-45) **hoàn toàn bỏ qua trường `vat_rate` của từng item**.
- Hàm `recalculateTotals` (dòng 53) tính thuế GTGT bằng cách lấy toàn bộ `totals.subtotal * invoice.tax_rate`.
- **Rủi ro:** Không thể hỗ trợ hóa đơn có nhiều mức thuế suất (Mixed VAT Invoices - ví dụ dòng hàng chịu thuế 5% và dòng hàng chịu thuế 10% trên cùng một hóa đơn).

### 8.3. An toàn Giao dịch Đồng thời (Concurrency Safety)
- Thao tác thanh toán đơn lẻ (`POST /invoices/:id/payments`): Sử dụng `SELECT ... FOR UPDATE` bên trong `inTransaction` -> **An toàn trước Double Payment**.
- Thao tác hủy hóa đơn (`POST /invoices/:id/cancel`): Kiểm tra `paid_total = 0` và có khóa dòng `FOR UPDATE` -> **An toàn trước xung đột Hủy vs Thanh toán**.
- Thao tác lập lịch (`scheduler.js`): Dùng `pg_try_advisory_lock` và transaction `FOR UPDATE` -> **An toàn trước Duplicate Invoice Generation**.

---

## 9. Aging / DSO / Revenue / VAT Semantics

Kiểm toán trực tiếp các câu lệnh SQL trong `app/src/routes/reports.js`:

### 9.1. Báo cáo Tuổi nợ (Aging Matrix) — PASS tại SQL
- Phân loại 5 dải tuổi nợ: Hiện tại, 1-30 ngày, 31-60 ngày, 61-90 ngày, và trên 90 ngày bằng `current_date - due_date`.
- Tính toán trực tiếp trên $total - paid\_total$ của các hóa đơn `ISSUED` và `PARTIALLY_PAID`.
- Câu lệnh SQL phản ánh chính xác công nợ thực tế.

### 9.2. Báo cáo Thu hồi nợ (DSO & CEI) — FLAWED do Credit Note
- Dòng 81: `SELECT sum(amount) FROM public.payments WHERE paid_at >= current_date - interval '90 days'`
- Dòng 86: Gom nhóm thanh toán theo tháng từ `public.payments`.
- **Sai lệch:** Vì bảng `payments` chứa các dòng `method = 'CREDIT_NOTE'`, tiền giảm trừ công nợ bị cộng vào tổng tiền thu được ($collected\_90d$).
- Chỉ số CEI (Collection Effectiveness Index) bị tính sai:
  $$CEI = \frac{\text{Cash} + \text{Credit Notes}}{\text{Receivables} + \text{Sales}} \times 100\% \quad (\text{Thổi phồng hiệu quả thu hồi nợ})$$

### 9.3. Báo cáo Doanh thu (Revenue Analytics) — FLAWED
- Dòng 124-126:
  ```sql
  SELECT to_char(date_trunc('month', issue_date), 'TMM/YY') AS month,
         coalesce(sum(subtotal), 0)::numeric(14, 2)::text AS revenue
  FROM public.invoices
  WHERE issue_date IS NOT NULL AND status <> 'CANCELLED'
  ```
- **Sai lệch:** Doanh thu được lấy thuần túy từ $subtotal$ của các hóa đơn chưa hủy. Khi một hóa đơn có Credit Note giảm trừ 50% giá trị, $subtotal$ trên hóa đơn không đổi và câu lệnh SQL này **không trừ đi giá trị của `invoice_adjustments`**. Doanh thu công bố cho ban điều hành bị khống.

### 9.4. Báo cáo Thuế GTGT (VAT Declaration) — FLAWED
- Dòng 216-233: Lấy toàn bộ tổng $subtotal$ và $tax\_amount$ từ bảng `invoices`.
- **Sai lệch:** Hoàn toàn không liên kết hay giảm trừ thuế GTGT từ bảng `invoice_adjustments`. Theo quy định thuế tại Việt Nam, doanh nghiệp phải kê khai giảm thuế GTGT đầu ra khi phát hành hóa đơn điều chỉnh giảm. Báo cáo hiện tại làm doanh nghiệp nộp thừa thuế.

---

## 10. RBAC Deep Audit

Kiểm toán hệ thống phân quyền hạt nhân:

### 10.1. Cơ chế Middleware
Trong `app/src/routes/auth.js`:
- Hàm `requirePermission(permissionCode)`:
  ```javascript
  if (req.user.role === 'admin') return next(); // Admin bypass mọi quyền
  const userPerms = req.user.permissions || [];
  if (userPerms.includes('*') || userPerms.includes(permissionCode)) return next();
  return next(new AppError(403, 'FORBIDDEN', ...));
  ```
- **Đánh giá:**
  - Logic kiểm tra `requirePermission` có hoạt động và trả về HTTP 403 khi `staff` thiếu quyền.
  - Tuy nhiên, việc `admin` bypass tự động mà không cần kiểm tra quyền cụ thể làm suy giảm tính chất kiểm soát chéo (Separation of Duties).

### 10.2. Các Endpoint Bỏ Ngỏ Kiểm Tra Quyền (RBAC Gaps)
1. **Các tuyến đường vẫn dùng Hardcoded `requireRole('admin')`:**
   - `DELETE /api/customers/:id` (dòng 217 trong `customers.js`) -> Không dùng quyền `customer.delete`.
   - `DELETE /api/products/:id` (dòng 144 trong `products.js`) -> Không dùng quyền `product.manage`.
   - `PUT /api/settings` (dòng 36 trong `settings.js`) -> Không dùng quyền `settings.manage`.
   - `POST/PUT/DELETE /api/payment-terms/*` -> Không dùng quyền phân hệ quản lý.
   - **Hậu quả:** Ngay cả khi một tài khoản được gán vai trò `ROLE_BILLING_MANAGER` với đầy đủ quyền trong bảng `role_permissions`, tài khoản đó vẫn bị chặn với mã 403 khi thao tác các endpoint này vì code kiểm tra cứng `role !== 'admin'`.
2. **Các tuyến đường Đột biến (Mutation) Hoàn Toàn Bỏ Quên `requirePermission`:**
   - `POST /api/reconciliation/auto-match`
   - `POST /api/reconciliation/manual-match`
   - Cả 2 endpoint này trong `reconciliation.js` chỉ có `router.use(requireAuth)`. Bất kỳ tài khoản `staff` bình thường nào cũng có thể kích hoạt đối soát ngân hàng và khớp nối công nợ mà không cần quyền `reconciliation.manage`.
   - `GET /api/audit` và `GET /api/audit/verify`: Không có `requirePermission('audit.view')`. Bất kỳ người dùng nào đăng nhập cũng có thể đọc toàn bộ lịch sử kiểm toán của hệ thống.
3. **Thiếu API Quản lý Người dùng & Gán Vai trò:**
   - Router `rbac.js` chỉ có 2 endpoint đọc danh mục: `GET /roles` và `GET /permissions`.
   - Không có API tạo người dùng mới, đổi vai trò của người dùng, hay gán quyền. Bảng `users` chỉ có đúng 2 tài khoản tĩnh (`admin`, `staff`) được tạo từ script seed ban đầu. Các vai trò Enterprise (`ROLE_ACCOUNTANT`, `ROLE_BILLING_MANAGER`, `ROLE_AUDITOR`) hoàn toàn "nằm bất động" trong database mà không thể gán cho ai qua giao diện hoặc API.

---

## 11. Audit Hash Chain

### 11.1. Công thức và Thuật toán Tính Băm
Trong `app/src/audit.js`:
$$hash_i = \text{SHA256}(prev\_hash_i \mid ts_i \mid actorId_i \mid actorName_i \mid module_i \mid action_i \mid targetRef_i \mid severity_i \mid summary_i \mid canonicalData_i)$$

- Genesis Record ($i = 1$): $prev\_hash_1 = \text{"0"}^{64}$.
- Thuật toán băm: Chuẩn mật mã SHA-256 (`crypto.createHash('sha256')`).
- Dữ liệu chuẩn hóa ($canonicalData$): JSON chuỗi của `metadata`.

### 11.2. Phân tích Khả năng Phát hiện Can thiệp
1. **Sửa đổi bản ghi quá khứ (Modification):**
   - Nếu kẻ tấn công can thiệp sửa đổi trường bất kỳ trong bản ghi $k$: Mã hash tính lại của bản ghi $k$ sẽ lệch với $hash_k$ lưu trong database -> **Phát hiện ngay lập tức (`HASH_TAMPERED`)**.
   - Nếu kẻ tấn công tính lại cả $hash_k$ mới: Bản ghi tiếp theo $k+1$ có $prev\_hash_{k+1}$ trỏ tới mã hash cũ -> **Phát hiện ngay lập tức (`PREV_HASH_CHAIN_BROKEN`)**.
2. **Xóa bản ghi ở giữa (Deletion):**
   - Nếu xóa bản ghi $k$: Bản ghi $k+1$ có $prev\_hash_{k+1} = hash_k$, nhưng bản ghi đứng trước nó là $k-1$ có mã hash khác -> **Phát hiện ngay lập tức (`PREV_HASH_CHAIN_BROKEN`)**.
3. **Chèn bản ghi vào giữa (Insertion):**
   - Không thể chèn mà không làm đứt chuỗi băm của bản ghi đứng sau -> **Phát hiện ngay lập tức**.

### 11.3. Lỗ hổng Trọng yếu (Concurrency Race Condition & Privilege Misconfiguration)
1. **Race Condition Gây Đứt gãy Chuỗi Băm:**
   - Trong `recordAudit`:
     ```javascript
     const lastRes = await dbOrClient.query('SELECT hash FROM public.audit_logs ORDER BY id DESC LIMIT 1');
     const prevHash = lastRes.rows[0]?.hash || '0'.repeat(64);
     ...
     await dbOrClient.query('INSERT INTO public.audit_logs ...');
     ```
   - Không có khóa độc quyền trên bảng `audit_logs`. Khi 2 request ghi log đồng thời (ví dụ: phát hành 2 hóa đơn cùng lúc): Cả hai đều đọc cùng 1 `prevHash`. Cả hai đều chèn vào database với cùng 1 `prev_hash`.
   - Kết quả: Khi chạy `GET /api/audit/verify`, bản ghi thứ hai sẽ bị coi là can thiệp trái phép (`PREV_HASH_CHAIN_BROKEN`). Hệ thống tự sinh cảnh báo lỗi giả dưới tải cao.
2. **Cấp quyền Trái nguyên tắc trong `05-remediation.sql`:**
   - Dòng 89: `GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO billing_app;`
   - **Vi phạm nguyên tắc Least Privilege & Immutability:** Một bảng nhật ký kiểm toán bất biến (*Append-only Audit Log*) **tuyệt đối không được cấp quyền `UPDATE` và `DELETE`** cho tài khoản ứng dụng (`billing_app`). Ứng dụng chỉ được phép có quyền `SELECT, INSERT`.

---

## 12. Recurring Billing Scheduler

### 12.1. Kiểm tra An toàn Khởi động và Đa Container (Multi-Container Scaling)
- **Cơ chế Khóa Phân tán:**
  Sử dụng PostgreSQL Session-level Advisory Lock:
  ```sql
  SELECT pg_try_advisory_lock(88812345) AS acquired;
  ```
- **Kịch bản 3 container Web chạy đồng thời:**
  - Container A gọi `pg_try_advisory_lock` thành công (`acquired = true`) và thực thi chu kỳ.
  - Container B và Container C gọi `pg_try_advisory_lock` thất bại (`acquired = false`) -> Ngay lập tức thoát an toàn với log `scheduler.skipped_locked`.
  - Khóa advisory lock tự động giải phóng qua `SELECT pg_advisory_unlock(88812345)` trong khối `finally` và giải phóng client về pool.
  - **Kết luận:** **Tuyệt đối an toàn khi scale nhiều container, không bao giờ sinh trùng chu kỳ.**

### 12.2. Khả năng Phục hồi khi Crash (Crash Recovery & Idempotency)
- **Kịch bản tiến trình bị crash / tắt đột ngột:**
  - Toàn bộ thao tác sinh hóa đơn, tạo dòng hàng, tính tổng tiền và cập nhật trạng thái gói (`completed_cycles++`, `next_run_date = nextSafeDate`) được gói trọn vẹn trong một PostgreSQL transaction duy nhất: `await inTransaction(async (txClient) => { ... })`.
  - Nếu process crash trước khi transaction commit: PostgreSQL tự động ROLLBACK 100%. Không có hóa đơn rác bị lưu lại. Lần scheduler tiếp theo quét lại và chạy lại bình thường.
  - Nếu transaction đã commit: Cả hóa đơn và ngày chạy kế tiếp đều đã được lưu đồng thời. Lần scheduler tiếp theo sẽ bỏ qua vì `next_run_date > current_date`.

### 12.3. Bất cập Kỹ thuật trong Scheduler
- **Hardcode Thuế suất:**
  Dòng 88 và 106 trong `app/src/scheduler.js`:
  ```javascript
  tax_rate: 0.10, tax_amount = round(totals.subtotal * 0.10, 2)
  ```
  Thuế suất bị ép cứng là 10%. Các dịch vụ định kỳ không chịu thuế hoặc chịu thuế 5%/8% đều bị tính sai thành 10%.

---

## 13. API Contracts

### 13.1. Rà soát Độ lệch Hợp đồng Frontend ↔ Backend
Để che giấu các lỗi 404 và mismatch trường phát hiện ở đợt audit trước, mã nguồn hiện tại triển khai rất nhiều cơ chế tương thích kép (*Dual-mounting & Aliasing*):

| Module | Tên Tuyến Đường (Routes) | Trường Dữ Liệu (Field Aliasing) | Đánh Giá Kỹ Thuật |
|:---|:---|:---|:---:|
| **Adjustments** | `/adjustments` VÀ `/credit-notes` | `credit_note_no` / `adjustment_no`, `original_invoice_id` / `invoice_id`, `adjustment_type` / `type` | **TECHNICAL DEBT** |
| **Recurring** | `/recurring` VÀ `/recurring-plans` | Khớp nhau | **TECHNICAL DEBT** |
| **Reconciliation**| `/reconciliation/transactions` VÀ `/bank-transactions` | Trả về cả `{ items, transactions }` | **TECHNICAL DEBT** |
| **Reports** | `/reports/revenue` VÀ `/reports/revenue-analytics` | Khớp nhau | **TECHNICAL DEBT** |
| **Payment Terms**| `/payment-terms` | Chấp nhận cả `days` và `net_days` | **TECHNICAL DEBT** |
| **Invoices** | `/invoices` | Chấp nhận cả `e_invoice_code` và `einvoice_code` | **TECHNICAL DEBT** |
| **Aging Report** | `/reports/aging` | Trả về cả `{ summary, customers, matrix }` | **TECHNICAL DEBT** |

### 13.2. Đánh giá Mức độ Rủi ro: **TECHNICAL DEBT (Nợ Kỹ Thuật Lớn)**
- **Hiện tại (Runtime):** Tạm thời an toàn, không gây crash giao diện hay lỗi 404.
- **Rủi ro Dài hạn:**
  - Không có tài liệu OpenAPI / Swagger chuẩn hóa phiên bản.
  - Khi bảo trì hoặc tích hợp ứng dụng bên thứ ba (Third-party ERP/CRM), sự tồn tại song song của các trường alias gây khó khăn cho việc kiểm soát schema contract.
  - Cần có lộ trình khấu hao (*Deprecation Roadmap*) để chuẩn hóa về một định dạng duy nhất.

---

## 14. Frontend E2E Test Authenticity

Phân tích mã nguồn tệp `scripts/frontend-e2e-test.mjs`:
```javascript
// Dòng 17-34: Dùng fetch gọi HTTP lấy text HTML, CSS, JS
const htmlRes = await fetch(`${baseUrl}/`);
...
// Dòng 38-44: Dùng Regular Expression quét chuỗi text JS để tìm endpoint
const endpointRegex = /api\(\s*[`'"](\/[a-zA-Z0-9_\-\/?&=]+)[`'"]/g;
...
// Dòng 80-89: Dùng fetch gọi tuần tự 16 API GET với cookie đăng nhập
for (const viewEndpoint of frontendViews) {
  const res = await fetch(`${baseUrl}${viewEndpoint}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
}
```

### Kết luận Kiểm toán về Tính Xác thực của Test:
- **Phân loại thật sự:** **HYBRID HTTP/API INTEGRATION + STATIC ASSET SMOKE TEST** (Không phải Browser E2E).
- **Những gì test THỰC SỰ kiểm tra:**
  1. Nginx và backend phục vụ tệp tĩnh `index.html`, `styles.css`, `app.js` trả về HTTP 200.
  2. Giao thức HTTP POST `/api/auth/login` thiết lập session cookie hợp lệ.
  3. 16 route API GET của backend trả về HTTP 200 khi có session cookie.
- **Những gì test HOÀN TOÀN KHÔNG KIỂM TRA:**
  - Không khởi chạy headless browser (Chrome, Chromium, Firefox).
  - Không thực thi mã JavaScript client-side trong môi trường DOM.
  - Không kiểm tra cây DOM, render giao diện người dùng, bảng biểu, modal.
  - Không mô phỏng hành động người dùng: gõ bàn phím, bấm nút, submit form, lọc bảng.
  - Không bắt được các lỗi JavaScript runtime trên trình duyệt (ví dụ: `TypeError: Cannot read properties of undefined`).
- **Tuyên bố trong Final Report:** Tuyên bố *"Frontend E2E Test 16/16 views PASS"* gây hiểu lầm rằng toàn bộ giao diện đã được kiểm thử tự động toàn diện qua trình duyệt.

---

## 15. E-Invoice Compliance Assessment

### 15.1. Cơ chế Tạo Mã Hóa đơn Hiện tại
Tại `app/src/routes/invoices.js` dòng 273-274 và `scheduler.js` dòng 126:
```javascript
const seqVal = invoiceNo.split('-')[2] || '000001';
const eInvoiceCode = invoice.e_invoice_code || `1C25TND-${seqVal}`;
```

### 15.2. Đối chiếu Pháp lý (Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC)
Theo quy định pháp luật Việt Nam về hóa đơn điện tử:
1. Hóa đơn điện tử có mã của cơ quan thuế bắt buộc phải:
   - Được lập theo định dạng chuẩn XML quy định tại Quyết định 1450/QĐ-TCT.
   - Ký số bằng Chứng thư số (Chữ ký số doanh nghiệp / HSM Token).
   - Truyền nhận qua tổ chức cung cấp dịch vụ nhận, truyền, lưu trữ dữ liệu hóa đơn điện tử (T-VAN) tới Cổng thông tin điện tử của Tổng cục Thuế.
   - Cơ quan thuế cấp một chuỗi ký tự mã xác thực duy nhất gồm 34 ký tự hexa ("Mã của cơ quan thuế").
2. **Hiện trạng của Billing_One:**
   - Hoàn toàn **KHÔNG CÓ** adapter kết nối nhà cung cấp T-VAN (Viettel, VNPT, MISA, BKAV).
   - Hoàn toàn **KHÔNG CÓ** module ký số XML (XML-DSig).
   - Chuỗi `1C25TND-XXXXXX` chỉ là ký hiệu mẫu được ghép chuỗi trong bộ nhớ Node.js.

### 15.3. Đánh giá Mức độ Sẵn sàng:
# **SIMULATION ONLY**
Hệ thống chỉ ở mức độ mô phỏng hiển thị định danh phục vụ nghiệp vụ nội bộ; hoàn toàn không có giá trị pháp lý về hóa đơn điện tử.

---

## 16. Security Audit

| Lĩnh Vực An Ninh | Kiểm Tra Thực Tế | Hiện Trạng Code & Config | Đánh Giá |
|:---|:---|:---|:---:|
| **Authentication & Password** | Thuật toán băm mật khẩu | Sử dụng `bcryptjs` với salt rounds chuẩn | **PASS** |
| **Session Security** | Quản lý phiên làm việc | `connect-pg-simple`, lưu trữ trong PostgreSQL, cookie `HttpOnly`, `SameSite=Strict`, `Path=/`, thời hạn 8 giờ | **PASS** |
| **Cookie Secure Flag** | Bảo vệ truyền dẫn cookie | Tham số `SESSION_COOKIE_SECURE=true` trên môi trường HTTPS | **PASS** |
| **SQL Injection** | Truy vấn cơ sở dữ liệu | 100% câu truy vấn đều tham số hóa qua `$1, $2` của pg driver; không dùng chuỗi nối trực tiếp | **PASS** |
| **Security Headers** | Cứng hóa HTTP Headers qua Nginx | Đầy đủ HSTS (`max-age=86400`), CSP, X-Frame-Options (`DENY`), X-Content-Type-Options (`nosniff`), Referrer-Policy, Permissions-Policy | **PASS** |
| **Rate Limiting** | Chống Brute-force Login | Nginx limit_req zone `rate=5r/m burst=5 nodelay` trên `/api/auth/login` | **PASS** |
| **Network & Isolation** | Phân tầng mạng Docker | 5 mạng riêng biệt (`edge_net`, `app_net`, `admin_net`, `db_net`, `monitoring_net`). Cổng PostgreSQL 5432 và Web 3000 không bị publish ra Internet | **PASS** |
| **Container Runtime** | Quyền chạy container | Non-root cho tất cả service chính (Node UID 1000, Postgres UID 999, Nginx UID 101, Grafana UID 472, Prometheus UID 65534) | **PASS** |
| **Audit Log Privilege** | Quyền tài khoản DB trên audit log | `05-remediation.sql` cấp quyền `UPDATE, DELETE` trên `audit_logs` cho `billing_app` (Vi phạm quyền tối thiểu) | **FAIL** |
| **CSRF Defense** | Chống giả mạo request cross-site | Dựa hoàn toàn vào cookie `SameSite=Strict`; không có CSRF Token trên mutation routes | **WARN** |
| **Double Reconciliation** | Khớp nối ngân hàng lặp lại | `manual-match` không kiểm tra trạng thái giao dịch ngân hàng trước khi xử lý | **FAIL** |

---

## 17. Migration Safety

### 17.1. Phân tích Tệp Migration
- `db/init/04-evolution.sql`:
  - Mở rộng bảng cũ: Dùng `ADD COLUMN IF NOT EXISTS`, khối `DO $$ ... IF NOT EXISTS ...` kiểm tra constraint.
  - Tạo bảng mới: Dùng `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`.
  - Mức độ an toàn: **Idempotent, Non-destructive**.
- `db/init/05-remediation.sql`:
  - Dùng `DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT ...` để nới lỏng check constraints (`customers_segment_check`, `payments_method_check`, `bank_transactions_status_check`).
  - Mức độ an toàn: Chạy lại an toàn (*Rerun safe*). Không có lệnh `DROP TABLE`, `TRUNCATE` hay `DROP DATABASE`.

### 17.2. Rủi ro Triển khai Môi trường Sản xuất (Production Deployment Risk)
- **Thiếu Migration Runner / Versioning Tool:**
  - Dự án không sử dụng công cụ quản lý migration (như Flyway, Liquibase, Db-migrate, Knex, v.v.).
  - Các file SQL trong `db/init/` chỉ được Docker tự động thực thi **khi khởi tạo database lần đầu tiên** (thư mục volume trống).
  - Khi nâng cấp hệ thống có sẵn dữ liệu, người vận hành phải chạy lệnh thủ công vào container qua `psql`. Nếu một câu lệnh bị lỗi giữa chừng, không có cơ chế rollback tự động.
- **Rủi ro Dữ liệu Không Tương Thích:**
  - Nếu dữ liệu cũ trong `payments` có phương thức không nằm trong danh sách mới, lệnh `ADD CONSTRAINT payments_method_check` sẽ làm crash quá trình upgrade.

---

## 18. Findings Matrix

Bảng tổng hợp chi tiết toàn bộ các phát hiện kiểm toán được phân loại theo mức độ nghiêm trọng:

| ID | Mức Độ | Thành Phần | Hiện Trạng / Bằng Chứng | Nguyên Nhân Gốc Rễ | Tác Động Nghiệp Vụ & Kỹ Thuật | Đề Xuất Khắc Phục (Fix) | Phương Pháp Kiểm Chứng |
|:---|:---:|:---|:---|:---|:---|:---|:---|
| **FIND-01** | **CRITICAL** | `app/src/routes/adjustments.js`, `reports.js`, `dashboard.js` | Credit Note chèn dòng vào `payments` với `method = 'CREDIT_NOTE'`; các báo cáo sum toàn bộ `payments.amount` | Coi Credit Note là một khoản thanh toán thay vì giảm trừ doanh thu/công nợ | Tiền chiết khấu bị tính nhầm thành Tiền thu thực tế; báo cáo tài chính sai lệch nghiêm trọng | Tách biệt Credit Note khỏi bảng `payments`. Trừ nợ qua cột `adjusted_total` trên invoice; loại trừ `CREDIT_NOTE` khỏi truy vấn tiền thu | Truy vấn đối soát giữa tiền ngân hàng và tổng payments |
| **FIND-02** | **CRITICAL** | `app/src/routes/reports.js` | Báo cáo Doanh thu & Thuế GTGT không khấu trừ giá trị từ `invoice_adjustments` | Câu lệnh SQL trong `reports.js` chỉ đọc thuần túy từ bảng `invoices` | Khai khống doanh thu và khai thừa nghĩa vụ thuế GTGT đầu ra | Bổ sung mệnh đề `LEFT JOIN invoice_adjustments` và trừ giá trị đã điều chỉnh hợp lệ | Kiểm tra báo cáo doanh thu trước và sau khi áp dụng Credit Note |
| **FIND-03** | **CRITICAL** | `db/init/` & PostgreSQL Database | 10 hóa đơn lịch sử (ID 384, 385, 386, 387, 401, 402, 410, 411, 422, 423) có `paid_total` lệch với `sum(payments)` | Lỗi phân bổ cũ trước F-09 để lại dữ liệu rác chưa từng được chạy migration sửa chữa | Sổ sách công nợ không cân; hóa đơn đã trả tiền nhưng không có lịch sử thanh toán | Viết script migration rà soát và chuẩn hóa lại các cặp hóa đơn bị phân bổ sai | Chạy câu lệnh SQL kiểm toán đối soát `paid_total <> sum(payments)` trả về 0 dòng |
| **FIND-04** | **CRITICAL** | `app/src/routes/reconciliation.js` | `manual-match` không kiểm tra `tx.status` trước khi khớp lệnh | Thiếu điều kiện guard `tx.status === 'UNMATCHED'` trong transaction | Giao dịch ngân hàng bị tái sử dụng vô số lần để xóa nợ hóa đơn giả tạo | Bổ sung kiểm tra `if (tx.status !== 'UNMATCHED') throw new AppError(409, 'TRANSACTION_ALREADY_MATCHED')` | Gọi `manual-match` lần 2 trên cùng 1 giao dịch nhận HTTP 409 |
| **FIND-05** | **HIGH** | `app/src/audit.js` | `recordAudit` đọc `prev_hash` không có khóa đồng thời | Thiếu khóa hàng/khóa bảng hoặc sequence locking trên `audit_logs` | Chuỗi băm bị đứt gãy (*forked*) khi có 2 request ghi log đồng thời | Sử dụng transaction với khóa phân tán hoặc hàng đợi ghi tuần tự (*serialized queue*) | Mô phỏng 10 request ghi đồng thời và chạy `/api/audit/verify` |
| **FIND-06** | **HIGH** | `db/init/05-remediation.sql` | Cấp quyền `UPDATE, DELETE` trên `audit_logs` cho tài khoản `billing_app` | Cấu hình grant lỏng lẻo trong script remediation 05 | Mất tính chất bất biến (*Append-only*); tài khoản app có thể xóa lịch sử kiểm toán | `REVOKE UPDATE, DELETE ON public.audit_logs FROM billing_app;` | Thử chạy lệnh `UPDATE audit_logs` với quyền `billing_app` nhận permission denied |
| **FIND-07** | **HIGH** | `app/src/routes/payments.js` | Thanh toán đa hóa đơn bị xé lẻ thành $N$ dòng payments con | Ràng buộc `payments.invoice_id NOT NULL` từ Core V1 | Mất quan hệ 1-N thực sự; bảng `payment_allocations` mất ý nghĩa; không có unapplied cash cấp payment | Cho phép `payments.invoice_id` nhận `NULL` đối với khoản thanh toán gộp khách hàng | Tạo 1 payment 5M phân bổ cho 2 invoice và kiểm tra DB có đúng 1 payment |
| **FIND-08** | **HIGH** | `app/src/routes/adjustments.js` | Credit Note không thể xử lý cho hóa đơn đã `PAID` (`adjAmount > outstanding`) | Ràng buộc cứng `adjAmount <= outstanding` trong code | Doanh nghiệp không thể thực hiện hoàn tiền cho khách hàng đã trả đủ tiền | Cho phép Credit Note trên hóa đơn `PAID` và ghi nhận khoản phải trả lại khách hàng (*Refund Payable*) | Tạo Credit Note cho hóa đơn đã PAID và kiểm tra xử lý thành công |
| **FIND-09** | **MEDIUM** | `app/src/routes/` (`products`, `customers`, `settings`, `reconciliation`) | Nhiều route vẫn dùng `requireRole('admin')`, hoặc bỏ quên `requirePermission` | Chuyển đổi RBAC dở dang trong đợt remediation F-08 | Không thể áp dụng các vai trò nghiệp vụ Enterprise; một số route bị hở quyền | Chuẩn hóa toàn bộ router dùng `requirePermission` thống nhất | Đăng nhập tài khoản `staff` kiểm tra các quyền tương ứng |
| **FIND-10** | **MEDIUM** | `app/src/scheduler.js` | Thuế suất trong hóa đơn định kỳ bị ép cứng 10% (`tax_rate: 0.10`) | Hardcode trong code sinh hóa đơn của scheduler | Hóa đơn không chịu thuế hoặc thuế 5%/8% bị tính sai tiền thuế | Đọc `tax_rate` từ gói dịch vụ hoặc sản phẩm cấu hình trong hợp đồng | Sinh hóa đơn định kỳ cho dịch vụ 0% thuế và kiểm tra thuế = 0 |
| **FIND-11** | **MEDIUM** | `app/src/routes/index.js`, `adjustments.js`, `payments.js` | Tồn tại song song nhiều alias router và alias fields (`credit-notes`, `recurring-plans`, `einvoice_code`) | Vá víu hợp đồng API để tránh lỗi 404 phía frontend | Nợ kỹ thuật lớn, khó bảo trì và tích hợp bên ngoài | Lập tài liệu OpenAPI chuẩn hóa và kế hoạch khấu hao các trường thừa | Kiểm tra tính nhất quán của API contract |
| **FIND-12** | **LOW** | `scripts/frontend-e2e-test.mjs` | Tệp kiểm thử được đặt tên là E2E nhưng thực chất chỉ là HTTP Integration Test | Dùng Node.js `fetch` thay vì công cụ điều khiển trình duyệt | Đánh giá sai độ tin cậy của giao diện người dùng | Đổi tên tệp thành `frontend-api-smoke.mjs` và bổ sung bộ test Playwright/Puppeteer thật | Chạy kiểm thử tự động trên trình duyệt thật |
| **FIND-13** | **INFO** | `app/src/routes/invoices.js`, `scheduler.js` | Mã hóa đơn điện tử `1C25TND-XXXXXX` là chuỗi mô phỏng nội bộ | Chưa xây dựng module tích hợp T-VAN / Cơ quan Thuế | Nhầm lẫn về tính pháp lý của hóa đơn xuất ra | Ghi rõ trong tài liệu kỹ thuật là mã định danh mô phỏng nội bộ | Kiểm tra tài liệu và giao diện hiển thị nhãn minh bạch |

---

## 19. Critical Decision Questions

Dưới đây là câu trả lời độc lập, thẳng thắn cho 10 câu hỏi kiểm toán quyết định:

### 1. Billing_One có đang giữ đúng financial source of truth không?
**KHÔNG.** Mặc dù cơ sở dữ liệu PostgreSQL sử dụng định dạng số học `NUMERIC(14,2)` chính xác, nhưng logic nghiệp vụ tầng ứng dụng làm sai lệch sổ cái:
- Coi Credit Note là tiền thu thực tế.
- Báo cáo Doanh thu và Thuế không trừ giảm giá/trả hàng.
- Tồn tại 10 hóa đơn lịch sử có số dư thanh toán không khớp với bảng `payments`.

### 2. Credit Note có làm sai cash/payment/DSO không?
**CÓ, LÀM SAI NGHIÊM TRỌNG.**
- Việc chèn bản ghi vào `public.payments` với `method = 'CREDIT_NOTE'` làm tăng ảo tổng tiền thu được trong các báo cáo dòng tiền (`/dashboard/summary` và `/reports/collection-metrics`).
- Chỉ số thu hồi nợ CEI bị thổi phồng khống.
- Doanh thu và Thuế GTGT bị báo cáo sai lệch.

### 3. Payment Allocation có đúng domain model không?
**KHÔNG.** Mô hình miền bị đứt gãy do ràng buộc `payments.invoice_id NOT NULL`. Hệ thống xé lẻ một khoản thanh toán ngân hàng thành nhiều dòng con, làm bảng `payment_allocations` trở thành bản sao 1-1 vô nghĩa và không thể hiện được tiền chưa phân bổ cấp giao dịch.

### 4. Invoice balance có invariant rõ ràng và transaction-safe không?
**VỀ MẶT CODE ĐỒNG THỜI: CÓ (Transaction-safe qua `FOR UPDATE`).**  
**VỀ MẶT TỔNG THỂ KẾ TOÁN: KHÔNG RÕ RÀNG.**  
Biến số `paid_total` bị dùng chung cho cả tiền thật và tiền giảm trừ Credit Note, làm mất ranh giới giữa "Khách hàng đã trả tiền" và "Doanh nghiệp giảm trừ công nợ".

### 5. RBAC có thực sự granular runtime không?
**CHƯA ĐẦY ĐỦ.** Cơ chế `requirePermission` đã được đưa vào một số route chính, nhưng:
- Admin tự động bypass mọi kiểm soát.
- Nhiều route quan trọng vẫn dùng `requireRole('admin')`.
- Các route đối soát ngân hàng và xem audit hoàn toàn bỏ ngỏ không kiểm tra quyền.
- Hệ thống không có API gán vai trò người dùng trong môi trường vận hành.

### 6. Audit hash chain có thực sự tamper-evident không?
**VỀ MẶT THUẬT TOÁN: CÓ.** Sửa đổi, xóa, hoặc chèn bản ghi đều bị thuật toán SHA-256 phát hiện.  
**VỀ MẶT RUNTIME: CÓ LỖ HỔNG.** Thiếu khóa đồng thời khi ghi log làm chuỗi băm dễ bị đứt gãy (*fork*), và tài khoản ứng dụng `billing_app` bị cấp quyền `UPDATE/DELETE` trên bảng `audit_logs`.

### 7. Recurring Scheduler có an toàn khi scale nhiều container không?
**CÓ.** Hệ thống sử dụng PostgreSQL Session Advisory Lock (`pg_try_advisory_lock(88812345)`) kết hợp với transaction khóa dòng `FOR UPDATE`. Scale nhiều container hoàn toàn không gây trùng lặp hóa đơn. Bất cập duy nhất là thuế suất bị ép cứng 10%.

### 8. Frontend E2E test có phải browser E2E thực sự không?
**KHÔNG.** Tệp `scripts/frontend-e2e-test.mjs` thuần túy là một bộ kiểm thử tích hợp HTTP API và smoke test tệp tĩnh sử dụng `fetch`. Hoàn toàn không khởi chạy trình duyệt, không kiểm tra DOM và không bắt được lỗi JavaScript runtime phía client.

### 9. E-Invoice hiện tại có phải legal CQT integration hay chỉ simulation?
**HOÀN TOÀN LÀ SIMULATION.** Hệ thống chỉ ghép chuỗi định dạng mẫu `1C25TND-XXXXXX` trong bộ nhớ, không có chữ ký số, không kết nối nhà cung cấp T-VAN và không kết nối Cục Thuế.

### 10. Database migration có an toàn cho existing production DB không?
**CHƯA ĐẠT CHUẨN SẢN XUẤT.** Dự án thiếu công cụ quản lý phiên bản migration tự động (như Flyway/Liquibase). Các tệp SQL chỉ tự chạy khi khởi tạo database mới tinh. Nâng cấp database có sẵn dữ liệu đòi hỏi can thiệp thủ công và tiềm ẩn rủi ro xung đột check constraint.

---

## 20. Recommended Remediation Priority

Dưới đây là lộ trình khắc phục đề xuất theo mức độ ưu tiên kỹ thuật:

### Ưu tiên 1 (P0 — Ngăn chặn Sai lệch Tài chính & Lỗ hổng Trọng yếu):
1. **Tách biệt hoàn toàn Credit Note khỏi bảng `payments`:**
   - Xóa bỏ việc `INSERT INTO payments (method = 'CREDIT_NOTE')`.
   - Thêm cột `adjusted_total numeric(14,2) DEFAULT 0` vào bảng `invoices`.
   - Công thức công nợ chuẩn: $outstanding = total - paid\_total - adjusted\_total$.
   - Sửa lại các câu lệnh SQL trong `dashboard.js`, `reports.js`: Loại bỏ `CREDIT_NOTE` khỏi tiền thu; khấu trừ giá trị `invoice_adjustments` khỏi Báo cáo Doanh thu và Báo cáo Thuế GTGT.
2. **Khắc phục Lỗ hổng Double Reconciliation:**
   - Thêm kiểm tra điều kiện cứng trong `reconciliation.js`: Chỉ cho phép giao dịch có `status === 'UNMATCHED'` được tham gia đối soát.
3. **Sửa lỗi Dữ liệu Lịch sử (Historical Data Migration):**
   - Viết tệp migration rà soát và tạo các bản ghi thanh toán bù trừ chuẩn xác cho 10 hóa đơn bị lệch số dư (ID 384, 385, 386, 387, 401, 402, 410, 411, 422, 423).

### Ưu tiên 2 (P1 — An ninh & Toàn vẹn Dữ liệu):
4. **Cứng hóa Chuỗi Băm Kiểm toán (`audit_logs`):**
   - Sử dụng cơ chế khóa tuần tự hóa (`pg_advisory_xact_lock`) trong `recordAudit` để loại bỏ triệt để hiện tượng phân nhánh chuỗi băm dưới tải cao.
   - Chạy lệnh thu hồi quyền: `REVOKE UPDATE, DELETE ON public.audit_logs FROM billing_app;`.
5. **Cải tổ Mô hình Thanh toán Đa Hóa đơn:**
   - Cho phép `payments.invoice_id` nhận giá trị `NULL`.
   - Lưu trữ 1 giao dịch ngân hàng thành đúng 1 bản ghi `Payment`, và phân bổ vào $N$ bản ghi `PaymentAllocation` thực thụ.

### Ưu tiên 3 (P2 — Chuẩn hóa Kiến trúc & Kiểm thử):
6. **Hoàn thiện RBAC Hạt nhân:**
   - Thay thế toàn bộ các lệnh `requireRole('admin')` còn sót lại bằng `requirePermission`.
   - Bổ sung `requirePermission` cho các route đối soát ngân hàng và kiểm toán.
   - Xây dựng API quản lý người dùng và gán vai trò.
7. **Bổ sung Bộ Kiểm thử Trình duyệt Thật:**
   - Đổi tên `frontend-e2e-test.mjs` thành `api-contract-smoke.mjs`.
   - Thiết lập bộ kiểm thử Playwright để điều khiển trình duyệt thật.

---

## 21. Final Verdict

Căn cứ trên các bằng chứng pháp y mã nguồn, cấu trúc dữ liệu và logic kế toán tài chính:

# **NOT READY — CRITICAL FINANCIAL/SECURITY ISSUES**

### Lý do kết luận:
Mặc dù hệ thống Billing_One đã hoàn thiện rất tốt về mặt hạ tầng container Docker, bảo mật biên mạng Nginx H1–H6, và các API cơ bản trả về HTTP 200, **nhưng hệ thống không thể được coi là sẵn sàng cho môi trường sản xuất khi sổ cái tài chính cốt lõi đang tạo ra các số liệu sai lệch nghiêm trọng**:
1. Tiền giảm giá/Credit Note đang bị tính nhầm thành Tiền thu thực tế trên Dashboard và báo cáo thu hồi nợ.
2. Báo cáo Doanh thu và Thuế GTGT đang khai khống số liệu do bỏ quên các khoản điều chỉnh.
3. Dữ liệu thực tế trong cơ sở dữ liệu đang tồn tại 10 hóa đơn vi phạm tính toàn vẹn số dư.
4. Tồn tại lỗ hổng đối soát cho phép nhân đôi thanh toán từ giao dịch ngân hàng đã khớp.
5. Chuỗi băm kiểm toán có nguy cơ đứt gãy dưới tải đồng thời.

**Kiểm toán viên khuyến nghị:** Hệ thống bắt buộc phải trải qua một đợt khắc phục chuyên sâu các vấn đề tài chính P0 nói trên trước khi đưa vào vận hành sản xuất chính thức.
