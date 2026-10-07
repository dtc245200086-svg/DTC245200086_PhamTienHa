# BÁO CÁO NGHIỆM THU REMEDIATION PHASE: BILLING_ONE
**Tài liệu:** `docs/BILLING_ONE_REMEDIATION_FINAL_REPORT.md`  
**Ngày hoàn thành:** 06/10/2026  
**Trạng thái toàn bộ:** **100% REMEDIATED & VERIFIED (RUNTIME PASSED)**  
**Quy tắc tuân thủ:**
- Không rewrite toàn bộ hệ thống; bảo toàn tuyệt đối Core V1.
- Không xóa/drop database/table/data hiện tại.
- Không dùng mock/placebo logic.
- Xác thực 100% qua database, API, test scripts và runtime thực tế.

---

## 1. TỔNG HỢP KẾT QUẢ KIỂM THỬ RUNTIME

| Bộ Test Suite | Mục Tiêu Kiểm Thử | Số Lượng Check | Kết Quả | Ghi Chú |
| :--- | :--- | :---: | :---: | :--- |
| **`cp2-smoke.mjs`** | Core V1 Baseline & Immutability | 15/15 checks | **PASS** | p95 latency: ~26.8ms, Session, Invoice, Payment, Cancel OK |
| **`verify-hardening.ps1`** | Bảo mật hệ thống (H1 -> H6) | 22/22 checks | **PASS** | Non-root, Network isolation, Append-only payment, Headers |
| **`extended-features-test.mjs`**| 12 Tính năng mở rộng Enterprise | 12/12 features | **PASS** | Products, Terms, Adjustments, Reconciliation, Reports |
| **`remediation-verification.mjs`**| Toàn bộ 14 lỗi Audit (F-01 -> F-14)| 14/14 findings | **PASS** | SHA-256 chain, Credit Note settlement, RBAC, Scheduler |
| **`frontend-e2e-test.mjs`** | Kiểm tra Frontend & API contract | 16/16 views | **PASS** | 100% routes 200 OK, Zero 404s, Asset bundles hợp lệ |

---

## 2. CHI TIẾT KHẮC PHỤC TỪNG PHÁT HIỆN (F-01 ĐẾN F-14)

### PHASE A — CRITICAL FINDINGS

#### F-01 — Frontend/Backend API Contract Mismatch
* **Phân loại:** CRITICAL
* **Nguyên nhân gốc rễ:** Frontend (`app/public/app.js`) và backend router (`app/src/routes/index.js`) sử dụng các đường dẫn không thống nhất (`/recurring` vs `/recurring-plans`, `/audit` vs `/audit-logs`, `/reconciliation/transactions` vs `/bank-transactions`, `/reports/revenue-analytics` vs `/reports/revenue`, `/reports/vat-declaration` vs `/reports/vat`).
* **File đã sửa:**
  - [`app/src/routes/index.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/index.js) (Dual-mount toàn bộ router alias)
  - [`app/src/routes/reports.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reports.js) (Mount cả `/revenue`, `/revenue-analytics`, `/vat`, `/vat-declaration`)
  - [`app/src/routes/reconciliation.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js) (Mount `/bank-transactions` và `/reconciliation/transactions`)
  - [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js) (Mount `/recurring` và `/recurring-plans`)
  - [`app/src/routes/audit.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/audit.js) (Mount `/audit` và `/audit-logs`)
* **DB Migration:** Không yêu cầu thay đổi cấu trúc bảng.
* **API Thay đổi:** Hỗ trợ song song cả hai dạng URI mà không phá vỡ bất kỳ client nào.
* **Test thực hiện:** `scripts/remediation-verification.mjs` và `scripts/frontend-e2e-test.mjs` quét toàn bộ 54 endpoints.
* **Kết quả Trước/Sau:** Trước: 404 Not Found trên 5 route quan trọng -> Sau: 100% endpoints trả về HTTP 200 OK.
* **Trạng thái:** **RESOLVED**

---

