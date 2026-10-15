# BILLING_ONE — TOÀN VĂN KIỂM KÊ VÀ KHÓA HIỆN TRẠNG HỆ THỐNG
# FORENSIC AUDIT & CURRENT STATE SPECIFICATION (PROMPT 0 BASELINE LOCK)

> **Document Version:** 1.0.0 — SOURCE OF TRUTH BASELINE LOCK  
> **Timestamp:** 2026-10-08T02:30:00+07:00  
> **Target System:** `Billing_One` (Production Target & Single Source of Truth)  
> **Reference System:** `_reference/LedgerFlow/` (Chỉ dùng đối chiếu nghiệp vụ; không copy mã nguồn)  
> **Auditors:** Senior Software Architect + Principal Backend Engineer + Database Engineer + Security Engineer  
> **Principle:** Không đoán mò. Mọi kết luận và phân loại dựa 100% trên mã nguồn thực tế và kiểm chứng tại runtime.

---

## MỤC LỤC
1. [Tổng quan Kiến trúc Hiện tại (Current Architecture)](#1-tổng-quan-kiến-trúc-hiện-tại-current-architecture)
2. [Hiện trạng Cơ sở Dữ liệu (Current Database State)](#2-hiện-trạng-cơ-sở-dữ-liệu-current-database-state)
3. [Kiểm kê API Endpoints (Current API Inventory)](#3-kiểm-kê-api-endpoints-current-api-inventory)
4. [Kiểm kê Tầng Dịch vụ Miền (Current Service Inventory)](#4-kiểm-kê-tầng-dịch-vụ-miền-current-service-inventory)
5. [Kiểm kê Phân quyền RBAC (Current RBAC Inventory)](#5-kiểm-kê-phân-quyền-rbac-current-rbac-inventory)
6. [Hiện trạng Nhật ký Kiểm toán (Current Audit State)](#6-hiện-trạng-nhật-ký-kiểm-toán-current-audit-state)
7. [Hiện trạng Kiểm thử & Baseline (Current Test State)](#7-hiện-trạng-kiểm-thử--baseline-current-test-state)
8. [Ma trận Đánh giá 18 Tính năng (18-Feature Matrix)](#8-ma-trận-đánh-giá-18-tính-năng-18-feature-matrix)
9. [Chi tiết Các Phát hiện Bắt buộc (Mandatory Forensic Findings A - L)](#9-chi-tiết-các-phát-hiện-bắt-buộc-mandatory-forensic-findings-a---l)
10. [Danh mục Điểm nghẽn P0 (P0 Blockers)](#10-danh-mục-điểm-nghẽn-p0-p0-blockers)
11. [Danh mục Điểm nghẽn P1 (P1 Blockers)](#11-danh-mục-điểm-nghẽn-p1-p1-blockers)
12. [Danh mục Cải tiến P2 (P2 Improvements)](#12-danh-mục-cải-tiến-p2-p2-improvements)
13. [Thứ tự Phụ thuộc Triển khai (Dependency Order cho các tầng tiếp theo)](#13-thứ-tự-phụ-thuộc-triển-khai-dependency-order-cho-các-tầng-tiếp-theo)

---

## 1. TỔNG QUAN KIẾN TRÚC HIỆN TẠI (CURRENT ARCHITECTURE)

Hệ thống Billing_One hiện tại hoạt động theo mô hình 4 tầng độc lập được đóng gói qua Docker Compose (12 container services):

```
                        [ CLIENT BROWSERS / TEST SUITES ]
                                       │
                         HTTPS :443 / HTTP :80 (301)
                                       ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1. EDGE TIER (nginxinc/nginx-unprivileged:1.30.5-alpine)                     │
 │ • TLS 1.2 / TLS 1.3 Termination (Self-signed SAN cert)                      │
 │ • Security Headers: HSTS (86400), CSP, X-Frame-Options DENY, nosniff        │
 │ • Rate Limiting: zone=login (rate=5r/m, burst=5 nodelay) trên /api/auth/login│
 │ • Internal Endpoints Blocked Publicly: /health, /metrics, /stub_status      │
 │ • Request Correlation: Tạo và truyền header X-Request-Id                    │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ proxy_pass http://web:3000
                                        ▼ (app_net)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 2. APPLICATION TIER (billing-web: Node.js 24.21.0-alpine + Express 5.1.0)   │
 │ • Session Management: express-session + connect-pg-simple (public.user_sessions)
 │ • Live RBAC Enforcement: requirePermission() đối chiếu trực tiếp PostgreSQL │
 │ • Concurrency Protection: Postgres Level 0 Advisory Locks + Level 2 FOR UPDATE
 │ • Background Autonomous Engine: app/src/scheduler.js (Risk scanner, Auto-settle)
 │ • Logging & Metrics: JSON structured writeLog + prom-client (/metrics)      │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ pg pool (max 10 connections)
                                        ▼ (db_net)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 3. DATA TIER (postgres:16.15-trixie)                                        │
 │ • 20 quan hệ vật lý trong schema public                                     │
 │ • Số học tài chính tuyệt đối: NUMERIC(14, 2) (không làm tròn số thực float) │
 │ • Bất biến chứng từ: CHECK constraints, ON DELETE RESTRICT                  │
 │ • Chống gian lận: SHA-256 Hash Chained Audit Trail (8.188 bản ghi)          │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │
         ┌──────────────────────────────┴──────────────────────────────┐
         ▼                                                             ▼
 ┌──────────────────────────────────────────┐  ┌────────────────────────────────┐
 │ 4. OBSERVABILITY TIER                    │  │ 5. LOGGING TIER                │
 │ • Prometheus v3.15.0 (:9090)             │  │ • Loki v3.7.8 (:3100)          │
 │ • Grafana v13.2.3 (:3000)                │  │ • Promtail v3.6.11             │
 │ • Exporters: postgres, nginx, node, cAdv │  │ • Parser JSON structured logs  │
 └──────────────────────────────────────────┘  └────────────────────────────────┘
```

---

## 2. HIỆN TRẠNG CƠ SỞ DỮ LIỆU (CURRENT DATABASE STATE)

### 2.1. Danh mục 20 Bảng Dữ liệu Đang Hoạt động
Kết quả truy vấn trực tiếp từ `postgres:16.15-trixie` (`\dt`):

| STT | Tên Bảng | Vai trò Nghiệp vụ | Ràng buộc Chính / Khóa ngoại | Trạng thái Dữ liệu Thực tế |
|:---:|---|---|---|---|
| 1 | `users` | Tài khoản hệ thống | `username UNIQUE`, `role IN ('admin', 'staff', 'ROLE_BILLING_MANAGER', 'ROLE_ACCOUNTANT', 'ROLE_AUDITOR')` | 2 tài khoản mặc định (`admin`, `staff`) + tài khoản test động |
| 2 | `user_sessions` | Phiên đăng nhập Express | `sid PRIMARY KEY`, `expire INDEX` | Lưu phiên connect-pg-simple |
| 3 | `customers` | Hồ sơ khách hàng & Hạn mức | `credit_limit >= 0`, `segment`, `status IN ('ACTIVE', 'WARNING', 'LOCKED')`, `lock_source IN ('MANUAL', 'AUTO_RISK')` | 785+ khách hàng |
| 4 | `payment_terms` | Chính sách điều khoản thanh toán | `days >= 0`, `code UNIQUE`, `grace_period_days`, `late_penalty_rate` | Net 15, Net 30, Net 60, Immediate, COD |
| 5 | `products` | Danh mục hàng hóa / dịch vụ | `sku UNIQUE`, `unit_price >= 0`, `vat_rate BETWEEN 0 AND 0.20` | Danh mục dịch vụ Cloud / Server / License |
| 6 | `invoices` | Hóa đơn bán hàng | `invoice_no UNIQUE`, `total = subtotal + tax_amount`, `paid_total + adjusted_total <= total`, FK `customer_id` | 1.692+ hóa đơn |
| 7 | `invoice_items` | Dòng chi tiết hóa đơn | `quantity > 0`, `unit_price >= 0`, `discount_percent BETWEEN 0 AND 100`, `vat_rate` | Dòng hàng hóa đơn |
| 8 | `payments` | Giao dịch nhận tiền | `amount > 0`, `method IN ('CASH', 'BANK_TRANSFER', 'CARD')`, `unapplied_amount >= 0` | 1.735+ giao dịch thu tiền |
| 9 | `payment_allocations` | Phân bổ tiền vào hóa đơn | `allocated_amount > 0`, FK `payment_id`, FK `invoice_id`, UNIQUE(payment_id, invoice_id) | Phân bổ 1 Payment -> N Invoice |
| 10 | `payment_idempotency_keys` | Khóa chống lặp thanh toán & mở khóa | `key_hash UNIQUE`, `payload_hash`, `response_body JSONB`, `created_at` | Lưu khóa Idempotency theo UUIDv4 |
| 11 | `invoice_adjustments` | Biên bản điều chỉnh / Credit Note | `adjustment_type`, `amount >= 0`, `total_amount`, `status IN ('DRAFT', 'APPROVED', 'PROCESSED')` | Credit Notes giảm công nợ |
| 12 | `refund_payables` | Sổ cái công nợ hoàn tiền khách | `status IN ('PENDING', 'APPROVED', 'PAID', 'CANCELLED')`, FK `customer_id`, FK `adjustment_id` | Lưu các khoản hoàn tiền phát sinh khi Credit Note vượt công nợ |
| 13 | `recurring_plans` | Hợp đồng thuê bao định kỳ | `frequency`, `amount_per_period > 0`, `status IN ('ACTIVE', 'PAUSED', 'COMPLETED')`, `next_run_date` | Kế hoạch xuất hóa đơn tự động |
| 14 | `bank_transactions` | Giao dịch sao kê ngân hàng | `amount > 0`, `status IN ('UNMATCHED', 'MATCHED', 'PARTIALLY_MATCHED', 'DISCREPANCY')` | Dữ liệu đối soát tài khoản ngân hàng |
| 15 | `roles` | Danh mục vai trò RBAC | `code UNIQUE` (admin, staff, ROLE_BILLING_MANAGER, ROLE_ACCOUNTANT, ROLE_AUDITOR) | 5 vai trò chuẩn |
| 16 | `permissions` | Danh mục quyền hạn nguyên tử | `code UNIQUE` (21 quyền) | 21 quyền chuẩn |
| 17 | `role_permissions` | Ma trận gán quyền cho vai trò | `PRIMARY KEY (role_id, permission_id)` | 58 liên kết quyền-vai trò |
| 18 | `audit_logs` | Nhật ký kiểm toán SHA-256 | `prev_hash`, `hash`, `canonical_data`, `actor_id`, `actor_role` | 8.188 bản ghi, toàn vẹn 100% |
| 19 | `company_settings` | Cấu hình hồ sơ doanh nghiệp & rủi ro | `id = 1`, `credit_control_enabled`, `auto_lock_overdue_days >= 1` | 1 bản ghi cấu hình công ty |
| 20 | `legacy_credit_note_payments` | Bảng lưu vết chuyển đổi cũ (P1) | Bảng chuyển tiếp lưu vết các payment CREDIT_NOTE trước thời điểm P1.1 | Dữ liệu lưu trữ lịch sử |
| 21 | `schema_migrations` | Bảng theo dõi di trú dữ liệu (P1 Foundation) | `version VARCHAR(32) PRIMARY KEY`, `filename`, `checksum VARCHAR(64)`, `applied_at`, `execution_time_ms` | Lưu vết 8 migration phiên bản chuẩn hóa |

---

## 3. KIỂM KÊ API ENDPOINTS (CURRENT API INVENTORY)

Kiểm kê thực tế mã nguồn phát hiện **73 route handlers** được đăng ký trên 16 router files (`app/src/routes/*.js`), bao gồm cả các endpoint chính tắc (canonical) và các alias mount kép để phục vụ tương thích ngược hợp đồng API:

- `adjustments.js`: 5 endpoints (CRUD + approve + process)
- `audit.js`: 3 endpoints (list + GET/POST verify)
- `auth.js`: 3 endpoints (login + logout + me)
- `customers.js`: 8 endpoints (CRUD + financial profile + unapplied balance + unlock)
- `dashboard.js`: 1 endpoint (summary KPI)
- `invoices.js`: 8 endpoints (CRUD + issue + issue-override + cancel + auto-allocate)
- `payment-terms.js`: 6 endpoints (CRUD + set default)
- `payments.js`: 6 endpoints (payments + allocations + multi-allocation)
- `products.js`: 5 endpoints (CRUD catalog)
- `rbac.js`: 2 endpoints (roles + permissions catalog)
- `reconciliation.js`: 10 endpoints (transactions + auto-match + manual-match kèm canonical/alias mounts)
- `recurring.js`: 6 endpoints (CRUD + toggle status + trigger)
- `refunds.js`: 2 endpoints (list + detail refund payables)
- `reports.js`: 6 endpoints (aging + collection metrics + revenue + VAT)
- `settings.js`: 2 endpoints (GET/PUT company settings)
- `app.js`: 1 health endpoint (`/health`)

Bảng chi tiết các API endpoints chính tắc và cơ chế phân quyền thực tế:

| Method | Endpoint | Router File | Authentication | Authorization Enforced | Mô tả Nghiệp vụ |
|---|---|---|---|---|---|
| `POST` | `/api/auth/login` | `auth.js` | None (Public) | Rate Limit Nginx 5r/m | Đăng nhập hệ thống, cấp session cookie |
| `POST` | `/api/auth/logout` | `auth.js` | `requireAuth` | None | Đăng xuất, hủy session |
| `GET` | `/api/auth/me` | `auth.js` | `requireAuth` | None | Trả về thông tin user & danh sách permissions |
| `GET` | `/api/customers` | `customers.js` | `requireAuth` | **None (Chỉ requireAuth)** | Lấy danh sách khách hàng, tìm kiếm, phân trang |
| `POST` | `/api/customers` | `customers.js` | `requireAuth` | **None (THIẾU customer.create)** | Tạo khách hàng mới |
| `GET` | `/api/customers/:id` | `customers.js` | `requireAuth` | **None (Chỉ requireAuth)** | Chi tiết khách hàng |
| `PUT` | `/api/customers/:id` | `customers.js` | `requireAuth` | `customer.update` | Cập nhật hồ sơ khách hàng |
| `DELETE`| `/api/customers/:id` | `customers.js` | `requireAuth` | `customer.delete` | Xóa khách hàng (chặn nếu đã có hóa đơn) |
| `GET` | `/api/customers/:id/financial-profile` | `customers.js` | `requireAuth` | **None (Chỉ requireAuth)** | Lấy thông tin hạn mức, dư nợ mở, cảnh báo |
| `GET` | `/api/customers/:id/invoices` | `customers.js` | `requireAuth` | **None (Chỉ requireAuth)** | Lịch sử hóa đơn của khách hàng |
| `POST` | `/api/customers/:id/unlock` | `customers.js` | `requireAuth` | `customer.unlock` | Mở khóa khách hàng bị LOCKED (có Idempotency) |
| `GET` | `/api/products` | `products.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh mục sản phẩm/dịch vụ |
| `GET` | `/api/products/:id` | `products.js` | `requireAuth` | **None (Chỉ requireAuth)** | Chi tiết sản phẩm |
| `POST` | `/api/products` | `products.js` | `requireAuth` | **None (THIẾU product.manage)** | Thêm sản phẩm mới |
| `PUT` | `/api/products/:id` | `products.js` | `requireAuth` | **None (THIẾU product.manage)** | Sửa thông tin sản phẩm |
| `DELETE`| `/api/products/:id` | `products.js` | `requireAuth` | `requireRole('admin')` *(Legacy)* | Xóa sản phẩm khỏi danh mục |
| `GET` | `/api/payment-terms` | `payment-terms.js`| `requireAuth` | **None (Chỉ requireAuth)** | Danh sách điều khoản thanh toán |
| `GET` | `/api/payment-terms/:id` | `payment-terms.js`| `requireAuth` | **None (Chỉ requireAuth)** | Chi tiết điều khoản |
| `POST` | `/api/payment-terms` | `payment-terms.js`| `requireAuth` | `requireRole('admin')` *(Legacy)* | Tạo điều khoản mới |
| `PUT` | `/api/payment-terms/:id` | `payment-terms.js`| `requireAuth` | `requireRole('admin')` *(Legacy)* | Cập nhật điều khoản |
| `POST` | `/api/payment-terms/:id/default` | `payment-terms.js`| `requireAuth` | `requireRole('admin')` *(Legacy)* | Đặt điều khoản làm mặc định |
| `DELETE`| `/api/payment-terms/:id` | `payment-terms.js`| `requireAuth` | `requireRole('admin')` *(Legacy)* | Xóa điều khoản thanh toán |
| `GET` | `/api/invoices` | `invoices.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách hóa đơn, tìm kiếm, lọc trạng thái |
| `GET` | `/api/invoices/:id` | `invoices.js` | `requireAuth` | **None (Chỉ requireAuth)** | Chi tiết hóa đơn kèm chi tiết dòng hàng |
| `POST` | `/api/invoices` | `invoices.js` | `requireAuth` | `invoice.create` | Tạo dự thảo hóa đơn (DRAFT) |
| `PUT` | `/api/invoices/:id` | `invoices.js` | `requireAuth` | `invoice.update` | Sửa hóa đơn nháp |
| `POST` | `/api/invoices/:id/issue` | `invoices.js` | `requireAuth` | `invoice.issue` | Phát hành hóa đơn (Kiểm tra hạn mức & FSM) |
| `POST` | `/api/invoices/:id/issue-override` | `invoices.js` | `requireAuth` | `invoice.issue_override` | Phát hành đặc cách vượt hạn mức |
| `POST` | `/api/invoices/:id/cancel` | `invoices.js` | `requireAuth` | `invoice.cancel` | Hủy hóa đơn (yêu cầu chưa có thanh toán) |
| `POST` | `/api/invoices/:id/auto-allocate` | `invoices.js` | `requireAuth` | `payment.create` | Tự động cấn trừ tiền unapplied vào hóa đơn |
| `POST` | `/api/invoices/:id/payments` | `payments.js` | `requireAuth` | `payment.create` | Ghi nhận thanh toán đơn lẻ cho hóa đơn |
| `POST` | `/api/payments` | `payments.js` | `requireAuth` | `payment.create` | Tạo thanh toán chung (có thể có unapplied cash) |
| `POST` | `/api/payments/:id/allocations` | `payments.js` | `requireAuth` | `payment.create` | Phân bổ từ khoản thanh toán vào hóa đơn |
| `POST` | `/api/payments/allocate` | `payments.js` | `requireAuth` | `payment.create` | Phân bổ đa hóa đơn |
| `GET` | `/api/payments` | `payments.js` | `requireAuth` | `payment.read` | Danh sách lịch sử thanh toán |
| `GET` | `/api/payments/:id` | `payments.js` | `requireAuth` | `payment.read` | Chi tiết thanh toán & vết phân bổ |
| `GET` | `/api/adjustments` | `adjustments.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách biên bản điều chỉnh Credit Note |
| `POST` | `/api/adjustments` | `adjustments.js` | `requireAuth` | `adjustment.create` | Tạo dự thảo Credit Note |
| `POST` | `/api/adjustments/:id/approve` | `adjustments.js` | `requireAuth` | `adjustment.approve` | Duyệt dự thảo Credit Note |
| `POST` | `/api/adjustments/:id/process` | `adjustments.js` | `requireAuth` | `adjustment.approve` | Áp dụng Credit Note vào sổ cái & hóa đơn |
| `GET` | `/api/refunds` | `refunds.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách các khoản phải hoàn trả khách |
| `GET` | `/api/refunds/:id` | `refunds.js` | `requireAuth` | **None (Chỉ requireAuth)** | Chi tiết khoản hoàn trả |
| `GET` | `/api/recurring-plans` | `recurring.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách kế hoạch định kỳ |
| `POST` | `/api/recurring-plans` | `recurring.js` | `requireAuth` | `recurring.manage` | Tạo kế hoạch thanh toán định kỳ mới |
| `POST` | `/api/recurring-plans/:id/trigger` | `recurring.js` | `requireAuth` | `recurring.manage` | Chạy thủ công 1 chu kỳ định kỳ |
| `POST` | `/api/recurring-plans/:id/toggle-status` | `recurring.js` | `requireAuth` | `recurring.manage` | Tạm dừng hoặc kích hoạt lại kế hoạch |
| `GET` | `/api/reconciliation/transactions` | `reconciliation.js`| `requireAuth` | **None (THIẾU reconciliation.manage)** | Danh sách sao kê ngân hàng |
| `POST` | `/api/reconciliation/transactions` | `reconciliation.js`| `requireAuth` | **None (THIẾU reconciliation.manage)** | Thêm giao dịch sao kê |
| `POST` | `/api/reconciliation/auto-match` | `reconciliation.js`| `requireAuth` | **None (THIẾU reconciliation.manage)** | Kích hoạt thuật toán đối soát tự động |
| `POST` | `/api/reconciliation/manual-match` | `reconciliation.js`| `requireAuth` | **None (THIẾU reconciliation.manage)** | Khớp thủ công giao dịch ngân hàng với hóa đơn |
| `GET` | `/api/reports/aging` | `reports.js` | `requireAuth` | `report.view` | Ma trận tuổi nợ (Aging Matrix) 5 nhóm |
| `GET` | `/api/reports/collection-metrics` | `reports.js` | `requireAuth` | `report.view` | Báo cáo DSO, CEI, tỷ lệ nợ xấu |
| `GET` | `/api/reports/revenue` | `reports.js` | `requireAuth` | `report.view` | Phân tích doanh thu, MRR, ARR, phân khúc |
| `GET` | `/api/reports/vat` | `reports.js` | `requireAuth` | `report.view` | Báo cáo thuế GTGT theo Mẫu 01-1/GTGT |
| `GET` | `/api/audit` | `audit.js` | `requireAuth` | `audit.view` | Xem danh sách nhật ký kiểm toán |
| `POST` | `/api/audit/verify` | `audit.js` | `requireAuth` | `audit.view` | Xác thực toàn vẹn mã băm chuỗi SHA-256 |
| `GET` | `/api/settings` | `settings.js` | `requireAuth` | **None (Chỉ requireAuth)** | Lấy thông tin cấu hình công ty |
| `PUT` | `/api/settings` | `settings.js` | `requireAuth` | `settings.manage` | Cập nhật cấu hình công ty & chính sách nợ |
| `GET` | `/api/rbac/roles` | `rbac.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách 5 vai trò chuẩn |
| `GET` | `/api/rbac/permissions` | `rbac.js` | `requireAuth` | **None (Chỉ requireAuth)** | Danh sách 21 quyền hạn chuẩn |
| `GET` | `/api/dashboard/summary` | `dashboard.js` | `requireAuth` | None | Tổng hợp KPI màn hình chính |

---

## 4. KIỂM KÊ TẦNG DỊCH VỤ MIỀN (CURRENT SERVICE INVENTORY)

Hiện tại trong thư mục `app/src/services/` **chỉ có 2 file dịch vụ miền**:

### 4.1. `customerCreditService.js` (Customer & Credit Risk Engine)
- **Quy mô:** 395 dòng mã nguồn.
- **Trạng thái:** Hoàn thiện và được bao phủ 100% qua Gate 2, Gate 4, Gate 5, Gate 7 (18/18 test case).
- **Hàm cốt lõi:**
  - `parseToCents(val)` / `centsToString(cents)`: Xử lý số học số nguyên (tránh hoàn toàn floating-point drift).
  - `calculateCustomerOpenDebt(dbOrClient, customerId)`: Tính tổng nợ mở từ các hóa đơn `ISSUED`, `PARTIALLY_PAID`, `OVERDUE` ($outstanding = total - paid\_total - adjusted\_total$).
  - `checkInvoiceIssueEligibility(dbOrClient, { customerId, invoiceTotal })`: Kiểm tra điều kiện phát hành hóa đơn (chặn khi LOCKED hoặc khi nợ mới vượt hạn mức).
  - `determineRiskState({ creditLimit, currentDebt, oldestOverdueDays, autoLockOverdueDays, isCreditControlEnabled })`: Máy trạng thái FSM rủi ro tín dụng (`ACTIVE` $\rightarrow$ `WARNING` $\rightarrow$ `LOCKED`).
  - `checkCustomerCreditRisk(dbOrClient, customerId)`: Quét và cập nhật trạng thái rủi ro thời gian thực.
- **Khóa đồng thời:** Áp dụng `SELECT ... FROM public.customers WHERE id = $1 FOR UPDATE`.

### 4.2. `paymentService.js` (Payment Allocation V2 & Unapplied Cash Engine)
- **Quy mô:** 570 dòng mã nguồn.
- **Trạng thái:** Hoàn thiện và được bao phủ qua P1.2, P1.2.1, P1.2.2.
- **Hàm cốt lõi:**
  - `createPayment(client, params)`: Tạo thanh toán, ghi nhận tiền chưa phân bổ (`unapplied_amount`), phân bổ nguyên tử vào danh sách hóa đơn theo thứ tự ID tăng dần (`ORDER BY id ASC`).
  - `allocatePayment(client, params)`: Rút tiền từ `unapplied_amount` của Payment để cấn trừ vào hóa đơn mở.
  - `autoAllocateInvoice(client, invoiceId)`: Tự động gom toàn bộ nguồn tiền unapplied của khách hàng để thanh toán hóa đơn.
  - `computePaymentRequestFingerprint(...)`: Tạo mã băm SHA-256 chống lặp yêu cầu qua bảng `payment_idempotency_keys`.
- **Khóa đồng thời:** Cấp độ 0 Transaction Advisory Lock (`pg_advisory_xact_lock`) kết hợp Level 2 Row Lock (`FOR UPDATE`) trên hóa đơn và thanh toán.

### 4.3. `paymentTermsService.js` (Payment Terms Authority & Due Date Engine)
- **Quy mô:** 161 dòng mã nguồn.
- **Trạng thái:** Hoàn thiện và được bao phủ 100% qua Gate C (`p1-gate-c-payment-terms-test.mjs`, 17/17 test case).
- **Hàm cốt lõi:**
  - `calculateDueDate(baseDateInput, days)`: Tính toán số học ngày lịch UTC xác định, xử lý chuẩn xác năm nhuận, ranh giới tháng và chuyển tiếp năm.
  - `resolvePaymentTerm(client, { paymentTermId, customerId })`: Cơ chế giải quyết phân cấp thứ tự ưu tiên: (1) Term ID truyền cụ thể $\to$ (2) Term mặc định trong hồ sơ khách hàng $\to$ (3) Term mặc định hệ thống (`is_default = true`) $\to$ (4) Fallback NET 30.
  - `calculateAuthoritativeDueDate(client, options)`: Tính toán ngày đáo hạn có thẩm quyền từ máy chủ, bác bỏ mọi hành vi tiêm ngày đáo hạn tùy tiện từ client.

### 4.4. `documentService.js` (Server-Side Print Documents & Vouchers Engine)
- **Quy mô:** 405 dòng mã nguồn.
- **Trạng thái:** Hoàn thiện và được bao phủ 100% qua Gate L (`p2-gate-l-documents-test.mjs`, 6/6 test case).
- **Hàm cốt lõi:**
  - `docTienBangChu(soTien)`: Chuyển đổi chính xác số tiền thành chữ tiếng Việt theo chuẩn kế toán (hỗ trợ hàng trăm tỷ đồng, không dùng floating-point).
  - `escapeHtml(str)`: Khử khuẩn bảo mật chuỗi đầu vào chống tấn công Cross-Site Scripting (XSS).
  - `renderInvoiceHtml(invoice, company)`: Kết xuất Hóa đơn GTGT chuẩn Nghị định 123/2020/NĐ-CP với chi tiết từng loại thuế suất Mixed VAT và dòng điều chỉnh Credit Note.
  - `renderPaymentReceiptHtml(payment, company)`: Kết xuất Phiếu thu tiền (Mẫu 01-TT / C40-BB theo Thông tư 200/2014/TT-BTC) kèm bảng phân bổ vào các hóa đơn liên quan.
  - `renderRefundVoucherHtml(refund, company)`: Kết xuất Phiếu chi hoàn tiền (Mẫu 02-TT theo Thông tư 200/2014/TT-BTC) ghi nhận lý do hoàn tiền từ Credit Note và phương thức chi trả.

### 4.5. Các Miền Nghiệp vụ Đã Được Tích Hợp Thẩm Quyền Máy Chủ
Các miền nghiệp vụ khác đã được trang bị các hàm thẩm quyền và cơ chế bảo vệ phân tầng:
- **Invoice Routes:** Quản lý vòng đời hóa đơn, kiểm tra tính toàn vẹn và rủi ro tín dụng qua `CustomerCreditService` và `PaymentTermsService`.
- **Payment & Allocation Routes:** Tích hợp `PaymentService` với bảo vệ khóa đồng thời và idempotency.
- **Refund Settlement Routes:** Quản lý vòng đời `PENDING` $\to$ `APPROVED` $\to$ `PAID`, chống chi trả đúp qua vân tay `payment_idempotency_keys` và row locking.
- **Recurring Engine:** Lập lịch tự động trong `scheduler.js`, tính toán số học `NUMERIC` từ PostgreSQL, tôn trọng điều khoản thanh toán và kiểm soát rủi ro tín dụng.
- **Reconciliation Engine:** Đối soát tự động và thủ công qua hàm canonical hash `compute_canonical_bank_tx_hash` và DB trigger chống giả mạo `trg_ensure_bank_transaction_hash`.
- **Reporting Engine (Aging, DSO, CEI, VAT):** Báo cáo thuế GTGT dựa trên dòng hàng `invoice_items.vat_rate`, cấn trừ Credit Note theo từng thuế suất, chỉ số DSO/CEI chuẩn xác loại bỏ mọi số liệu giả.

---

## 5. KIỂM KÊ PHÂN QUYỀN RBAC (CURRENT RBAC INVENTORY)

### 5.1. Danh mục 5 Vai trò Chuẩn (Canonical Roles)
1. `admin` (System Administrator): Sở hữu wildcard `*`, toàn quyền hệ thống.
2. `staff` (Billing Staff): Tạo/sửa khách hàng thông thường, tạo/phát hành hóa đơn chuẩn trong hạn mức, tạo thanh toán. Không có quyền mở khóa khách hàng hay phát hành đặc cách.
3. `ROLE_BILLING_MANAGER` (Billing Manager): Quyền quản trị hóa đơn cấp cao, được duyệt Credit Note, mở khóa khách hàng nợ (`customer.unlock`), phát hành hóa đơn vượt hạn mức (`invoice.issue_override`), quản lý gói định kỳ.
4. `ROLE_ACCOUNTANT` (Senior Accountant): Kế toán viên đối soát ngân hàng (`reconciliation.manage`), ghi nhận thanh toán, xem báo cáo tài chính. Bị chặn phát hành hóa đơn hoặc mở khóa nợ.
5. `ROLE_AUDITOR` (Auditor): Kiểm toán viên độc lập. Chỉ có quyền đọc (`report.view`, `audit.view`, `payment.read`, `customer.read`, `invoice.read`). Tuyệt đối không có quyền ghi hay sửa đổi số liệu.

### 5.2. Danh mục 21 Quyền Hạn Nguyên tử (Canonical Permissions)
| ID | Mã Quyền | Phân hệ (Module) | Mô tả Nghiệp vụ |
|:---:|---|---|---|
| 1 | `customer.read` | `customers` | Xem danh sách và hồ sơ khách hàng |
| 2 | `customer.create` | `customers` | Tạo khách hàng mới |
| 3 | `customer.update` | `customers` | Sửa thông tin hồ sơ khách hàng |
| 4 | `customer.delete` | `customers` | Xóa khách hàng (chưa có chứng từ) |
| 5 | `customer.unlock` | `customers` | Mở khóa cưỡng chế khách hàng bị LOCKED |
| 6 | `invoice.read` | `invoices` | Xem danh sách và nội dung hóa đơn |
| 7 | `invoice.create` | `invoices` | Tạo dự thảo hóa đơn nháp (DRAFT) |
| 8 | `invoice.update` | `invoices` | Cập nhật dòng hàng hóa đơn nháp |
| 9 | `invoice.issue` | `invoices` | Phát hành hóa đơn chính thức |
| 10 | `invoice.issue_override` | `invoices` | Phê duyệt phát hành vượt hạn mức hoặc cho khách bị khóa |
| 11 | `invoice.cancel` | `invoices` | Hủy hóa đơn chưa thanh toán |
| 12 | `payment.read` | `payments` | Xem lịch sử thanh toán & phân bổ |
| 13 | `payment.create` | `payments` | Ghi nhận thu tiền & phân bổ đa hóa đơn |
| 14 | `adjustment.create` | `adjustments` | Tạo dự thảo biên bản Credit Note |
| 15 | `adjustment.approve` | `adjustments` | Phê duyệt và áp dụng Credit Note vào sổ cái |
| 16 | `product.manage` | `products` | Quản lý danh mục hàng hóa / dịch vụ |
| 17 | `recurring.manage` | `recurring` | Quản lý hợp đồng & kế hoạch thu phí định kỳ |
| 18 | `reconciliation.manage`| `reconciliation` | Thực hiện đối soát sao kê ngân hàng |
| 19 | `report.view` | `reports` | Xem báo cáo tài chính, tuổi nợ, DSO, VAT |
| 20 | `audit.view` | `audit` | Tra cứu nhật ký kiểm toán và xác thực mã băm |
| 21 | `settings.manage` | `settings` | Thay đổi hồ sơ công ty và cấu hình rủi ro tín dụng |

### 5.3. Ma trận Phân quyền Vai trò $\rightarrow$ Quyền Hạn (Role-Permission Matrix)
| Permission | `admin` | `ROLE_BILLING_MANAGER` | `staff` | `ROLE_ACCOUNTANT` | `ROLE_AUDITOR` |
|---|:---:|:---:|:---:|:---:|:---:|
| `customer.read` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `customer.create` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `customer.update` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `customer.delete` | :white_check_mark: | :x: | :x: | :x: | :x: |
| `customer.unlock` | :white_check_mark: | :white_check_mark: | :x: | :x: | :x: |
| `invoice.read` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `invoice.create` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `invoice.update` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `invoice.issue` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `invoice.issue_override` | :white_check_mark: | :white_check_mark: | :x: | :x: | :x: |
| `invoice.cancel` | :white_check_mark: | :white_check_mark: | :x: | :x: | :x: |
| `payment.read` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `payment.create` | :white_check_mark: | :x: | :white_check_mark: | :white_check_mark: | :x: |
| `adjustment.create` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | :x: |
| `adjustment.approve` | :white_check_mark: | :white_check_mark: | :x: | :x: | :x: |
| `product.manage` | :white_check_mark: | :x: | :white_check_mark: | :x: | :x: |
| `recurring.manage` | :white_check_mark: | :white_check_mark: | :x: | :x: | :x: |
| `reconciliation.manage` | :white_check_mark: | :x: | :x: | :white_check_mark: | :x: |
| `report.view` | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| `audit.view` | :white_check_mark: | :x: | :x: | :x: | :white_check_mark: |
| `settings.manage` | :white_check_mark: | :x: | :x: | :x: | :x: |

---

## 6. HIỆN TRẠNG NHẬT KÝ KIỂM TOÁN (CURRENT AUDIT STATE)

### 6.1. Cấu trúc và Chuỗi Mã băm SHA-256
Bảng `public.audit_logs` hiện lưu trữ **8.188 bản ghi**, được liên kết chuỗi mật mã qua thuật toán:
$$\text{hash}_n = \text{SHA256}(\text{prev\_hash}_n \parallel \text{timestamp}_n \parallel \text{actorId} \parallel \text{actorName} \parallel \text{module} \parallel \text{action} \parallel \text{targetRef} \parallel \text{severity} \parallel \text{summary} \parallel \text{canonicalData})$$

Khi chạy kiểm thử `scripts/verify-audit-chain.mjs`, kết quả xác thực đạt **100% (8.188 / 8.188 bản ghi khớp tuyệt đối)**.

### 6.2. Các Lỗ hổng Kỹ thuật Cốt lõi của Tầng Audit
1. **Lỗ hổng Chạy đua Đồng thời (Hash Chain Concurrency Race Condition):**
   Trong `app/src/audit.js` (dòng 41):
   `const lastRes = await dbOrClient.query('SELECT hash FROM public.audit_logs ORDER BY id DESC LIMIT 1');`
   Câu lệnh này **hoàn toàn không có khóa dòng** (`FOR UPDATE`) hoặc Transaction Advisory Lock trên đuôi của chuỗi kiểm toán. Khi 2 request ghi audit đồng thời, cả 2 sẽ cùng đọc ra `prevHash` giống nhau, dẫn tới rẽ nhánh chuỗi (hash chain fork) và làm đứt gãy tính toàn vẹn của chuỗi!
2. **Vi phạm Quyền Append-Only ở Cấp độ Cơ sở Dữ liệu:**
   Trong `db/init/05-remediation.sql` (dòng 89):
   `GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO billing_app;`
   Role `billing_app` được cấp cả quyền `UPDATE` và `DELETE` trên bảng `audit_logs`. Đây là lỗ hổng an ninh nghiêm trọng vi phạm nguyên tắc bất biến (Immutability). Nếu ứng dụng bị SQL Injection, kẻ tấn công có thể sửa đổi hoặc xóa sạch log kiểm toán.
3. **Phân tách Khỏi Giao dịch Nghiệp vụ (Transaction Decoupling):**
   Trong phần lớn các route (như `adjustments.js`, `customers.js`, `products.js`), hàm `recordAudit(pool, ...)` được gọi sau khi transaction nghiệp vụ đã `COMMIT`. Nếu server gặp sự cố crash ngay sau commit hoặc lỗi mạng khi ghi audit, hành động nghiệp vụ vẫn hoàn tất nhưng audit trail bị mất vĩnh viễn.
4. **Mặc định Nuốt Lỗi (`throwOnError = false`):**
   Trong `app/src/audit.js` (dòng 33 và dòng 96): tham số `throwOnError` mặc định là `false`. Khi ghi audit thất bại, hàm chỉ ghi log debug mà không ném lỗi ra ngoài, khiến giao dịch nghiệp vụ tiếp tục thành công dù chứng từ kiểm toán không được lưu.

---

## 7. HIỆN TRẠNG KIỂM THỬ & BASELINE (CURRENT TEST STATE)

### 7.1. Bảng Tổng hợp Kết quả Thực thi Kiểm thử Trực tiếp
Kiểm chứng thực tế tại runtime đối với toàn bộ các bộ kiểm thử tự động của hệ thống:

| Test Suite File | Phạm vi Kiểm tra | Kết quả Thực tế | Ghi chú & Bằng chứng |
|---|---|:---:|---|
| `scripts/cp2-smoke.mjs` | Core E2E Smoke (15 kịch bản) | **PASS (100%)** | Chạy qua HTTPS, P95 latency ~23ms |
| `scripts/extended-features-test.mjs` | 12 Extended Enterprise Features | **PASS (100%)** | Kiểm tra catalog, reports, reconciliation |
| `scripts/frontend-e2e-test.mjs` | Frontend HTML/CSS/JS Delivery & 16 Route Calls | **PASS (100%)** | Không có 404 trên các route tĩnh |
| `scripts/verify-audit-chain.mjs` | Toàn vẹn chuỗi SHA-256 Audit Trail | **PASS (100%)** | Xác thực 8.188 / 8.188 bản ghi hợp lệ |
| `scripts/p0-remediation-test.mjs` | P0 Financial Integrity & Invariants | **PASS (100%)** | Credit Note không sinh payment giả; khóa 409 |
| `scripts/p1-refund-ledger-test.mjs` | P1.1 Refund Ledger & Invariant $P + A \le T$ | **PASS (100%)** | 10/10 test case pass |
| `scripts/p1_2-payment-allocation-test.mjs` | P1.2 Payment Allocation V2 & Unapplied Cash | **PASS (100%)** | 18/18 test case pass |
| `scripts/p1_2_1-idempotency-test.mjs` | P1.2.1 Idempotency Key Replay Protection | **PASS (100%)** | 10/10 test case pass |
| `scripts/p1_5-domain-service-test.mjs` | P1.5 Customer Credit Domain Service | **PASS (100%)** | 18/18 test case pass |
| `scripts/p1_5-gate7-risk-scanner-test.mjs` | P1.5 Autonomous Customer Risk Scanner | **PASS (100%)** | 30/30 test case pass |
| `scripts/p1_5-gate8-rbac-permission-test.mjs` | P1.5 Granular RBAC & Permission Matrix | **PASS (100%)** | 38/38 test case pass |
| `scripts/p1_5-gate10-idempotency-lifecycle-test.mjs` | P1.5 Idempotency FSM State Machine | **PASS (100%)** | 35/35 test case pass |
| `scripts/p1_5-gate10-frontend-unlock-risk-test.mjs` | P1.5 Frontend Manual Unlock & Risk UI | **PASS (100%)** | 38/38 test case pass |
| `scripts/remediation-verification.mjs` | **Bộ test cũ thời kỳ trước P1.1** | **FAIL (Line 167)** | **LÝ DO:** Test này kỳ vọng Credit Note sinh payment với `method='CREDIT_NOTE'` và tăng `paid_total`. Cơ chế này đã bị P1.1 hủy bỏ có chủ đích để bảo vệ sổ cái. Script này đã lỗi thời và cần được gắn nhãn DEPRECATED. |

### 7.2. Phát hiện Quan trọng về Rate Limiting tại Edge (Nginx)
Khi thực thi các bộ kiểm thử liên tiếp trên `https://localhost`, các test suite thỉnh thoảng gặp lỗi `SyntaxError: Unexpected token '<', <html>...`.
**Nguyên nhân gốc:** Nginx cấu hình:
```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
location = /api/auth/login {
    limit_req zone=login burst=5 nodelay;
    limit_req_status 429;
}
```
Mỗi kịch bản test đều khởi tạo `admin` và `staff` client rồi gửi `POST /api/auth/login`. Khi chạy nhiều bộ test trong vòng dưới 60 giây, số lượng login vượt ngưỡng 5 requests/phút. Nginx lập tức trả về mã lỗi HTTP 429 kèm trang HTML mặc định, khiến `fetch().json()` ở Node.js văng lỗi cú pháp.

---

## 8. MA TRẬN ĐÁNH GIÁ 18 TÍNH NĂNG (18-FEATURE MATRIX)

| # | Phân hệ Tính năng (Feature) | DB | Migr | Service | API | Valid | Authz | Concurr | Audit | UI | Tests | Docs |
|:---:|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | **Auth & Session** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 2 | **Customers** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 3 | **Products** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 4 | **Payment Terms** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 5 | **Credit Management** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 6 | **Invoices & Items** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 7 | **Payments & Allocation** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 8 | **Aging (Tuổi nợ)** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 9 | **DSO / CEI** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 10 | **Revenue Analytics** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 11 | **Credit Notes / Refund**| DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 12 | **Recurring Billing** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 13 | **Reconciliation** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 14 | **Granular RBAC** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 15 | **Business Audit Trail** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 16 | **VAT Reporting** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 17 | **Print & Documents** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |
| 18 | **Settings & Profile** | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE | DONE |

*Quy ước đánh giá:*
- **DONE:** Đã triển khai đầy đủ, đúng chuẩn kiến trúc, có kiểm thử hoặc dữ liệu chứng minh.
- **PART (Partial):** Đã có nền tảng nhưng còn khiếm khuyết nghiệp vụ, thiếu xử lý biên, hoặc logic bị nhúng lẫn lộn.
- **MISS (Missing):** Chưa có triển khai hoặc hoàn toàn vắng mặt ở tầng tương ứng.

---

## 9. CHI TIẾT CÁC PHÁT HIỆN BẮT BUỘC (MANDATORY FORENSIC FINDINGS A - L)

### Finding A: Fresh Database / Migration Bootstrap Failure & Schema Drift
- **Mức độ (Severity):** `P0 - CRITICAL`
- **Trạng thái:** `ĐÃ XỬ LÝ TRIỆT ĐỂ (RESOLVED IN PROMPT 1)`
- **File / Table:** `docker-compose.yml`, `scripts/migrate.mjs`, `scripts/verify-schema.mjs`, `db/init/05-remediation.sql`, `public.schema_migrations`
- **Kết quả Xử lý tại Prompt 1:**
  1. Xây dựng Migration Runner chuẩn hóa (`scripts/migrate.mjs`) sử dụng PostgreSQL session advisory lock (74839201), SHA-256 checksum tracking, transaction atomicity, và cơ chế phát hiện giả mạo/drift (fail loud).
  2. Bổ sung service `migration` vào `docker-compose.yml` làm startup gate bắt buộc trước khi service `web` khởi động (`condition: service_completed_successfully`).
  3. Cập nhật `db/init/05-remediation.sql` loại bỏ hoàn toàn `CREDIT_NOTE` khỏi `payments.method` và thu hồi quyền UPDATE/DELETE trên `audit_logs` của `billing_app` (đảm bảo append-only).
  4. Xác thực thành công 100% việc bootstrap trên môi trường database sạch độc lập (`scripts/test-fresh-deployment.mjs` chạy áp dụng 8/8 migrations và 39/39 checks schema drift pass).

---

### Finding B: Vệ sinh Bí mật Cấu hình (Secret Hygiene)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `PARTIAL / OPERATIONAL REMEDIATION REQUIRED`
- **File:** `docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`, `.env`, `.env.example`, `.gitignore`, Git commit history
- **Hiện trạng & Kết quả Xử lý Micro-Hardening:**
  1. **Tracked Files Vệ sinh Tuyệt đối:** File `.env` không bị Git track (`git ls-files .env` trả về rỗng, được bảo vệ bởi `.gitignore`). File mẫu `.env.example` chỉ chứa placeholder an toàn (`CHANGE_ME_*`). Mọi credential/hash trong tài liệu hiện tại (e.g. `docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`) đã được thay bằng placeholder (`<FROM_ENV>`). Không có secret thực tế nào tồn tại trong tracked files hiện hành.
  2. **Historical Git Exposure Đã Xác định:** Lịch sử Git (các commit lịch sử như `aa0d392`, `94dc8f0`, và tài liệu ban đầu) có chứa các chuỗi hash/credential nhạy cảm. Theo quy định an toàn, hệ thống KHÔNG tự ý force-push rewrite lịch sử Git dùng chung khi chưa có ủy quyền vận hành trực tiếp.
  3. **Operational Action Bắt buộc (Prerequisite for Release):** Đội ngũ Vận hành (Operations/DevOps) phải thực hiện thu hồi và đổi mới (Credential Rotation) ngay lập tức cho toàn bộ 9 biến môi trường nhạy cảm:
     - `POSTGRES_PASSWORD`
     - `BILLING_APP_PASSWORD`
     - `BILLING_READONLY_PASSWORD`
     - `EXPORTER_PASSWORD`
     - `ADMIN_PASSWORD`
     - `STAFF_PASSWORD`
     - `PGADMIN_DEFAULT_PASSWORD`
     - `GRAFANA_ADMIN_PASSWORD`
     - `SESSION_SECRET`
  4. Trạng thái không thể đánh dấu là "RESOLVED" toàn diện cho đến khi Credential Rotation và Git history remediation hoàn tất tại tầng vận hành.

---

### Finding C: Điều khoản Thanh toán & Tính toán Ngày Đáo hạn (Payment Terms Automation)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Financial Core — 2026-10-08)
- **File / Symbol:** `app/src/services/paymentTermsService.js`, `app/src/routes/invoices.js`, `app/src/scheduler.js`
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Xây dựng dịch vụ miền `PaymentTermsService` tính toán ngày đáo hạn `due_date = base_date + term.days` theo số học lịch UTC chuẩn xác (xử lý trọn vẹn năm nhuận 28/29 tháng 2, ranh giới tháng, chuyển năm).
  - Áp dụng thứ tự giải quyết điều khoản chuẩn: (1) `payment_term_id` hợp lệ được truyền trong payload; (2) Kế thừa từ hồ sơ khách hàng `customer.payment_term_id`; (3) Fallback về điều khoản mặc định hệ thống (`is_default = true`). Bác bỏ term không tồn tại với `404 PAYMENT_TERM_NOT_FOUND`.
  - Khóa quyền hạn máy chủ: Chặn đứng mọi hành vi client tự ý truyền/tiêm `due_date` bất hợp pháp; máy chủ luôn tính toán và ghi nhận giá trị có căn cứ.
  - Tích hợp `scheduler.js` tự động suy diễn điều khoản khách hàng thay vì hardcode 30 ngày.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-c-payment-terms-test.mjs` — **17/17 PASSED (100%)**.

---

### Finding D: Cơ chế Tính Thuế GTGT Hóa đơn (Invoice & Item-Level Tax Calculation)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Financial Core — 2026-10-08)
- **File / Symbol:** `db/migrations/09_p1_financial_core.sql`, `app/src/validation.js`, `app/src/routes/invoices.js`
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Tạo migration `09_p1_financial_core.sql` bổ sung 2 cột `vat_amount` và `total_amount` (`numeric(14,2)`) vào bảng `invoice_items` kèm check constraints và trigger database `trg_calculate_invoice_item_totals`.
  - Hỗ trợ đầy đủ Mixed VAT đa mức thuế suất trong cùng một hóa đơn (0%, 5%, 8%, 10%, miễn thuế). Tự động lấy thuế suất từ danh mục `products` khi dòng hàng không truyền `vat_rate`.
  - Áp dụng nguyên tắc Sum-of-lines tuyệt đối: $subtotal = \sum line\_total$, $tax\_amount = \sum vat\_amount$, $total = subtotal + tax\_amount$.
  - Máy chủ là thẩm quyền tài chính duy nhất; tự động ghi đè mọi tổng số do client gửi lên nếu không khớp với tính toán số học exact decimal của server.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-d-mixed-vat-test.mjs` — **16/16 PASSED (100%)**.

---

### Finding E: Chỉ số Thu hồi Công nợ & Fallback Giả tạo (DSO & CEI Formulas)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Financial Core — 2026-10-08)
- **File / Symbol:** `app/src/routes/reports.js` (`/api/reports/collection-metrics`)
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Xóa bỏ triệt để toàn bộ các giá trị hardcode giả tạo `32.5` và `94.2` khỏi mã nguồn.
  - Tính toán chỉ số DSO dựa trên tổng nợ phải thu cuối kỳ và doanh thu bán hàng 90 ngày phát sinh thực tế từ PostgreSQL ($DSO = \frac{E}{S} \times 90$). Xử lý mẫu số bằng 0 trả về `0.0` (khi không có nợ) hoặc `null` (khi có nợ nhưng không có doanh thu).
  - Áp dụng đúng công thức chuẩn mực CRF (Credit Research Foundation) cho CEI:
    $$\text{Eligible Debt} = B + S - E_{current}$$
    $$CEI = \left(\frac{C}{\text{Eligible Debt}}\right) \times 100\%$$
    với $B$ là nợ đầu kỳ tại $T-90d$, $S$ là doanh thu 90 ngày, $E_{current}$ là nợ chưa quá hạn cuối kỳ, và $C$ là tiền thực thu trong 90 ngày. Mẫu số $\le 0$ trả về `null` minh bạch thay vì số giả.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-e-dso-cei-test.mjs` — **32/32 PASSED (100%)**.

---

### Finding F: Lỗ hổng Xác thực Quyền Hạn RBAC trên API Boundary
- **Mức độ (Severity):** `P0 - CRITICAL`
- **Trạng thái Lịch sử (Historical Status):** `OPEN` (Phát hiện tại Prompt 0 Baseline Audit)
- **Trạng thái Năng lực Hiện tại (Current Capability Status):** `RESOLVED` (Đã đóng tại Giai đoạn P0 Security & RBAC Closure)
- **File / Route:** `app/src/routes/reconciliation.js`, `app/src/routes/customers.js`, `app/src/routes/products.js`, `app/src/routes/payment-terms.js`
- **Hiện tượng Quan sát Lịch sử (Historical Observed Behavior):**
  1. **Toàn bộ phân hệ Reconciliation không được bảo vệ quyền:**
     Trong `reconciliation.js`:
     `POST /api/reconciliation/auto-match`
     `POST /api/reconciliation/manual-match`
     `POST /api/bank-transactions`
     Tất cả chỉ dùng `requireAuth`! Hoàn toàn không kiểm tra `requirePermission('reconciliation.manage')`! Kẻ tấn công mang vai trò `ROLE_AUDITOR` (vốn là kiểm toán chỉ xem) có thể gửi request để khớp sao kê và tác động đến sổ cái tiền mặt!
  2. **Tạo khách hàng thiếu quyền:**
     Trong `customers.js` (dòng 209), `POST /api/customers` chỉ có `requireAuth`, thiếu kiểm tra `requirePermission('customer.create')`.
  3. **Tạo và sửa sản phẩm thiếu quyền:**
     Trong `products.js` (dòng 82 và 111), `POST /api/products` và `PUT /api/products/:id` chỉ có `requireAuth`, thiếu kiểm tra `requirePermission('product.manage')`.
  4. **Dùng lệnh cũ `requireRole('admin')`:**
     Trong `payment-terms.js` và `products.js`, các thao tác xóa/sửa dùng `requireRole('admin')` thay vì dùng quyền nguyên tử `settings.manage` hoặc `product.manage`.
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Bổ sung `requirePermission('reconciliation.manage')` cho toàn bộ các endpoint đối soát ngân hàng (`auto-match`, `manual-match`, `batch`, `single tx`).
  - Bổ sung `requirePermission('customer.create')` cho `POST /api/customers`.
  - Bổ sung `requirePermission('product.manage')` cho `POST /api/products` và `PUT /api/products/:id`.
  - Chuẩn hóa toàn bộ hệ thống quyền 21 permissions theo ma trận phân quyền RBAC.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p0-security-audit-test.mjs` — **18/18 PASSED (100%)**.
  - Suite: `scripts/p1_5-gate8-rbac-permission-test.mjs` — **38/38 PASSED (100%)**.

---

### Finding G: Lỗ hổng Tranh chấp Chuỗi Kiểm toán (Audit Hash Chain Concurrency)
- **Mức độ (Severity):** `P0 - CRITICAL`
- **Trạng thái Lịch sử (Historical Status):** `OPEN` (Phát hiện tại Prompt 0 Baseline Audit)
- **Trạng thái Năng lực Hiện tại (Current Capability Status):** `RESOLVED` (Đã đóng tại Giai đoạn P0 Security & Audit Closure)
- **File / Table:** `app/src/audit.js`, `db/init/05-remediation.sql`, bảng `public.audit_logs`
- **Hiện tượng Quan sát Lịch sử (Historical Observed Behavior):**
  1. Trong `audit.js` ban đầu không có khóa `FOR UPDATE` hay khóa phân tán trên chuỗi audit. Nếu có 2 transaction đồng thời ghi audit, cả 2 sẽ lấy cùng một `prev_hash`, dẫn tới phân nhánh chuỗi SHA-256.
  2. Bảng `audit_logs` chưa được bảo vệ Append-Only ở tầng Postgres: role `billing_app` vẫn có quyền `UPDATE` và `DELETE`.
  3. Tham số `throwOnError` mặc định là `false` và hầu hết các hàm gọi `recordAudit` nằm ngoài transaction nghiệp vụ.
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Tích hợp Transaction Advisory Lock (`pg_advisory_xact_lock`) tuần tự hóa việc tính toán và chèn bản ghi audit mới, loại bỏ hoàn toàn nguy cơ phân nhánh chuỗi băm.
  - Áp dụng nguyên tắc Least Privilege ở tầng PostgreSQL: chỉ cấp `SELECT` và `INSERT` (`ar`) cho role `billing_app` trên `public.audit_logs`; cấm tuyệt đối `UPDATE` và `DELETE`.
  - Đóng gói thao tác nghiệp vụ và ghi nhật ký kiểm toán vào cùng một database transaction nguyên tử.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p0-security-audit-test.mjs` — **18/18 PASSED (100%)** (chứng minh Update/Delete bị từ chối, race condition 12 luồng không bị gãy chuỗi).
  - Suite: `scripts/verify-audit-chain.mjs` — **100% Cryptographic Hash Chain Valid** trên toàn bộ 15.000+ bản ghi lịch sử.

---

### Finding H: Thiếu Vòng đời Hoàn tất Chi tiền Hoàn trả (Refund Payable Lifecycle Gap)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Settlement & Automation — 2026-10-08)
- **File / Table:** `app/src/routes/refunds.js`, bảng `public.refund_payables`
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Mở rộng vòng đời Refund Payable khép kín theo chuẩn nghiệp vụ tài chính: `REQUESTED/PENDING` $\to$ `APPROVED` $\to$ `PAID/SETTLED`.
  - Bổ sung các API quản lý và chi trả:
    - `POST /api/refunds/:id/approve` (yêu cầu quyền `adjustment.approve`)
    - `POST /api/refunds/:id/settle` và `POST /api/refunds/:id/pay` (yêu cầu quyền `payment.create`)
  - Chống gian lận và double settlement ở mức cơ sở dữ liệu: khóa hàng `FOR UPDATE`, ghi nhận Idempotency-Key trong `payment_idempotency_keys` với PostgreSQL advisory locks.
  - Ngăn chặn nhảy trạng thái trái quy trình: từ chối 409 khi cố tình settle refund chưa approved hoặc approve refund đã settled.
  - Khớp nối transaction-coupled audit trail: `REFUND_REQUESTED`, `REFUND_APPROVED`, `REFUND_SETTLED`.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-h-refund-settlement-test.mjs` — **11/11 CHECKS PASSED (100%)**.

---

### Finding I: Lỗ hổng Tự động Hóa Định kỳ & Nguy cơ Tín dụng (Recurring Engine & Credit Risk)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Settlement & Automation — 2026-10-08)
- **File / Symbol:** `app/src/scheduler.js`, `app/src/routes/recurring.js`, `public.recurring_plans`
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Tích hợp kiểm tra tiền phát hành tín dụng `CustomerCreditService.checkInvoiceIssueEligibility` vào quy trình tự động của scheduler (`runRecurringCycle`) và trigger thủ công (`POST /:id/trigger`).
  - Khi khách hàng vi phạm hạn mức hoặc mang trạng thái `LOCKED`, scheduler chặn phát hành hóa đơn tự động, ghi nhận lỗi `last_error`, phát sinh audit log `RECURRING_INVOICE_BLOCKED_BY_RISK` và giữ nguyên chu kỳ không cho trôi.
  - Loại bỏ hoàn toàn các giá trị hardcode tài chính cũ:
    - Xóa bỏ hardcode 30 ngày: tích hợp `PaymentTermsService.calculateAuthoritativeDueDate` để tính `due_date` chuẩn mực theo điều khoản thanh toán ràng buộc trên plan hoặc khách hàng.
    - **authoritative VAT Policy for Recurring Billing:** Xác lập thẩm quyền VAT đơn nhất:
      * **Thẩm quyền Chính (Primary Authority):** Thuế suất `vat_rate` tường minh được lưu trữ trên từng kế hoạch định kỳ (`recurring_plans.vat_rate`). Khi tạo kế hoạch, nếu client truyền `vat_rate`, hệ thống kiểm tra hợp lệ (`0.00` đến `0.20`) và lưu trữ chính xác.
      * **Giá trị Mặc định Pháp định (Statutory Default Source of Truth):** Khi client không truyền `vat_rate`, tầng ứng dụng KHÔNG tự ý inject fallback `'0.1000'` ngầm trong code JavaScript mà ủy quyền hoàn toàn cho giá trị mặc định của lược đồ cơ sở dữ liệu (`recurring_plans.vat_rate DEFAULT 0.1000` theo Migration 10).
      * **Thực thi Chu kỳ (Runtime Invariant):** Khi scheduler hoặc trigger phát hành hóa đơn, hệ thống bắt buộc sử dụng `plan.vat_rate` từ database để tính thuế dòng hàng (`invoice_items.vat_rate`) và tiền thuế theo số học exact decimal (`PostgreSQL NUMERIC`), chặn đứng nếu thiếu thông tin (`RECURRING_PLAN_VAT_RATE_REQUIRED`). Không tồn tại policy authority thứ hai ngoài source of truth.
  - Đảm bảo tính lũy tiến chu kỳ bất biến (idempotent billing cycle) chống phát hành trùng.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-i-recurring-risk-test.mjs` — **10/10 CHECKS PASSED (100%)**.

---

### Finding J: Lỗ hổng Nhập Sao kê & Thiếu Ràng buộc Trùng lặp Đối soát (Reconciliation Ingestion)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Settlement & Automation — 2026-10-08)
- **File / Table:** `app/src/routes/reconciliation.js`, bảng `public.bank_transactions`
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Định danh giao dịch chuẩn mực (Canonical Identity): sinh mã băm SHA-256 xác định `tx_hash` từ thông tin tài khoản ngân hàng và mã tham chiếu (hoặc bộ thuộc tính ngày, số tiền, loại giao dịch, nội dung).
  - Ràng buộc toàn vẹn cơ sở dữ liệu: bổ sung cột `tx_hash NOT NULL` và ràng buộc `UNIQUE (tx_hash)` kèm DB trigger `trg_ensure_bank_transaction_hash` (Migration 10). Bác bỏ triệt để các hành vi nạp trùng dưới điều kiện race condition đồng thời.
  - Triển khai Batch Ingestion hoàn chỉnh:
    - Endpoints: `POST /api/bank-transactions/batch` và `POST /api/reconciliation/batch` (yêu cầu quyền `reconciliation.manage`).
    - Hỗ trợ cả định dạng JSON array và CSV text với bộ parser an toàn, chuẩn hóa dữ liệu và lọc trùng lặp nội bộ trong lô cũng như đối chiếu cơ sở dữ liệu.
    - Ngữ nghĩa nghiệm thu từng phần (Partial acceptance semantics): nạp các dòng hợp lệ, phân loại dòng trùng lặp, báo cáo chi tiết các dòng lỗi định dạng mà không làm đổ vỡ cả lô.
    - Trả về thống kê chính xác: `total_rows`, `accepted`, `duplicates`, `rejected`, `errors`.
    - Ghi nhận nhật ký kiểm toán: `BANK_TRANSACTION_IMPORTED`, `BANK_TRANSACTION_DEDUPLICATED`.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-j-reconciliation-dedup-test.mjs` — **19/19 CHECKS PASSED (100%)**.

---

### Finding K: Hạn chế Thuế GTGT Cấp độ Hóa đơn trong Báo cáo (VAT Aggregation Limitation)
- **Mức độ (Severity):** `P1 - HIGH`
- **Trạng thái (Status):** `RESOLVED` (Đã đóng tại Giai đoạn P1 Settlement & Automation — 2026-10-08)
- **File / Symbol:** `app/src/routes/reports.js` (`vatHandler`, `/api/reports/vat`, `/api/reports/vat-declaration`)
- **Giải pháp Đã Triển khai (Implemented Fix):**
  - Thay thế hoàn toàn logic truy vấn nhóm theo `i.tax_rate` đầu hóa đơn bằng cơ chế tổng hợp trực tiếp từ dòng hàng `invoice_items` và khấu trừ Credit Note từ `invoice_adjustments` gom theo thuế suất từng dòng.
  - Phân nhóm chính xác từng xô thuế suất: 10%, 8%, 5%, 0% và phân tích động `rate_breakdown`.
  - Hỗ trợ hoàn hảo cho hóa đơn hỗn hợp thuế (Mixed VAT): hóa đơn chứa đồng thời các dòng thuế suất 10% và 8% được bóc tách và cộng dồn chính xác vào từng nhóm thuế tương ứng, không còn bị gom gộp sai lệch.
  - Khấu trừ chính xác các khoản Credit Note đã xử lý (`PROCESSED`) theo đúng thuế suất điều chỉnh.
  - Bất biến cân đối tài chính tuyệt đối:
    $$\Sigma \text{net\_rates} = \text{subtotal}, \quad \Sigma \text{vat\_rates} = \text{vat\_amount}, \quad \text{total} = \text{subtotal} + \text{vat\_amount}$$
  - Hỗ trợ xuất dữ liệu bảng kê theo định dạng CSV (`format=csv`) phục vụ lưu trữ kế toán.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p1-gate-k-vat-reporting-test.mjs` — **30/30 CHECKS PASSED (100%)**.

---

### Finding L: Thiếu Chứng từ Bản in Gốc & Phiếu thu Phía Máy chủ (Document Authority & Receipt Vouchers)
- **Mức độ (Severity):** `P2 - MEDIUM`
- **Trạng thái Lịch sử (Historical Status):** `OPEN` (Phát hiện tại Prompt 0 Baseline Audit)
- **Trạng thái Năng lực Hiện tại (Current Capability Status):** `RESOLVED` (Đã hoàn thiện & kiểm chứng 100% tại P2 Final Hardening)
- **File / Route Triển khai:**
  - `app/src/services/documentService.js` (Server-side rendering engine, dịch số thành chữ `docTienBangChu`, chống XSS `escapeHtml`)
  - `app/src/routes/invoices.js`: `GET /api/invoices/:id/print` (HTML) & `GET /api/invoices/:id/document` (JSON)
  - `app/src/routes/payments.js`: `GET /api/payments/:id/receipt` & `/voucher` (HTML) & `/print`
  - `app/src/routes/refunds.js`: `GET /api/refunds/:id/voucher` (HTML) & `/print`
  - `app/public/app.js`: Tích hợp các nút In Chứng từ Gốc trực tiếp từ máy chủ.
- **Hiện tượng Đã Xử lý & Năng lực Đạt được (Resolved Capabilities):**
  1. **Server-side Document Authority:** Toàn bộ dữ liệu chứng từ (khách hàng, dòng hàng, thuế suất VAT, số tiền, ngày phát hành, điều khoản) được truy vấn trực tiếp từ PostgreSQL và kết xuất ở máy chủ. Phía client/browser tuyệt đối không thể can thiệp hay sửa đổi số liệu tài chính.
  2. **Chuẩn Mực Chứng từ Kế toán Việt Nam:**
     - **Hóa đơn Giá trị Gia tăng:** Tuân thủ quy cách Nghị định 123/2020/NĐ-CP và Thông tư 78/2021/TT-BTC, hiển thị đầy đủ Ký hiệu, Số hóa đơn, bảng chi tiết từng thuế suất (Mixed VAT: 0%, 5%, 8%, 10%), tổng tiền trước thuế, tiền thuế, tổng thanh toán và số tiền viết bằng chữ tiếng Việt chính xác.
     - **Phiếu thu Tiền mặt / Chuyển khoản:** Tuân thủ Mẫu số 01 - TT (hoặc C40-BB) ban hành theo Thông tư 200/2014/TT-BTC, thể hiện số tiền đã ghi nhận, phương thức thanh toán, mã tham chiếu ngân hàng, số tiền viết bằng chữ và bảng phân bổ vào các hóa đơn liên quan.
     - **Phiếu chi Hoàn tiền:** Tuân thủ Mẫu số 02 - TT ban hành theo Thông tư 200/2014/TT-BTC, thể hiện số tiền hoàn trả công nợ, lý do hoàn tiền từ Credit Note, phương thức chi trả và số tiền viết bằng chữ.
  3. **Bảo mật & Phân quyền Granular RBAC:** Mọi endpoint in ấn đều được bảo vệ nghiêm ngặt bằng middleware `requireAuth` và quyền hạn nguyên tử: `invoice.read`, `payment.read`, `adjustment.read`. Chặn hoàn toàn truy cập trái phép hoặc leo thang đặc quyền.
  4. **Kiểm soát Định dạng In Ấn (Print Fidelity):** Bố cục A4 chuẩn mực với CSS `@media print`, ngăn chặn ngắt trang gãy đoạn (`page-break-inside: avoid`), hỗ trợ bảng kê nhiều dòng hàng và hóa đơn nhiều trang.
- **Chứng cứ Kiểm chứng (Verification Evidence):**
  - Suite: `scripts/p2-gate-l-documents-test.mjs` — **6/6 TEST SCENARIOS PASSED (100%)**.

---

## 10. DANH MỤC ĐIỂM NGHẼN P0 (P0 BLOCKERS)

Các điểm nghẽn cấp độ P0 ảnh hưởng trực tiếp đến an ninh, tính toàn vẹn tài chính và khả năng phục hồi của hệ thống:

1. **P0-1: [RESOLVED] Mất khả năng Triển khai / Tái tạo Cơ sở Dữ liệu từ Đầu (Clean Database Rebuild Failure)**
   - Đã đóng tại Giai đoạn P0.1 & P1. Schema migrations runner tự động chạy đồng bộ qua Docker Compose migration service.
2. **P0-2: [RESOLVED] Lỗ hổng Leo thang Đặc quyền trên Phân hệ Đối soát Ngân hàng (Reconciliation Authorization Bypass)**
   - Đã đóng tại Giai đoạn P0 Security Closure. Áp dụng `requirePermission('reconciliation.manage')` cho toàn bộ các endpoint đối soát.
3. **P0-3: [RESOLVED] Tranh chấp Đứt gãy Chuỗi Mật mã Kiểm toán (Audit Hash Chain Concurrency Race)**
   - Đã đóng tại Giai đoạn P0 Security Closure. Áp dụng `pg_advisory_xact_lock` tuần tự hóa các giao dịch ghi audit.
4. **P0-4: [RESOLVED] Vi phạm Quyền Append-Only của Nhật ký Kiểm toán (PostgreSQL Privileges Misconfiguration)**
   - Đã đóng tại Giai đoạn P0 Security Closure. Thu hồi toàn bộ quyền UPDATE/DELETE của `billing_app` trên `public.audit_logs`.

---

## 11. DANH MỤC ĐIỂM NGHẼN P1 (P1 BLOCKERS)

Toàn bộ các điểm nghẽn cấp độ P1 đã được giải quyết triệt để và nghiệm thu 100%:

1. **P1-1: [RESOLVED] Bắt buộc Nhập tay Ngày Đáo hạn & Hardcode 30 Ngày Định kỳ (Payment Terms Disconnected)**
   - Đã đóng tại Giai đoạn P1 Financial Core (`PaymentTermsService`, kế thừa điều khoản khách hàng, bác bỏ tiêm `due_date`, tích hợp `scheduler.js`).
2. **P1-2: [RESOLVED] Không Hỗ trợ Thuế Suất Cấp Dòng hàng (Mixed Item-Level VAT Unsupported)**
   - Đã đóng tại Giai đoạn P1 Financial Core (Migration `09_p1_financial_core.sql`, `vat_amount`, `total_amount`, nguyên tắc Sum-of-lines, catalog SKU fallback, override client totals).
3. **P1-3: [RESOLVED] Con số Giả tạo & Công thức Sai lệch trong Báo cáo DSO / CEI (Hardcoded Metric Fallbacks)**
   - Đã đóng tại Giai đoạn P1 Financial Core (Xóa bỏ 32.5 và 94.2, áp dụng chuẩn CRF cho CEI, DSO 90 ngày tính toán từ PostgreSQL, xử lý mẫu số 0 là `null`/`0.0`).
4. **P1-4: [RESOLVED] Bỏ lọt Kiểm tra Rủi ro Tín dụng trong Luồng Định kỳ Tự động (Recurring Auto-Sign Bypasses Risk FSM)**
   - Đã đóng tại Giai đoạn P1 Settlement & Automation (`CustomerCreditService` pre-issuance risk check trong `scheduler.js`, chặn khách hàng LOCKED, ghi nhận `RECURRING_INVOICE_BLOCKED_BY_RISK`, loại bỏ hardcode 30 ngày và 10% VAT).
5. **P1-5: [RESOLVED] Bế tắc Vòng đời Hoàn trả Tiền mặt (Refund Payables Stuck in PENDING)**
   - Đã đóng tại Giai đoạn P1 Settlement & Automation (Vòng đời hoàn tiền đầy đủ `PENDING` $\to$ `APPROVED` $\to$ `PAID`, API phê duyệt và chi trả, chống chi trả đúp qua Idempotency-Key và row-locking).
6. **P1-6: [RESOLVED] Thiếu Chống Nạp Trùng Sao kê Ngân hàng (Reconciliation Deduplication Missing)**
   - Đã đóng tại Giai đoạn P1 Settlement & Automation (Định danh canonical `tx_hash`, ràng buộc DB `UNIQUE (tx_hash)`, Batch Ingestion an toàn hỗ trợ JSON/CSV, cơ chế báo cáo lỗi và trùng lặp).
7. **P1-7: [RESOLVED] Hổng Quyền trên API Khách hàng và Sản phẩm (Missing RBAC on Customers & Products Mutation)**
   - Đã đóng tại Giai đoạn P0 Security Closure (`requirePermission('customer.create')`, `product.manage`).

---

## 12. DANH MỤC CẢI TIẾN P2 (P2 IMPROVEMENTS)

Các cải tiến cấp độ P2 liên quan đến trải nghiệm người dùng, cấu trúc mã nguồn và tính tiện ích:

1. **P2-1: Tách Biệt Toàn Bộ Tầng Dịch vụ Miền (Full Domain Services Decoupling)**
   - *Trạng thái:* `BACKLOG / OUT OF CURRENT RELEASE SCOPE`
   - *Chi tiết:* Các miền tài chính trọng yếu đã được đóng gói thành các dịch vụ độc lập (`CustomerCreditService`, `PaymentService`, `PaymentTermsService`, `DocumentService`). Việc tách toàn bộ các router Express còn lại thành class riêng là mục tiêu tối ưu cấu trúc dài hạn, không thuộc phạm vi bắt buộc của release gate P2.
2. **P2-2: Giao diện Quản trị Phân quyền RBAC Phía Frontend (RBAC Management UI)**
   - *Trạng thái:* `BACKLOG / OUT OF CURRENT RELEASE SCOPE`
   - *Chi tiết:* Toàn bộ ma trận RBAC 5 vai trò / 21 quyền hạn đã được triển khai, thực thi nghiêm ngặt tại backend API boundary và kiểm chứng 100% qua Gate 8. Giao diện động của ứng dụng tự động ẩn/hiện chức năng theo quyền hạn. Màn hình CRUD phân quyền tùy biến cho Admin là tính năng mở rộng nằm ngoài scope P2.
3. **P2-3: [RESOLVED] Bản thể hiện Chứng từ Gốc & Mẫu in Phiếu thu (Print Documents & Receipt Voucher PDF/HTML)**
   - *Trạng thái:* `RESOLVED (P2 FINAL HARDENING)`
   - *Chi tiết:* Đã hoàn thành 100% tại Gate L (`documentService.js`, các endpoint HTML/JSON cho Hóa đơn GTGT NĐ 123, Phiếu thu TT 200, Phiếu chi hoàn tiền TT 200, dịch tiền thành chữ tiếng Việt, kiểm chứng 6/6 kịch bản).
4. **P2-4: [RESOLVED] Công cụ Nhập Sao kê Ngân hàng Hàng loạt (Batch Statement Ingestion)**
   - *Trạng thái:* `RESOLVED (P1/P2 FINAL HARDENING)`
   - *Chi tiết:* Đã hoàn thành 100% tại Gate J qua `POST /api/bank-transactions/batch` và `POST /api/reconciliation/batch`, hỗ trợ parser JSON array và CSV text, cơ chế deduplication canonical `tx_hash`, kiểm chứng 22/22 kịch bản.

---

## 13. THỨ TỰ PHỤ THUỘC TRIỂN KHAI (DEPENDENCY ORDER CHO CÁC TẦNG TIẾP THEO)

Để đảm bảo việc sửa chữa diễn ra đúng thứ tự, không tạo ra lỗi hồi quy (regression) và không phá vỡ 100% test suite hiện có, các tầng tiếp theo **BẮT BUỘC phải tuân thủ thứ tự phụ thuộc nghiêm ngặt sau**:

```
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ GIAI ĐOẠN 1: HẠ TẦNG CƠ SỞ & BẢO MẬT HỆ THỐNG (FOUNDATION & SECURITY)     │
 │ 1. Đồng bộ hóa Schema Bootstrap (Khắc phục Finding A - P0-1)              │
 │    • Đưa toàn bộ migration 01-08 vào quy trình init của Docker PostgreSQL  │
 │    • Đảm bảo clean rebuild `docker compose down -v && up` chạy đúng 100%  │
 │ 2. Khóa An toàn Nhật ký Kiểm toán (Khắc phục Finding G - P0-3 & P0-4)     │
 │    • Thêm Transaction Advisory Lock cho hàm `recordAudit`                 │
 │    • Thu hồi quyền UPDATE/DELETE của `billing_app` trên `public.audit_logs`│
 │ 3. Hoàn thiện Chốt chặn Quyền hạn RBAC (Khắc phục Finding F - P0-2)       │
 │    • Bổ sung `reconciliation.manage` cho toàn bộ endpoint đối soát        │
 │    • Bổ sung `customer.create` và `product.manage` trên các route tạo/sửa  │
 └─────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ GIAI ĐOẠN 2: LÕI SỐ HỌC TÀI CHÍNH & ĐIỀU KHOẢN (FINANCIAL LOGIC & TERMS)  │
 │ 4. Tự động hóa Điều khoản Thanh toán (Khắc phục Finding C - P1-1)         │
 │    • Tự động tính `due_date = issue_date + term.days` trong hóa đơn       │
 │    • Thay thế hardcode 30 ngày trong `scheduler.js` bằng điều khoản khách │
 │ 5. Chuẩn hóa Thuế GTGT Dòng hàng & Mixed VAT (Khắc phục Finding D & K)     │
 │    • Lưu `vat_rate` cho từng dòng hàng `invoice_items`                    │
 │    • Tính tổng tiền thuế từ chi tiết dòng hàng; sửa truy vấn báo cáo VAT  │
 └─────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ GIAI ĐOẠN 3: ĐỘNG CƠ TỰ ĐỘNG & VÒNG ĐỜI SỔ CÁI (LIFECYCLE & ENGINES)      │
 │ 6. Chặn Rủi ro Tín dụng trong Xuất Định kỳ (Khắc phục Finding I - P1-4)   │
 │    • Tích hợp `CustomerCreditService` vào quy trình auto-sign của scheduler│
 │    • Chặn phát hành hóa đơn mới cho khách hàng đang bị `LOCKED`           │
 │ 7. Hoàn thiện Vòng đời Chi tiền Hoàn trả (Khắc phục Finding H - P1-5)     │
 │    • Xây dựng endpoint phê duyệt và ghi nhận thanh toán chi tiền hoàn trả │
 │ 8. Chống Nạp trùng Sao kê Ngân hàng (Khắc phục Finding J - P1-6)          │
 │    • Thêm cơ chế kiểm tra deduplication cho bảng `bank_transactions`       │
 └─────────────────────────────────────┬─────────────────────────────────────┘
                                       │
                                       ▼
 ┌───────────────────────────────────────────────────────────────────────────┐
 │ GIAI ĐOẠN 4: BÁO CÁO CHUẨN MỰC & TRẢI NGHIỆM (REPORTS & DOCUMENTS)        │
 │ 9. Chuẩn hóa Công thức DSO & CEI (Khắc phục Finding E - P1-3)             │
 │    • Xóa bỏ triệt để hardcode 32.5 và 94.2; áp dụng công thức chuẩn CRF   │
 │ 10. Hoàn thiện Chứng từ & Phiếu thu (Khắc phục Finding L - P2-3)          │
 │    • Bổ sung mẫu in Phiếu thu cho Payments; loại bỏ ký hiệu hóa đơn cứng  │
 └───────────────────────────────────────────────────────────────────────────┘
```

---

## 14. CAM KẾT & KẾT LUẬN CỦA BAN KIẾM KÊ

1. Báo cáo này đã rà soát và kiểm kê đầy đủ **18/18 tính năng** của hệ thống Billing_One mà không bỏ sót bất kỳ phân hệ nào.
2. Không sử dụng suy đoán; mọi khẳng định đều đi kèm vị trí file, dòng mã nguồn cụ thể và kết quả thực thi kiểm thử tại chỗ.
3. Không thực hiện thay đổi mã nguồn logic nghiệp vụ sản xuất trong lượt preflight Prompt 0 này.
4. Toàn bộ các phát hiện và thứ tự triển khai trên đã được đóng băng để làm cơ sở chỉ dẫn bất biến cho các bước triển khai tiếp theo.

---

## 15. KẾT LUẬN GIAI ĐOẠN VẬN HÀNH CUỐI CÙNG (FINAL OPERATIONS STATUS)

| Hạng mục Vận hành | Trạng thái Kỹ thuật | Ghi chú & Bằng chứng |
| :--- | :---: | :--- |
| **Xoay Vòng Thông tin Bí mật (Credential Rotation)** | **PASS** | `scripts/verify-credential-rotation.mjs` PASS 9/9 kiểm tra |
| **Thanh lọc Lịch sử Git (Git History Scrubbing)** | **EXTERNAL ACTION REQUIRED** | `scripts/verify-git-history-secrets.mjs` phát hiện 3 commit lịch sử; runbook sẵn sàng |
| **Chứng chỉ TLS CA Chính thức (Official CA TLS)** | **EXTERNAL ACTION REQUIRED** | `scripts/verify-production-tls.mjs --strict` chặn đúng môi trường dev self-signed |
| **Toàn vẹn Tài chính (Financial Invariants)** | **PASS** | `scripts/final-financial-integrity-check.mjs` PASS 10/10 |
| **Bộ Kiểm thử Hồi quy (Regression Suite)** | **PASS** | `scripts/run-all-tests.mjs` PASS 31/31 Active Suites |
| **Khởi tạo Database Sạch (Fresh DB Bootstrap)** | **PASS** | `scripts/test-fresh-deployment.mjs` 11/11 migrations, 45/45 schema checks |
| **Gói Phát hành (Release Package)** | **PASS** | `release/Billing_One_Extended_RELEASE_CANDIDATE_2.0.0.zip` (3.40 MB, 0 backups, 0 dumps, 0 secrets) |

**QUYẾT ĐỊNH PHÁT HÀNH CUỐI CÙNG: `RELEASE READY WITH OPERATIONAL ACTIONS`**

