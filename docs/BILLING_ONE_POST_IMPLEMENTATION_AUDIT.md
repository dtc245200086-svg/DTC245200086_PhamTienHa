# Báo cáo Kiểm toán Độc lập Toàn diện Sau Triển khai Tích hợp LedgerFlow
## BILLING_ONE POST-IMPLEMENTATION FULL AUDIT REPORT

> **Hệ thống kiểm toán:** Billing_One Enterprise Management Platform  
> **Phiên bản được kiểm toán:** Release v2.0-Enterprise (Sau tích hợp LedgerFlow)  
> **Tài liệu đối chiếu:** [docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md)  
> **Thời điểm thực hiện:** 06/10/2026  
> **Nguyên tắc kiểm toán:** Xác minh độc lập dựa trên mã nguồn thực tế, cơ sở dữ liệu PostgreSQL runtime, giao thức HTTP/API trực tiếp, và log hệ thống. Tuyệt đối không giả định các mục ghi "PASS" trong báo cáo trước là đúng.  
> **Quy tắc tuân thủ:** CHỈ KIỂM TOÁN + XÁC MINH + BÁO CÁO (KHÔNG tự ý chỉnh sửa mã nguồn trong giai đoạn này).

---

## 1. Executive Summary & Kết quả Tổng quan

Kiểm toán đã tiến hành rà soát chuyên sâu 14 lĩnh vực trọng yếu của hệ thống Billing_One sau khi tích hợp các tính năng doanh nghiệp từ LedgerFlow.

### Tóm tắt Phát hiện:
- **Hạ tầng, Bảo mật Biên & Baseline Tests (PASS)**: Toàn bộ 12 Docker containers đang chạy ổn định (UP/healthy). Nginx TLS, bảo mật phân tầng mạng H1–H6, và 15 bài kiểm thử baseline (`cp2-smoke.mjs`) đều đạt PASS 100%, chứng minh **không có hồi quy (Zero Regression)** trên luồng hóa đơn cơ bản của Đề 18.
- **Phát hiện Lỗi Nghiêm trọng (CRITICAL & HIGH)**: Kiểm toán phát hiện nhiều điểm sai lệch bản chất giữa nội dung công bố trong `FINAL REPORT` và mã nguồn thực thi thực tế:
  1. **CRITICAL - Đứt gãy Liên kết Tuyến đường Frontend - Backend**: Giao diện người dùng (`app/public/app.js`) gọi sai 5 đường dẫn API chính thức (`/recurring`, `/reconciliation/transactions`, `/reports/revenue-analytics`, `/reports/vat-declaration`, `/audit`), dẫn tới lỗi **HTTP 404** khi người dùng truy cập các màn hình này từ thanh điều hướng.
  2. **CRITICAL - Lỗi Nghiệp vụ Trừ nợ Biên bản Điều chỉnh (Credit Notes)**: Endpoint `POST /api/adjustments/:id/process` chỉ cập nhật cờ `status = 'PROCESSED'` trên bảng điều chỉnh, **hoàn toàn không khấu trừ công nợ trên hóa đơn gốc**, không tạo bút toán hoàn tiền hay giảm `paid_total`/`total`.
  3. **CRITICAL - Chuỗi Băm Mật mã Kiểm toán (SHA-256 Audit Trail) là Mô phỏng**: Bảng `audit_logs` trong PostgreSQL thực tế không có cột `hash` hay `prev_hash`. Endpoint `/verify` chỉ đếm tổng số dòng `SELECT count(*)` rồi trả về thông điệp thành công mà không thực hiện bất kỳ phép toán kiểm tra băm liên kết nào.
  4. **HIGH - Lệch Cấu trúc Dữ liệu Form Điều chỉnh**: Giao diện gửi `{ invoice_id, type }` trong khi backend đòi hỏi `{ original_invoice_id, adjustment_type }` với tập giá trị enum hoàn toàn khác nhau, khiến chức năng tạo Credit Note trên UI bị chặn bởi lỗi 400.
  5. **HIGH - Không có Bộ Lập lịch Chạy ngầm cho Thuê bao Định kỳ**: Các gói thuê bao định kỳ chỉ được sinh hóa đơn khi có người bấm nút gọi API thủ công; không có cron daemon hay bộ lập lịch nền tự động quét ngày chạy `next_run_date`.
  6. **HIGH - Mã Hóa đơn Điện tử (e_invoice_code) Thuần túy là Mã Mô phỏng Nội bộ**: Hệ thống không tích hợp với Cục Thuế hay nhà cung cấp T-VAN; việc gọi đây là "mã CQT cấp" trong báo cáo là không chính xác.
  7. **HIGH - Phân quyền Hạt nhân (RBAC) Chưa Được Áp dụng vào Luồng Request**: Các bảng `roles`, `permissions`, `role_permissions` chỉ mang tính chất metadata tra cứu; backend vẫn chỉ kiểm tra quyền dựa trên 2 role cố định `admin`/`staff`.

---

## 2. Bảng Phân loại Toàn bộ Phát hiện (Audit Findings Matrix)