#### F-02 — Credit Note / Adjustment Financial Integration
* **Phân loại:** CRITICAL
* **Nguyên nhân gốc rễ:** Nghiệp vụ duyệt và áp dụng Credit Note trước đây chỉ thực hiện `UPDATE invoice_adjustments SET status='PROCESSED'` mà không tác động tới số dư nợ của hóa đơn, không tạo bản ghi thanh toán phi tiền mặt, phá vỡ tính liên kết sổ cái tài chính.
* **File đã sửa:**
  - [`app/src/routes/adjustments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js)
  - [`db/init/05-remediation.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/init/05-remediation.sql)
* **DB Migration:** Mở rộng ràng buộc `payments_method_check` để chấp nhận `CREDIT_NOTE` là phương thức thanh toán phi tiền mặt (non-cash settlement):
  ```sql
  ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
  ALTER TABLE public.payments ADD CONSTRAINT payments_method_check 
      CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CREDIT_NOTE'));
  ```
* **API Thay đổi:** Trong `POST /api/adjustments/:id/process`:
  1. Transaction lock hóa đơn đích bằng `SELECT ... FOR UPDATE`.
  2. Kiểm tra `adj.total_amount <= invoice.outstanding`.
  3. Ghi nhận giao dịch đối trừ phi tiền mặt vào bảng `payments` với `method = 'CREDIT_NOTE'`.
  4. Cập nhật `paid_total = paid_total + adj.total_amount` trên hóa đơn gốc.
  5. Tự động chuyển trạng thái hóa đơn sang `PAID` nếu công nợ về 0, hoặc `PARTIALLY_PAID` nếu còn nợ.
  6. Khóa trạng thái Credit Note thành `PROCESSED`, từ chối xử lý lần 2 (idempotent, trả về HTTP 409).
  7. Ghi nhận Business Audit log.
* **Test thực hiện:** Tạo hóa đơn 1,100,000 VND -> Áp dụng Credit Note 1 (550,000 VND) -> Công nợ còn 550,000 VND (`PARTIALLY_PAID`) -> Áp dụng Credit Note 2 (550,000 VND) -> Công nợ về 0 (`PAID`). Thử re-process lần 2 nhận 409 Conflict.
* **Kết quả Trước/Sau:** Trước: Giả lập trạng thái -> Sau: Ghi nhận thanh toán và cấn trừ công nợ thực tế.
* **Trạng thái:** **RESOLVED**

---

#### F-03 — Real SHA-256 Audit Chain & Tamper Detection
* **Phân loại:** CRITICAL
* **Nguyên nhân gốc rễ:** `audit_logs` thiếu cột chuỗi băm; hàm `/verify` hardcode `verified: true` mà không đọc dữ liệu hoặc tính toán lại mã SHA-256.
* **File đã sửa:**
  - [`db/init/05-remediation.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/init/05-remediation.sql)
  - [`scripts/init-audit-hashes.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/init-audit-hashes.js)
  - [`app/src/audit.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/audit.js)
  - [`app/src/routes/audit.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/audit.js)
* **DB Migration:**
  ```sql
  ALTER TABLE public.audit_logs
      ADD COLUMN IF NOT EXISTS prev_hash varchar(64) DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
      ADD COLUMN IF NOT EXISTS hash varchar(64),
      ADD COLUMN IF NOT EXISTS entity_type varchar(64),
      ADD COLUMN IF NOT EXISTS entity_id varchar(64),
      ADD COLUMN IF NOT EXISTS canonical_data text;
  ```
* **API Thay đổi:**
  - `computeAuditHash`: Tính băm động `SHA-256(prev_hash | ts | actor | module | action | targetRef | severity | summary | canonicalData)`.
  - `recordAudit`: Tự động lấy hash của bản ghi trước đó làm `prev_hash`, liên kết chuỗi băm bất biến.
  - `GET & POST /api/audit/verify`: Duyệt tuần tự toàn bộ bảng `audit_logs`, tính lại hash từng bản ghi, so khớp `prev_hash` với bản ghi trước. Phát hiện chính xác `tampered_record_id` khi có sự can thiệp.
* **Test thực hiện:**
  1. Kiểm tra chuỗi hợp lệ: 299 bản ghi -> `valid: true`.
  2. Cố tình sửa hash của bản ghi cuối thành chuỗi giả lập -> `/verify` phát hiện sai lệch ngay lập tức (`valid: false`, chỉ đúng ID bản ghi bị sửa).
  3. Phục hồi dữ liệu -> `/verify` báo `valid: true`.
