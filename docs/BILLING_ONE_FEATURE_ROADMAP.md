# BILLING_ONE EXTENDED — LỘ TRÌNH PHÁT TRIỂN TÍNH NĂNG (FEATURE ROADMAP)

> **Kế hoạch triển khai tích hợp theo chuỗi phụ thuộc (Dependency-Driven Roadmap)**  
> **Cam kết:** Thực hiện tuần tự từng tính năng. Sau mỗi tính năng đều có Migration + Backend + API + Frontend + Test + Regression verification.

---

## 1. MA TRẬN PHỤ THUỘC TÍNH NĂNG (DEPENDENCY GRAPH)

```text
  [Phase 1: Core Baseline] (PASS 100%)
       │
       ├─────────────────────────────────┐
       ▼                                 ▼
  [Phase 2: Product Catalog]       [Phase 3: Payment Terms]
       │                                 │
       ├─────────────────────────────────┼─────────────────────────────────┐
       ▼                                 ▼                                 ▼
  [Phase 5: Invoice Enhancement]   [Phase 4: Customer Credit]       [Phase 10: Recurring Plans]
       │                                 │                                 │
       ▼                                 ▼                                 │
  [Phase 6: Payment Allocations]   [Phase 7: Aging Matrix & DSO]          │
       │                                 │                                 │
       ├─────────────────────────────────┼─────────────────────────────────┤
       ▼                                 ▼                                 ▼
  [Phase 9: Adjustments & Credit]  [Phase 8: Revenue & MRR/ARR]    [Phase 11: Bank Reconciliation]
       │                                 │                                 │
       └─────────────────────────────────┼─────────────────────────────────┘
                                         ▼
                     [Phase 12: Granular RBAC]
                                         ▼
                     [Phase 13: Business Audit Trail]
                                         ▼
                     [Phase 14: Tax & VAT Compliance]
                                         ▼
                     [Phase 15: Organization Profile & Unified UI]
```

---

## 2. LỘ TRÌNH CHI TIẾT THEO CÁC GIAI ĐOẠN (DETAILED PHASES)

### Phase 1 — Core Stabilization & Baseline Verification
- **Mục tiêu:** Kiểm tra và xác nhận 100% tính năng cốt lõi và tiêu chuẩn an toàn hiện hữu của Billing_One.
- **Trạng thái:** **HOÀN THÀNH (DONE)** — Đạt 15/15 checks trong `cp2-smoke.mjs`, đạt 100% kiểm tra hardening H1–H6 trong `verify-hardening.ps1`.

---

### Phase 2 — Danh mục Sản phẩm & Dịch vụ (Product & Service Master Catalog)
- **Dependencies:** Độc lập sau Phase 1.
- **Phạm vi triển khai:**
  - Database: Bảng `public.products` (SKU, tên, danh mục, đơn vị tính, đơn giá chuẩn, thuế suất mặc định, trạng thái).
  - Backend & API: `GET /api/products`, `POST /api/products`, `PUT /api/products/:id`, `DELETE /api/products/:id`.
  - Frontend: Giao diện quản lý Danh mục sản phẩm (Master Catalog), tìm kiếm theo tên/SKU/danh mục, tạo mới sản phẩm.
  - Tests: Test CRUD sản phẩm, kiểm tra SKU duy nhất, kiểm tra giá không âm.

---

### Phase 3 — Quản trị Điều khoản Thanh toán (Payment Terms & Due Date Policies)
- **Dependencies:** Độc lập sau Phase 1.
- **Phạm vi triển khai:**
  - Database: Bảng `public.payment_terms` (Mã, tên, số ngày cho nợ, ngày ân hạn, tỷ lệ phạt trễ hạn, chiết khấu thanh toán sớm).
  - Backend & API: `GET /api/payment-terms`, `POST /api/payment-terms`, `PUT /api/payment-terms/:id`, `DELETE /api/payment-terms/:id`.
  - Frontend: Giao diện Quản trị Điều khoản thanh toán, thiết lập điều khoản mặc định.
  - Tests: Test CRUD điều khoản thanh toán, kiểm tra tính toán ngày đến hạn tự động.

