# BILLING_ONE EXTENDED — KIẾN TRÚC MỤC TIÊU (TARGET ARCHITECTURE)

> **Tài liệu đặc tả kiến trúc hệ thống mở rộng**  
> **Target Version:** `Billing_One Extended (v2.0)`  
> **Nguyên tắc cốt lõi:** Bảo toàn và kế thừa 100% hạ tầng hiện hữu (Nginx TLS, Docker Compose 12 containers, PostgreSQL 16, Prometheus/Grafana, Loki/Promtail).  
> **Mục tiêu:** Mở rộng thành nền tảng kế toán tài chính doanh nghiệp hoàn chỉnh (Enterprise Billing & Financial Management Platform).

---

## 1. SƠ ĐỒ KIẾN TRÚC TỔNG THỂ (HIGH-LEVEL ARCHITECTURE)

```text
                                        [ CLIENT BROWSERS ]
                                                │
                                    HTTPS :443 / HTTP :80 (301)
                                                ▼
  ┌───────────────────────────────────────────────────────────────────────────────────────────┐
  │ EDGE TIER — NGINX (Unprivileged Alpine)                                                   │
  │ • TLS 1.2 / 1.3 Termination                                                               │
  │ • H1-H6 Security Headers (HSTS, CSP, X-Frame-Options DENY, nosniff)                       │
  │ • Rate Limiting (login zone 5r/m burst 5)                                                 │
  │ • Trace Correlation (X-Request-Id injection)                                              │
  │ • Static Asset Caching                                                                    │
  └─────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                                │ proxy_pass http://web:3000
                                                ▼ (app_net)
  ┌───────────────────────────────────────────────────────────────────────────────────────────┐
  │ APPLICATION TIER — BILLING_ONE EXTENDED (Node.js 24 + Express 5)                          │
  │                                                                                           │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐  │
  │  │ HTTP Middleware & Security Pipeline                                                 │  │
  │  │ • Request UUID & Structured Logger (JSON)                                           │  │
  │  │ • Prometheus Metrics Collector (prom-client)                                        │  │
  │  │ • Session Manager (connect-pg-simple / secure cookie)                               │  │
  │  │ • RBAC & Permission Enforcement Engine (requireAuth, requirePermission)             │  │
  │  │ • Strict Input Validation & Schema Sanitizer                                        │  │
  │  └──────────────────────────────────────────┬──────────────────────────────────────────┘  │
  │                                             ▼                                             │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐  │
  │  │ RESTful API Layer (/api)                                                            │  │
  │  │ ├─ /auth             ├─ /customers         ├─ /products         ├─ /payment-terms   │  │
  │  │ ├─ /invoices         ├─ /payments          ├─ /adjustments      ├─ /recurring-plans │  │
  │  │ ├─ /reconciliation   ├─ /reports (aging, DSO, revenue, VAT)     ├─ /audit-logs      │  │
  │  └──────────────────────────────────────────┬──────────────────────────────────────────┘  │
  │                                             ▼                                             │
  │  ┌─────────────────────────────────────────────────────────────────────────────────────┐  │
  │  │ Domain Service & Business Logic Tier                                                │  │
  │  │ ├─ Customer & Credit Service     ├─ Product Catalog Service                         │  │
  │  │ ├─ Payment Terms Engine          ├─ Invoice Lifecycle & Calculation Engine          │  │
  │  │ ├─ Payment & Allocation Engine   ├─ Credit Note & Refund Engine                     │  │
  │  │ ├─ Recurring Billing Scheduler   ├─ Bank Statement Matching Engine                  │  │
  │  │ ├─ Aging & DSO Financial Engine  ├─ Tax & VAT Compliance Engine                     │  │
  │  │ └─ Tamper-Evident Business Audit Service                                            │  │
  │  └──────────────────────────────────────────┬──────────────────────────────────────────┘  │
  └─────────────────────────────────────────────┼─────────────────────────────────────────────┘
                                                │ pg connection pool (10 clients)
                                                ▼ (db_net)
  ┌───────────────────────────────────────────────────────────────────────────────────────────┐
  │ DATA TIER — POSTGRESQL 16 (SOURCE OF TRUTH)                                               │
  │                                                                                           │
  │  Core Entities:                                                                           │
  │  • users, roles, permissions, role_permissions, user_sessions                             │
  │  • customers, payment_terms                                                               │
  │  • products                                                                               │
  │  • invoices, invoice_items, invoice_no_seq                                                │
  │  • payments, payment_allocations                                                          │
  │  • invoice_adjustments (Credit Notes / Refunds)                                           │
  │  • recurring_plans                                                                        │
  │  • bank_transactions                                                                      │
  │  • audit_logs (append-only)                                                               │
  │  • company_settings                                                                       │
  │                                                                                           │
  │  Guarantees:                                                                              │
  │  • Exact NUMERIC(14,2) decimal precision (No floating point drift)                         │
  │  • Strict Foreign Keys (ON DELETE RESTRICT / CASCADE)                                     │
  │  • CHECK Constraints on amounts, tax rates, statuses, date logic                          │
  │  • Transaction Concurrency Isolation (SELECT ... FOR UPDATE)                              │
  └───────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▲
                    ┌───────────────────────────┴───────────────────────────┐
                    │                                                       │
  ┌─────────────────┴─────────────────────────┐   ┌─────────────────────────┴─────────────────┐
  │ OBSERVABILITY TIER                        │   │ LOGGING TIER                              │
  │ • Prometheus v3.15.0                      │   │ • Loki v3.7.8 (Retention 72h)             │
  │ • Grafana v13.2.3                         │   │ • Promtail v3.6.11                        │
  │ • postgres-exporter, nginx-exporter       │   │ • JSON structured log parsing             │
  │ • cadvisor, node-exporter                 │   │ • Correlation qua X-Request-Id            │
  └───────────────────────────────────────────┘   └───────────────────────────────────────────┘
```