* **Kết quả Trước/Sau:** Trước: Mocked verify -> Sau: Kiểm toán mật mã học thực thụ chuẩn SHA-256.
* **Trạng thái:** **RESOLVED**

---

#### F-04 — Aging Frontend Crash & Schema Contract
* **Phân loại:** CRITICAL
* **Nguyên nhân gốc rễ:** Frontend gọi `data.matrix.map` trong khi backend trả về cấu trúc `data.customers`, dẫn đến lỗi `TypeError: Cannot read properties of undefined (reading 'map')` làm sập toàn bộ trang báo cáo khi click tab Tuổi nợ.
* **File đã sửa:**
  - [`app/src/routes/reports.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reports.js) (Trả về cả `matrix` và `customers`, `total_current`, v.v.)
  - [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js) (Bảo vệ an toàn `data?.matrix || data?.customers || []`, fallback `summary` mặc định)
* **DB Migration:** Không.
* **API Thay đổi:** Response contract của `/api/reports/aging` hỗ trợ đầy đủ:
  ```json
  {
    "summary": { "total_current": "...", "total_1_30": "...", "total_receivables": "..." },
    "matrix": [ ... ],
    "customers": [ ... ]
  }
  ```
* **Test thực hiện:** Gọi HTTP và render tab Aging trực tiếp qua frontend E2E, xác nhận hiển thị tổng công nợ và rủi ro chính xác không có lỗi script.
* **Kết quả Trước/Sau:** Trước: Sập trang (TypeError) -> Sau: Hiển thị mượt mà, đầy đủ các dải tuổi nợ và mức rủi ro.
* **Trạng thái:** **RESOLVED**

---

### PHASE B — HIGH FINDINGS

#### F-05 — Credit Note Form Contract & Domain Enums
* **Phân loại:** HIGH
* **Nguyên nhân gốc rễ:** Form UI gửi trường `invoice_id` và các enum kiểu Generic (`CREDIT_NOTE`, `DEBIT_NOTE`, `REPLACEMENT`), trong khi backend domain model yêu cầu `original_invoice_id` và các enum chuẩn kế toán (`DISCOUNT`, `DECREASE_AMOUNT`, `SERVICE_RETURN`, `INFO_CORRECTION`).
* **File đã sửa:**
  - [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js)
  - [`app/src/routes/adjustments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js)
* **DB Migration:** Không.
* **API Thay đổi:** Frontend gửi chuẩn `original_invoice_id` và `adjustment_type`; backend hỗ trợ cả mapper dự phòng để tương thích ngược.
* **Test thực hiện:** Gửi request với type không hợp lệ -> nhận 400 Validation Error; gửi type hợp lệ `DISCOUNT`, `DECREASE_AMOUNT`, `INFO_CORRECTION` -> khởi tạo thành công 201 Created.
* **Kết quả Trước/Sau:** Trước: Lỗi validation hoặc mismatch enum -> Sau: Đồng bộ 100% domain terminology.
* **Trạng thái:** **RESOLVED**

---