---

### Phase 4 — Hồ sơ Khách hàng & Hạn mức Công nợ (Customer Financial Profile & Credit Limit)
- **Dependencies:** Phụ thuộc Phase 3 (`payment_terms`).
- **Phạm vi triển khai:**
  - Database: Cập nhật `customers` với `code`, `segment` (Enterprise/SME/FDI), `contact_person`, `credit_limit`, `payment_term_id`, `status`.
  - Backend & API: Cập nhật `POST/PUT /customers`. Thêm endpoint `GET /customers/:id/financial-profile` trả về tổng nợ hiện tại, hạn mức còn lại, cảnh báo rủi ro.
  - Frontend: Hiển thị phân khúc khách hàng, hạn mức công nợ, nợ hiện tại, thời hạn thanh toán được gán.
  - Tests: Test tính toán nợ khách hàng và cảnh báo vượt hạn mức.

---

### Phase 5 — Nâng cấp Hóa đơn & Tích hợp Dòng hàng Sản phẩm (Enhanced Invoices & Items)
- **Dependencies:** Phụ thuộc Phase 2 (`products`), Phase 3 (`payment_terms`), Phase 4 (`customers`).
- **Phạm vi triển khai:**
  - Database: Thêm `e_invoice_code`, `notes` trong `invoices`; thêm `sku`, `unit`, `discount_percent` trong `invoice_items`.
  - Backend & API: Cập nhật `invoices.js`: Tự động tính ngày đến hạn từ `payment_term_id` nếu có; tính toán chiết khấu dòng hàng; tự động sinh mã hóa đơn điện tử CQT khi phát hành.
  - Frontend: Form tạo hóa đơn cho phép chọn nhanh từ Danh mục sản phẩm, tự động điền đơn giá, thuế suất, đơn vị tính; hỗ trợ nhập chiết khấu %; hiển thị mã tra cứu hóa đơn điện tử.
  - Tests: Test tính tiền hóa đơn có chiết khấu, test sinh mã hóa đơn điện tử, regression test `cp2-smoke.mjs`.

---

### Phase 6 — Nâng cấp Thanh toán & Phân bổ Đa Hóa đơn (Payments & Payment Allocations)
- **Dependencies:** Phụ thuộc Phase 5 (`invoices`).
- **Phạm vi triển khai:**
  - Database: Thêm `bank_name`, `bank_account`, `notes` trong `payments`; tạo bảng `payment_allocations`.
  - Backend & API: Cập nhật `POST /invoices/:id/payments` hỗ trợ thông tin ngân hàng. Thêm endpoint `POST /payments/allocate` cho phép phân bổ 1 khoản tiền cho nhiều hóa đơn.
  - Frontend: Form ghi nhận thanh toán nâng cao (chọn ngân hàng, số tài khoản, mã tham chiếu); hiển thị chi tiết lịch sử phân bổ.
  - Tests: Concurrency test double payment, test phân bổ chính xác số dư.

---

### Phase 7 — Báo cáo Tuổi nợ & Chỉ số Thu hồi Công nợ (Aging Matrix & Collection Metrics / DSO)
- **Dependencies:** Phụ thuộc Phase 5 (`invoices`), Phase 6 (`payments`).
- **Phạm vi triển khai:**
  - Backend & API:
    - `GET /api/reports/aging`: Tổng hợp 5 nhóm tuổi nợ (Current, 1-30d, 31-60d, 61-90d, 90+d) trên toàn bộ hóa đơn chưa thu đủ và ma trận tuổi nợ theo từng khách hàng.
    - `GET /api/reports/collection-metrics`: Tính toán DSO, tỷ lệ thu hồi CEI, tỷ lệ quá hạn rủi ro.
  - Frontend: Giao diện Báo cáo Tuổi nợ (Aging Matrix) và Báo cáo Chỉ số Thu nợ & DSO với phân loại màu sắc rủi ro trực quan.
  - Tests: Test logic phân loại ngày quá hạn và công thức DSO.