| Mã | Phân loại | Module / Vị trí | Tóm tắt Vấn đề | Mức độ Ảnh hưởng |
| :--- | :--- | :--- | :--- | :--- |
| **F-01** | **CRITICAL** | `app/public/app.js` & Backend Routers | Sai lệch URL endpoint giữa Frontend và Backend (`/recurring`, `/reconciliation/transactions`, `/reports/*`, `/audit`) | Người dùng truy cập UI nhận lỗi HTTP 404, không dùng được tính năng |
| **F-02** | **CRITICAL** | `app/src/routes/adjustments.js` | Endpoint `/process` không trừ công nợ hay ghi nhận thay đổi số dư hóa đơn gốc | Sai lệch sổ sách kế toán; nợ của khách hàng không đổi dù Credit Note đã xử lý |
| **F-03** | **CRITICAL** | `app/src/routes/audit.js` & `db/04-evolution.sql` | Thiếu cột băm mật mã trong DB; hàm `/verify` là giả lập (dummy verification) | Sai lệch với cam kết kiến trúc toàn vẹn dữ liệu SHA-256 trong Final Report |
| **F-04** | **CRITICAL** | `app/public/app.js` (Tab Aging Report) | Đọc thuộc tính `data.matrix` thay vì `data.customers` gây sập màn hình (TypeError) | Màn hình Báo cáo Tuổi nợ bị crash hoàn toàn khi chuyển tab |
| **F-05** | **HIGH** | `app/public/app.js` & `adjustments.js` | Form tạo biên bản điều chỉnh gửi sai tên trường (`invoice_id`, `type`) và sai enum | Giao diện không thể tạo mới biên bản điều chỉnh (Lỗi HTTP 400) |
| **F-06** | **HIGH** | `app/src/routes/recurring.js` | Thiếu background scheduler / cron daemon tự động quét chu kỳ | Thuê bao định kỳ không tự động sinh hóa đơn nếu không có tương tác thủ công |
| **F-07** | **HIGH** | `app/src/routes/invoices.js` | Tự sinh `e_invoice_code` nội bộ nhưng Final Report gọi là "Mã do Cục Thuế cấp" | Sai lệch tài liệu pháp lý; gây hiểu nhầm hệ thống đã kết nối cổng T-VAN thật |
| **F-08** | **HIGH** | `app/src/routes/rbac.js` & Middleware | Quyền hạn trong `permissions` không được kiểm tra trong middleware xử lý request | Phân quyền hạt nhân chỉ là hình thức, thực tế vẫn là 2 role thô sơ |
| **F-09** | **HIGH** | `app/src/routes/payments.js` (`/allocate`) | Thanh toán đa hóa đơn ghi toàn bộ số tiền vào hóa đơn đầu tiên | Hóa đơn thứ hai hiển thị nợ 0đ nhưng lịch sử thanh toán rỗng; hóa đơn 1 bị ghi sai tiền |
| **F-10** | **MEDIUM** | `app/public/app.js` (Payment Terms) | Giao diện đọc `net_days` thay vì `days` từ API; ngày hạn nợ bị `NaN` | Bảng điều khoản hiện `undefined ngày`; chọn điều khoản sinh hạn nợ lỗi |
| **F-11** | **MEDIUM** | `app/src/routes/customers.js` | Giao diện cho chọn `RETAIL`/`VIP` nhưng Backend âm thầm ép về `SME` | Phân khúc khách hàng bị mất dữ liệu mà không báo lỗi cho người dùng |
| **F-12** | **MEDIUM** | `app/src/routes/reconciliation.js` | Khớp thừa tiền ngân hàng không lưu vết số tiền chênh lệch (Unapplied Cash) | Mất cân đối dòng tiền khi khách hàng chuyển khoản thừa so với nợ hóa đơn |
| **F-13** | **MEDIUM** | `app/public/app.js` (E-Invoice Display) | Giao diện đọc `einvoice_code` thay vì `e_invoice_code` từ API | Hóa đơn đã cấp mã nhưng UI luôn hiển thị "Chưa cấp" |
| **F-14** | **LOW** | `app/src/routes/recurring.js` | Phép tính `setMonth(+1)` có thể nhảy tháng nếu ngày bắt đầu là 31 | Ngày thanh toán định kỳ bị lệch dần qua các tháng có 28, 30 ngày |
| **F-15** | **PASS** | Infrastructure & Docker | 12/12 container UP, non-root, network isolation, TLS 1.3, CSP | Đạt chuẩn an toàn hạ tầng và quan sát vận hành |
| **F-16** | **PASS** | Financial Math & Database Types | `NUMERIC(14,2)` áp dụng nhất quán, tính toán dòng hàng, thuế GTGT chuẩn | Không dùng số thực (floating point); tính toán số học chính xác |
| **F-17** | **PASS** | Baseline Test Suite | `cp2-smoke.mjs` đạt 15/15 PASS, p95 21.01ms | Toàn bộ luồng hóa đơn cốt lõi của Đề 18 được bảo vệ tuyệt đối |

---