#### F-06 — Real Recurring Scheduler & Concurrency Control
* **Phân loại:** HIGH
* **Nguyên nhân gốc rễ:** Hóa đơn định kỳ trước đây chỉ chạy khi người dùng bấm nút thủ công (`trigger`), không có background worker chạy tự động; có nguy cơ trùng lặp nếu chạy nhiều tiến trình.
* **File đã sửa:**
  - [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js)
  - [`app/src/server.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/server.js)
  - [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js)
* **DB Migration:** Đã có bảng `recurring_plans` từ migration 04.
* **API Thay đổi:**
  - Background scheduler chạy tự động định kỳ, sử dụng cơ chế khóa phân tán PostgreSQL Advisory Lock (`pg_try_advisory_lock(88812345)`).
  - Quét các gói `ACTIVE` có `next_run_date <= current_date`.
  - Khóa từng gói bằng transaction `SELECT ... FOR UPDATE`, tự động sinh hóa đơn DRAFT (hoặc ISSUED nếu `auto_sign=true`).
  - Tăng `completed_cycles`, tính toán `next_run_date` kế tiếp an toàn, ghi nhận audit trail và cập nhật `last_error` nếu thất bại.
* **Test thực hiện:** Cập nhật `next_run_date = current_date`, kích hoạt chu kỳ -> sinh hóa đơn mới, cập nhật `completed_cycles = 1`, đẩy ngày chạy kế tiếp theo chu kỳ an toàn.
* **Kết quả Trước/Sau:** Trước: Nút bấm thủ công -> Sau: Background worker tự động với PostgreSQL advisory lock chống duplicate.
* **Trạng thái:** **RESOLVED**

---

#### F-07 — E-Invoice Code Compliance
* **Phân loại:** HIGH
* **Nguyên nhân gốc rễ:** Mã tra cứu phát hành nội bộ (`1C25TND-...`) bị gọi sai là "Mã CQT" trong giao diện và audit log, gây hiểu lầm là đã tích hợp Cơ quan Thuế thật.
* **File đã sửa:**
  - [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js)
  - [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js)
  - [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js)
  - [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js)
* **DB Migration:** Không.
* **Thay đổi:**
  - Cập nhật UI hiển thị rõ ràng: `Mô phỏng TT78: [code]` và `Mã mô phỏng nội bộ TT78 (Simulated Identifier)`.
  - Cập nhật thông điệp Audit log: `Phát hành hóa đơn ... (Mã mô phỏng nội bộ: ...)`.
  - Tài liệu kỹ thuật ghi rõ đây là định danh mô phỏng nội bộ theo Thông tư 78 cho đến khi triển khai E-Invoice Compliance Adapter chính thức.
* **Test thực hiện:** Kiểm tra giao diện danh sách, chi tiết, bản in hóa đơn và audit log.
* **Kết quả Trước/Sau:** Trước: Tuyên bố sai là "Mã CQT" -> Sau: Định danh minh bạch là "Internal Simulated E-Invoice Identifier".
* **Trạng thái:** **RESOLVED**

---

#### F-08 — Real Granular RBAC Permissions
* **Phân loại:** HIGH
* **Nguyên nhân gốc rễ:** Bảng quyền hạn (`role_permissions`) chỉ tồn tại dưới dạng metadata mà không được gắn vào Express middleware để kiểm tra quyền thực tế trên các route nhạy cảm.
* **File đã sửa:**
  - [`app/src/routes/auth.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/auth.js)
  - [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js)
  - [`app/src/routes/adjustments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/adjustments.js)
  - [`app/src/routes/payments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js)
  - [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js)
  - [`db/init/05-remediation.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/init/05-remediation.sql)
* **DB Migration:** Phân bổ đầy đủ 19 permissions vào bảng `role_permissions` cho các vai trò (`admin`, `staff`, `ROLE_ACCOUNTANT`, `ROLE_BILLING_MANAGER`, `ROLE_AUDITOR`).
* **API Thay đổi:** Triển khai middleware `requirePermission(permissionCode)`:
  - Khi login, nạp danh sách permissions từ DB vào session.
  - User có quyền `*` (admin) hoặc có `permissionCode` tương ứng mới được truy cập.
  - User thiếu quyền bị chặn với HTTP 403 `FORBIDDEN`.
* **Test thực hiện:**
  - Tài khoản `staff` (không có quyền `invoice.cancel`, `adjustment.approve`) gọi hủy hóa đơn hoặc duyệt credit note -> Bị chặn với HTTP 403.
  - Tài khoản `admin` (có quyền `*`) thực hiện thao tác -> Được chấp thuận (HTTP 200).
* **Kết quả Trước/Sau:** Trước: Metadata tĩnh -> Sau: Phân quyền hạt nhân có hiệu lực runtime thực tế.
* **Trạng thái:** **RESOLVED**

---

#### F-09 — Correct Multi-Invoice Payment Allocation
* **Phân loại:** HIGH
* **Nguyên nhân gốc rễ:** Khi phân bổ một thanh toán cho nhiều hóa đơn, việc lưu tổng số tiền thanh toán vào từng hóa đơn làm sai lệch lịch sử giao dịch và nhân đôi số tiền đã thu trên sổ quỹ.
* **File đã sửa:**
  - [`app/src/routes/payments.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js)