---

## 2. NGUYÊN TẮC THIẾT KẾ & TÍNH ĐÚNG ĐẮN TÀI CHÍNH (FINANCIAL INTEGRITY FIRST)

1. **Số học tài chính tuyệt đối (Exact Decimal Arithmetic):**
   - Mọi giá trị tiền tệ trong toàn bộ hệ thống đều được lưu trữ dưới kiểu `NUMERIC(14, 2)` trong PostgreSQL.
   - Các phép tính nhân thuế suất, tính chiết khấu hoặc phân bổ đều được làm tròn qua hàm `round(..., 2)` của PostgreSQL hoặc thư viện xử lý số nguyên / chuỗi số ở backend.
   - Frontend không tự tính toán tổng tiền rồi gửi lên server; backend luôn là nơi duy nhất tính toán và xác thực thành tiền.

2. **Tính bất biến của chứng từ phát hành (Issued Record Immutability):**
   - Hóa đơn một khi đã chuyển trạng thái sang `ISSUED`, `PARTIALLY_PAID`, hoặc `PAID` sẽ **bị cấm tuyệt đối** việc cập nhật trực tiếp dòng hàng, số tiền, khách hàng, ngày phát hành qua `UPDATE`.
   - Mọi thay đổi về giá trị tài chính phát sinh sau khi phát hành (chiết khấu thương mại, trả lại hàng, bớt giá, hoàn tiền) bắt buộc phải thực hiện thông qua **Biên bản Điều chỉnh / Hóa đơn Giảm trừ (Credit Note / `invoice_adjustments`)** có liên kết tham chiếu tới hóa đơn gốc.

3. **Kiểm soát đồng thời và Chống gian lận hai lần chi (Concurrency & Double-Payment Prevention):**
   - Mọi thao tác ghi nhận thanh toán (`POST /payments`), phân bổ (`payment_allocations`), hoặc hoàn tiền đều được thực thi bên trong transaction PostgreSQL sử dụng khóa bi quan:
     ```sql
     SELECT id, status, total, paid_total FROM public.invoices WHERE id = $1 FOR UPDATE;
     ```
   - Ràng buộc cứng tại DB: `paid_total <= total`, số tiền thanh toán `amount > 0` và `amount <= (total - paid_total)`.

