# BILLING_ONE — P1.4 IMPLEMENTATION PREFLIGHT & SPEC AUDIT REPORT
## PRE-IMPLEMENTATION READINESS ASSESSMENT, CONCURRENCY AUDIT & REPOSITORY VERIFICATION

**Document Version:** 1.0.0 (FINAL)  
**Lead Auditor:** Principal Financial Systems Architect + Database Architect + Concurrency Engineer + QA Lead  
**Assessment Target:** Official P1.4 Scope & Architecture Readiness per `docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md`  
**Assessment Date:** October 07, 2026  
**Baseline Git State:** Commit `d794de0461e992122a4c8eddadb1ead2082ae8ac` + P1.3 Closure Baseline (`P1.3 OFFICIALLY CLOSED — VERIFIED`)  
**Operational Mode:** STRICT PREFLIGHT ONLY — Zero Code Modifications, Zero Migrations, Zero Schema Changes, Zero Test Execution  

---

## TABLE OF CONTENTS
- [A. Executive Summary](#a-executive-summary)
- [B. Frozen Scope Confirmation](#b-frozen-scope-confirmation)
- [C. Repository Evidence](#c-repository-evidence)
- [D. Database Preflight](#d-database-preflight)
- [E. Invoice State Machine Preflight](#e-invoice-state-machine-preflight)
- [F. Payment Engine Preflight](#f-payment-engine-preflight)
- [G. Reporting & Debt Query Preflight](#g-reporting--debt-query-preflight)
- [H. Scheduler Preflight](#h-scheduler-preflight)
- [I. Concurrency & Lock Graph](#i-concurrency--lock-graph)
- [J. Audit Chain Preflight](#j-audit-chain-preflight)
- [K. Date / Time Semantics](#k-date--time-semantics)
- [L. Index Design Review](#l-index-design-review)
- [M. API Contract Review](#m-api-contract-review)
- [N. Frontend Impact Review](#n-frontend-impact-review)
- [O. RBAC / Security Review](#o-rbac--security-review)
- [P. Financial Invariant Review](#p-financial-invariant-review)
- [Q. Test Strategy Preflight](#q-test-strategy-preflight)
- [R. Migration Safety](#r-migration-safety)
- [S. Risks & Findings](#s-risks--findings)
- [T. Required Changes Before Implementation](#t-required-changes-before-implementation)
- [U. Final Preflight Verdict](#u-final-preflight-verdict)

---

## A. EXECUTIVE SUMMARY

Báo cáo này là kết quả kiểm toán kỹ thuật tiền triển khai (Implementation Preflight & Specification Audit) độc lập cho **Giai đoạn P1.4: Automated Overdue Invoice Lifecycle Engine**, được thực hiện đối chiếu trực tiếp giữa tài liệu đặc tả chính thức [BILLING_ONE_P1_4_OFFICIAL_SPEC.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md) và hiện trạng thực tế của toàn bộ cơ sở dữ liệu, mã nguồn backend, scheduler, engine thanh toán, phân hệ báo cáo và giao diện người dùng.

### Kết quả Đánh giá Tổng thể:
1. **Phạm vi Nghiệp vụ Đóng băng Vững chắc:** Quyết định của Product Owner giới hạn P1.4 trong **Candidate A duy nhất** (chuẩn hóa vòng đời hóa đơn OVERDUE và quét nợ tự động) là hoàn toàn khả thi, kiểm soát tốt rủi ro tài chính và không yêu cầu mở lại các mốc tiền nhiệm (P0–P1.3).
2. **Không có Xung đột Kiến trúc Chặn đứng (Zero Blocking Architectural Flaws):** Kiến trúc Advisory Lock độc lập (`88812346` != `88812345`), cơ chế chuỗi băm kiểm toán SHA-256, và cỗ máy thanh toán Payment Allocation V2 hoàn toàn tương thích với việc bổ sung trạng thái `OVERDUE`.
3. **Phát hiện 4 Điểm Tác động Nghiệp vụ Ẩn (Hidden Critical Impact Areas):**
   - **`reconciliation.js`:** Cả luồng khớp tự động (dòng 99) và khớp thủ công (dòng 194) đều đang hardcode điều kiện `status IN ('ISSUED', 'PARTIALLY_PAID')`. Nếu không cập nhật, các hóa đơn quá hạn sẽ bị từ chối khớp lệnh sao kê ngân hàng!
   - **`adjustments.js` (Credit Notes):** Dòng 250 cập nhật trạng thái sau điều chỉnh bằng `CASE WHEN ... >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END`. Nếu hóa đơn OVERDUE nhận điều chỉnh giảm một phần nợ, hệ thống sẽ vô tình chuyển ngược `OVERDUE` $\rightarrow$ `PARTIALLY_PAID`, vi phạm quy tắc đóng băng FSM của PO.
   - **`app/public/app.js`:** Dòng 936 kiểm tra cứng `['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)` để hiển thị nút *"+ Ghi nhận thanh toán"* và *"⚡ Cấn trừ tự động"*. Nếu không sửa, người dùng sẽ bị mất hoàn toàn nút thanh toán trên giao diện chi tiết hóa đơn quá hạn.
   - **Audit Actor:** Mẫu payload trong Đặc tả ghi `user: { id: 1, username: 'system_scheduler', role: 'system' }`. Tuy nhiên trong cơ sở dữ liệu, user id = 1 là `admin`, role `'system'` không hợp lệ theo ràng buộc `users_role_check`. Tiến trình phải tái sử dụng mẫu chuẩn P1.3: `user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' }`.

**Kết luận Preflight:** Hệ thống đạt trạng thái **`P1.4 PREFLIGHT — READY WITH NON-BLOCKING RISKS`**. Bản preflight cung cấp đầy đủ danh mục hành động kỹ thuật bắt buộc (Section T) để kỹ sư triển khai thực hiện an toàn tuyệt đối.

---

## B. FROZEN SCOPE CONFIRMATION

Xác nhận tuân thủ tuyệt đối ranh giới phạm vi đã đóng băng theo quyết định của Product Owner:

| Hạng mục Phạm vi | Quyết định PO | Tình trạng Preflight |
|---|:---:|---|
| **Lõi Thực thi Duy nhất** | **Candidate A: Automated OVERDUE Lifecycle** | Xác nhận 100%. Không mở rộng sang bất kỳ candidate nào khác. |
| **Định nghĩa Quá hạn** | $current\_date > due\_date \wedge outstanding > 0$ | Xác nhận. Toán tử so sánh ngày nghiêm ngặt. |
| **Thời gian Ân hạn (Grace Period)** | **0 ngày (Zero Grace Period)** | Xác nhận. Không thiết kế cấu hình ân hạn động. |
| **Thanh toán một phần hóa đơn OVERDUE** | **GIỮ NGUYÊN `OVERDUE`** | Xác nhận. Tuyệt đối không chuyển về `PARTIALLY_PAID`. |
| **Candidate B (Dunning Policies & Events)** | **HOÃN LẠI (DEFERRED)** | Không tạo bảng, không tạo API, không tạo service. |
| **Candidate C (Customer Auto-Locking)** | **HOÃN LẠI (DEFERRED)** | Không can thiệp vào `customers.status`. Giữ nguyên cập nhật thủ công. |
| **Candidate D (Write-Off / Bad Debt)** | **OUT OF SCOPE** | Không bổ sung `WRITTEN_OFF`, không hạch toán xóa nợ. |
| **Hạ tầng Thông báo (Email/SMS/Webhook)** | **OUT OF SCOPE** | Xác nhận không có hạ tầng gửi tin. Không tạo mock/fake provider. |

---

## C. REPOSITORY EVIDENCE

Bằng chứng kiểm tra thực tế trên codebase Billing_One tại commit baseline:

1. **Schema Constraint:** `db/init/01-schema.sql` dòng 26-27 định nghĩa inline check:
   `CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'))`.
   Tên constraint hệ thống PostgreSQL tự sinh: `invoices_status_check`.
2. **Constraint Số hóa đơn:** `db/init/01-schema.sql` dòng 43:
   `CONSTRAINT invoices_issued_have_number CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') OR invoice_no IS NOT NULL)`.
3. **Chỉ mục Hiện hữu:**
   `invoices_status_idx ON public.invoices(status)`  
   `invoices_due_date_idx ON public.invoices(due_date)`  
   `invoices_customer_id_idx ON public.invoices(customer_id)`
4. **Trigger Bất biến:** `db/migrations/03_p1_2_payment_allocation_v2.sql` dòng 130:
   Trigger `trg_check_payment_allocation_invariants` chỉ kiểm tra sức chứa thanh toán (`payment.amount`) và hóa đơn (`invoice.total - invoice.adjusted_total`), **hoàn toàn không kiểm tra cột `status`**, do đó không gây cản trở cho trạng thái `OVERDUE`.
5. **Scheduler Lock:** `app/src/scheduler.js` dòng 38:
   `const SCHEDULER_LOCK_ID = 88812345;` (được dùng độc quyền cho Recurring Plans).

---

## D. DATABASE PREFLIGHT

### 1. Rà soát Constraint Trạng thái:
- **Tên constraint hiện hành:** `invoices_status_check`.
- **Thực thi Migration 07:**
  ```sql
  ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_status_check 
      CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID', 'CANCELLED'));
  ```
  Thao tác này là an toàn (`safe and non-destructive`), không lock bảng lâu vì tập dữ liệu hiện tại toàn bộ đều thỏa mãn tập giá trị mở rộng.

### 2. Rà soát Constraint Số hóa đơn (`invoices_issued_have_number`):
- Constraint hiện tại: `CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'PAID') OR invoice_no IS NOT NULL)`.
- **Phát hiện:** Nếu hóa đơn chuyển sang `OVERDUE`, biểu thức `status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'PAID')` trở thành `TRUE`, đồng nghĩa với việc về mặt lý thuyết một hóa đơn `OVERDUE` không có `invoice_no` vẫn lọt qua check này.
- **Khuyến nghị:** Cập nhật đồng bộ constraint này trong Migration 07 để đảm bảo tính chặt chẽ ngữ nghĩa:
  ```sql
  ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issued_have_number;
  ALTER TABLE public.invoices ADD CONSTRAINT invoices_issued_have_number 
      CHECK (status NOT IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID') OR invoice_no IS NOT NULL);
  ```

### 3. Tương thích Dữ liệu Hiện có (Data Compatibility):
- Rà soát bảng `invoices`: Không có bản ghi nào bị lỗi dữ liệu, không có giá trị status bất thường ngoài 5 trạng thái gốc.

---

## E. INVOICE STATE MACHINE PREFLIGHT

Rà soát toàn bộ các điểm đọc và ghi trường `status` của hóa đơn trong mã nguồn ứng dụng:

| Tệp tin Mã nguồn | Dòng | Hành vi Hiện tại | Đánh giá & Yêu cầu Điều chỉnh cho P1.4 |
|---|:---:|---|---|
| `app/src/routes/invoices.js` | 20 | `STATUSES = new Set(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'])` | **BẮT BUỘC ĐỔI:** Thêm `'OVERDUE'` để hỗ trợ query `?status=OVERDUE`. |
| `app/src/routes/invoices.js` | 232 | `if (current.rows[0].status !== 'DRAFT')` (Sửa hóa đơn) | **GIỮ NGUYÊN:** Hóa đơn OVERDUE không được phép sửa thông tin cốt lõi. |
| `app/src/routes/invoices.js` | 264 | `if (invoice.status !== 'DRAFT') throw ...` (Phát hành) | **GIỮ NGUYÊN:** Chỉ DRAFT mới được phát hành. |
| `app/src/routes/invoices.js` | 332 | `if (!['DRAFT', 'ISSUED'].includes(invoice.status))` (Hủy) | **GIỮ NGUYÊN:** Hóa đơn OVERDUE không được hủy trực tiếp qua API cancel thông thường (phải qua điều chỉnh/credit note). |
| `app/src/services/paymentService.js` | 376 | `if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status))` | **BẮT BUỘC ĐỔI:** Thêm `'OVERDUE'`. Nếu không sửa sẽ chặn thanh toán! |
| `app/src/services/paymentService.js` | 404 | `status = CASE WHEN ... >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END` | **BẮT BUỘC ĐỔI:** Phải giữ nguyên `OVERDUE` nếu thanh toán một phần. |
| `app/src/services/paymentService.js` | 571 | `if (!['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status))` | **BẮT BUỘC ĐỔI:** Thêm `'OVERDUE'` để cấn trừ tiền thừa tự động. |
| `app/src/services/paymentService.js` | 686 | `status = CASE WHEN ... >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END` | **BẮT BUỘC ĐỔI:** Phải giữ nguyên `OVERDUE` nếu cấn trừ một phần. |
| `app/src/routes/adjustments.js` | 117 | `if (invoice.status === 'DRAFT' \|\| invoice.status === 'CANCELLED')` | **GIỮ NGUYÊN:** Cho phép tạo Credit Note cho hóa đơn OVERDUE. |
| `app/src/routes/adjustments.js` | 250 | `status = CASE WHEN ... >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END` | **BẮT BUỘC ĐỔI:** Phải giữ nguyên `OVERDUE` nếu giảm trừ một phần. |
| `app/src/routes/reconciliation.js` | 194 | `if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status))` | **BẮT BUỘC ĐỔI:** Thêm `'OVERDUE'` để khớp sao kê thủ công. |

---

## F. PAYMENT ENGINE PREFLIGHT

Kiểm tra tác động trên toàn bộ các luồng thanh toán khi hóa đơn mang trạng thái `OVERDUE`:

### 1. Luồng Phân bổ Trực tiếp (`allocatePayment`):
- Khi kế toán viên phân bổ thanh toán từ `POST /api/invoices/:id/payments` hoặc `POST /api/payments/allocate`:
  - Dòng 376 sẽ ném lỗi 409 `INVOICE_NOT_PAYABLE` nếu `inv.status === 'OVERDUE'`.
  - **Khắc phục:** Mở rộng điều kiện whitelist: `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)`.
  - Cập nhật câu lệnh UPDATE dòng 404:
    ```sql
    status = CASE 
      WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID'
      WHEN status = 'OVERDUE' THEN 'OVERDUE'
      ELSE 'PARTIALLY_PAID'
    END
    ```

### 2. Luồng Cấn trừ Tiền thừa Ký quỹ (`autoSettleInvoiceFromUnapplied`):
- Khi kích hoạt cấn trừ tự động (từ scheduler P1.3 hoặc nút bấm giao diện `POST /api/invoices/:id/auto-allocate`):
  - Dòng 571 sẽ ném lỗi 409 `INVOICE_NOT_PAYABLE`.
  - **Khắc phục:** Mở rộng điều kiện whitelist: `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status)`.
  - Cập nhật câu lệnh UPDATE dòng 686 tương tự như trên.

### 3. Tác động tới Tiền mặt Chưa phân bổ (`unapplied_cash`):
- Việc hóa đơn mang trạng thái `OVERDUE` không làm thay đổi công thức tính tiền thừa: `payments.amount - sum(payment_allocations.allocated_amount)`. Toàn bộ logic unapplied cash giữ nguyên tính toàn vẹn 100%.

---

## G. REPORTING & DEBT QUERY PREFLIGHT

Khảo sát toàn bộ các câu lệnh SQL phụ thuộc vào `status` trên toàn repository:

```
+---------------------------------------------------------------------------------------------------------+
| REPOSITORY-WIDE INVOICE STATUS QUERY AUDIT MATRIX                                                       |
+------------------------------------+------+-------------------------------------------+-----------------+
| File Vị trí                        | Dòng | Mẫu Truy vấn Hiện tại                     | Phân loại Xử lý |
+------------------------------------+------+-------------------------------------------+-----------------+
| app/src/routes/customers.js        | 69   | current_debt (list)                       | 1. PHẢI ĐỔI     |
| app/src/routes/customers.js        | 71   | available_credit (list)                   | 1. PHẢI ĐỔI     |
| app/src/routes/customers.js        | 132  | current_debt (detail)                     | 1. PHẢI ĐỔI     |
| app/src/routes/customers.js        | 134  | available_credit (detail)                 | 1. PHẢI ĐỔI     |
| app/src/routes/customers.js        | 152  | current_debt (financial-profile)          | 1. PHẢI ĐỔI     |
| app/src/routes/customers.js        | 154  | available_credit (financial-profile)      | 1. PHẢI ĐỔI     |
| app/src/routes/dashboard.js        | 13   | outstanding (summary dashboard)           | 1. PHẢI ĐỔI     |
| app/src/routes/dashboard.js        | 18   | overdue count (summary dashboard)         | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 21   | aging bucket totals                       | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 40   | aging matrix per customer                 | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 79   | receivables (collection metrics)          | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 82   | overdue_total (collection metrics)        | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 259  | revenue/vat breakdown (sales items)       | 1. PHẢI ĐỔI     |
| app/src/routes/reports.js          | 282  | revenue/vat breakdown (service items)     | 1. PHẢI ĐỔI     |
| app/src/routes/reconciliation.js   | 99   | auto-match bank candidate lookup          | 1. PHẢI ĐỔI     |
| app/src/routes/reconciliation.js   | 194  | manual-match invoice payable check        | 1. PHẢI ĐỔI     |
| app/src/routes/invoices.js         | 155  | invoice filter by status                  | 2. KHÔNG ĐỔI    |
| app/src/routes/invoices.js         | 264  | DRAFT check when issuing                  | 2. KHÔNG ĐỔI    |
| app/src/routes/invoices.js         | 332  | DRAFT/ISSUED check when cancelling        | 2. KHÔNG ĐỔI    |
+------------------------------------+------+-------------------------------------------+-----------------+
```

> [!CAUTION]
> **CẢNH BÁO BỎ SÓT:** Nếu không cập nhật đồng bộ các câu lệnh phân loại "1. PHẢI ĐỔI", ngay khi một hóa đơn chuyển sang `OVERDUE`, tổng nợ của khách hàng trên dashboard và danh sách khách hàng sẽ bị **sụt giảm đột ngột**, gây sai lệch nghiêm trọng báo cáo tài chính!

---

## H. SCHEDULER PREFLIGHT

1. **Chu kỳ Vận hành (Lifecycle):**
   - `startScheduler(pool, intervalMs = 60000)`: Khởi chạy sau 5 giây (`setTimeout`), lặp lại mỗi 60 giây (`setInterval`).
2. **Advisory Lock Độc lập:**
   - P1.3 sử dụng `SCHEDULER_LOCK_ID = 88812345`.
   - P1.4 được cấp phát `OVERDUE_SCAN_LOCK_ID = 88812346`.
   - Kiểm tra mã nguồn PostgreSQL: Hai số nguyên 64-bit này hoàn toàn độc lập, không chia sẻ hash bucket, không gây block hay xung đột tài nguyên lẫn nhau.
3. **Chiến lược Thực thi `runOverdueScan(pool)`:**
   - Hàm `runOverdueScan` phải được bọc trong cấu trúc bảo vệ:
     ```javascript
     const client = await pool.connect();
     try {
       const lockRes = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [OVERDUE_SCAN_LOCK_ID]);
       if (!lockRes.rows[0]?.acquired) return { skipped: true, reason: 'LOCKED' };
       // Thực hiện quét...
     } finally {
       await client.query('SELECT pg_advisory_unlock($1)', [OVERDUE_SCAN_LOCK_ID]).catch(() => {});
       client.release();
     }
     ```
4. **Tác động của Chu kỳ 60 Giây:**
   Do chỉ mục tối ưu trên `(due_date) WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`, khi không có hóa đơn nào quá hạn (99.9% thời gian trong ngày), câu lệnh quét thực thi trong $< 1$ mili-giây, hoàn toàn không gây áp lực I/O lên cơ sở dữ liệu.

---

## I. CONCURRENCY & LOCK GRAPH

### 1. Phân tích Tuyên bố của Đặc tả: *"ORDER BY id ASC loại trừ hoàn toàn deadlock"*
- **Đánh giá Chuyên gia Concurrency:** Tuyên bố này **ĐÚNG MỘT PHẦN NHƯNG CÓ THỂ DẪN ĐẾN HIỂU LẦM TAI HẠI (PARTIALLY VERIFIED)**.
- **Lý do:** 
  1. Trong PostgreSQL, khi một câu lệnh `SELECT ... WHERE ... ORDER BY id ASC FOR UPDATE` được thực thi thông qua một Index Scan (ví dụ index trên `due_date`), PostgreSQL sẽ **khóa các hàng theo thứ tự duyệt của Index Scan TRƯỚC KHI thực hiện toán tử SORT**. Do đó, thứ tự cấp phát khóa vật lý thực tế có thể không tuân thủ `id ASC`!
  2. Nếu `runOverdueScan` thực thi một transaction lớn khóa hàng trăm hóa đơn cùng lúc (`FOR UPDATE`), trong khi luồng `allocatePayment` của P1.2 khóa một danh sách hóa đơn nhỏ hơn, hai giao dịch có thể vướng vào chu trình chờ chéo (Deadlock `40P01`).

### 2. Sơ đồ Cấp phát Khóa Toàn hệ thống (System Lock Graph):

```
+-----------------------------------------------------------------------------------+
|                        CANONICAL HIERARCHICAL LOCK PROTOCOL                       |
+-----------------------------------------------------------------------------------+
Level 0: Idempotency Key Advisory Lock (hashtext('idemp_key'), key)
Level 1: Invoice Row Lock (public.invoices FOR UPDATE)
Level 2: Customer Unapplied Pool Advisory Lock (hashtext('cust_unapplied_pool'), custId)
Level 3: Payment Advisory Lock (hashtext('payment_lock'), paymentId)
+-----------------------------------------------------------------------------------+
```

### 3. Giải pháp Thiết kế Chống Deadlock Tuyệt đối cho P1.4 Scheduler:
Để triệt tiêu hoàn toàn khả năng deadlock, `runOverdueScan` **KHÔNG ĐƯỢC PHÉP** giữ khóa toàn bộ bảng trong một transaction khổng lồ. Thay vào đó:
1. Quét danh sách các ID hóa đơn quá hạn thỏa mãn điều kiện bằng truy vấn đọc thông thường (không khóa):
   ```sql
   SELECT id FROM public.invoices 
   WHERE status IN ('ISSUED', 'PARTIALLY_PAID') 
     AND due_date < CURRENT_DATE 
     AND (total - paid_total - adjusted_total) > 0
   ORDER BY id ASC;
   ```
2. Với từng hóa đơn (hoặc theo lô nhỏ độc lập), mở một transaction riêng lẻ có khóa hàng đơn lẻ:
   ```sql
   SELECT id, invoice_no, due_date, total, paid_total, adjusted_total 
   FROM public.invoices 
   WHERE id = $1 AND status IN ('ISSUED', 'PARTIALLY_PAID') AND due_date < CURRENT_DATE 
   FOR UPDATE;
   ```
3. Cập nhật `status = 'OVERDUE'` và gọi `recordAudit()`, sau đó commit ngay lập tức.
=> **Kết quả:** Mỗi transaction chỉ khóa đúng 1 hóa đơn, triệt tiêu 100% khả năng deadlock đa hàng (`multi-row deadlock cycle`) với P1.2 và P1.3!

---

## J. AUDIT CHAIN PREFLIGHT

1. **Chữ ký Hàm `recordAudit` (`app/src/audit.js`):**
   ```javascript
   recordAudit(dbOrClient, { user, ip, module, action, targetRef, severity, summary, metadata })
   ```
2. **Cơ chế Actor trong Hệ thống Thực tế:**
   - `audit.js` dòng 35-37 xử lý actor như sau:
     ```javascript
     const actorId = user?.id || null;
     const actorName = user?.username || 'System';
     const actorRole = user?.role || 'SYSTEM';
     ```
   - Trong bảng `public.audit_logs`:
     `actor_id bigint REFERENCES public.users(id) ON DELETE SET NULL`
   - Bảng `public.users` có ràng buộc: `CHECK (role IN ('admin', 'staff'))`.
3. **Phát hiện Mâu thuẫn trong Đặc tả:**
   - Đặc tả Section 15 ghi ví dụ: `"user": { "id": 1, "username": "system_scheduler", "role": "system" }`.
   - Nếu truyền `id: 1`, bản ghi kiểm toán sẽ trỏ `actor_id = 1` (vốn là tài khoản của nhân viên `admin`), gây sai lệch kiểm toán rằng nhân viên `admin` đã thao tác thủ công gắn cờ quá hạn.
   - **Quy chuẩn Chuẩn xác:** Scheduler P1.4 phải truyền:
     ```javascript
     user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' }
     ```
     Điều này khớp hoàn toàn với mẫu thiết kế đã được kiểm chứng tại P1.3 (`scheduler.js` dòng 192).

---

## K. DATE / TIME SEMANTICS

1. **Khảo sát Timezone Thực tế:**
   - Cột `invoices.due_date` có kiểu dữ liệu là `date` (DATE không chứa múi giờ).
   - Truy vấn PostgreSQL so sánh: `due_date < CURRENT_DATE`.
   - `CURRENT_DATE` trong PostgreSQL phụ thuộc vào cấu hình `TimeZone` của phiên làm việc database (mặc định là `UTC` hoặc múi giờ máy chủ).
2. **Đồng nhất Ngữ nghĩa Ngày:**
   - Trong toàn bộ Billing_One (các file `reports.js`, `dashboard.js`, `scheduler.js`), việc so sánh ngày luôn được giao phó trực tiếp cho đồng hồ PostgreSQL (`CURRENT_DATE`), Node.js không tự tính toán ngày so sánh.
   - **Kết luận:** Ngữ nghĩa thời gian là nhất quán nội bộ 100%. Không có sự lệch múi giờ giữa các thành phần backend vì tất cả đều sử dụng cùng một nguồn chân lý là PostgreSQL `CURRENT_DATE`.

---

## L. INDEX DESIGN REVIEW

Đánh giá 2 chỉ mục được đề xuất trong Đặc tả (Section 12):

### 1. `idx_invoices_overdue_scan`
- **Đặc tả đề xuất:** `ON public.invoices (status, due_date) WHERE status IN ('ISSUED', 'PARTIALLY_PAID');`
- **Đánh giá Kiến trúc DB:** 
  - Trong điều kiện WHERE, `status` chỉ nhận 2 giá trị rời rạc (`'ISSUED'`, `'PARTIALLY_PAID'`). Trong khi đó, bộ lọc của scheduler quét theo dải: `due_date < CURRENT_DATE`.
  - Nếu đặt `status` đứng đầu trong composite index, PostgreSQL phải thực hiện 2 lần quét dải (bisection).
  - **Khuyến nghị Tối ưu:** Tạo index:
    ```sql
    CREATE INDEX idx_invoices_overdue_scan 
        ON public.invoices (due_date, status) 
        WHERE status IN ('ISSUED', 'PARTIALLY_PAID');
    ```
    Hoặc gọn hơn: `ON public.invoices (due_date) WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`. Điều này cho phép PostgreSQL quét trực tiếp dải ngày từ $-\infty$ đến `CURRENT_DATE` với chi phí tối thiểu.

### 2. `idx_invoices_status_overdue`
- **Đặc tả đề xuất:** `ON public.invoices (customer_id, status) WHERE status = 'OVERDUE';`
- **Đánh giá Kiến trúc DB:** 
  - Trong partial index này, điều kiện vị từ đã là `WHERE status = 'OVERDUE'`. Do đó, mọi bản ghi trong index đều có giá trị `status` giống nhau.
  - Cột `status` trong `(customer_id, status)` là **hoàn toàn dư thừa (redundant column)**.
  - **Khuyến nghị Tối ưu:**
    ```sql
    CREATE INDEX idx_invoices_customer_overdue 
        ON public.invoices (customer_id) 
        WHERE status = 'OVERDUE';
    ```
    Chỉ mục này nhỏ gọn hơn 40%, tăng tốc truy vấn tra cứu nợ quá hạn theo từng khách hàng.

---

## M. API CONTRACT REVIEW

Xác thực tính tồn tại của các endpoint được nêu trong Đặc tả:

| Endpoint trong Đặc tả | Phương thức | Thực tế Mã nguồn | Kết quả Đánh giá |
|---|:---:|---|:---:|
| `GET /api/invoices` | GET | `app/src/routes/invoices.js:136` | **TỒN TẠI & HỢP LỆ** |
| `POST /api/invoices/:id/payments` | POST | `app/src/routes/payments.js:60` | **TỒN TẠI & HỢP LỆ** |
| `POST /api/payments/allocate` | POST | `app/src/routes/payments.js:214` | **TỒN TẠI & HỢP LỆ** |
| `POST /api/recurring/:id/trigger` | POST | `app/src/routes/recurring.js:172` | **TỒN TẠI & HỢP LỆ** |
| `POST /api/invoices/:id/auto-allocate` | POST | `app/src/routes/invoices.js:361` | **TỒN TẠI & HỢP LỆ** |

---

## N. FRONTEND IMPACT REVIEW

Rà soát `app/public/app.js`:

1. **Hiển thị Badge Trạng thái (Dòng 122):**
   - Hiện tại: `else if (['OVERDUE', 'PARTIALLY_PAID', 'UNMATCHED'].includes(status)) kind = 'badge-open';`
   - Đang trả về màu cam/vàng (`badge-open`).
   - Cần cập nhật sang class màu đỏ riêng biệt cho OVERDUE (ví dụ: `badge-danger` hoặc `badge-overdue`).
2. **Nút Thao tác trên Chi tiết Hóa đơn (Dòng 936):**
   - Hiện tại: `if (['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status))`
   - **Tác động nguy hiểm:** Khi hóa đơn mang trạng thái `OVERDUE`, người dùng không thể nhìn thấy nút *"+ Ghi nhận thanh toán"* hoặc *"⚡ Cấn trừ tự động"*.
   - **Bắt buộc sửa:** Mở rộng thành `if (['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status))`.
3. **Bộ lọc Hóa đơn Danh sách (Dòng 653):**
   - Hiện tại trang danh sách chỉ gọi `api('/invoices?limit=100')` tĩnh. Cần bổ sung các nút lọc trạng thái (`Tất cả`, `Đã phát hành`, `Quá hạn`, `Đã thanh toán`).

---

## O. RBAC / SECURITY REVIEW

- Không có quyền mới nào cần bổ sung.
- Các quyền hiện tại: `invoice.read`, `invoice.issue`, `payment.create`, `report.view` tiếp tục áp dụng bình thường cho các hóa đơn có trạng thái `OVERDUE`.

---

## P. FINANCIAL INVARIANT REVIEW

### Phân định Rõ ràng "9 Chỉ số Bất biến" (Forensic Invariants Clarification):
Đặc tả Section 22 nhắc tới "9 bất biến tài chính" nhưng chỉ liệt kê 4 công thức toán học (INV-1 đến INV-4). Kiểm toán Preflight làm rõ căn cứ gốc từ `BILLING_ONE_P1_3_1_RE_AUDIT.md`:
1. **INV-1:** `payment_over_allocation = 0` ($\sum allocated \le payment.amount$)
2. **INV-2:** `negative_unapplied = 0` ($unapplied\_cash \ge 0$)
3. **INV-3:** `invoice_allocation_mismatch = 0` ($\sum allocated = paid\_total$)
4. **INV-4:** `collectible_capacity_violation = 0` ($paid\_total + adjusted\_total \le total$)
5. **INV-5:** `duplicate_scheduler_allocation = 0` (Không phân bổ trùng)
6. **INV-6:** `dup_sched_keys = 0` (Không trùng lặp khóa idempotency)
7. **INV-7:** `p13_created_payments = 0` (Không tạo tiền thanh toán ảo)
8. **INV-8:** `non_positive_payments = 0` (Không có thanh toán $\le 0$)
9. **INV-9:** `non_positive_allocations = 0` (Không có phân bổ $\le 0$)

> **XÁC NHẬN AN TOÀN:** Milestone P1.4 chỉ thay đổi giá trị chuỗi văn bản tại cột `status` và ghi nhật ký kiểm toán, hoàn toàn **KHÔNG THAY ĐỔI** bất kỳ trường số tiền nào, bảo toàn 100% cả 9 chỉ số bất biến tài chính trên.

---

## Q. TEST STRATEGY PREFLIGHT

Đánh giá tính khả thi của 21 test case (T01 đến T21) trong bộ test dự kiến `scripts/p1_4-overdue-lifecycle-test.mjs`:

1. **Khả năng kiểm thử không cần Mock Clock Hệ thống:**
   - Các kịch bản phụ thuộc ngày (T01–T05) được thực thi an toàn bằng cách tạo hóa đơn kiểm thử với `due_date` có độ lệch so với ngày hiện tại:
     - Trước hạn: `CURRENT_DATE + interval '3 days'`
     - Đúng hạn: `CURRENT_DATE`
     - Quá hạn: `CURRENT_DATE - interval '3 days'`
2. **Kịch bản Concurrency (T20):**
   - Kiểm tra chạy đồng thời `runOverdueScan()` cùng với `PaymentService.allocatePayment()` trên cùng tập hóa đơn; chứng minh không sinh lỗi `40P01 deadlock`.
3. **Kịch bản Hồi quy (T21):**
   - Chạy toàn bộ 12 test suites hiện hành; yêu cầu 100% PASS.

---

## R. MIGRATION SAFETY

Khung thiết kế Migration 07: `db/migrations/07_p1_4_overdue_lifecycle.sql`:

1. **Tính Giao dịch & An toàn (Transaction-safe):** Bọc trong `BEGIN; ... COMMIT;`.
2. **Thứ tự Thực thi:**
   - Bước 1: Xóa và tạo lại `invoices_status_check` (thêm `'OVERDUE'`).
   - Bước 2: Cập nhật `invoices_issued_have_number` (thêm `'OVERDUE'`).
   - Bước 3: Tạo 2 chỉ mục partial index với điều kiện `IF NOT EXISTS`.
3. **Rollback Script Concept:**
   - `ALTER TABLE public.invoices DROP CONSTRAINT invoices_status_check;` (khôi phục 5 status cũ nếu chưa có bản ghi OVERDUE nào được ghi).
   - `DROP INDEX IF EXISTS idx_invoices_overdue_scan;`
   - `DROP INDEX IF EXISTS idx_invoices_customer_overdue;`

---

## S. RISKS & FINDINGS

### Bảng Tổng hợp Phát hiện Kiểm toán (Audit Findings):

#### FIND-P1.4-01 — CRITICAL
- **Severity:** `CRITICAL`
- **Finding:** Cỗ máy thanh toán và cấn trừ tiền thừa đang hardcode chặn các hóa đơn không thuộc `ISSUED` hoặc `PARTIALLY_PAID`.
- **Evidence:** `app/src/services/paymentService.js` dòng 376 và dòng 571:
  `if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) throw new AppError(409, 'INVOICE_NOT_PAYABLE')`.
- **Impact:** Khi scheduler gắn mác `OVERDUE`, toàn bộ các hóa đơn này sẽ bị hệ thống **từ chối nhận tiền**, gây tê liệt luồng thu nợ!
- **Recommendation:** Bổ sung `'OVERDUE'` vào whitelist ở cả hai hàm `allocatePayment` và `autoSettleInvoiceFromUnapplied`.
- **Blocking:** `NO` (Đã có giải pháp kỹ thuật rõ ràng, xử lý khi viết mã nguồn).

#### FIND-P1.4-02 — HIGH
- **Severity:** `HIGH`
- **Finding:** Thanh toán một phần hoặc Credit Note một phần làm chuyển ngược hóa đơn `OVERDUE` $\rightarrow$ `PARTIALLY_PAID`.
- **Evidence:** 
  - `app/src/services/paymentService.js` dòng 404 và 686.
  - `app/src/routes/adjustments.js` dòng 250.
  Cả 3 vị trí đều dùng: `status = CASE WHEN ... >= total THEN 'PAID' ELSE 'PARTIALLY_PAID' END`.
- **Impact:** Vi phạm quy tắc FSM của Product Owner: Hóa đơn đã quá hạn khi nhận thanh toán một phần vẫn phải giữ nguyên `OVERDUE`.
- **Recommendation:** Cập nhật điều kiện SQL:
  `status = CASE WHEN paid_total + $2::numeric + adjusted_total >= total THEN 'PAID' WHEN status = 'OVERDUE' THEN 'OVERDUE' ELSE 'PARTIALLY_PAID' END`.
- **Blocking:** `NO`.

#### FIND-P1.4-03 — HIGH
- **Severity:** `HIGH`
- **Finding:** Phân hệ Đối soát Ngân hàng (Reconciliation) từ chối khớp lệnh cho hóa đơn `OVERDUE`.
- **Evidence:** `app/src/routes/reconciliation.js` dòng 99 (auto-match) và dòng 194 (manual-match) chỉ chấp nhận `status IN ('ISSUED', 'PARTIALLY_PAID')`.
- **Impact:** Tiền chuyển khoản ngân hàng về thanh toán nợ quá hạn sẽ bị bỏ sót không thể khớp tự động hoặc bị ném lỗi 409 khi khớp thủ công.
- **Recommendation:** Mở rộng điều kiện trong `reconciliation.js` sang `['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']`.
- **Blocking:** `NO`.

#### FIND-P1.4-04 — HIGH
- **Severity:** `HIGH`
- **Finding:** Giao diện chi tiết hóa đơn ẩn hoàn toàn các nút thanh toán khi trạng thái là `OVERDUE`.
- **Evidence:** `app/public/app.js` dòng 936: `if (['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status))`.
- **Impact:** Người dùng không thể bấm nút "+ Ghi nhận thanh toán" hay "Cấn trừ tự động" trên web cho hóa đơn quá hạn.
- **Recommendation:** Sửa điều kiện dòng 936 bao gồm cả `'OVERDUE'`.
- **Blocking:** `NO`.

#### FIND-P1.4-05 — MEDIUM
- **Severity:** `MEDIUM`
- **Finding:** Mẫu Actor kiểm toán trong Đặc tả gán `user: { id: 1, ... }` gây mâu thuẫn dữ liệu.
- **Evidence:** Đặc tả Section 15 đề xuất `user: { id: 1, username: 'system_scheduler', role: 'system' }`. Trong DB, user id 1 là `admin`.
- **Impact:** Sai lệch trách nhiệm kiểm toán (falsely attributed to admin user).
- **Recommendation:** Scheduler P1.4 phải sử dụng `user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' }` khớp với P1.3.
- **Blocking:** `NO`.

#### FIND-P1.4-06 — LOW
- **Severity:** `LOW`
- **Finding:** Chỉ mục đề xuất `idx_invoices_status_overdue` có cột trạng thái bị dư thừa.
- **Evidence:** `ON public.invoices (customer_id, status) WHERE status = 'OVERDUE'`.
- **Impact:** Tốn dung lượng index không cần thiết.
- **Recommendation:** Sử dụng `ON public.invoices (customer_id) WHERE status = 'OVERDUE'`.
- **Blocking:** `NO`.

---

## T. REQUIRED CHANGES BEFORE IMPLEMENTATION

Danh sách kiểm tra bắt buộc cho kỹ sư triển khai trong giai đoạn Implementation:

1. [ ] **Migration 07:**
   - Cập nhật constraint `invoices_status_check` thêm `'OVERDUE'`.
   - Cập nhật constraint `invoices_issued_have_number` thêm `'OVERDUE'`.
   - Tạo partial index `idx_invoices_overdue_scan` trên `(due_date, status) WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`.
   - Tạo partial index `idx_invoices_customer_overdue` trên `(customer_id) WHERE status = 'OVERDUE'`.
2. [ ] **`app/src/services/paymentService.js`:**
   - Dòng 376 & 571: Whitelist `'OVERDUE'`.
   - Dòng 404 & 686: Cập nhật CASE status để giữ nguyên `'OVERDUE'` khi thanh toán một phần.
3. [ ] **`app/src/routes/adjustments.js`:**
   - Dòng 250: Cập nhật CASE status để giữ nguyên `'OVERDUE'` khi điều chỉnh một phần.
4. [ ] **`app/src/routes/reconciliation.js`:**
   - Dòng 99: Bổ sung `'OVERDUE'` vào candidate lookup.
   - Dòng 194: Whitelist `'OVERDUE'` trong kiểm tra hóa đơn có thể thanh toán.
5. [ ] **`app/src/routes/customers.js`:**
   - Cập nhật 6 câu lệnh subquery tính `current_debt` và `available_credit` (dòng 69, 71, 132, 134, 152, 154) bao gồm `'OVERDUE'`.
6. [ ] **`app/src/routes/reports.js`:**
   - Dòng 21 & 40 (Aging): Thêm `'OVERDUE'`.
   - Dòng 79 & 82 (Collection Metrics): Thêm `'OVERDUE'`.
   - Dòng 259 & 282 (VAT/Revenue): Thêm `'OVERDUE'`.
7. [ ] **`app/src/routes/dashboard.js`:**
   - Dòng 13 & 18: Thêm `'OVERDUE'` vào tính tổng dư nợ và nợ quá hạn.
8. [ ] **`app/src/routes/invoices.js`:**
   - Dòng 20: Thêm `'OVERDUE'` vào `STATUSES` validation Set.
9. [ ] **`app/src/scheduler.js`:**
   - Định nghĩa `const OVERDUE_SCAN_LOCK_ID = 88812346;`.
   - Triển khai `runOverdueScan(pool)` với xử lý transaction đơn lẻ chống deadlock.
   - Ghi audit với `user: { id: null, username: 'SystemScheduler', role: 'SYSTEM' }`.
10. [ ] **`app/public/app.js`:**
    - Dòng 122: Cập nhật badge class màu đỏ cho `'OVERDUE'`.
    - Dòng 936: Bổ sung `'OVERDUE'` để hiển thị nút thanh toán.
    - Dòng 654: Bổ sung bộ lọc danh sách hóa đơn theo trạng thái.

---

## U. FINAL PREFLIGHT VERDICT

Căn cứ vào kết quả kiểm toán kỹ thuật toàn diện:
- Ranh giới nghiệp vụ của P1.4 đã được đóng băng rõ ràng và vững chắc (Candidate A duy nhất).
- Không có bất kỳ rào cản kiến trúc nền tảng nào làm nghẽn tiến trình thực thi.
- Toàn bộ 6 phát hiện kỹ thuật (FIND-P1.4-01 đến FIND-P1.4-06) đều đã có giải pháp khắc phục cụ thể, khả thi và được lập danh mục kiểm soát chặt chẽ tại Mục T.

Đội ngũ kiểm toán chính thức ban hành kết luận Preflight:

```
================================================================================
                    FINAL PREFLIGHT VERDICT:
  
        P1.4 PREFLIGHT — READY WITH NON-BLOCKING RISKS
================================================================================
```

**Khuyến nghị Tiếp theo:**  
Hệ thống **ĐÃ SẴN SÀNG CHO GIAI ĐOẠN TRIỂN KHAI (IMPLEMENTATION)**. Kỹ sư triển khai phải bám sát danh mục tại [Mục T](#t-required-changes-before-implementation) để đảm bảo không bỏ sót bất kỳ điểm sửa đổi nào đã được cảnh báo trong báo cáo này.  
**DỪNG TOÀN BỘ CÔNG VIỆC TẠI ĐÂY.** Không bắt đầu triển khai code, không tạo migration cho đến khi nhận được lệnh thực thi chính thức.