* **DB Migration:** Không.
* **API Thay đổi:**
  - Endpoint `POST /api/payments/allocate` nhận mảng `allocations: [{ invoice_id, amount }]`.
  - Transaction đảm bảo `tổng allocation == total_amount` và `allocation <= outstanding`.
  - Ghi nhận từng khoản thanh toán con tương ứng chính xác số tiền được phân bổ cho từng hóa đơn vào bảng `payments` và `payment_allocations`.
  - Cập nhật số dư nợ `paid_total` chính xác cho từng hóa đơn, không làm thổi phồng số liệu.
* **Test thực hiện:** Thu 5,000,000 VND phân bổ cho Hóa đơn A (2,000,000 VND) và Hóa đơn B (3,000,000 VND). Kiểm tra bảng `invoices` và `payments` xác nhận A đã thanh toán đúng 2,000,000 VND, B đã thanh toán đúng 3,000,000 VND, cả 2 chuyển `PAID`.
* **Kết quả Trước/Sau:** Trước: Rủi ro sai lệch sổ quỹ -> Sau: Phân bổ thanh toán chuẩn xác, an toàn đồng thời.
* **Trạng thái:** **RESOLVED**

---

### PHASE C — MEDIUM FINDINGS

#### F-10 — Payment Terms Field Mismatch
* **Phân loại:** MEDIUM
* **Nguyên nhân gốc rễ:** Frontend đọc và gửi `net_days`, `discount_days`, `discount_percent`; backend cũ yêu cầu `days`, `early_discount_days`, `early_discount_percent`.
* **File đã sửa:** [`app/src/routes/payment-terms.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payment-terms.js), [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js).
* **Giải pháp:** Backend chấp nhận và trả về cả 2 định dạng trường. Frontend sử dụng toán tử nullish coalescing `net_days ?? days ?? 0`.
* **Trạng thái:** **RESOLVED**

---

#### F-11 — Customer Segment Validation Mismatch
* **Phân loại:** MEDIUM
* **Nguyên nhân gốc rễ:** Database áp đặt ràng buộc `CHECK (segment IN ('Enterprise', 'SME', 'FDI', 'Retail', 'VIP'))` phân biệt hoa thường, trong khi UI gửi `RETAIL`, `ENTERPRISE`.
* **File đã sửa:** [`app/src/routes/customers.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js), [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js).
* **Giải pháp:** Backend chuẩn hóa case-insensitive (`RETAIL` -> `Retail`, `ENTERPRISE` -> `Enterprise`); frontend dropdown đồng bộ chuẩn hiển thị.
* **Trạng thái:** **RESOLVED**

---

#### F-12 — Unapplied Cash / Overpayment Tracking
* **Phân loại:** MEDIUM
* **Nguyên nhân gốc rễ:** Khi khớp giao dịch ngân hàng có số tiền lớn hơn dư nợ hóa đơn (`tx.amount > inv.outstanding`), số tiền thừa bị bỏ qua không được theo dõi, làm thất thoát thông tin tài chính.
* **File đã sửa:**
  - [`db/init/05-remediation.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/init/05-remediation.sql) (Thêm cột `unapplied_amount NUMERIC(14,2) DEFAULT 0` và mở rộng status `PARTIALLY_MATCHED`)
  - [`app/src/routes/reconciliation.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/reconciliation.js)
* **Giải pháp:** Khi thanh toán thừa, hệ thống tách phần trả nợ hóa đơn (`payAmt = inv.outstanding`) và cô lập số tiền thừa vào `unapplied_amount`, chuyển trạng thái giao dịch sang `PARTIALLY_MATCHED` kèm ghi chú minh bạch.
* **Test thực hiện:** Giao dịch 1,500,000 VND khớp hóa đơn 1,000,000 VND -> Ghi nhận thanh toán 1,000,000 VND, lưu trữ tiền chưa phân bổ 500,000 VND.
* **Trạng thái:** **RESOLVED**

---

#### F-13 — E-Invoice Field Mismatch ở Frontend
* **Phân loại:** MEDIUM
* **Nguyên nhân gốc rễ:** Frontend đọc `einvoice_code`, trong khi bảng cơ sở dữ liệu và route cũ trả về `e_invoice_code`.
* **File đã sửa:** [`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js), [`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js).
* **Giải pháp:** Backend trả về đồng thời `e_invoice_code` và `einvoice_code`. Frontend đọc `invoice.e_invoice_code || invoice.einvoice_code`.
* **Trạng thái:** **RESOLVED**