## 3. Kiểm toán Chi tiết 14 Lĩnh vực Chuyên sâu

### 3.1. Cơ sở Dữ liệu (Database Schema, Constraints, Migrations)
- **Hiện trạng thực tế:** PostgreSQL 16.15 có 17 bảng trong schema `public`. File migration `db/init/04-evolution.sql` đã chạy thành công.
- **Độ chính xác tài chính (PASS):** Mọi trường tiền tệ trong các bảng mới và mở rộng (`products.unit_price`, `invoices.subtotal`, `invoice_items.line_total`, `payments.amount`, `payment_allocations.allocated_amount`, `invoice_adjustments.total_amount`, `recurring_plans.amount_per_period`) đều được định kiểu `NUMERIC(14,2)`. Ràng buộc `CHECK (credit_limit >= 0)`, `CHECK (amount >= 0)` hoạt động chuẩn mực.
- **Ràng buộc khóa ngoại & chỉ mục (PASS):** Các ràng buộc `ON DELETE SET NULL` (cho `payment_term_id`) và `ON DELETE RESTRICT` (cho các liên kết tài chính) ngăn chặn xóa mồ côi.
- **Bất cập phát hiện (F-03, F-11):**
  - Bảng `audit_logs` thiếu hẳn các cột `hash`, `prev_hash`, `old_values`, `new_values`.
  - Bảng `customers` có ràng buộc: `CHECK (segment IN ('Enterprise', 'SME', 'FDI'))`. Trong khi đó, Frontend lại cung cấp các lựa chọn `RETAIL`, `SME`, `ENTERPRISE`, `VIP`. Khi người dùng chọn `RETAIL`, hàm `customerInput` trong `customers.js` không tìm thấy trong tập hợp cho phép nên âm thầm ghi đè về `'SME'`.

---

### 3.2. Nghiệp vụ Lõi Billing (Lifecycle, Immutability, Adjustments)
- **Vòng đời Hóa đơn (PASS):** Ràng buộc máy trạng thái `DRAFT` → `ISSUED` → `PARTIALLY_PAID` → `PAID` và `CANCELLED` tuân thủ nguyên tắc bất biến (Immutability). Hóa đơn đã phát hành bị cấm sửa đổi dòng hàng; hóa đơn có thanh toán bị cấm hủy.
- **Biên bản Điều chỉnh / Credit Notes (CRITICAL - F-02):**
  - **Bằng chứng code tại `app/src/routes/adjustments.js` (dòng 166-186):**
    ```javascript
    router.post('/:id/process', requireRole('admin'), asyncRoute(async (req, res) => {
      ...
      await client.query(
        `UPDATE public.invoice_adjustments SET status = 'PROCESSED' WHERE id = $1`,
        [id]
      );
      return adj;
    }));
    ```
  - **Phân tích:** Khi kế toán phê duyệt và xử lý một Credit Note giảm 5.000.000 ₫ cho hóa đơn 20.000.000 ₫, số nợ của hóa đơn trên hệ thống **vẫn giữ nguyên là 20.000.000 ₫**. Bảng `invoices` không được cập nhật trừ nợ, và không có bản ghi bù trừ nào được sinh ra trong bảng `payments`. Tính năng Credit Note thực chất chỉ là một bản ghi biểu mẫu độc lập, không gắn kết vào sổ cái công nợ.

---

### 3.3. Tính Đúng đắn của Dữ liệu Tài chính (Financial Correctness)
- **Công thức tính dòng hàng & Thuế (PASS):**
  `line_total = round(quantity * unit_price * (1 - discount_percent / 100), 2)`. Tính toán hoàn toàn trong PostgreSQL bằng hàm `round(..., 2)` trên kiểu `numeric`, triệt tiêu sai số dấu phẩy động.
- **Báo cáo Tuổi nợ (Aging Matrix) & Thu hồi nợ (DSO / CEI) (PASS tại Backend):**
  - Phân loại 5 kỳ hạn nợ: Hiện tại (`due_date >= current_date`), 1-30 ngày, 31-60 ngày, 61-90 ngày, và trên 90 ngày được gom nhóm chính xác bằng câu lệnh `CASE WHEN current_date - due_date ...`.
  - Công thức DSO: `(Receivables / Sales_90d) * 90` và CEI: `(Collected_90d / (Receivables + Sales_90d)) * 100` tuân thủ chuẩn kế toán quản trị doanh nghiệp.
- **Lỗi Báo cáo phía Frontend (CRITICAL - F-04):**
  Backend `reports.js` trả về `{ summary, customers }`, nhưng file `app.js` lại gọi `data.matrix.map(...)`. Do `data.matrix` là `undefined`, trình duyệt quăng ngoại lệ `TypeError: Cannot read properties of undefined (reading 'map')` và làm sập giao diện báo cáo.

---

### 3.4. Hóa đơn Thuê bao Định kỳ (Recurring Billing)
- **Cơ chế Sinh Hóa đơn (PASS khi gọi API):**
  Khi gọi `POST /api/recurring-plans/:id/trigger`, hệ thống mở transaction, chèn hóa đơn nháp, chèn dòng hàng tương ứng với số kỳ cước (`Kỳ cước X`), tính toán tổng tiền và tăng số chu kỳ hoàn thành.