---

### Phase 8 — Phân tích Doanh thu & MRR / ARR (Revenue Analytics)
- **Dependencies:** Phụ thuộc Phase 5, Phase 6.
- **Phạm vi triển khai:**
  - Backend & API: `GET /api/reports/revenue`: Tổng hợp doanh thu theo tháng (12 tháng gần nhất), phân rã doanh thu theo phân khúc khách hàng (Enterprise/SME/FDI) và danh mục dịch vụ.
  - Frontend: Giao diện Báo cáo Doanh thu & Tăng trưởng tài chính với biểu đồ trực quan và danh sách Top khách hàng đóng góp doanh thu lớn nhất.
  - Tests: Test tính toán tổng doanh thu và tỷ trọng cơ cấu.

---

### Phase 9 — Biên bản Điều chỉnh & Hóa đơn Giảm trừ (Invoice Adjustments & Credit Notes)
- **Dependencies:** Phụ thuộc Phase 5, Phase 6.
- **Phạm vi triển khai:**
  - Database: Bảng `invoice_adjustments` và sequence `adjustment_no_seq`.
  - Backend & API: `GET /api/adjustments`, `POST /api/adjustments`, `POST /api/adjustments/:id/approve`, `POST /api/adjustments/:id/process`.
  - Frontend: Giao diện Quản lý Biên bản Điều chỉnh & Giảm trừ công nợ, quy trình phê duyệt Credit Note, xem chi tiết và in biên bản.
  - Tests: Test tạo biên bản, test quyền phê duyệt (chỉ Admin/Manager), test cấn trừ công nợ vào hóa đơn gốc.

---

### Phase 10 — Thuê bao & Hóa đơn Định kỳ (Recurring Billing Engine)
- **Dependencies:** Phụ thuộc Phase 4 (`customers`), Phase 5 (`invoices`).
- **Phạm vi triển khai:**
  - Database: Bảng `recurring_plans` và sequence `recurring_plan_no_seq`.
  - Backend & API: `GET /api/recurring-plans`, `POST /api/recurring-plans`, `PUT /api/recurring-plans/:id`, `POST /api/recurring-plans/:id/trigger`, `POST /api/recurring-plans/:id/toggle-status`.
  - Frontend: Giao diện Quản lý Hóa đơn Định kỳ, danh sách hợp đồng, chỉ số MRR/ARR, nút kích hoạt sinh hóa đơn ngay.
  - Tests: Test sinh hóa đơn tự động từ plan, kiểm tra tính toán ngày kỳ tiếp theo, chống trùng lặp hóa đơn.

---

### Phase 11 — Đối soát Sao kê Ngân hàng (Bank Statement Reconciliation & Matching)
- **Dependencies:** Phụ thuộc Phase 5, Phase 6.
- **Phạm vi triển khai:**
  - Database: Bảng `bank_transactions`.
  - Backend & API: `GET /api/bank-transactions`, `POST /api/bank-transactions`, `POST /api/reconciliation/auto-match`, `POST /api/reconciliation/manual-match`.
  - Frontend: Giao diện Đối soát Sao kê Ngân hàng, danh sách giao dịch CREDIT/DEBIT, bộ lọc trạng thái MATCHED/UNMATCHED, nút kích hoạt Đối soát tự động và Modal khớp giao dịch thủ công.
  - Tests: Test thuật toán khớp tự động theo số hóa đơn/MST/số tiền, test khớp thủ công sinh payment.

---