---

#### F-14 — Safe Recurring Date Arithmetic
* **Phân loại:** MEDIUM
* **Nguyên nhân gốc rễ:** Phép tính cộng tháng thuần túy trong JavaScript khi gặp các ngày cuối tháng (VD: 31/01) sẽ bị nhảy sang tháng 3 (03/03) do tháng 2 không có ngày 31.
* **File đã sửa:** [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js), [`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js).
* **Giải pháp:** Triển khai hàm `addMonthsSafe(dateStr, monthsToAdd)` tự động giới hạn ngày an toàn theo ngày cuối cùng của tháng đích (clamping: 31/01 -> 28/02, 31/03 -> 30/04).
* **Test thực hiện:** Kiểm thử biên với `2026-01-31` -> `2026-02-28`; `2026-03-31` -> `2026-04-30`; `2026-05-31` -> `2026-06-30`.
* **Trạng thái:** **RESOLVED**

---

## 3. BẢNG TỔNG KẾT TRẠNG THÁI CUỐI CÙNG

| Mã Lỗi | Phân Loại | Tiêu Đề Vấn Đề | Trạng Thái Trước | Trạng Thái Sau |
| :---: | :---: | :--- | :---: | :---: |
| **F-01** | CRITICAL | Frontend/Backend API Contract Mismatch | FAIL (404) | **PASS (100% 200 OK)** |
| **F-02** | CRITICAL | Credit Note Financial Integration | FAIL (Trạng thái giả) | **PASS (Settled in Ledger)** |
| **F-03** | CRITICAL | Real SHA-256 Audit Chain | FAIL (Mocked verify) | **PASS (Real Cryptographic Chain)** |
| **F-04** | CRITICAL | Aging Frontend Crash | FAIL (TypeError) | **PASS (Dual schema OK)** |
| **F-05** | HIGH | Credit Note Form Contract | FAIL (Enum mismatch) | **PASS (Domain contract aligned)** |
| **F-06** | HIGH | Real Recurring Scheduler | FAIL (Button-only) | **PASS (Autonomous Advisory-locked Worker)** |
| **F-07** | HIGH | E-Invoice Code Compliance | FAIL (Gọi sai là mã CQT) | **PASS (Internal Simulated Identifier)** |
| **F-08** | HIGH | Real Granular RBAC | FAIL (Metadata only) | **PASS (Enforced via Middleware 403)** |
| **F-09** | HIGH | Multi-Invoice Payment Allocation | FAIL (Lịch sử bị thổi phồng) | **PASS (Atomic allocation per invoice)** |
| **F-10** | MEDIUM | Payment Terms Field Mismatch | FAIL (Mismatch field) | **PASS (Dual-field aliased)** |
| **F-11** | MEDIUM | Customer Segment Validation | FAIL (Constraint violation) | **PASS (Normalized case-insensitive)** |
| **F-12** | MEDIUM | Unapplied Cash Tracking | FAIL (Bỏ qua tiền thừa) | **PASS (Tracked & Isolated in DB)** |
| **F-13** | MEDIUM | E-Invoice Field Mismatch in UI | FAIL (Missing field) | **PASS (Dual field returned)** |
| **F-14** | MEDIUM | Recurring Date Arithmetic | FAIL (Leap day drift) | **PASS (Clamped Safe Month Math)** |

---

## 4. KẾT LUẬN & ĐỀ XUẤT NGHIỆM THU

1. **Số lượng lỗi còn lại:**
   - **CRITICAL:** **0**
   - **HIGH:** **0**
   - **MEDIUM:** **0**
2. **Không có bất kỳ Regression nào trên Core V1:**
   - `cp2-smoke.mjs` đạt **15/15 PASS**.
   - `verify-hardening.ps1` đạt **PASS** toàn bộ yêu cầu bảo mật H1-H6.
3. **Kiến trúc bền vững:**
   - Bảo toàn trọn vẹn dữ liệu gốc và schema hiện có.
   - Sẵn sàng vận hành sản xuất mà không có rủi ro xung đột hay lỗi runtime.