- **Thiếu Bộ Lập lịch Chạy ngầm (HIGH - F-06):**
  Hệ thống hoàn toàn không có tiến trình chạy ngầm (Node `cron`, `node-cron`, hoặc worker container) để tự động quét `next_run_date <= current_date`. Trong môi trường thực tế, nếu kế toán không truy cập hệ thống và bấm nút thủ công cho từng hợp đồng, các hóa đơn định kỳ sẽ không bao giờ được sinh ra.
- **Rủi ro Lệch Tháng (LOW - F-14):**
  Hàm `calculateNextDate` dùng `current.setMonth(current.getMonth() + 1)`. Trong JavaScript, nếu ngày bắt đầu là `31/01`, `setMonth(+1)` sẽ tự động nhảy sang `03/03` (hoặc `02/03`), làm lệch ngày thanh toán định kỳ của khách hàng.

---

### 3.5. Đối soát Ngân hàng (Bank Reconciliation)
- **Động cơ Tự động Khớp lệnh (PASS tại Backend):**
  Thuật toán trong `reconciliation.js` tìm kiếm hóa đơn theo 3 nấc: (1) Số hóa đơn trong nội dung chuyển khoản, (2) Mã số thuế + số tiền khớp chính xác nợ còn lại, (3) Tên khách hàng + số tiền khớp chính xác. Khi khớp, hệ thống tạo bản ghi thanh toán thật và cập nhật hóa đơn sang `PAID`/`PARTIALLY_PAID`.
- **Lỗi Xử lý Thừa Tiền (MEDIUM - F-12):**
  Dòng 101: `const payAmt = Math.min(Number(tx.amount), Number(inv.outstanding)).toFixed(2)`. Nếu khách hàng nợ 5 triệu nhưng chuyển khoản 6 triệu, hệ thống chỉ ghi nhận thanh toán 5 triệu, còn 1 triệu dư thừa bị bỏ qua không lưu vết, và giao dịch ngân hàng vẫn bị đánh dấu `MATCHED` trọn vẹn.
- **Lỗi Đường dẫn Giao diện (CRITICAL - F-01):**
  Giao diện gọi `/api/reconciliation/transactions` (nhận mã 404) thay vì `/api/bank-transactions`.

---

### 3.6. Kiểm soát Truy cập Phân quyền (RBAC)
- **Hiện trạng Triển khai (HIGH - F-08):**
  - PostgreSQL đã tạo 3 bảng: `roles`, `permissions`, `role_permissions` và nạp sẵn dữ liệu danh mục quyền.
  - Tuy nhiên, qua kiểm tra toàn bộ mã nguồn `app/src/`, **không có bất kỳ middleware nào kiểm tra quyền hạn chi tiết**. Ví dụ: không có hàm `requirePermission('invoices:issue')`.
  - Hệ thống chỉ duy trì 2 cấp bậc thô sơ từ ban đầu: `requireAuth` (đã đăng nhập) và `requireRole('admin')`.
  - Tính năng RBAC hiện chỉ dừng lại ở mức mô hình dữ liệu tĩnh hiển thị qua API tra cứu, chưa có hiệu lực bảo vệ thực tế trên các luồng nghiệp vụ.

---

### 3.7. Nhật ký Kiểm toán & Tính Toàn vẹn Mật mã (Audit Trail)
- **Ghi nhận Sự kiện Nghiệp vụ (PASS):**
  Mọi hành động quan trọng (`INVOICE_ISSUED`, `PAYMENT_RECORDED`, `CREDIT_NOTE_CREATED`, `RECURRING_INVOICE_GENERATED`, `AUTO_RECONCILIATION_RUN`) đều gọi hàm `recordAudit` để ghi vào bảng `audit_logs` với đầy đủ `actor_name`, `ip_address`, `action`, `summary`.
- **Tính Toàn vẹn Mật mã SHA-256 (CRITICAL - F-03):**
  - Final Report tuyên bố: *"Nhật ký kiểm toán bất biến bảo vệ bằng chuỗi mã băm SHA-256 liên kết (hash, prev_hash)... GET /api/audit/verify duyệt toàn bộ cây lịch sử kiểm tra chữ ký băm"*.
  - **Sự thật kiểm toán:** Bảng `audit_logs` không có cột lưu mã băm. Endpoint `POST /api/audit-logs/verify` chỉ thực hiện `SELECT count(*)::text AS count FROM public.audit_logs` rồi trả về `verified: true`. Đây là cơ chế kiểm tra giả lập (mock verification), hoàn toàn không có thuật toán xác minh chuỗi băm hay phát hiện sửa đổi dữ liệu.

---