4. **Idempotency & Chống trùng lặp:**
   - Các tác vụ chạy nền định kỳ (Recurring Billing) sinh hóa đơn tự động bắt buộc kiểm tra điều kiện Idempotency: không tạo hai hóa đơn cho cùng một hợp đồng trong cùng một chu kỳ kỳ cước.

---

## 3. PHÂN RÃ CÁC MODULE NGHIỆP VỤ MỤC TIÊU

### 3.1. Phân hệ Khách hàng & Hạn mức Công nợ (Customer & Credit Profile)
- Mở rộng thông tin doanh nghiệp: Mã định danh (`code`), phân khúc (`segment`: Enterprise, SME, FDI), người liên hệ, hạn mức công nợ (`credit_limit`).
- Liên kết với Điều khoản thanh toán mặc định (`payment_term_id`).
- Truy vấn tài chính tự động tính toán số nợ hiện hành (`current_debt`) và hạn mức còn khả dụng (`available_credit`).

### 3.2. Phân hệ Danh mục Sản phẩm & Dịch vụ (Product & Service Catalog)
- Bảng giá chuẩn doanh nghiệp: SKU, Tên, Danh mục (Hạ tầng Cloud, Bản quyền Phần mềm, Dịch vụ Kỹ thuật, Tư vấn), Đơn vị tính (Tháng, Gói, Năm, Lượt), Đơn giá mặc định, Thuế suất VAT mặc định (0%, 5%, 8%, 10%, KCT).
- Tích hợp vào Form lập hóa đơn: Khi người dùng chọn sản phẩm từ danh mục, hệ thống tự động điền đơn giá, đơn vị tính và thuế suất tiêu chuẩn, giảm thiểu tối đa sai sót kế toán thủ công.

### 3.3. Phân hệ Điều khoản Thanh toán (Payment Terms & Due Date Engine)
- Bảng cấu hình chính sách công nợ: Mã (NET_15, NET_30, NET_60, IMMEDIATE), Số ngày cho nợ (`days`), Thời gian ân hạn (`grace_period_days`), Tỷ lệ lãi phạt trễ hạn (`late_penalty_rate`), Chiết khấu thanh toán sớm (`early_discount_percent`, `early_discount_days`).
- Tự động hóa: Khi phát hành hóa đơn, hệ thống tự động tính ngày đến hạn: `due_date = issue_date + days`.

### 3.4. Phân hệ Thanh toán & Phân bổ (Payments & Payment Allocations)
- Hỗ trợ ghi nhận thông tin nguồn tiền: Ngân hàng giao dịch, số tài khoản, mã tham chiếu ủy nhiệm chi / QR.
- Bảng liên kết `payment_allocations`: Cho phép một khoản thanh toán được phân bổ cho một hoặc nhiều hóa đơn của cùng một khách hàng.

### 3.5. Phân hệ Điều chỉnh Hóa đơn, Giảm trừ & Hoàn tiền (Adjustments & Credit Notes)
- Bảng `invoice_adjustments`: Quản lý các chứng từ điều chỉnh hợp pháp theo Nghị định 123/2020/NĐ-CP.
- Các loại điều chỉnh: `DISCOUNT` (Chiết khấu thương mại), `DECREASE_AMOUNT` (Điều chỉnh giảm giá trị), `SERVICE_RETURN` (Thu hồi/trả lại dịch vụ), `INFO_CORRECTION` (Điều chỉnh thông tin).
- Quy trình trạng thái: `DRAFT` -> `APPROVED` -> `PROCESSED`. Khi được duyệt, tự động giảm trừ công nợ của hóa đơn tương ứng hoặc ghi nhận hoàn tiền.

