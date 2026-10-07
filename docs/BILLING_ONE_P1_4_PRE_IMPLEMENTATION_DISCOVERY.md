# BILLING_ONE — P1.4 PRE-IMPLEMENTATION DISCOVERY REPORT
## OFFICIAL SCOPE DISCOVERY, ARCHITECTURAL REVIEW & CANDIDATE ANALYSIS
## PRE-IMPLEMENTATION DISCOVERY ONLY — ZERO IMPLEMENTATION

**Role:** Senior Product Architect + Financial Systems Analyst + Technical Lead  
**Discovery Target:** Official Scope Discovery, Gap Analysis, Technical Baseline & Candidate Architecture for P1.4  
**Discovery Date:** October 07, 2026  
**Baseline Commit (P1.3 Closed):** `d794de0461e992122a4c8eddadb1ead2082ae8ac` + P1.3 Closure Baseline  
**P1.3 Status:** `P1.3 OFFICIALLY CLOSED — VERIFIED` (per `docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md`)  
**Operational Mode:** STRICT DISCOVERY ONLY — Zero Code Modifications, Zero Schema Changes, Zero Migrations, Zero Test Data Deletion, Zero Implementation Commits  

---

## TABLE OF CONTENTS
- [A. EXECUTIVE SUMMARY](#a-executive-summary)
- [B. EXISTING P1.4 EVIDENCE](#b-existing-p14-evidence)
- [C. CURRENT SYSTEM BASELINE](#c-current-system-baseline)
- [D. CURRENT GAP ANALYSIS](#d-current-gap-analysis)
- [E. CANDIDATE P1.4 SCOPES](#e-candidate-p14-scopes)
- [F. DEPENDENCY ANALYSIS](#f-dependency-analysis)
- [G. FINANCIAL IMPACT ANALYSIS](#g-financial-impact-analysis)
- [H. ARCHITECTURAL IMPACT](#h-architectural-impact)
- [I. NOTIFICATION CAPABILITY CHECK](#i-notification-capability-check)
- [J. BUSINESS QUESTIONS / OPEN DECISIONS](#j-business-questions--open-decisions)
- [K. CANDIDATE SCOPE COMPARISON](#k-candidate-scope-comparison)
- [L. RECOMMENDED P1.4 DIRECTION](#l-recommended-p14-direction)
- [M. DRAFT ACCEPTANCE CRITERIA](#m-draft-acceptance-criteria)
- [N. IMPLEMENTATION RISKS](#n-implementation-risks)
- [O. DISCOVERY RECOMMENDATION](#o-discovery-recommendation)
- [P. FINAL VERDICT](#p-final-verdict)

---

## A. EXECUTIVE SUMMARY

1. **P1.3 is officially closed and verified:**
   Mốc P1.3 (Recurring Billing Auto-Settlement Engine) đã được kiểm chứng độc lập và chính thức đóng tại [BILLING_ONE_P1_3_FINAL_CLOSURE.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md). Toàn bộ 9 bất biến tài chính đạt trạng thái bảo vệ tuyệt đối (0 vi phạm), chuỗi băm SHA-256 đạt tính toàn vẹn 100%, và 12/12 test suites đạt PASS. Mốc P1.3 là nền tảng đóng băng (frozen baseline), không được mở lại hay tái cấu trúc.

2. **P1.4 chưa từng được đóng băng phạm vi (Not Formally Scope-Frozen):**
   Giai đoạn P1.4 chưa có tài liệu đặc tả chính thức (Official Specification), chưa có BRD phê duyệt, và chưa có thỏa thuận ranh giới kỹ thuật nào được thiết lập giữa Product Owner và đội ngũ phát triển.

3. **Tài liệu hiện hữu không cung cấp đặc tả P1.4 đầy đủ:**
   Kho tài liệu dự án hiện không chứa bất kỳ đặc tả kỹ thuật, luồng nghiệp vụ (user story), hoặc quy tắc tính toán chi tiết nào cho P1.4. Không có bảng dữ liệu dunning, không có sơ đồ trạng thái thu hồi nợ chính thức, và không có tiêu chuẩn nghiệm thu nào đã được định nghĩa.

4. **"Automated Dunning & Debt Recovery" chỉ là nhãn định hướng ứng viên:**
   Thuật ngữ *"P1.4 — Automated Dunning & Debt Recovery"* chỉ xuất hiện **duy nhất một lần** trong toàn bộ kho tài liệu của dự án — tại mục "Giới hạn Phạm vi Tuyệt đối (Absolute Out-of-Scope)" của `docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md` (dòng 29: *"Không mở rộng sang P1.4 (Automated Dunning & Debt Recovery)"*). Đây là một nhãn định hướng tham chiếu (directional candidate label), tuyệt đối không được tự động suy diễn thành một phạm vi bắt buộc hay một đặc tả đã hoàn chỉnh.

5. **Discovery là bắt buộc trước khi đóng băng phạm vi:**
   Theo nguyên tắc bất biến của dự án: *"KHÔNG tự suy đoán phạm vi từ tên phase. Không tự bịa ra đặc tả khi tài liệu gốc không có"*. Báo cáo Discovery này tiến hành kiểm tra thực tế mã nguồn, cơ sở dữ liệu, kiến trúc hạ tầng và các tài liệu liên quan nhằm làm rõ các khoảng cách (gaps), đánh giá khả thi kỹ thuật, và đề xuất các phương án phạm vi để Product Owner xem xét trước khi tiến hành Scope Freeze.

---

## B. EXISTING P1.4 EVIDENCE

Rà soát pháp y toàn bộ kho mã nguồn, migrations, tests và tài liệu đối chiếu dự án với các từ khóa chuyên môn:

| Từ khóa / Khái niệm | Nguồn Bằng chứng (Source File & Line) | Mô tả Tính năng & Tham chiếu | Trạng thái Thực tế | Phân loại Trạng thái |
|---|---|---|---|---|
| **P1.4** | `docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md:L29` | Giới hạn ngoài của P1.3: *"Không mở rộng sang P1.4 (Automated Dunning & Debt Recovery)"*. | Chỉ là nhãn loại trừ phạm vi ngoài P1.3. Không có đặc tả chi tiết. | **MISSING** (Spec không tồn tại) |
| **Dunning** | `_reference/LedgerFlow/src/components/views/AgingReportView.tsx:L128` | Nút bấm giao diện: *"Nhắc nợ hàng loạt (Dunning)"*. | Mock UI ở hệ thống tham chiếu. Không có backend xử lý. | **MISSING** trong Billing_One |
| **Dunning** | `_reference/LedgerFlow/src/App.tsx:L407-426` | Hàm `handleSendReminder`: hiển thị Toast thông báo và tạo bản ghi giả lập trong state `auditLogs` với actor `'Dunning Bot'`. | Mock client-side thuần túy, không có database, không có email/SMS backend. | **MISSING** trong Billing_One |
| **Debt Recovery** | `docs/BILLING_ONE_P1_3_FINAL_CLOSURE.md:L29` | Nằm trong tên gọi định hướng của phase ("Automated Dunning & Debt Recovery"). | Không có bất kỳ mô tả quy trình, bảng dữ liệu, hay API nào trong hệ thống. | **MISSING** |
| **Overdue (Tính toán động)** | `app/src/routes/reports.js:L15,L82` | `GET /api/reports/aging` và `GET /api/reports/collection-metrics`: Tính toán nợ quá hạn động bằng SQL `due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID')`. | Đã hoạt động trong phân hệ báo cáo, nhưng chỉ là tính toán tại thời điểm truy vấn (dynamic calculation). | **IMPLEMENTED** (Báo cáo động) |
| **Overdue (Trạng thái hóa đơn)** | `db/init/01-schema.sql:L26-27` | Ràng buộc: `CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'))`. | Cột `status` trong DB hoàn toàn KHÔNG có giá trị `'OVERDUE'`. | **MISSING** (Chưa có trong DB/FSM) |
| **Overdue (FSM Đề xuất)** | `docs/FUTURE_SYSTEM_EVOLUTION_PROPOSAL.md:L344-348` | Sơ đồ FSM đề xuất: `ISSUED --> OVERDUE` và `PARTIALLY_PAID --> OVERDUE` khi quá `due_date`. | Đề xuất kiến trúc tương lai, chưa từng được hiện thực hóa vào schema hay code. | **PLANNED** (Đề xuất tương lai) |
| **Collection Metrics** | `app/src/routes/reports.js:L75-118` | `GET /api/reports/collection-metrics`: Tính toán DSO, CEI, overdue_total, overdue_ratio_percent. | Đã triển khai đầy đủ backend API và phục vụ dashboard. | **IMPLEMENTED** |
| **Reminder** | `_reference/LedgerFlow/src/components/views/InvoicesView.tsx:L10,L797` | Nút thao tác `onSendReminder(inv)` trên từng dòng hóa đơn. | Client-side mock handler, chỉ trigger toast trình duyệt. | **MISSING** trong Billing_One |
| **Escalation** | Toàn bộ repository và docs | Không có tài liệu hoặc mã nguồn nào đề cập đến cấp bậc leo thang nhắc nợ (Escalation levels). | Hoàn toàn chưa được thiết kế. | **MISSING** |
| **Notification** | `AGENT_MASTER_INSTRUCTIONS.md:L212` | Liệt kê mục *"Automation: Notifications"* trong danh mục phân hệ của hệ thống. | Ý niệm kiến trúc tổng thể; không có mã nguồn, thư viện gửi tin, hay cấu hình nhà cung cấp. | **MISSING** (Hạ tầng không tồn tại) |
| **Aging Analysis** | `app/src/routes/reports.js:L10-72` | `GET /api/reports/aging`: 5 nhóm tuổi nợ (Current, 1-30d, 31-60d, 61-90d, 90+d) và ma trận rủi ro theo khách hàng. | Đã triển khai hoàn chỉnh theo chuẩn tài chính. | **IMPLEMENTED** |
| **Credit Limit** | `db/init/04-evolution.sql:L14`, `app/src/routes/customers.js:L36,L70` | Cột `customers.credit_limit numeric(14,2)`, tính toán `available_credit = credit_limit - current_debt`. | Đã lưu trữ và tính toán trên hồ sơ khách hàng, nhưng chưa có logic cưỡng chế chặn phát hành hóa đơn. | **PARTIAL** |
| **Customer Warning** | `db/init/04-evolution.sql:L24`, `app/src/routes/customers.js:L19` | Ràng buộc: `CHECK (status IN ('ACTIVE', 'WARNING', 'LOCKED'))`. Giá trị `'WARNING'` được hỗ trợ. | Có enum trong DB, nhưng chỉ cập nhật thủ công qua `PUT /api/customers/:id`. Không có automation. | **PARTIAL** |
| **Customer Locked** | `db/init/04-evolution.sql:L24`, `app/src/routes/customers.js:L19` | Giá trị `'LOCKED'` được hỗ trợ trong DB. | Có enum trong DB, nhưng chỉ set thủ công. Chưa có scheduler tự động khóa, chưa có logic chặn `POST /invoices/:id/issue`. | **PARTIAL** |
| **Write-off (Xóa nợ xấu)** | `docs/BILLING_ONE_DEEP_ARCHITECTURE_AUDIT.md:L514` | Cảnh báo FIND-04 về việc giao dịch ngân hàng không được phép bị lợi dụng để "xóa nợ giả tạo". | Không có sổ cái nợ xấu, không có endpoint ghi giảm nợ không thể thu hồi. | **MISSING** |

---

## C. CURRENT SYSTEM BASELINE

Khảo sát chi tiết hiện trạng mã nguồn và cơ sở dữ liệu Billing_One tại điểm mốc Baseline hiện tại:

### 1. Invoices (Hóa đơn)
- **Status Values:**
  Ràng buộc tại `db/init/01-schema.sql` dòng 26-27 và `app/src/routes/invoices.js` dòng 20:
  `CHECK (status IN ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'))`.
  Trạng thái `'OVERDUE'` **hoàn toàn không có mặt**.
- **due_date:**
  Cột `due_date date NOT NULL` bắt buộc trên bảng `invoices`. Ràng buộc `CHECK (issue_date IS NULL OR due_date >= issue_date)`.
- **paid_total & adjusted_total:**
  - `paid_total numeric(14,2) NOT NULL DEFAULT 0 CHECK (paid_total >= 0 AND paid_total <= total)`.
  - `adjusted_total numeric(14,2) NOT NULL DEFAULT 0` (được thêm từ Migration 01 - P0).
  - Ràng buộc tổng hợp: `CHECK (paid_total >= 0 AND adjusted_total >= 0 AND (paid_total + adjusted_total) <= total)`.
- **Invoice Lifecycle:**
  `DRAFT` $\xrightarrow{\text{issue}}$ `ISSUED` $\xrightarrow{\text{allocate}}$ `PARTIALLY_PAID` / `PAID`.
  `DRAFT`/`ISSUED` $\xrightarrow{\text{cancel}}$ `CANCELLED` (chỉ khi `paid_total = 0`).
  Không có sự kiện chuyển đổi trạng thái tự động dựa trên thời gian (`due_date`).

### 2. Customers (Khách hàng)
- **Status:**
  `customers.status varchar(24) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WARNING', 'LOCKED'))`.
- **credit_limit:**
  `customers.credit_limit numeric(14,2) DEFAULT 0`.
- **Financial Profile:**
  `GET /api/customers/:id` trả về `profile`, `recent_invoices`, `recent_payments`.
- **Current Debt Calculation:**
  Được tính động qua câu lệnh SQL trong `app/src/routes/customers.js` (dòng 68-71, 151-154):
  ```sql
  coalesce((SELECT sum(total - paid_total - adjusted_total) 
            FROM public.invoices 
            WHERE customer_id = c.id 
              AND status IN ('ISSUED', 'PARTIALLY_PAID')), 0) AS current_debt
  ```
  *(Lưu ý cực kỳ quan trọng: Query này hardcode `status IN ('ISSUED', 'PARTIALLY_PAID')`!)*

### 3. Reporting (Báo cáo & Phân tích)
- **Aging Analysis:**
  `GET /api/reports/aging` nhóm 5 bucket: Current ($due\_date \ge current\_date$), 1–30d, 31–60d, 61–90d, >90d. Gán `risk_level` (LOW, WARNING, CRITICAL).
- **Overdue Calculations:**
  Tính toán động tại thời điểm truy vấn: `due_date < current_date AND status IN ('ISSUED', 'PARTIALLY_PAID')`.
- **DSO & CEI:**
  `GET /api/reports/collection-metrics` tính:
  - $DSO = \frac{\text{Receivables}}{\text{Sales}_{90d}} \times 90$
  - $CEI = \frac{\text{Collected}_{90d}}{\text{Receivables} + \text{Sales}_{90d}} \times 100$
  - `overdue_ratio_percent` = tỷ lệ nợ quá hạn trên tổng phải thu.

### 4. Scheduler (Tiến trình Định kỳ)
- **Chu kỳ & Engine:**
  `app/src/scheduler.js`: hàm `startScheduler()` chạy mỗi 60 giây, gọi `runRecurringCycle(pool)`.
- **Advisory Locks:**
  Sử dụng khóa cố vấn PostgreSQL `pg_try_advisory_lock(88812345)` (`SCHEDULER_LOCK_ID`). Trả về `{ skipped: true, reason: 'LOCKED' }` nếu chu kỳ trước đang thực thi.
- **Tác vụ hiện tại:**
  Chỉ xử lý sinh hóa đơn định kỳ (`recurring_plans`) và tự động cấn trừ số dư chưa phân bổ (`auto_settle_unapplied`) theo P1.3. Không có bất kỳ tác vụ nào quét nợ quá hạn.

### 5. Payments (Thanh toán & Phân bổ)
- **Payment Allocation V2:**
  Bảng `public.payment_allocations` lưu trữ quan hệ phân bổ $1:N$.
- **Unapplied Cash:**
  Tiền mặt chưa phân bổ được quản lý độc lập tại mức khách hàng, hỗ trợ tự động tất toán qua P1.3 engine.
- **Idempotency & Concurrency:**
  Bảng `public.payment_idempotency_keys` lưu khóa và request hash SHA-256. Tuân thủ giao thức khóa Canonical Lock Hierarchy (Level 0 $\rightarrow$ Level 3).

### 6. Audit (Kiểm toán Bất biến)
- **Chuỗi băm SHA-256:**
  Bảng `public.audit_logs` liên kết dạng chuỗi khối qua `prev_hash` và `curr_hash`.
- **Sự kiện kiểm toán:**
  Ghi nhận đầy đủ thông tin WHO, WHAT, WHEN, WHERE, metadata chi tiết cho các hành động phát hành hóa đơn, thanh toán, hủy hóa đơn, phân bổ.

### 7. RBAC (Phân quyền Vai trò)
- **Quyền hiện hành (`app/src/routes/auth.js`):**
  `DEFAULT_STAFF_PERMISSIONS`: `invoice.create`, `invoice.read`, `invoice.update`, `invoice.issue`, `customer.create`, `customer.read`, `customer.update`, `payment.create`, `payment.read`, `adjustment.create`, `product.manage`, `report.view`.
- **Đánh giá liên quan đến thu hồi nợ:**
  Chỉ có quyền xem báo cáo (`report.view`) và sửa khách hàng (`customer.update`). **Hoàn toàn chưa có quyền** dành riêng cho quản trị chính sách nhắc nợ, kích hoạt dunning, mở khóa khách hàng (unlock override), hay xóa nợ.

### 8. Notifications (Thông báo)
- **Khảo sát:**
  Kiểm tra `app/package.json` và mã nguồn trong `app/src/`:
  - Thư viện email (nodemailer, sendgrid, mailgun...): **0**
  - Cấu hình SMTP / Mail service: **0**
  - Tích hợp SMS (Twilio, VietGuys...): **0**
  - Webhook service / Webhook dispatcher: **0**
  - Hàng đợi thông báo (Notification queue / Redis BullMQ): **0**
  - Bảng lưu trữ mẫu tin (templates) hoặc nhật ký gửi tin: **0**

---

## D. CURRENT GAP ANALYSIS

Bảng đánh giá khoảng cách chi tiết đối với 14 thành phần cốt lõi của bài toán Quản lý Nợ & Nhắc nợ:

| STT | Thành phần Nghiệp vụ & Kỹ thuật | Trạng thái Hiện tại | Chi tiết Khoảng cách (Gap Details) |
|:---:|---|:---:|---|
| **1** | **Vòng đời hóa đơn OVERDUE chính thức (Formal OVERDUE lifecycle)** | **MISSING** | DB check constraint từ chối giá trị `'OVERDUE'`. `invoices.js` và `paymentService.js` chưa có logic hỗ trợ chuyển trạng thái hay nhận thanh toán khi hóa đơn ở trạng thái OVERDUE. |
| **2** | **Phát hiện quá hạn (Overdue detection)** | **PARTIALLY EXISTS** | Có query tính toán động trong API báo cáo (`reports.js`), nhưng chưa có engine định kỳ quét và đồng bộ hóa trạng thái lưu trữ trong cơ sở dữ liệu. |
| **3** | **Cấu hình chính sách nhắc nợ (Dunning policy configuration)** | **MISSING** | Chưa có bảng cấu hình chính sách (ngưỡng số ngày quá hạn, hành động tương ứng, mức độ cảnh báo). Không có API CRUD chính sách. |
| **4** | **Lịch nhắc nợ (Reminder schedule)** | **MISSING** | Chưa có cơ chế lập lịch theo mốc (ví dụ: ngày quá hạn thứ 3, 7, 15, 30). |
| **5** | **Nhật ký & Lịch sử nhắc nợ (Dunning events/history)** | **MISSING** | Chưa có bảng `dunning_events` để ghi lại lịch sử các lần kích hoạt nhắc nợ theo từng hóa đơn và khách hàng. |
| **6** | **Hạ tầng gửi thông báo (Notification dispatch)** | **MISSING** | Không có dịch vụ gửi Email, SMS, Webhook hay hàng đợi tin nhắn trong toàn bộ hệ thống. |
| **7** | **Cấp bậc leo thang nhắc nợ (Escalation levels)** | **MISSING** | Chưa có định nghĩa logic phân cấp: Nhắc nhở mềm (Soft Reminder) $\rightarrow$ Cảnh báo tài chính (Warning) $\rightarrow$ Khóa giao dịch (Lock) $\rightarrow$ Pháp lý (Legal/Collection). |
| **8** | **Tự động hóa cảnh báo/khóa khách hàng (Customer warning/locking)** | **PARTIALLY EXISTS** | Trường `customers.status` hỗ trợ `ACTIVE/WARNING/LOCKED`, nhưng hiện tại 100% là thao tác thủ công qua API cập nhật khách hàng; không có cơ chế tự động chuyển trạng thái theo nợ quá hạn. |
| **9** | **Quy trình thu hồi nợ chuyên sâu (Debt recovery workflow)** | **MISSING** | Chưa có luồng quản lý hồ sơ công nợ khó đòi (Case management), giao việc cho nhân viên thu nợ, hoặc bàn giao đơn vị thu hồi nợ ngoài. |
| **10** | **Quy trình xóa nợ xấu (Write-off workflow)** | **MISSING** | Chưa có cơ chế hạch toán xóa nợ không thể thu hồi, thiếu quy trình phê duyệt (approval chain) và sổ cái hạch toán chi phí nợ khó đòi. |
| **11** | **Quản lý hồ sơ thu nợ (Collection case management)** | **MISSING** | Chưa có khái niệm hồ sơ vụ việc thu nợ (Collection Case), ghi nhận cam kết thanh toán (Promise to Pay - PTP), hoặc theo dõi tranh chấp công nợ (Dispute). |
| **12** | **Khả năng kiểm toán (Auditability)** | **ALREADY EXISTS** | Hạ tầng `public.audit_logs` với chuỗi băm SHA-256 đã hoàn thiện và sẵn sàng ghi nhận các mã hành động mới liên quan đến dunning và overdue. |
| **13** | **Tính lũy kế / Chống trùng lặp (Idempotency)** | **ALREADY EXISTS** | Hạ tầng `payment_idempotency_keys` và cơ chế khóa Advisory Lock đã hoàn chỉnh, có thể tái sử dụng mô hình để đảm bảo các chu kỳ dunning không bị thực thi lặp. |
| **14** | **Tiến trình tự động hóa định kỳ (Scheduler automation)** | **PARTIALLY EXISTS** | Module `app/src/scheduler.js` đã có cơ chế chạy vòng lặp an toàn và chống xung đột bằng Advisory Lock, nhưng hiện chỉ phục vụ Recurring Billing P1.3, chưa có job cho Overdue/Dunning. |

---

## E. CANDIDATE P1.4 SCOPES

Phân tích độc lập 4 kịch bản phạm vi ứng viên (Candidate Scopes), tuyệt đối không gộp chung một cách cơ học:

### 1. CANDIDATE A — AUTOMATED OVERDUE INVOICE LIFECYCLE
*Tự động hóa Vòng đời Trạng thái Hóa đơn Quá hạn.*

- **Mục tiêu:** Đưa `OVERDUE` trở thành trạng thái chính thức được quản lý trong cơ sở dữ liệu và vòng đời hóa đơn (FSM). Tự động chuyển các hóa đơn chưa tất toán sang `OVERDUE` khi vượt quá `due_date`.
- **Giá trị nghiệp vụ:** Đảm bảo tính nhất quán dữ liệu trạng thái trên toàn hệ thống; cho phép lọc, tìm kiếm, xuất báo cáo và giám sát hóa đơn quá hạn với hiệu năng cao bằng index; kích hoạt các luồng nghiệp vụ tiếp theo một cách minh bạch.
- **Dependencies hiện tại:** P0 (bất biến tài chính), P1.2 (cơ chế phân bổ thanh toán V2).
- **Thành phần hiện có tái sử dụng:** `app/src/scheduler.js` (engine chạy định kỳ), `invoices` table, `public.audit_logs` (`recordAudit()`).
- **Thành phần mới cần xây dựng:** Job `runOverdueScan()` trong scheduler; migration cập nhật check constraint của bảng `invoices`; cập nhật validator trong `invoices.js`.
- **Database impact:** 
  - Cập nhật constraint `invoices_status_check` thêm `'OVERDUE'`.
  - Thêm composite index: `idx_invoices_overdue_scan ON invoices (status, due_date) WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`.
- **API impact:** 
  - `GET /api/invoices`: Hỗ trợ filter `status=OVERDUE`.
  - Review `paymentService.js`: Cho phép nhận thanh toán cho hóa đơn có trạng thái `OVERDUE` (tự động chuyển thành `PAID` hoặc `PARTIALLY_PAID` sau khi nhận tiền).
- **Scheduler impact:** Thêm tác vụ quét hàng ngày chạy trong scheduler. Yêu cầu dùng Advisory Lock riêng biệt.
- **Frontend impact:** Thêm tab bộ lọc "Quá hạn" (OVERDUE) và huy hiệu cảnh báo (badge màu đỏ) trên danh sách và chi tiết hóa đơn.
- **Notification impact:** Không yêu cầu hạ tầng gửi thông báo bên ngoài.
- **Financial impact:** Thay đổi trường `status` trên hóa đơn. **Không thay đổi** bất kỳ trường số tiền nào (`total`, `paid_total`, `adjusted_total`). Bất biến tài chính giữ nguyên 100%.
- **Security / RBAC impact:** Không yêu cầu quyền mới; kế toán viên có quyền xem hóa đơn hiện tại có thể xem trạng thái OVERDUE.
- **Audit requirements:** Ghi audit log `INVOICE_OVERDUE_FLAGGED` khi hóa đơn chuyển sang OVERDUE (kèm `days_overdue`, `outstanding_amount`).
- **Concurrency / Idempotency requirements:** Job quét phải dùng câu lệnh cập nhật an toàn: `UPDATE invoices SET status = 'OVERDUE' WHERE status IN ('ISSUED', 'PARTIALLY_PAID') AND due_date < CURRENT_DATE AND (total - paid_total - adjusted_total) > 0`. Chạy lặp lại không làm sai lệch dữ liệu.
- **Độ phức tạp:** Thấp - Trung bình.
- **Rủi ro chính:** Nếu không sửa `paymentService.js` (dòng 376 và 571 đang từ chối hóa đơn khác `ISSUED` và `PARTIALLY_PAID`), các hóa đơn bị gắn mác `OVERDUE` sẽ bị chặn không thể thanh toán!
- **Phân loại đề xuất:** **CORE SCOPE (Bắt buộc phải có làm nền tảng).**

---

### 2. CANDIDATE B — DUNNING POLICY + SCHEDULED REMINDERS
*Quản lý Chính sách Nhắc nợ & Ghi nhận Sự kiện Nhắc nợ Tự động.*

- **Mục tiêu:** Cấu hình các mốc thời gian nhắc nợ theo chính sách doanh nghiệp (ví dụ: Quá hạn 3 ngày, 7 ngày, 15 ngày, 30 ngày) và tự động ghi nhận các sự kiện nhắc nợ (Dunning Events) nội bộ vào cơ sở dữ liệu.
- **Giá trị nghiệp vụ:** Chuẩn hóa quy trình xử lý nợ quá hạn; lưu vết lịch sử đôn đốc thu hồi nợ của doanh nghiệp; cung cấp danh sách công việc cần xử lý cho bộ phận kế toán công nợ.
- **Dependencies hiện tại:** Bắt buộc phụ thuộc Candidate A (hóa đơn phải có trạng thái OVERDUE).
- **Thành phần hiện có tái sử dụng:** Hệ thống Scheduler, bảng `audit_logs`.
- **Thành phần mới cần xây dựng:** Bảng `dunning_policies`, bảng `dunning_events`, service `dunningService.js`, các API quản trị chính sách và xem lịch sử nhắc nợ.
- **Database impact:** Tạo 2 bảng mới `dunning_policies` và `dunning_events` cùng các chỉ mục tương ứng; ràng buộc UNIQUE chống ghi nhận trùng lặp sự kiện cho cùng một hóa đơn ở cùng một mốc nhắc nợ.
- **API impact:** 
  - `GET /api/dunning/policies`, `POST /api/dunning/policies`, `PUT /api/dunning/policies/:id` (Quản trị chính sách).
  - `GET /api/dunning/events` (Tra cứu lịch sử nhắc nợ).
  - `GET /api/invoices/:id/dunning-history` (Lịch sử nhắc nợ theo hóa đơn).
- **Scheduler impact:** Thêm tác vụ `runDunningCycle()` chạy định kỳ sau khi `runOverdueScan()` hoàn tất.
- **Frontend impact:** Màn hình cấu hình Chính sách Nhắc nợ; Tab hiển thị Lịch sử đôn đốc nợ trong trang chi tiết hóa đơn.
- **Notification impact:** Do Billing_One chưa có hạ tầng gửi tin, các sự kiện dunning ở Candidate B **chỉ được ghi nhận trong nội bộ hệ thống (Internal Audit / Action Log)**, hiển thị danh sách để kế toán liên hệ thủ công, KHÔNG tự động bắn email/SMS.
- **Financial impact:** Không thay đổi số tiền hay công nợ. Hoàn toàn là nghiệp vụ phi tài chính (non-financial operational tracking).
- **Security / RBAC impact:** Thêm quyền mới: `dunning.manage` (quản trị chính sách), `dunning.view` (xem lịch sử).
- **Audit requirements:** Ghi audit log khi thay đổi chính sách dunning và khi chu kỳ nhắc nợ sinh sự kiện mới.
- **Concurrency / Idempotency requirements:** Unique constraint `(invoice_id, policy_id)` hoặc `(invoice_id, days_threshold)` để chống sinh nhiều bản ghi nhắc nợ lặp trong cùng một chu kỳ.
- **Độ phức tạp:** Trung bình.
- **Rủi ro chính:** Người dùng có thể hiểu lầm rằng hệ thống "đã gửi email cho khách hàng" dù thực tế hệ thống chỉ mới ghi nhận sự kiện vào database do thiếu Notification Provider.
- **Phân loại đề xuất:** **STAGED OPTION (Có thể triển khai sau Candidate A nếu chấp nhận giới hạn internal tracking).**

---

### 3. CANDIDATE C — CUSTOMER DEBT STATUS AUTO-MANAGEMENT
*Tự động hóa Đồng bộ Trạng thái Rủi ro Khách hàng (WARNING / LOCKED).*

- **Mục tiêu:** Tự động đánh giá tổng công nợ quá hạn và số ngày trễ hạn lớn nhất của khách hàng để chuyển trạng thái `customers.status` từ `ACTIVE` $\rightarrow$ `WARNING` $\rightarrow$ `LOCKED`, đồng thời cưỡng chế chặn phát hành hóa đơn mới đối với khách hàng bị `LOCKED`.
- **Giá trị nghiệp vụ:** Kiểm soát rủi ro tín dụng tức thời; ngăn chặn việc tiếp tục cung cấp hàng hóa/dịch vụ cho các khách hàng có nợ xấu chây ỳ; giải phóng nhân sự kế toán khỏi việc kiểm tra thủ công từng khách hàng.
- **Dependencies hiện tại:** Candidate A (để xác định chính xác các hóa đơn OVERDUE).
- **Thành phần hiện có tái sử dụng:** Bảng `customers`, cột `status`, `credit_limit`. Endpoint `POST /api/invoices/:id/issue`.
- **Thành phần mới cần xây dựng:** Scheduler job `runCustomerDebtSync()`; logic kiểm tra trạng thái khách hàng tại endpoint phát hành hóa đơn (`POST /api/invoices/:id/issue`); endpoint mở khóa thủ công cho quản trị viên (`POST /api/customers/:id/override-status`).
- **Database impact:** Không cần đổi cấu trúc bảng `customers` (đã có đủ `ACTIVE, WARNING, LOCKED`). Có thể bổ sung bảng log chuyển trạng thái khách hàng `customer_status_history`.
- **API impact:** 
  - `POST /api/invoices/:id/issue`: Thêm điều kiện chặn nếu `customer.status === 'LOCKED'` (trả về lỗi HTTP 409 `CUSTOMER_IS_LOCKED`).
  - `POST /api/customers/:id/override-status`: Cho phép Admin can thiệp cưỡng chế mở khóa có ghi nhận lý do kiểm toán.
- **Scheduler impact:** Thêm tác vụ đồng bộ trạng thái khách hàng chạy định kỳ (sau khi quét nợ quá hạn).
- **Frontend impact:** Cảnh báo trực quan trên giao diện khi khách hàng ở trạng thái WARNING/LOCKED; chặn nút bấm phát hành hóa đơn mới kèm giải thích nguyên nhân.
- **Notification impact:** Không yêu cầu.
- **Financial impact:** Gián tiếp ngăn chặn rủi ro tăng trưởng công nợ xấu. Không trực tiếp thay đổi số dư tiền tệ.
- **Security / RBAC impact:** Yêu cầu quyền quản trị viên đặc biệt để mở khóa khách hàng bị `LOCKED` (`customer.override_lock`).
- **Audit requirements:** Bắt buộc ghi audit log chi tiết khi hệ thống tự động khóa khách hàng (`CUSTOMER_AUTO_LOCKED`) hoặc khi Admin mở khóa thủ công (`CUSTOMER_MANUAL_UNLOCKED`).
- **Concurrency / Idempotency requirements:** Quét và cập nhật trạng thái khách hàng với điều kiện an toàn, chống deadlock khi có giao dịch thanh toán đồng thời đang diễn ra.
- **Độ phức tạp:** Trung bình.
- **Rủi ro chính:** Khóa nhầm khách hàng quan trọng do quy tắc quá cứng nhắc hoặc do thanh toán đã chuyển khoản nhưng chưa kịp đối soát sao kê; gây gián đoạn hoạt động kinh doanh.
- **Phân loại đề xuất:** **SECONDARY EXTENSION (Cần cân nhắc kỹ quy tắc nghiệp vụ trước khi triển khai).**

---

### 4. CANDIDATE D — DEBT RECOVERY / WRITE-OFF WORKFLOW
*Quy trình Xử lý Nợ Xấu & Xóa Nợ Bất Khả Thu Hồi (Bad Debt Write-Off).*

- **Mục tiêu:** Xây dựng quy trình xử lý công nợ xấu khó đòi: bàn giao hồ sơ thu nợ pháp lý, ghi nhận tiến trình hòa giải, và quy trình đề xuất - phê duyệt - hạch toán xóa nợ không thể thu hồi (Write-off).
- **Giá trị nghiệp vụ:** Đóng sổ các khoản nợ không còn khả năng thu hồi theo đúng quy định kế toán và chuẩn mực tài chính; làm sạch sổ sách công nợ phải thu của doanh nghiệp.
- **Dependencies hiện tại:** Cần phân hệ Phê duyệt Đa cấp (Approval Workflow Module) và Sổ cái Kế toán Chi phí (Accounting Expense Ledger). Cả hai đều **chưa có** trong Billing_One.
- **Thành phần hiện có tái sử dụng:** Bảng `invoices`, bảng `audit_logs`.
- **Thành phần mới cần xây dựng:** Bảng `debt_write_offs`, bảng `collection_cases`, luồng duyệt nhiều bước (Maker-Checker), hạch toán giảm trừ doanh thu/tăng chi phí nợ xấu, cập nhật trạng thái hóa đơn thành `WRITTEN_OFF`.
- **Database impact:** Cực kỳ lớn. Cần thêm bảng mới, sửa đổi trạng thái hóa đơn, và điều chỉnh lại toàn bộ công thức tính bất biến tài chính của hệ thống.
- **API impact:** Toàn bộ cụm API mới cho quy trình đề xuất, duyệt và thực thi xóa nợ.
- **Scheduler impact:** Thấp.
- **Frontend impact:** Giao diện quản lý nợ xấu, màn hình duyệt xóa nợ chuyên biệt.
- **Notification impact:** Cần thông báo nội bộ cho cấp quản lý phê duyệt.
- **Financial impact:** **CỰC KỲ CAO (Actual Financial Mutation).** Thay đổi số dư công nợ phải thu, ảnh hưởng trực tiếp đến báo cáo tài chính, thuế GTGT, và lợi nhuận của doanh nghiệp.
- **Security / RBAC impact:** Đòi hỏi thẩm quyền tài chính cấp cao (CFO/Finance Director).
- **Audit requirements:** Kiểm toán pháp lý bắt buộc ở mức nghiêm ngặt nhất.
- **Concurrency / Idempotency requirements:** Rất cao; phải đảm bảo không thể vừa thanh toán vừa xóa nợ cùng lúc trên một hóa đơn.
- **Độ phức tạp:** RẤT CAO (Phức tạp bậc nhất).
- **Rủi ro chính:** Vi phạm bất biến tài chính hiện hành; rủi ro thất thoát tài sản nếu không có quy trình kiểm soát nội bộ chuẩn mực; ảnh hưởng đến tuân thủ thuế Việt Nam.
- **Phân loại đề xuất:** **OUT OF SCOPE (Tuyệt đối không đưa vào P1.4; dành cho phase chuyên biệt P2.x).**

---

## F. DEPENDENCY ANALYSIS

Ma trận kế thừa và giới hạn đối với các mốc đã hoàn thành:

```
[P0: Financial Integrity]
  │   - adjusted_total, invariant trigger, legacy settlement isolation
  ▼
[P1.1: Refund Ledger]
  │   - refund_payables, credit notes
  ▼
[P1.2: Payment Allocation V2]
  │   - multi-invoice allocation, unapplied cash ledger
  ▼
[P1.2.1: Payment Idempotency]
  │   - payment_idempotency_keys, request hash verification
  ▼
[P1.2.2: Least Privilege & Concurrency Hardening]
  │   - Canonical Lock Hierarchy (Level 0 -> Level 3), DB role privileges
  ▼
[P1.3: Recurring Auto-Settlement Engine] (OFFICIALLY CLOSED & STABLE)
  │   - scheduler engine, advisory lock 88812345, FIFO auto-settle
  ▼
[P1.4: Tùy chọn Phạm vi Ứng viên]
```

### 1. Những gì P1.4 có thể an toàn tái sử dụng:
- **Scheduler Infrastructure (P1.3):** Cấu trúc bộ định thời lặp lại an toàn (`setInterval` + `setTimeout` khởi tạo + try/finally release lock) trong `app/src/scheduler.js`.
- **Audit Trail Pipeline (P0):** Hàm `recordAudit(pool, event)` với thuật toán băm SHA-256 chuỗi liên kết và cấu trúc bảo vệ append-only.
- **Idempotency Architecture (P1.2.1 / P1.2.2):** Mô hình khóa Advisory Lock mức tiến trình và kiểm tra hash để ngăn chặn tác vụ chạy lặp.
- **Database Connection & Transaction Utilities:** Hàm `inTransaction()` quản lý BEGIN/COMMIT/ROLLBACK chuẩn mực.

### 2. Những gì P1.4 TUYỆT ĐỐI KHÔNG ĐƯỢC thiết kế lại (Must Not Redesign):
- **Không chạm vào Payment Allocation V2 Engine (`PaymentService`):** Logic phân bổ tiền mặt, tính toán số dư chưa phân bổ (unapplied cash), và thứ tự phân bổ không được thay đổi.
- **Không sửa đổi cấu trúc chuỗi băm Audit (`audit_logs`):** Giữ nguyên các trường `prev_hash`, `curr_hash`, bảng mã hành động và quy tắc bảo vệ phân quyền role `billing_app`.
- **Không phá vỡ Canonical Lock Hierarchy:** 
  Thứ tự khóa chuẩn mực đã được nghiệm thu tại P1.2.2:
  - Level 0: Idempotency Key Advisory Lock
  - Level 1: Invoice Row Lock (`invoices FOR UPDATE ORDER BY id ASC`)
  - Level 2: Customer Unapplied Pool Advisory Lock
  - Level 3: Payment Advisory Lock (`paymentId ASC`)
  Mọi tác vụ của P1.4 (quét quá hạn, nhắc nợ) nếu cần khóa dữ liệu chỉ được phép dừng lại ở **Level 1 (Invoice Row Lock)**.

### 3. Khả năng tái sử dụng Scheduler của P1.3 và Phân định Lock ID:
Hạ tầng scheduler của P1.3 hoàn toàn có thể tái sử dụng để chứa thêm các tác vụ mới. Tuy nhiên, **tuyệt đối không được dùng chung lock ID**.
- P1.3 Recurring Billing sử dụng: `SCHEDULER_LOCK_ID = 88812345`.
- Nếu triển khai tác vụ P1.4, **bắt buộc phải cấp phát lock ID riêng biệt**:
  ```javascript
  const OVERDUE_SCAN_LOCK_ID    = 88812346; // Dành riêng cho tác vụ quét nợ quá hạn
  const DUNNING_CYCLE_LOCK_ID   = 88812347; // Dành riêng cho chu kỳ nhắc nợ (nếu có)
  const CUSTOMER_STATUS_LOCK_ID = 88812348; // Dành riêng cho đồng bộ rủi ro khách hàng
  ```
Việc tách riêng lock ID giúp tác vụ quét quá hạn không bị chặn lẫn nhau hoặc làm nghẽn tiến trình sinh hóa đơn định kỳ của P1.3.

---

## G. FINANCIAL IMPACT ANALYSIS

Đánh giá mức độ tác động tài chính giữa hai nhóm nghiệp vụ:

### 1. Bảng Khảo sát Tác động Dữ liệu Tài chính theo từng Ứng viên

| Thực thể / Chỉ số | Candidate A (OVERDUE FSM) | Candidate B (Dunning Events) | Candidate C (Customer Auto-Lock) | Candidate D (Debt Write-Off) |
|---|:---:|:---:|:---:|:---:|
| `invoice.status` | **CÓ THAY ĐỔI** (`ISSUED` $\rightarrow$ `OVERDUE`) | KHÔNG | KHÔNG | **CÓ THAY ĐỔI** (`WRITTEN_OFF`) |
| `invoice.total` | KHÔNG | KHÔNG | KHÔNG | KHÔNG |
| `invoice.paid_total` | KHÔNG | KHÔNG | KHÔNG | KHÔNG |
| `invoice.adjusted_total` | KHÔNG | KHÔNG | KHÔNG | **CÓ THỂ TĂNG** (nếu ghi giảm) |
| `payments` records | KHÔNG | KHÔNG | KHÔNG | KHÔNG |
| `payment_allocations` | KHÔNG | KHÔNG | KHÔNG | KHÔNG |
| `customer.current_debt` | KHÔNG (về mặt bản chất nợ) | KHÔNG | KHÔNG | **GIẢM** (xóa bỏ số dư nợ) |
| `credit_exposure` | KHÔNG | KHÔNG | **BỊ KHÓA** (không tăng thêm) | GIẢM |
| Doanh thu ghi nhận | KHÔNG | KHÔNG | KHÔNG | **GIẢM** (hoặc tăng chi phí nợ xấu) |
| Thuế VAT đầu ra | KHÔNG | KHÔNG | KHÔNG | **ẢNH HƯỞNG PHÁP LÝ** |
| Điều chỉnh (Adjustments) | KHÔNG | KHÔNG | KHÔNG | **PHÁT SINH MỚI** |
| Phân loại Bản chất | **Tác vụ Vận hành (Operational)** | **Tác vụ Vận hành (Operational)** | **Tác vụ Vận hành (Operational)** | **Biến động Tài chính (Financial Mutation)** |

### 2. Phân định Ranh giới Nghiệp vụ Cốt lõi:
- **Tác vụ Vận hành Thu nợ (Operational Collection Activity - Candidates A, B, C):**
  Chỉ phản ánh trạng thái quản lý thời gian, gửi thông báo nhắc nhở, hoặc thay đổi cờ quản trị rủi ro của khách hàng. **Hoàn toàn không làm biến đổi bất kỳ giá trị tiền tệ nào**. Do đó, không có nguy cơ làm sai lệch số dư sổ cái hay vi phạm bất biến tài chính của P0–P1.3.
- **Biến động Tài chính & Kế toán Thực thụ (Actual Accounting/Financial Mutation - Candidate D):**
  Làm thay đổi số dư nợ phải thu, xóa bỏ nghĩa vụ thanh toán của khách hàng, ảnh hưởng đến doanh thu và nghĩa vụ thuế. Nhóm này đòi hỏi chứng từ hợp lệ, quy trình phê duyệt nghiêm ngặt và hạch toán kế toán kép.

### 3. Yêu cầu Bắt buộc đối với các thao tác thay đổi dữ liệu:
Ngay cả với các tác vụ thuần vận hành (như chuyển `status` sang `OVERDUE`), hệ thống vẫn phải tuân thủ:
- **Financial Invariants Intact:** Bất biến `paid_total + adjusted_total <= total` phải được bảo vệ tuyệt đối.
- **Idempotency:** Lệnh cập nhật trạng thái phải idempotent, chạy $N$ lần cho cùng một kết quả.
- **Concurrency Protection:** Sử dụng transaction và row lock an toàn nếu có giao dịch thanh toán đồng thời đang tác động vào hóa đơn.
- **Audit Trail:** Mọi lần chuyển đổi trạng thái tự động phải có bản ghi audit log kèm đầy đủ metadata nguyên nhân.

---

## H. ARCHITECTURAL IMPACT

Phân loại các thành phần kiến trúc dự kiến theo 4 nhóm hành động:

| Thành phần Hệ thống | Phân loại | Mô tả Chi tiết Tác động Kiến trúc |
|---|:---:|---|
| **Database Schema** | **EXTEND** | Cập nhật constraint `invoices_status_check` thêm `'OVERDUE'`. Thêm index phục vụ quét nợ. (Nếu có Candidate B: Tạo thêm bảng `dunning_policies`, `dunning_events`). |
| **Domain Services** | **EXTEND** | Cập nhật `paymentService.js` để chấp nhận thanh toán cho hóa đơn `OVERDUE`. Xây dựng mới `dunningService.js` (nếu làm Candidate B/C). |
| **API Routes** | **EXTEND** | Cập nhật `app/src/routes/invoices.js` (cho phép filter `status=OVERDUE`). Cập nhật `app/src/routes/reports.js` và `customers.js` (bổ sung `OVERDUE` vào các query công nợ). |
| **Scheduler Engine** | **EXTEND** | Giữ nguyên engine nền tảng của `app/src/scheduler.js`, bổ sung hàm quét nợ `runOverdueScan()` với Lock ID độc lập. |
| **Audit Layer** | **REUSE** | Giữ nguyên 100% module `app/src/audit.js`, chỉ bổ sung các action types mới (`INVOICE_OVERDUE_FLAGGED`, `DUNNING_EVENT_TRIGGERED`). |
| **Idempotency Layer** | **REUSE** | Tái sử dụng cơ chế kiểm tra trùng lặp và bảo vệ transaction. |
| **Frontend UI** | **EXTEND** | Bổ sung hiển thị huy hiệu `OVERDUE` (màu đỏ), tab bộ lọc hóa đơn quá hạn, cảnh báo trạng thái khách hàng `LOCKED`. |
| **RBAC / Authorization** | **EXTEND** | Bổ sung các permissions mới nếu có tính năng quản trị chính sách dunning (`dunning.manage`, `customer.override_lock`). |
| **Monitoring & Metrics** | **EXTEND** | Bổ sung Prometheus Gauge `billing_invoices_overdue_count` để theo dõi số lượng hóa đơn quá hạn theo thời gian thực. |
| **Notification Layer** | **OUT OF SCOPE** | Toàn bộ hạ tầng gửi Email/SMS/Webhook bên ngoài không thuộc phạm vi khả thi hiện tại. |
| **Approval Workflow Module** | **OUT OF SCOPE** | Cơ chế phê duyệt nhiều cấp (Maker-Checker) phục vụ xóa nợ được đưa ra ngoài phạm vi. |
| **Legal / Debt Collection Agency**| **OUT OF SCOPE** | Tích hợp bên thứ ba thu hồi nợ pháp lý nằm ngoài phạm vi. |

---

## I. NOTIFICATION CAPABILITY CHECK

> [!IMPORTANT]
> **KẾT QUẢ KIỂM TRA HẠ TẦNG THÔNG BÁO:**  
> **"Notification infrastructure is not currently available."**  
> *(Hạ tầng thông báo hiện tại hoàn toàn chưa có trong hệ thống).*

Rà soát chi tiết trên toàn bộ repository:

1. **Email Provider / SMTP:** Không có cấu hình SMTP, không có thông tin kết nối máy chủ gửi mail trong `.env`, không có thư viện SMTP client.
2. **Mail Service Packages:** `app/package.json` chỉ bao gồm 6 thư viện runtime (`bcryptjs`, `connect-pg-simple`, `express`, `express-session`, `pg`, `prom-client`). Hoàn toàn không có `nodemailer`, `@sendgrid/mail`, `mailgun-js` hay bất kỳ SDK email nào.
3. **SMS Provider:** Không có tích hợp với bất kỳ nhà cung cấp dịch vụ SMS Gateway nào (Twilio, Stringee, SpeedSMS, eSMS...).
4. **Webhook Dispatcher Service:** Không có cơ chế gửi HTTP webhook ra hệ thống bên ngoài, không có logic retry khi gửi lỗi, không có ký số HMAC cho payload webhook.
5. **Notification Queue & Worker:** Không có Message Queue (Redis BullMQ, RabbitMQ, Kafka) để xử lý các tác vụ gửi thông báo bất đồng bộ ngoài luồng chính.
6. **Notification Templates:** Không có thư mục chứa mẫu email/tin nhắn (HTML/Mustache/Handlebars templates) cho các văn bản nhắc nợ.
7. **Delivery Status Tracking:** Không có bảng cơ sở dữ liệu để theo dõi trạng thái gửi tin (`QUEUED`, `SENT`, `DELIVERED`, `BOUNCED`, `OPENED`).

**Kết luận Thiết kế Bắt buộc:**  
Tuyệt đối không thể giả định rằng hệ thống có thể "tự động gửi email/SMS nhắc nợ cho khách hàng" trong P1.4 mà không phải kéo theo một khối lượng công việc khổng lồ về xây dựng hạ tầng thông báo từ con số không. Bất kỳ tác vụ dunning nào trong giai đoạn này (nếu được phê duyệt) chỉ có thể dừng lại ở mức **Internal Dunning Event Logging** (ghi nhận sự kiện nội bộ vào cơ sở dữ liệu để nhân viên kế toán tra cứu).

---

## J. BUSINESS QUESTIONS / OPEN DECISIONS

Danh sách chính xác các câu hỏi nghiệp vụ và quyết định kiến trúc **BẮT BUỘC** Product Owner phải phê duyệt trước khi tiến hành Scope Freeze cho P1.4:

1. **Tiêu chí xác định Quá hạn (Overdue Criteria):**
   - Hóa đơn quá hạn được tính chính xác vào thời điểm nào? Ngay khi bước sang ngày tiếp theo của `due_date` ($current\_date > due\_date$ lúc 00:00:00), hay cần có thời gian ân hạn (Grace Period)?
2. **Thời gian ân hạn (Grace Period):**
   - Có áp dụng số ngày ân hạn mặc định (ví dụ: 1 ngày, 3 ngày sau `due_date`) trước khi chính thức đổi trạng thái sang `OVERDUE` không?
3. **`OVERDUE` có phải là một trạng thái FSM độc lập trong Cơ sở dữ liệu?**
   - Chấp thuận thêm `'OVERDUE'` vào check constraint của bảng `invoices` hay tiếp tục duy trì trạng thái tính toán động trong API báo cáo?
4. **Những trạng thái nào của hóa đơn được phép chuyển sang `OVERDUE`?**
   - Chỉ có `ISSUED`, hay cả `PARTIALLY_PAID` khi còn dư nợ và đã quá hạn?
5. **Xử lý khi hóa đơn `OVERDUE` được thanh toán:**
   - Khi thanh toán đủ: Chuyển thẳng sang `PAID`?
   - Khi thanh toán một phần: Chuyển về `PARTIALLY_PAID` hay vẫn giữ là `OVERDUE` kèm ghi nhận số tiền còn lại?
6. **Phạm vi của Chính sách Nhắc nợ (Dunning Policy Scope):**
   - Chính sách nhắc nợ áp dụng chung cho toàn hệ thống (Global Policy), theo phân khúc khách hàng (Segment: Enterprise vs SME), hay cấu hình riêng cho từng khách hàng?
7. **Lịch nhắc nợ mặc định (Default Reminder Schedule):**
   - Nếu áp dụng nhắc nợ, các mốc ngày quá hạn mặc định là gì? (Ví dụ: Ngày +3, Ngày +7, Ngày +14, Ngày +30?).
8. **Số lần nhắc nợ tối đa (Maximum Reminders):**
   - Có giới hạn số lần nhắc nợ tối đa cho một hóa đơn không, hay nhắc liên tục cho đến khi thanh toán?
9. **Cấp bậc leo thang (Escalation Stages):**
   - Có bao nhiêu cấp bậc đôn đốc? (Ví dụ: Cấp 1 - Nhắc nhở thiện chí; Cấp 2 - Đôn đốc thanh toán; Cấp 3 - Cảnh báo ngừng dịch vụ; Cấp 4 - Bàn giao pháp lý?).
10. **Kênh truyền thông nhắc nợ (Channels):**
    - Trong bối cảnh hệ thống chưa có hạ tầng gửi tin ngoài, Product Owner có chấp nhận phương án chỉ ghi nhận sự kiện nội bộ (Internal Dashboard / Task List) để kế toán viên thực hiện cuộc gọi/email thủ công không?
11. **Tạm dừng Nhắc nợ (Dunning Pause / Dispute Hold):**
    - Nhân viên kế toán có được phép tạm dừng chu kỳ nhắc nợ đối với các hóa đơn đang có tranh chấp (disputed invoices) không?
12. **Can thiệp thủ công (Manual Staff Override):**
    - Nhân viên có quyền can thiệp thủ công để kích hoạt một lần nhắc nợ ngoài chu kỳ tự động không?
13. **Tự động hóa Trạng thái Khách hàng (WARNING / LOCKED):**
    - Có chấp thuận tự động chuyển trạng thái khách hàng sang `WARNING` và `LOCKED` không? Ngưỡng nợ quá hạn hoặc số ngày quá hạn bao nhiêu thì bị khóa? (Ví dụ: Quá hạn > 30 ngày hoặc nợ quá hạn > Hạn mức tín dụng?).
14. **Hiệu lực của trạng thái `LOCKED` đối với phát hành hóa đơn:**
    - Khách hàng bị `LOCKED` có bị hệ thống chặn hoàn toàn việc phát hành hóa đơn mới (`POST /api/invoices/:id/issue`) không, hay chỉ hiển thị cảnh báo để nhân viên quyết định?
15. **Cơ chế Mở khóa Khách hàng (Unlock Mechanism):**
    - Khi khách hàng thanh toán hết nợ quá hạn, hệ thống có tự động mở khóa về `ACTIVE` không? Quản trị viên có quyền cưỡng chế mở khóa (Override Unlock) không và cần ghi nhận lý do kiểm toán như thế nào?
16. **Phạm vi của Xóa nợ xấu (Write-Off Scope):**
    - Xác nhận chính thức: Quy trình xóa nợ xấu (Write-off) có đưa ra ngoài phạm vi P1.4 để chuyển sang các phase sau hay không?
17. **Yêu cầu về Nhà cung cấp Thông báo (Notification Provider Requirement):**
    - Doanh nghiệp có yêu cầu phải tích hợp một dịch vụ gửi email thực thụ (ví dụ: SMTP công ty) ngay trong P1.4 không, hay chấp nhận tách riêng thành phân hệ thông báo độc lập?
18. **Quyền hạn RBAC cần bổ sung:**
    - Cần những mã quyền mới nào cho phân hệ này? (Đề xuất: `dunning.manage`, `dunning.view`, `customer.override_lock`).
19. **Tên gọi sự kiện Kiểm toán (Audit Event Names):**
    - Chuẩn hóa danh mục tên gọi các sự kiện kiểm toán mới: `INVOICE_OVERDUE_FLAGGED`, `CUSTOMER_AUTO_LOCKED`, `CUSTOMER_AUTO_UNLOCKED`, `CUSTOMER_MANUAL_UNLOCKED`, `DUNNING_EVENT_RECORDED`.

---

## K. CANDIDATE SCOPE COMPARISON

Bảng so sánh tổng hợp các kịch bản phạm vi ứng viên:

| Tiêu chí So sánh | Candidate A: OVERDUE FSM | Candidate B: Dunning Policy & Events | Candidate C: Customer Debt Auto-Lock | Candidate D: Debt Write-Off |
|---|:---:|:---:|:---:|:---:|
| **Giá trị nghiệp vụ (Business Value)** | Cao (Nền tảng chuẩn hóa dữ liệu & FSM) | Trung bình - Cao (Chuẩn hóa quy trình nhắc nợ) | Cao (Kiểm soát rủi ro tín dụng khách hàng) | Cao (Làm sạch sổ sách kế toán) |
| **Sẵn sàng về phụ thuộc (Dependency Readiness)** | **100% SẴN SÀNG** (Dựa trên P0, P1.2, P1.3) | **PHỤ THUỘC CANDIDATE A** | **PHỤ THUỘC CANDIDATE A** | **CHƯA SẴN SÀNG** (Thiếu Approval, Ledger) |
| **Độ phức tạp triển khai (Complexity)** | Thấp - Trung bình | Trung bình | Trung bình | Rất cao |
| **Rủi ro tài chính (Financial Risk)** | Rất thấp (Không đổi số tiền) | Rất thấp (Non-financial log) | Thấp (Chặn bán hàng, không đổi tiền) | **RẤT CAO** (Thay đổi nợ, doanh thu, thuế) |
| **Tác động kiến trúc (Arch Impact)** | Nhỏ (Sửa constraint, index, scheduler) | Vừa (Thêm 2 bảng, service mới) | Vừa (Scheduler sync, logic check issue) | Rất lớn (Bảng mới, sổ cái mới, approval) |
| **Phụ thuộc Notification Infra** | **HOÀN TOÀN KHÔNG** | Không (nếu chỉ log nội bộ) | **HOÀN TOÀN KHÔNG** | Cần thông báo duyệt nội bộ |
| **Thời điểm khuyến nghị (Timing)** | **Ngay trong P1.4** | Giai đoạn 2 của P1.4 (Staged) | Giai đoạn 2 của P1.4 (Staged) | **Trì hoãn sang Phase tương lai** |

### Phân loại Phạm vi Đề xuất:
- **RECOMMENDED P1.4 CORE CANDIDATE:** **Candidate A (Automated OVERDUE Invoice Lifecycle)**.
- **DEFERRED CANDIDATES (Cân nhắc Staged Extension):** **Candidate B** (chỉ ở mức Internal Event Log) và **Candidate C** (Auto-Locking với cơ chế Override an toàn).
- **OUT-OF-SCOPE CANDIDATES (Loại bỏ tuyệt đối khỏi P1.4):** **Candidate D** (Debt Write-Off) và **External Notification Dispatch Infrastructure**.

---

## L. RECOMMENDED P1.4 DIRECTION

Dựa trên các bằng chứng pháp y từ kho mã nguồn, tính sẵn sàng của các phụ thuộc kỹ thuật, và nguyên tắc an toàn tài chính:

### 1. Hướng tiếp cận Khuyến nghị: Lát cắt Dọc Nhỏ nhất Khả thi (Smallest Coherent Vertical Slice)
Chúng tôi khuyến nghị định hình P1.4 xoay quanh một lát cắt dọc mạch lạc, an toàn và mang lại giá trị thực tế ngay lập tức:

> **LÕI CỐT LÕI (MANDATORY CORE): Candidate A — Automated OVERDUE Invoice Lifecycle Automation**  
> Kết hợp mở rộng có điều kiện: **Candidate B (Internal Dunning Logging)** và **Candidate C (Customer Risk Warning/Locking)** dưới dạng các lớp chức năng tách biệt (phụ thuộc vào quyết định của Product Owner).

### 2. Lý giải Tại sao Lựa chọn Hướng này:
1. **Giải quyết triệt để nút thắt nền tảng (Foundation Bottleneck):**
   Hiện tại, việc thiếu trạng thái `OVERDUE` chính thức trong cơ sở dữ liệu khiến toàn bộ hệ thống phải tính toán "chắp vá" thông qua các câu lệnh subquery lọc `due_date < current_date` trong các báo cáo. Nếu không có trạng thái `OVERDUE` chính thức trong DB, không có bất kỳ quy trình Dunning, nhắc nợ, hay khóa khách hàng nào có thể chạy một cách hiệu quả và đáng tin cậy.
2. **Không bị chặn bởi sự thiếu vắng Hạ tầng Thông báo:**
   Do hệ thống chưa có dịch vụ email/SMS, việc định nghĩa P1.4 là "gửi tin nhắn tự động đến khách hàng" chắc chắn sẽ thất bại hoặc biến thành mock data vô nghĩa. Thay vào đó, việc tập trung vào chuẩn hóa FSM hóa đơn và nhật ký đôn đốc nợ nội bộ sẽ tạo ra giá trị nghiệp vụ vững chắc mà không phụ thuộc vào hạ tầng bên ngoài.
3. **Bảo vệ 100% Bất biến Tài chính:**
   Candidate A và các phần mở rộng nội bộ chỉ tác động vào trường `status` và ghi nhật ký vận hành, hoàn toàn không làm biến đổi số dư các trường tiền tệ (`total`, `paid_total`, `adjusted_total`). Điều này đảm bảo tính ổn định tuyệt đối đã đạt được sau đợt nghiệm thu P1.3.

---

## M. DRAFT ACCEPTANCE CRITERIA

*(Dự thảo tiêu chí nghiệm thu sơ bộ cho Candidate A & các thành phần mở rộng khuyến nghị — CHỈ LÀ BẢN THẢO, không phải Official Criteria)*

### 1. Tính đúng đắn của Vòng đời Hóa đơn (Correctness)
- Hóa đơn ở trạng thái `ISSUED` hoặc `PARTIALLY_PAID` có số dư nợ còn lại $> 0$ và có `due_date < CURRENT_DATE` phải được scheduler tự động chuyển trạng thái thành `OVERDUE`.
- Hóa đơn ở trạng thái `DRAFT`, `PAID`, hoặc `CANCELLED` tuyệt đối không bị chuyển sang `OVERDUE`.
- Hóa đơn có số dư nợ bằng 0 ($total - paid\_total - adjusted\_total = 0$) tuyệt đối không bị chuyển sang `OVERDUE`.
- Khi một hóa đơn `OVERDUE` nhận được phân bổ thanh toán:
  - Nếu tất toán đủ 100%: Tự động chuyển trạng thái sang `PAID`.
  - Nếu thanh toán một phần: Tự động chuyển trạng thái sang `PARTIALLY_PAID` (hoặc giữ `OVERDUE` tùy theo cấu hình PO phê duyệt).

### 2. Tính lũy kế & Idempotency của Scheduler
- Tác vụ `runOverdueScan()` phải mang tính idempotent tuyệt đối: Thực thi liên tiếp nhiều lần trong cùng một ngày chỉ tạo ra một kết quả duy nhất, không cập nhật lại các hóa đơn đã xử lý, không sinh các bản ghi log dư thừa.
- Scheduler job phải sử dụng Advisory Lock độc lập (`OVERDUE_SCAN_LOCK_ID = 88812346`) để ngăn chặn việc chạy đè đồng thời giữa hai worker hoặc hai tiến trình web.

### 3. Đồng thời & An toàn Giao dịch (Concurrency & Transaction Safety)
- Tác vụ quét nợ không được gây deadlock với tiến trình thanh toán/phân bổ của P1.2 hoặc tiến trình sinh hóa đơn định kỳ P1.3.
- Trong trường hợp một hóa đơn đang được nhân viên phân bổ thanh toán cùng lúc scheduler đang quét, giao thức khóa hàng (`FOR UPDATE`) phải đảm bảo thứ tự thực thi nhất quán, không xảy ra xung đột dữ liệu (data inconsistency).

### 4. Kiểm toán & Khả năng Truy vết (Audit & Traceability)
- Mọi lần hóa đơn được hệ thống chuyển sang trạng thái `OVERDUE` đều phải ghi nhận một sự kiện kiểm toán bất biến vào `public.audit_logs` với action `INVOICE_OVERDUE_FLAGGED`.
- Metadata kiểm toán phải chứa tối thiểu: `invoice_id`, `invoice_no`, `due_date`, `days_overdue`, `outstanding_amount`, `scanned_at`.
- Chuỗi băm SHA-256 (`prev_hash`, `curr_hash`) phải được duy trì liên tục và toàn vẹn 100%.

### 5. An ninh & Phân quyền (Security & RBAC)
- Khách hàng không có quyền truy cập trái phép vào các thông tin cảnh báo nợ ngoài phạm vi cho phép.
- Quyền can thiệp cưỡng chế mở khóa khách hàng bị khóa công nợ (`customer.override_lock`) phải được giới hạn chặt chẽ cho vai trò `admin`.

### 6. Bất biến Tài chính (Financial Invariants Intact)
- Sau khi quét và chuyển trạng thái hàng loạt hóa đơn sang `OVERDUE`, toàn bộ các bất biến tài chính của hệ thống phải được bảo toàn:
  - $paid\_total \le total$ (100% tuân thủ).
  - $paid\_total + adjusted\_total \le total$ (100% tuân thủ).
  - $\sum allocated\_amount = paid\_total$ (100% tuân thủ).

### 7. Hồi quy & Tương thích Báo cáo (Zero Regression)
- Toàn bộ 12 test suites hiện hành của hệ thống (bao gồm các bộ test P0, P1.1, P1.2, P1.2.1, P1.2.2, P1.3) phải tiếp tục đạt kết quả PASS 100%.
- Các API báo cáo hiện hành (`/api/reports/aging`, `/api/reports/collection-metrics`, `/api/customers/:id`) phải tiếp tục hoạt động chính xác và không bị thiếu sót số liệu do việc đưa thêm trạng thái `OVERDUE` vào cơ sở dữ liệu.

---

## N. IMPLEMENTATION RISKS

Đánh giá mức độ rủi ro triển khai theo các phân cấp chuẩn:

### 1. RỦI RO MỨC ĐỘ NGUY HIỂM (CRITICAL RISKS)
- **R-CRIT-01: Chặn thanh toán hóa đơn OVERDUE do hardcoded check trong `paymentService.js`:**
  Trong mã nguồn hiện tại (`paymentService.js` dòng 376 và dòng 571), hệ thống kiểm tra điều kiện cứng:
  `if (!['ISSUED', 'PARTIALLY_PAID'].includes(inv.status)) throw new AppError(409, 'INVOICE_NOT_PAYABLE')`.
  Nếu thêm trạng thái `OVERDUE` mà không cập nhật whitelist này, toàn bộ các hóa đơn quá hạn sẽ bị hệ thống **chặn đứng không cho thanh toán**, làm tê liệt luồng thu tiền của doanh nghiệp!
  *Biện pháp giảm thiểu:* Rà soát và cập nhật đồng bộ toàn bộ các điểm kiểm tra trạng thái trong `paymentService.js` trước khi kích hoạt scheduler chuyển trạng thái `OVERDUE`.

### 2. RỦI RO MỨC ĐỘ CAO (HIGH RISKS)
- **R-HIGH-01: Sai lệch số liệu công nợ trong các câu lệnh truy vấn báo cáo hiện hữu:**
  Tại `app/src/routes/customers.js` (dòng 68-71, 151-154) và `app/src/routes/reports.js` (dòng 21, 40, 79), câu lệnh tính toán `current_debt` và `receivables` đang sử dụng điều kiện cứng: `WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`. Khi hóa đơn chuyển sang `OVERDUE`, các truy vấn này sẽ **bỏ sót hoàn toàn các hóa đơn quá hạn**, dẫn đến việc nợ của khách hàng và tổng tài sản phải thu trên dashboard bị sụt giảm đột ngột một cách sai lệch!
  *Biện pháp giảm thiểu:* Cập nhật đồng bộ tất cả các câu lệnh SQL liên quan để bao gồm cả `'OVERDUE'`: `WHERE status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')`.
- **R-HIGH-02: Kỳ vọng sai lệch về tính năng gửi thông báo (Notification Misconception):**
  Các bên liên quan có thể kỳ vọng tính năng "Automated Dunning" đồng nghĩa với việc khách hàng tự động nhận được Email hoặc SMS. Do hệ thống chưa có hạ tầng gửi tin, việc này sẽ dẫn đến việc bàn giao không đúng kỳ vọng nghiệp vụ.
  *Biện pháp giảm thiểu:* Ghi rõ giới hạn phạm vi trong Official Specification: P1.4 chỉ ghi nhận sự kiện dunning nội bộ, không bao gồm gửi tin ngoại vi.

### 3. RỦI RO MỨC ĐỘ TRUNG BÌNH (MEDIUM RISKS)
- **R-MED-01: Xung đột khóa Advisory Lock giữa các tác vụ định kỳ:**
  Nếu tác vụ quét nợ vô tình sử dụng chung `SCHEDULER_LOCK_ID = 88812345` với P1.3 Recurring Billing, hai tác vụ sẽ triệt tiêu lẫn nhau, dẫn đến việc bỏ sót chu kỳ sinh hóa đơn hoặc chu kỳ quét nợ.
  *Biện pháp giảm thiểu:* Cấp phát hằng số khóa độc lập: `OVERDUE_SCAN_LOCK_ID = 88812346`.
- **R-MED-02: Khóa nhầm khách hàng do độ trễ đối soát ngân hàng (False-Positive Customer Locking):**
  Khách hàng đã chuyển tiền nhưng sao kê chưa được đối soát kịp thời; scheduler tự động quét thấy nợ quá hạn và khóa tài khoản (`LOCKED`), khiến khách hàng bị từ chối dịch vụ oan.
  *Biện pháp giảm thiểu:* Thiết lập khoảng thời gian đệm (buffer days/grace period) và cung cấp cơ chế mở khóa can thiệp tức thì (`override_lock`) cho Admin.

### 4. RỦI RO MỨC ĐỘ THẤP (LOW RISKS)
- **R-LOW-01: Tải cơ sở dữ liệu khi quét bảng `invoices` quy mô lớn:**
  Khi bảng `invoices` tăng trưởng hàng trăm ngàn dòng, câu lệnh quét hàng ngày có thể gây chậm cơ sở dữ liệu nếu thiếu chỉ mục tối ưu.
  *Biện pháp giảm thiểu:* Bổ sung partial composite index: `CREATE INDEX idx_invoices_overdue_scan ON invoices (status, due_date) WHERE status IN ('ISSUED', 'PARTIALLY_PAID')`.

### 5. THÔNG TIN QUAN SÁT (INFO)
- Cần chuẩn hóa quy tắc hiển thị trên giao diện người dùng để người dùng cuối phân biệt rõ giữa "Hóa đơn Chưa thanh toán trong hạn" (ISSUED) và "Hóa đơn Đã quá hạn thanh toán" (OVERDUE).

---

## O. DISCOVERY RECOMMENDATION

Dựa trên toàn bộ kết quả khảo sát kỹ thuật và phân tích khoảng cách, đội ngũ kiến trúc đưa ra khuyến nghị chính thức cho bước tiếp theo:

1. **Phạm vi Khuyến nghị cho P1.4 (Recommended Scope):**
   - **Tập trung làm chủ đạo:** **Candidate A (Automated OVERDUE Invoice Lifecycle Automation)**.
   - **Mở rộng thứ cấp (Nếu PO chấp thuận giới hạn nội bộ):** **Candidate B** (Cấu hình chính sách & Ghi nhận sự kiện Dunning nội bộ) và **Candidate C** (Đồng bộ trạng thái rủi ro khách hàng kèm cơ chế Override an toàn).
2. **Các chức năng Trì hoãn (Deferred Functionality):**
   - Cơ chế tự động hóa gửi email/SMS thông báo ra bên ngoài (trì hoãn cho đến khi có Phân hệ Notification độc lập).
   - Tự động phạt lãi chậm trả (Late payment interest calculation).
3. **Các chức năng Tuyệt đối Ngoài phạm vi (Explicit Out-of-Scope):**
   - **Candidate D (Debt Recovery / Bad Debt Write-Off):** Tuyệt đối không đưa vào P1.4. Chuyển sang một Phase chuyên biệt về Kế toán Nợ xấu (P2.x) có tích hợp quy trình phê duyệt đa cấp (Approval Engine).
   - Bàn giao công nợ cho công ty thu nợ hoặc cơ quan pháp lý bên ngoài.
   - Cổng thanh toán trực tuyến tự động cho khách hàng tự xử lý nợ.
4. **Các quyết định bắt buộc từ Product Owner:**
   - Trả lời và phê duyệt chính thức 19 câu hỏi nghiệp vụ tại [Mục J](#j-business-questions--open-decisions).
   - Xác nhận lựa chọn mô hình phạm vi: Chọn thuần túy Candidate A, hay gói kết hợp (A + B nội bộ + C).
5. **Tài liệu tiếp theo bắt buộc (Next Required Document):**
   Sau khi Product Owner đưa ra các quyết định phê duyệt chính thức bằng văn bản, bước tiếp theo sẽ là biên soạn:
   `docs/BILLING_ONE_P1_4_OFFICIAL_SPEC.md`
   *(Lưu ý: Tuyệt đối KHÔNG tạo hay viết tài liệu đặc tả này tại thời điểm hiện tại khi chưa có quyết định phê duyệt từ Product Owner).*

---

## P. FINAL VERDICT

Căn cứ vào kết quả khảo sát toàn diện:
- Kho mã nguồn hiện tại hoàn toàn chưa có bất kỳ đặc tả chính thức nào cho P1.4.
- Tên gọi "Automated Dunning & Debt Recovery" chỉ là nhãn tham chiếu định hướng, không phản ánh một phạm vi kỹ thuật đã được thống nhất.
- Hạ tầng thông báo (Notification Infrastructure) hoàn toàn chưa tồn tại trong hệ thống.
- Còn nhiều quyết định nghiệp vụ trọng yếu (ngưỡng quá hạn, chính sách nhắc nợ, quy tắc khóa khách hàng, phạm vi xóa nợ) cần Product Owner lựa chọn và phê chuẩn trước khi có thể thiết kế chi tiết.

Đội ngũ kiến trúc chính thức xác lập kết luận của đợt khảo sát:

```
================================================================================
  FINAL DISCOVERY VERDICT:
  
  P1.4 DISCOVERY — REQUIREMENT AMBIGUITY
================================================================================
```

**Hành động tiếp theo:**  
Trình báo cáo Khảo sát này lên Product Owner để xem xét và giải quyết các câu hỏi mở tại [Mục J](#j-business-questions--open-decisions).  
**DỪNG TOÀN BỘ CÔNG VIỆC TẠI ĐÂY.** Không bắt đầu triển khai mã nguồn, không tạo migration, và không tự ý biên soạn tài liệu đặc tả P1.4 cho đến khi nhận được chỉ đạo chính thức từ Product Owner.