### 3.8. Bản chất Mã Hóa đơn Điện tử (E-Invoice Code)
- **Xác minh Hiện trạng (HIGH - F-07):**
  - Theo yêu cầu kiểm toán: *"Xác định chính xác e_invoice_code hiện tại là mã nội bộ, mã mô phỏng, hay tích hợp thật với hệ thống/cổng hóa đơn điện tử. Không được gọi là mã CQT thật nếu chưa có integration thực tế"*.
  - **Bằng chứng tại `app/src/routes/invoices.js` (dòng 273-274):**
    ```javascript
    const seqVal = invoiceNo.split('-')[2] || '000001';
    const eInvoiceCode = invoice.e_invoice_code || `1C25TND-${seqVal}`;
    ```
  - **Kết luận:** Mã `e_invoice_code` hiện tại **100% là mã mô phỏng nội bộ (Internal Simulated Identifier)** sinh ra theo mẫu ký hiệu hóa đơn của Thông tư 78. Hệ thống hoàn toàn chưa có kết nối API truyền nhận dữ liệu với Cổng tiếp nhận của Tổng cục Thuế hoặc các nhà cung cấp dịch vụ hóa đơn điện tử (T-VAN).

---

### 3.9. Giao diện Người dùng (Frontend Implementation)
- **Kiến trúc & Thẩm mỹ (PASS):**
  Mã nguồn `app/public/app.js` và `app/public/styles.css` được xây dựng thuần Vanilla JS/CSS, giao diện sắc nét, hỗ trợ Dark Mode (`data-theme="dark"`), không sử dụng thư viện nặng nề, bảo đảm an ninh CSP.
- **Đứt gãy Tích hợp API (CRITICAL - F-01, F-04, F-05, F-10, F-13):**
  Do sai lệch tên trường và URL endpoint giữa Frontend và Backend, nhiều màn hình trên giao diện bị hỏng chức năng khi người dùng thao tác thực tế (xem bảng chi tiết ở Mục 4).

---

### 3.10. Tầng Giao tiếp API (API Inventory & Consistency)
- **Hiện trạng:** Hệ thống có 54 endpoints được định nghĩa trong Express.
- **Bất nhất Quán về Định tuyến (MEDIUM):**
  Trong `app/src/routes/index.js`, một số router được mount với tiền tố danh từ số nhiều (`/recurring-plans`, `/audit-logs`, `/bank-transactions`), trong khi giao diện người dùng lại gọi dạng số ít hoặc đường dẫn rút gọn (`/recurring`, `/audit`, `/reconciliation/transactions`). Việc thiếu chuẩn hóa API contract dẫn đến tình trạng test backend bằng script thì PASS nhưng click trên trình duyệt thì nhận 404.

---

### 3.11. An ninh & Bảo mật Ứng dụng (Application Security)
- **Chống SQL Injection (PASS):** 100% câu truy vấn cơ sở dữ liệu đều sử dụng tham số hóa (`$1, $2, ...`), không có hiện tượng cộng chuỗi SQL.
- **Chống XSS (PASS):** Mã nguồn frontend dùng phương thức `element.textContent = String(text)` và không sử dụng `innerHTML`.
- **Bảo mật Phiên làm việc (PASS):** Cookie session có đủ thuộc tính `HttpOnly`, `SameSite=Strict`, `Secure` (trên HTTPS), thời gian sống 8 tiếng.
- **Bảo mật Dữ liệu Nhạy cảm (PASS):** Mật khẩu người dùng được băm bằng bcrypt cost factor 12, không bị trả về qua API hay ghi vào log file.

---

### 3.12. Hạ tầng & Cơ chế Vận hành (Infrastructure & Operations)
- **Trạng thái Container (PASS):** Cả 12 container trong Docker Compose đều UP và Healthy.
- **Nginx Reverse Proxy (PASS):** Hoạt động ở cổng 443 với chứng chỉ TLS, che giấu phiên bản Nginx (`server_tokens off`), chuyển hướng 301 từ cổng 80, chặn truy cập trực tiếp vào cổng nội bộ web (3000) và database (5432).
- **Hệ thống Giám sát & Log (PASS):** Prometheus thu thập đủ 6/6 jobs UP. Grafana hiển thị biểu đồ thực tế. Loki và Promtail thu thập log tập trung.

---

### 3.13. Đánh giá Bộ Kiểm thử (Testing Evaluation)
- **Baseline Suite (`cp2-smoke.mjs`):** PASS 15/15 checks (Latency p95: 21.01ms). Bảo đảm không có hồi quy trên chức năng cốt lõi.
- **Hardening Verifier (`verify-hardening.ps1`):** PASS toàn bộ H1.1 đến H6.3.
- **Extended Test Suite (`extended-features-test.mjs`):** PASS 12/12 modules.
  - *Lý do test PASS dù hệ thống có lỗi:* Test script này được viết để gọi trực tiếp các endpoint backend với payload được thiết kế riêng cho backend (ví dụ: gọi `/api/recurring-plans` thay vì `/api/recurring`, gọi `/api/reports/revenue` thay vì `/api/reports/revenue-analytics`), do đó **không phát hiện được sự đứt gãy giữa Frontend và Backend**, cũng như không kiểm tra xem Credit Note sau khi process có thực sự trừ nợ hóa đơn hay không.