### 3.6. Phân hệ Thuê bao & Hóa đơn Định kỳ (Recurring Billing Engine)
- Lưu trữ hợp đồng dịch vụ định kỳ: Khách hàng, tiêu đề dịch vụ, mã hợp đồng, tần suất (Hàng tháng, Hàng quý, Hàng năm), số tiền kỳ cước, ngày chạy kế tiếp (`next_run_date`), trạng thái (`ACTIVE`, `PAUSED`, `FAILED`, `COMPLETED`).
- Xử lý máy chủ: API kích hoạt hoặc scheduler quét các hợp đồng đến hạn, tự động tạo hóa đơn nháp hoặc phát hành, cập nhật chu kỳ hoàn thành và tính toán `next_run_date` tiếp theo.

### 3.7. Phân hệ Đối soát Sao kê Ngân hàng (Bank Statement Reconciliation)
- Quản lý giao dịch sao kê ngân hàng (`bank_transactions`): Ngày, giờ, nội dung diễn giải, số tiền, loại giao dịch (`CREDIT`/`DEBIT`), mã tham chiếu, ngân hàng.
- Matching Engine:
  - *Auto Match:* Tự động quét nội dung diễn giải tìm số hóa đơn (`INV-YYYY-XXXXXX`), mã khách hàng hoặc so khớp chính xác số tiền còn nợ.
  - *Manual Match:* Cho phép kế toán viên chọn hóa đơn tương ứng để đối soát và kích hoạt ghi nhận thanh toán tự động vào hóa đơn.

### 3.8. Phân hệ Báo cáo Tài chính & Tuổi nợ (Aging, Collection & Revenue Analytics)
- **Aging Report:** Phân bổ công nợ theo 5 nhóm tuổi nợ chuẩn: Hiện tại (Current), 1–30 ngày, 31–60 ngày, 61–90 ngày, Trên 90 ngày. Ma trận rủi ro công nợ theo từng khách hàng.
- **Collection & DSO:** Tính chỉ số vòng quay công nợ DSO (Days Sales Outstanding) và tỷ lệ thu hồi CEI.
- **Revenue Analytics:** Doanh thu thuần, doanh thu định kỳ thuê bao (MRR, ARR), cơ cấu doanh thu theo nhóm khách hàng và dịch vụ.

### 3.9. Phân hệ Kê khai & Báo cáo Thuế GTGT (VAT Reporting Engine)
- Tổng hợp doanh thu tính thuế và thuế GTGT bán ra theo từng mức thuế suất: 10%, 8%, 5%, 0% và Không chịu thuế (KCT).
- Trích xuất bảng kê bán ra phục vụ nộp báo cáo thuế định kỳ theo Mẫu 01-1/GTGT.

### 3.10. Phân hệ Phân quyền Hạt mịn RBAC & Nhật ký Kiểm toán (RBAC & Business Audit Trail)
- **RBAC:** Hệ thống phân quyền role - permission rõ ràng: Quản trị viên, Quản lý Billing, Kế toán viên, Nhân viên Billing, Kiểm toán viên. Middleware bảo vệ từng route tại backend.
- **Audit Trail:** Bảng `audit_logs` lưu trữ bất biến (append-only) thông tin người thao tác, IP, hành động, thực thể, mã tham chiếu, thời gian và dữ liệu cũ/mới của mọi giao dịch tài chính trọng yếu.

---

## 4. CHIẾN LƯỢC TÍCH HỢP HẠ TẦNG (INFRASTRUCTURE COMPATIBILITY)

Hệ thống tiếp tục duy trì 100% các tiêu chuẩn an toàn H1–H6 đã nghiệm thu:
1. **Docker Compose:** Không xóa hoặc đổi cấu trúc các container hiện hữu.
2. **Nginx:** Giữ nguyên các rule bảo mật, reverse proxy tới container web.
3. **Database:** CSDL PostgreSQL `billing` trên container `postgres` tiếp tục là nguồn chân lý duy nhất. Tất cả bảng mới được tạo qua file migration an toàn có kiểm tra `CREATE TABLE IF NOT EXISTS` và `ADD COLUMN IF NOT EXISTS`.
4. **Monitoring & Logging:** Prometheus tiếp tục scrape metric từ ứng dụng; Loki & Promtail tiếp tục thu thập log qua Docker socket; Grafana cung cấp dashboard giám sát hệ thống.