### Phase 12 — Phân quyền Hạt mịn RBAC (Granular Roles & Permissions)
- **Dependencies:** Toàn bộ các API endpoints.
- **Phạm vi triển khai:**
  - Database: Bảng `roles`, `permissions`, `role_permissions` với 6 roles và 32 permissions chuẩn hóa.
  - Backend & API: Middleware `requirePermission` kiểm tra quyền theo token/session, `GET /api/rbac/roles`.
  - Frontend: Giao diện xem vai trò và danh sách quyền hạn trong Cài đặt hệ thống.
  - Tests: Test kiểm tra chặn 403 Forbidden khi thiếu quyền.

---

### Phase 13 — Nhật ký Kiểm toán Nghiệp vụ Bất biến (Business Audit Trail)
- **Dependencies:** Toàn bộ các thao tác tài chính trọng yếu.
- **Phạm vi triển khai:**
  - Database: Bảng `audit_logs` append-only.
  - Backend & API: Helper `recordAuditLog` được gọi tự động trong mọi thao tác phát hành hóa đơn, hủy hóa đơn, ghi nhận thanh toán, duyệt credit note, đối soát ngân hàng. `GET /api/audit-logs`.
  - Frontend: Giao diện Nhật ký Kiểm toán Nghiệp vụ với bộ lọc mức độ (CRITICAL/WARNING/INFO), tìm kiếm theo actor/action/target.
  - Tests: Test xác nhận audit log được ghi nhận đầy đủ sau mỗi nghiệp vụ.

---

### Phase 14 — Báo cáo Thuế GTGT & Kê khai Bán ra (VAT Reporting & Compliance)
- **Dependencies:** Phụ thuộc Phase 5 (`invoices`).
- **Phạm vi triển khai:**
  - Backend & API: `GET /api/reports/vat`: Tổng hợp doanh thu và thuế GTGT theo kỳ (Tháng / Quý), phân nhóm theo các mức thuế 10%, 8%, 5%, 0% và KCT.
  - Frontend: Giao diện Báo cáo Thuế GTGT & Bảng kê bán ra Mẫu 01-1/GTGT, xuất dữ liệu xem trước.
  - Tests: Test tính toán chính xác tiền thuế GTGT và doanh thu chưa thuế.

---

### Phase 15 — Cấu hình Pháp nhân & Giao diện Nâng cao (Org Profile, Dark Mode & Documents)
- **Dependencies:** Toàn bộ hệ thống.
- **Phạm vi triển khai:**
  - Database: Bảng `company_settings`.
  - Backend & API: `GET/PUT /api/settings`.
  - Frontend: Tích hợp Dark / Light mode toggle mượt mà; hoàn thiện giao diện in Hóa đơn GTGT và Phiếu thu tiền (Receipt Voucher); navigation menu đa module hoàn chỉnh.
  - Tests: Test cập nhật cấu hình pháp nhân, smoke test toàn bộ giao diện.

---

## 3. TIÊU CHÍ HOÀN THÀNH TỔNG THỂ (DEFINITION OF DONE)

Một tính năng chỉ được đánh dấu **DONE** khi đáp ứng đầy đủ 10 tiêu chuẩn:
1. [x] Có bảng hoặc trường dữ liệu thật trong PostgreSQL (`NUMERIC(14,2)` cho tiền tệ).
2. [x] Migration an toàn, có thể chạy lặp lại mà không gây lỗi (`IF NOT EXISTS`).
3. [x] Backend service xử lý nghiệp vụ đầy đủ, có xử lý lỗi `AppError` và transaction locking.
4. [x] RESTful API endpoints với validation chặt chẽ (định dạng ngày, số, chuỗi, ID).
5. [x] Kiểm soát phân quyền và xác thực ở backend.
6. [x] Giao diện người dùng kết nối API thật, loại bỏ hoàn toàn mock data hoặc React-only state.
7. [x] Ghi nhận Business Audit Log đối với các thao tác tài chính quan trọng.
8. [x] Có test kiểm thử tự động (Unit / Integration / Regression).
9. [x] Toàn bộ 15/15 tests cơ sở trong `scripts/cp2-smoke.mjs` tiếp tục PASS 100%.
10. [x] Cập nhật tài liệu kỹ thuật tương ứng.