---

### 3.14. Chất lượng Mã nguồn (Code Quality)
- **Thiếu Kiểm thử Tích hợp Đầu-Cuối (End-to-End Testing):** Hệ thống thiếu một bộ test kiểm thử từ tầng DOM giao diện xuống API để phát hiện sai lệch tên biến giữa client và server.
- **Logic Giả lập (Placebo Logic):** Hàm xác thực chuỗi băm trong `audit.js` là mã giả lập cần được thay thế bằng thuật toán xác thực chuỗi Merkel hoặc chuỗi băm liên kết thật.

---

## 4. Chi tiết Báo cáo Từng Lỗi (Issue Detail Reports)

### Lỗi 1: [CRITICAL] Đứt gãy Đường dẫn API giữa Frontend và Backend (F-01)
- **Module:** `app/public/app.js` vs `app/src/routes/index.js`
- **Nguyên nhân:** Tên tuyến đường trong code giao diện không khớp với route được mount trong Express:
  - Frontend gọi `api('/recurring')` ➔ Backend mount tại `/api/recurring-plans`.
  - Frontend gọi `api('/reconciliation/transactions')` ➔ Backend mount tại `/api/bank-transactions`.
  - Frontend gọi `api('/reports/revenue-analytics')` ➔ Backend là `/api/reports/revenue`.
  - Frontend gọi `api('/reports/vat-declaration')` ➔ Backend là `/api/reports/vat`.
  - Frontend gọi `api('/audit')` ➔ Backend mount tại `/api/audit-logs`.
- **Ảnh hưởng:** Người dùng không thể xem Thuê bao, Đối soát ngân hàng, Báo cáo Doanh thu, Báo cáo Thuế và Nhật ký kiểm toán trên trình duyệt (nhận lỗi 404).
- **Bằng chứng:** Kiểm tra trực tiếp qua curl/fetch trả về HTTP 404 cho cả 5 đường dẫn trên.
- **Cách sửa:** Đồng bộ hóa URL trong `app/public/app.js` cho khớp chính xác với router backend, hoặc thêm alias route trong Express.
- **Mức ưu tiên:** CRITICAL.

---

### Lỗi 2: [CRITICAL] Quy trình Xử lý Credit Note Không Khấu trừ Công nợ (F-02)
- **Module:** `app/src/routes/adjustments.js` (dòng 166-186)
- **Nguyên nhân:** Khi gọi `POST /api/adjustments/:id/process`, câu lệnh SQL chỉ cập nhật duy nhất bảng `invoice_adjustments`:
  `UPDATE public.invoice_adjustments SET status = 'PROCESSED' WHERE id = $1`.
- **Ảnh hưởng:** Dù biên bản điều chỉnh giảm giá đã được duyệt và xử lý thành công, số nợ `outstanding` của hóa đơn và của khách hàng không hề suy giảm. Doanh thu báo cáo bị sai lệch so với thực tế.
- **Bằng chứng:** Trong cơ sở dữ liệu, hóa đơn sau khi áp dụng Credit Note vẫn giữ nguyên `paid_total` và `total`.
- **Cách sửa:** Trong transaction xử lý adjustment, bổ sung logic tính toán:
  - Nếu là `DISCOUNT` hoặc `DECREASE_AMOUNT`: Cập nhật giảm `total` của hóa đơn hoặc tăng `paid_total` (coi như một khoản thanh toán điều chỉnh giảm trừ nợ), và tự động cập nhật trạng thái hóa đơn sang `PAID` nếu nợ về 0.
- **Mức ưu tiên:** CRITICAL.

---

### Lỗi 3: [CRITICAL] Cơ chế Chuỗi Băm Kiểm toán SHA-256 là Giả lập (F-03)
- **Module:** `db/init/04-evolution.sql` & `app/src/routes/audit.js`
- **Nguyên nhân:** Bảng `audit_logs` không được thiết kế các cột `hash` và `prev_hash`. Hàm `POST /api/audit-logs/verify` chỉ đếm dòng và trả về kết quả thành công hardcoded.
- **Ảnh hưởng:** Sai lệch nghiêm trọng so với tài liệu thiết kế và cam kết an toàn dữ liệu; hệ thống không có khả năng phát hiện việc sửa đổi trái phép dữ liệu kiểm toán.
- **Bằng chứng:** `\d audit_logs` trong PostgreSQL không có cột băm; mã nguồn `audit.js` không có logic băm liên hoàn (Chaining hash).
- **Cách sửa:** Thêm cột `hash` và `prev_hash` vào bảng `audit_logs`. Khi ghi log, tính toán `hash = SHA256(prev_hash + id + action + timestamp + data)`. Trong endpoint `/verify`, thực hiện vòng lặp duyệt toàn bộ bảng từ bản ghi đầu tiên để kiểm tra tính toàn vẹn của từng mắt xích.
- **Mức ưu tiên:** CRITICAL.

---

### Lỗi 4: [CRITICAL] Crash Màn hình Báo cáo Tuổi nợ (F-04)
- **Module:** `app/public/app.js` (dòng 725-745)
- **Nguyên nhân:** Frontend cố gắng truy cập `data.matrix.map(...)` trong khi backend `GET /api/reports/aging` trả về đối tượng có cấu trúc `{ summary, customers }`.
- **Ảnh hưởng:** Người dùng click vào tab "Ma trận tuổi nợ" sẽ khiến giao diện bị sập với ngoại lệ Uncaught TypeError.
- **Bằng chứng:** Kiểm tra cấu trúc JSON trả về của `/api/reports/aging`: trường chứa danh sách khách hàng là `customers`, không phải `matrix`.
- **Cách sửa:** Đổi `data.matrix.map(...)` thành `data.customers.map(...)` trong file `app.js`.
- **Mức ưu tiên:** CRITICAL.

---

### Lỗi 5: [HIGH] Lệch Schema Form Lập Biên bản Điều chỉnh (F-05)
- **Module:** `app/public/app.js` (dòng 585-610) vs `app/src/routes/adjustments.js`
- **Nguyên nhân:**
  - Frontend gửi trường: `invoice_id`, `type` (với các giá trị: `CREDIT_NOTE`, `DEBIT_NOTE`, `REPLACEMENT`).
  - Backend yêu cầu trường: `original_invoice_id`, `adjustment_type` (với các giá trị: `DISCOUNT`, `DECREASE_AMOUNT`, `SERVICE_RETURN`, `INFO_CORRECTION`).
- **Ảnh hưởng:** Người dùng không thể tạo bất kỳ biên bản điều chỉnh nào qua giao diện; form luôn bị từ chối với lỗi 400 `INVALID_ID` hoặc `INVALID_ADJUSTMENT_TYPE`.
- **Bằng chứng:** Thử gửi form từ giao diện nhận phản hồi: `{"error":{"code":"INVALID_ID","message":"original_invoice_id must be a positive integer."}}`.
- **Cách sửa:** Sửa form trong `app.js` để gửi đúng tên trường `original_invoice_id` và giá trị `adjustment_type` tương thích với backend.
- **Mức ưu tiên:** HIGH.

---

### Lỗi 6: [HIGH] Thuê bao Định kỳ Thiếu Tiến trình Chạy Tự động (F-06)
- **Module:** `app/src/routes/recurring.js`
- **Nguyên nhân:** Chỉ có endpoint tiếp nhận kích hoạt thủ công `/trigger`; không có timer hoặc cron daemon định kỳ quét các hợp đồng đến hạn.
- **Ảnh hưởng:** Hệ thống không tự động vận hành nghiệp vụ SaaS / hóa đơn định kỳ như mô tả; phụ thuộc hoàn toàn vào con người.
- **Cách sửa:** Bổ sung một module scheduler trong Node.js (sử dụng `setInterval` hoặc cron job) chạy mỗi ngày một lần lúc 00:00 để quét và kích hoạt các hợp đồng có `status = 'ACTIVE'` và `next_run_date <= current_date`.
- **Mức ưu tiên:** HIGH.

---

### Lỗi 7: [HIGH] Mã E-Invoice là Mã Nội bộ, Không Phải Mã CQT (F-07)
- **Module:** `app/src/routes/invoices.js` & Tài liệu Báo cáo
- **Nguyên nhân:** Mã `e_invoice_code` được tạo tự động bằng cú pháp nối chuỗi `1C25TND-${seqVal}`.
- **Ảnh hưởng:** Đưa thông tin không chính xác vào tài liệu nghiệm thu; tạo kỳ vọng sai về khả năng tích hợp thuế của hệ thống.
- **Cách sửa:** Cập nhật lại tài liệu và giao diện, ghi rõ đây là **"Mã Hóa đơn Điện tử Nội bộ (Mô phỏng chuẩn TT78)"**, không ghi là "Mã do Cục Thuế cấp" cho đến khi hoàn thành tích hợp cổng T-VAN thật.
- **Mức ưu tiên:** HIGH.

---

### Lỗi 8: [HIGH] RBAC Chưa Được Thực thi ở Tầng Nghiệp vụ (F-08)
- **Module:** `app/src/routes/rbac.js` & Các routes nghiệp vụ
- **Nguyên nhân:** Bảng quyền hạn tồn tại nhưng không có middleware nào đối chiếu quyền của người dùng đang đăng nhập với danh mục `role_permissions`.
- **Ảnh hưởng:** Bất kỳ nhân viên nào có role `staff` đều có quyền thao tác trên các module mà đáng lẽ cần quyền kế toán riêng biệt.
- **Cách sửa:** Xây dựng middleware `requirePermission(permCode)` truy vấn bảng `role_permissions` hoặc cache quyền trong session để kiểm soát từng hành động (tạo hóa đơn, duyệt chiết khấu, xem báo cáo).
- **Mức ưu tiên:** HIGH.

---

### Lỗi 9: [HIGH] Sai lệch Lịch sử Thanh toán khi Phân bổ Đa Hóa đơn (F-09)
- **Module:** `app/src/routes/payments.js` (dòng 169-215)
- **Nguyên nhân:** Endpoint `/payments/allocate` chèn một bản ghi thanh toán vào bảng `payments` gắn với `primaryInvoiceId` nhưng lại mang toàn bộ số tiền `totalAmount`.
- **Ảnh hưởng:** Khi xem chi tiết hóa đơn chính, lịch sử thanh toán hiển thị số tiền lớn hơn tổng tiền hóa đơn; trong khi các hóa đơn phụ còn lại thì lịch sử thanh toán hoàn toàn trống rỗng dù trạng thái là `PAID`.
- **Cách sửa:** Chèn từng dòng thanh toán tương ứng vào bảng `payments` cho mỗi hóa đơn được phân bổ, liên kết bằng mã giao dịch chung trong trường `reference`.
- **Mức ưu tiên:** HIGH.

---

## 5. Trả lời 4 Câu hỏi Bắt buộc Sau Kiểm toán

Dựa trên toàn bộ kết quả kiểm toán độc lập bằng mã nguồn, cơ sở dữ liệu và runtime thực tế:

### 1. Có thể tiếp tục Security Hardening hay chưa?
> **TRẢ LỜI: CHƯA NÊN TIẾP TỤC.**  
> Hiện tại hệ thống đang tồn tại **4 lỗi CRITICAL** và **5 lỗi HIGH** liên quan trực tiếp đến tính đúng đắn của logic tài chính và sự đứt gãy giao diện người dùng. Việc tiếp tục siết chặt Security Hardening ở giai đoạn này sẽ che lấp các lỗi logic nghiệp vụ cốt lõi. Cần khắc phục dứt điểm các lỗi CRITICAL và HIGH đã nêu trước khi chuyển sang giai đoạn kế tiếp.

### 2. Có lỗi CRITICAL/HIGH hay không?
> **TRẢ LỜI: CÓ.**  
> - **4 lỗi CRITICAL:** F-01 (Đứt gãy đường dẫn API giao diện 404), F-02 (Credit Note không trừ nợ hóa đơn gốc), F-03 (Chuỗi băm kiểm toán SHA-256 là giả lập), F-04 (Crash tab báo cáo tuổi nợ Aging).  
> - **5 lỗi HIGH:** F-05 (Lệch schema form điều chỉnh), F-06 (Thiếu scheduler tự động cho thuê bao định kỳ), F-07 (Mô tả sai bản chất mã e-invoice CQT), F-08 (RBAC hạt nhân chưa áp dụng), F-09 (Sai lệch dòng tiền thanh toán phân bổ đa hóa đơn).

### 3. Có regression (hồi quy) hay không?
> **TRẢ LỜI: KHÔNG CÓ HỒI QUY TRÊN CORE V1.**  
> Toàn bộ 15 bài kiểm thử baseline (`cp2-smoke.mjs`), các tiêu chuẩn bảo mật hệ thống H1–H6 (`verify-hardening.ps1`), và các luồng khách hàng - hóa đơn - thanh toán nguyên bản của Đề 18 vẫn đạt **PASS 100%**. Mọi lỗi phát sinh đều nằm ở **tầng tích hợp mới của các tính năng mở rộng từ LedgerFlow**.

### 4. Có feature nào thực tế chưa hoàn thành dù Final Report ghi DONE hay không?
> **TRẢ LỜI: CÓ 4 TÍNH NĂNG CHƯA HOÀN THÀNH ĐÚNG NGHĨA:**
> 1. **Biên bản Điều chỉnh & Credit Notes (Feature 7):** Chưa hoàn thành vì mới chỉ có giao diện và bảng dữ liệu, chưa gắn kết vào logic trừ nợ hóa đơn trong sổ cái kế toán.
> 2. **Nhật ký Kiểm toán Mật mã SHA-256 (Feature 11):** Chưa hoàn thành vì cơ sở dữ liệu không lưu chuỗi băm, hàm verify chỉ là đếm dòng giả lập.
> 3. **Phân quyền Hạt nhân RBAC (Feature 10):** Chưa hoàn thành vì các quyền mới chỉ lưu trong database, chưa có tác dụng phân quyền bảo vệ request thực tế.
> 4. **Hóa đơn Điện tử Cục Thuế (Feature 4 - E-Invoice):** Chưa hoàn thành kết nối thật, mới chỉ dừng ở mức sinh chuỗi ký hiệu mô phỏng nội bộ.

---

> **KẾT LUẬN CỦA KIỂM TOÁN VIÊN:**  
> Hệ thống Billing_One có nền tảng hạ tầng (Docker, Nginx, PostgreSQL, Monitoring) cực kỳ vững chắc và an toàn. Tuy nhiên, tầng ứng dụng tích hợp nghiệp vụ doanh nghiệp cần một đợt chuẩn hóa và sửa lỗi (Remediation Phase) nhằm đồng bộ hóa API contracts, hoàn thiện logic kế toán trừ nợ của Credit Notes, và hiện thực hóa thuật toán chuỗi băm mật mã trước khi nghiệm thu sản xuất.
