# BILLING_ONE — PRE-FLIGHT SYSTEM CHECK REPORT
**Document Reference:** `docs/BILLING_ONE_PREFLIGHT_CHECK_REPORT.md`  
**Assessment Date:** 2026-10-07  
**Evaluator:** Senior Software Engineer + DevOps Engineer  
**Stage:** PRE-FLIGHT BASELINE CHECK (Pre-Deep Audit)  
**Target Next Phase:** DEEP ARCHITECTURE & FINANCIAL INTEGRITY AUDIT  
**Readiness Conclusion:** **READY WITH WARNINGS**

---

## 1. Executive Summary

Hệ thống **Billing_One** đã trải qua đợt kiểm tra tiền khởi động (**Pre-flight System Check**) toàn diện, an toàn và hoàn toàn **READ-ONLY**, nhằm thiết lập trạng thái đường cơ sở (**Baseline State**) trước khi tiến hành giai đoạn kiểm toán kiến trúc sâu và tính toàn vẹn tài chính (*Deep Architecture & Financial Integrity Audit*).

### Điểm nổi bật chính:
1. **Container & Hạ tầng ảo hóa:** Toàn bộ **12/12 containers** trong cụm Docker Compose đều đang ở trạng thái **RUNNING**, trong đó tất cả các service có cấu hình health check (`web`, `postgres`, `nginx`, `cadvisor`) đều báo cáo **HEALTHY**.
2. **Cơ sở dữ liệu (PostgreSQL 16.15):** Kết nối thông suốt, 17 bảng nghiệp vụ đầy đủ, cấu trúc remediation (chuỗi băm kiểm toán `audit_logs`, phân bổ thanh toán `payment_allocations`, tiền chưa phân bổ `unapplied_amount`, kế hoạch định kỳ `recurring_plans`, hệ thống RBAC hạt nhân 5 roles / 19 permissions) tồn tại nguyên vẹn. Đặc biệt, **318/318 bản ghi kiểm toán** đã được chứng thực hợp lệ 100% qua chuỗi mã hóa mật mã SHA-256 (`valid: true`).
3. **Application & Backend:** Node.js Express 5.2.1 phản hồi ổn định với độ trễ nội bộ siêu thấp (**~1–20ms**), kết nối database thông suốt qua Connection Pool.
4. **Security Hardening (CP6):** Đã chạy thực chứng bộ kiểm thử tự động `scripts/verify-hardening.ps1` và đạt kết quả tuyệt đối **22/22 CHECKS PASS** (H1–H6: Non-root user, cách ly 5 mạng nội bộ, quyền tối thiểu DB, phân tách cổng, Security Headers đầy đủ).
5. **Frontend & Tích hợp API (E2E):** Đã chạy `scripts/frontend-e2e-test.mjs` và đạt **16/16 views PASS (100% 200 OK)**, phân phối tài nguyên tĩnh HTML/CSS/JS (67.8 KB) trơn tru, không có lỗi 404 trên các router alias.
6. **Background Scheduler:** Tiến trình lập lịch hóa đơn định kỳ tự động chạy nền trong container `web` mỗi 60 giây, bảo vệ bằng **PostgreSQL Advisory Lock (ID 88812345)** và thuật toán an toàn biên ngày `addMonthsSafe`.

### Cảnh báo cần lưu ý:
- **Codebase Git State:** Working tree hiện có 10 file modified và 27 file untracked (chứa toàn bộ code phát triển tính năng mở rộng và remediation từ đợt trước). Mặc dù các file này đã được đóng gói (*baked*) hoàn chỉnh vào Docker image `billing-web` đang chạy, nhưng chưa được commit vào Git repository.
- **Tên script Smoke Test:** Script được chỉ định trong yêu cầu kiểm tra là `scripts/cp2-smoke-test.mjs` không tồn tại trong codebase (file thực tế là `scripts/cp2-smoke.mjs`). Do quy tắc kiểm toán không tự tạo dữ liệu kinh doanh nhân tạo trước Deep Audit, script `cp2-smoke.mjs` không được kích hoạt nhằm bảo toàn tính bất biến của dữ liệu tài chính.

---

## 2. Environment Status

| Thành phần | Trạng thái | Phiên bản / Chi tiết | Đánh giá |
|:---|:---:|:---|:---:|
| **Docker Engine** | RUNNING | Docker Desktop v28+, WSL2 Linux kernel 6.18 | **PASS** |
| **Docker Compose** | RUNNING | 12 services defined, 12 active containers | **PASS** |
| **PostgreSQL** | HEALTHY | PostgreSQL 16.15 (Debian 16.15-1.pgdg13+2), port 5432 (internal only) | **PASS** |
| **Backend Web** | HEALTHY | Node.js v24.21.0, Express 5.2.1, port 3000 (internal only) | **PASS** |
| **Frontend / Reverse Proxy**| HEALTHY | Nginx 1.30.5-alpine, ports 80/443 exposed, SSL TLSv1.2/1.3 | **PASS** |
| **Scheduler** | RUNNING | Background Worker tích hợp trong `web`, interval 60s, Advisory Lock 88812345 | **PASS** |
| **Monitoring Stack** | RUNNING | Prometheus v3.15, Grafana v13.2.3, Loki v3.7.8, Promtail v3.6.11 | **PASS** |
| **System Exporters** | RUNNING | cadvisor v0.60.6, node-exporter v1.12.1, postgres-exporter v0.20.1, nginx-exporter v1.5.3 | **PASS** |

### Chi tiết trạng thái từng Container:
```
NAME                          IMAGE                                           STATUS                        PORTS
billing-cadvisor-1            ghcr.io/google/cadvisor:v0.60.6                 Up (healthy)                  8080/tcp
billing-grafana-1             grafana/grafana:13.2.3                          Up                            127.0.0.1:3000->3000/tcp
billing-loki-1                grafana/loki:3.7.8                              Up                            3100/tcp
billing-nginx-1               nginxinc/nginx-unprivileged:1.30.5-alpine       Up (healthy)                  0.0.0.0:80->8080/tcp, 0.0.0.0:443->8443/tcp
billing-nginx-exporter-1      nginx/nginx-prometheus-exporter:1.5.3           Up                            
billing-node-exporter-1       prom/node-exporter:v1.12.1                      Up                            9100/tcp
billing-pgadmin-1             dpage/pgadmin4:9.18.0                           Up                            127.0.0.1:5050->5050/tcp
billing-postgres-1            postgres:16.15-trixie                           Up (healthy)                  5432/tcp
billing-postgres-exporter-1   prometheuscommunity/postgres-exporter:v0.20.1   Up                            9187/tcp
billing-prometheus-1          prom/prometheus:v3.15.0                         Up                            127.0.0.1:9090->9090/tcp
billing-promtail-1            grafana/promtail:3.6.11                         Up                            
billing-web-1                 billing-web:latest                              Up (healthy)                  3000/tcp
```
- Phân loại: **12 RUNNING (trong đó 4 HEALTHY, 8 RUNNING không cấu hình healthcheck probe nội bộ)**.
- **0 UNHEALTHY, 0 EXITED, 0 RESTARTING, 0 MISSING**.

---

## 3. Git State

- **Branch hiện tại:** `main` (Up to date with `origin/main`)
- **Commit gần nhất (Top 5):**
  1. `0222e34` docs: add startup and assessment guides
  2. `1138c8c` docs: finalize post-release documentation
  3. `fded947` docs(report): add final report and demo script
  4. `2141b24` docs: complete README, architecture diagrams and evidence index
  5. `94dc8f0` security: harden containers, networks, credentials and database roles

### File đã sửa đổi nhưng chưa commit (`Changes not staged for commit`):
| File | Loại thay đổi | Ảnh hưởng Runtime |
|:---|:---:|:---|
| `app/public/app.js` | Modified | Chứa giao diện hoàn chỉnh, alias router fixes, format VND, dual field handler |
| `app/public/styles.css` | Modified | Stylesheet giao diện chuẩn |
| `app/src/metrics.js` | Modified | Đo lường metrics Prometheus cho API |
| `app/src/routes/auth.js` | Modified | RBAC permission middleware injection |
| `app/src/routes/customers.js` | Modified | Hỗ trợ tìm kiếm, case-insensitive segment normalization |
| `app/src/routes/index.js` | Modified | Dual-mount toàn bộ router alias (F-01 remediation) |
| `app/src/routes/invoices.js` | Modified | RBAC enforcement, credit note linkage, e-invoice code alias |
| `app/src/routes/payments.js` | Modified | Phân bổ thanh toán đa hóa đơn, method CREDIT_NOTE |
| `app/src/server.js` | Modified | Khởi động scheduler tích hợp |
| `app/src/validation.js` | Modified | Ràng buộc dữ liệu hợp lệ |

### File chưa được theo dõi (`Untracked files`):
| Thư mục / File | Mục đích / Mô tả |
|:---|:---|
| `app/src/audit.js` | Cryptographic SHA-256 tamper-evident chaining engine |
| `app/src/scheduler.js` | Autonomous recurring billing worker với Advisory Lock |
| `app/src/routes/adjustments.js` | Credit note / Adjustment router & cấn trừ công nợ |
| `app/src/routes/audit.js` | Endpoint truy vấn và xác thực tính toàn vẹn chuỗi audit |
| `app/src/routes/payment-terms.js` | Endpoint danh mục điều khoản thanh toán |
| `app/src/routes/products.js` | Endpoint danh mục sản phẩm/dịch vụ |
| `app/src/routes/rbac.js` | Endpoint quản lý quyền và vai trò |
| `app/src/routes/reconciliation.js` | Khớp nối ngân hàng và theo dõi tiền chưa phân bổ |
| `app/src/routes/recurring.js` | Endpoint quản lý hóa đơn định kỳ |
| `app/src/routes/reports.js` | Báo cáo tuổi nợ, doanh thu, thuế GTGT |
| `app/src/routes/settings.js` | Cấu hình công ty |
| `db/init/04-evolution.sql` | Schema mở rộng LedgerFlow Enterprise |
| `db/init/05-remediation.sql` | Schema sửa chữa 14 lỗi kiểm toán (Audit hash, RBAC, v.v.) |
| `docs/BILLING_ONE_*.md` | Toàn bộ tài liệu kiến trúc, mô hình dữ liệu, lộ trình, báo cáo |
| `scripts/extended-features-test.mjs`| Bộ test 12 tính năng mở rộng |
| `scripts/frontend-e2e-test.mjs` | Bộ test giao diện E2E và API contract |
| `scripts/init-audit-hashes.js` | Script khởi tạo mã băm chuỗi kiểm toán |
| `scripts/remediation-verification.mjs`| Bộ test kiểm chứng 14 phát hiện |

> [!NOTE]
> Toàn bộ các file modified và untracked nói trên đã được build vào image container `billing-web` (tạo lúc `2026-10-07T01:43:57Z`). Do đó, runtime trong container đang phản ánh chính xác 100% nội dung của các file này. Tuy nhiên, việc chưa commit vào Git là một trạng thái cần ghi nhận để tránh rủi ro mất mã nguồn nếu thực hiện thao tác checkout/clean bất cẩn.

---

## 4. Health Checks

| Component | Endpoint / Kiểm tra | Kết quả | Evidence |
|:---|:---|:---:|:---|
| **Nginx (Edge)** | `GET http://localhost/nginx-health` (port 8080) | **PASS** | HTTP 200 OK, Body: `"ok\n"`, latency < 2ms |
| **Nginx (SSL Redirect)**| `GET http://localhost/health` | **PASS** | HTTP 301 Moved Permanently -> `https://localhost/health` |
| **Nginx (Public Health)**| `GET https://localhost/health` | **PASS (Intended)** | HTTP 404 Not Found (Hardening H6: Chặn lộ thông tin nội bộ ra Internet) |
| **Backend Web (Internal)**| `GET http://127.0.0.1:3000/health` (trong container) | **PASS** | HTTP 200 OK, Body: `{"status":"ok","db":"ok"}`, latency ~1.1ms |
| **Backend Metrics** | `GET http://127.0.0.1:3000/metrics` (trong container) | **PASS** | HTTP 200 OK, Prometheus metrics exposition format |
| **PostgreSQL Engine** | `pg_isready -U postgres -d billing` | **PASS** | `accepting connections`, status code 0 |
| **Grafana UI** | `GET http://127.0.0.1:3000/api/health` | **PASS** | HTTP 200 OK, Grafana server listening |
| **Prometheus Server**| `GET http://127.0.0.1:9090/-/healthy` | **PASS** | HTTP 200 OK, Server ready to receive web requests |

---

## 5. Smoke Test Results

Theo chỉ dẫn kiểm toán tại Mục IX:
- Kiểm tra sự tồn tại của script: `scripts/cp2-smoke-test.mjs`
- Kết quả kiểm tra tệp: **Tệp `scripts/cp2-smoke-test.mjs` KHÔNG TỒN TẠI** trong thư mục `scripts/`.
- File thực tế trong repository: `scripts/cp2-smoke.mjs`.

| Test Name | File Path | Total Tests | PASS | FAIL | Status | Ghi chú |
|:---|:---|:---:|:---:|:---:|:---:|:---|
| **CP2 Smoke Test** | `scripts/cp2-smoke-test.mjs` | 0 | 0 | 0 | **NOT AVAILABLE** | Script not found với tên chính xác này. |
| **CP2 Baseline Script** | `scripts/cp2-smoke.mjs` | 15 checks | N/A | N/A | **NOT RUN (BLOCKED BY RULE)** | Không chạy vì script này tạo dữ liệu nghiệp vụ nhân tạo (Customer, Invoice, Payments), vi phạm Quy tắc 14 & Mục XI trong đợt Pre-flight Check. |

---

## 6. Extended / Hardening / Remediation Test Results

Đã thực hiện kiểm tra các test suite hiện có trong codebase:

### 6.1. Hardening Verification Test (`scripts/verify-hardening.ps1`)
- **Lệnh thực thi:** `powershell -ExecutionPolicy Bypass -File scripts/verify-hardening.ps1`
- **Kết quả:** **22/22 CHECKS PASS (100%)**
- **Chi tiết các nhóm kiểm soát:**
  - `H1.1 - H1.7`: Non-root container runtime (Node:1000, Postgres:999, Nginx:101, Grafana:472, Prometheus:65534, Loki:10001, cAdvisor privileged documented) -> **7/7 PASS**
  - `H2.1 - H2.4`: Network isolation (5 isolated networks: `edge_net`, `admin_net`, `app_net`, `db_net`, `monitoring_net`, internal flags verified, Nginx không thuộc `db_net`, Admin net tách biệt) -> **4/4 PASS**
  - `H3.1 - H3.3`: Credentials & Secrets (.env không bị track bởi git, .env.example được track, Grafana từ chối admin/admin mặc định 401) -> **3/3 PASS**
  - `H4.1 - H4.7`: Database Least Privilege (`billing_app` bị từ chối DROP TABLE, UPDATE payments, DELETE payments; `billing_readonly` chỉ được SELECT, bị chặn INSERT và truy cập bảng users; exporter có role `pg_monitor`) -> **7/7 PASS**
  - `H5.1 - H5.2`: Security Headers & TLS (HSTS, nosniff, DENY, Referrer, Permissions, CSP, Nginx server token hidden) -> **2/2 PASS**
  - `H6.1 - H6.3`: Port Exposure (Không expose port 3000 web, port 5432 postgres, port 3100 loki ra bên ngoài) -> **3/3 PASS**

### 6.2. Frontend & Static Asset E2E Test (`scripts/frontend-e2e-test.mjs`)
- **Lệnh thực thi:** `node scripts/frontend-e2e-test.mjs`
- **Kết quả:** **16/16 VIEWS PASS (100% 200 OK, ZERO 404s)**
- **Chi tiết:**
  - Cung cấp HTML shell (`/`): **PASS** (chứa `#app`, nạp `app.js`, `styles.css`)
  - Cung cấp Stylesheet (`/styles.css`): **PASS** (HTTP 200)
  - Cung cấp Javascript Bundle (`/app.js`): **PASS** (67,795 bytes, cú pháp hợp lệ)
  - Quét và kiểm tra 16 view routes gọi từ Frontend:
    - `/api/dashboard/summary` -> **200 OK**
    - `/api/customers?limit=100` -> **200 OK**
    - `/api/products?limit=100` -> **200 OK**
    - `/api/payment-terms` -> **200 OK**
    - `/api/invoices?limit=100` -> **200 OK**
    - `/api/payments?limit=100` -> **200 OK**
    - `/api/adjustments?limit=100` -> **200 OK**
    - `/api/recurring?limit=100` -> **200 OK**
    - `/api/reconciliation/transactions?limit=100` -> **200 OK**
    - `/api/reports/aging` -> **200 OK**
    - `/api/reports/collection-metrics` -> **200 OK**
    - `/api/reports/revenue-analytics` -> **200 OK**
    - `/api/reports/vat-declaration` -> **200 OK**
    - `/api/audit?limit=100` -> **200 OK**
    - `/api/audit/verify` -> **200 OK**
    - `/api/settings` -> **200 OK**

### 6.3. Extended Features & Remediation Scripts
- `scripts/extended-features-test.mjs`: **NOT RUN (PRE-AUDIT PRESERVATION)** — Script chứa các thao tác ghi dữ liệu (tạo sản phẩm mới, khách hàng mới, hóa đơn mới, thanh toán mới, phân bổ tín dụng). Để tuân thủ Quy tắc 14 ("Không thay đổi dữ liệu nghiệp vụ thật") và bảo toàn tính nguyên vẹn sổ cái cho Deep Audit, script này không được chạy trong bước Pre-flight Check.
- `scripts/remediation-verification.mjs`: **NOT RUN (PRE-AUDIT PRESERVATION)** — Script thực hiện sửa băm nhân tạo trong database (`UPDATE audit_logs SET hash = '...'`) để kiểm tra phát hiện can thiệp. Chạy script này trong Pre-flight Check có rủi ro làm hỏng chuỗi băm trước Deep Audit. Thay vào đó, tính toàn vẹn chuỗi băm được chứng thực an toàn qua endpoint READ-ONLY `GET /api/audit/verify`.

---

## 7. Database State (READ-ONLY Inspection)

Cơ sở dữ liệu: `billing`, Hệ quản trị: PostgreSQL 16.15.  
Toàn bộ thao tác kiểm tra được thực hiện dưới chế độ **CHỈ ĐỌC (READ-ONLY)**.

### 7.1. Danh sách bảng và quan hệ (17 tables):
```sql
 public | audit_logs          | table | postgres (318 rows)
 public | bank_transactions   | table | postgres (8 rows)
 public | company_settings    | table | postgres (1 row)
 public | customers           | table | postgres (82 rows)
 public | invoice_adjustments | table | postgres (22 rows)
 public | invoice_items       | table | postgres (702 rows)
 public | invoices            | table | postgres (455 rows)
 public | payment_allocations | table | postgres (10 rows)
 public | payment_terms       | table | postgres (14 rows)
 public | payments            | table | postgres (254 rows)
 public | permissions         | table | postgres (19 rows)
 public | products            | table | postgres (14 rows)
 public | recurring_plans     | table | postgres (10 rows)
 public | role_permissions    | table | postgres (54 rows)
 public | roles               | table | postgres (5 rows)
 public | user_sessions       | table | postgres (active session records)
 public | users               | table | postgres (2 rows: admin, staff)
```

### 7.2. Kiểm tra các cấu trúc Remediation:
1. **Audit Hash Chaining (`audit_logs`):**
   - Các cột: `prev_hash varchar(64)`, `hash varchar(64)`, `entity_type varchar(64)`, `entity_id varchar(64)`, `canonical_data text`.
   - Tổng số bản ghi: **318**.
   - Số bản ghi có `hash`: **318/318 (100%)**.
   - Số bản ghi có `prev_hash`: **318/318 (100%)**.
   - Chứng thực chuỗi băm qua API (`/api/audit/verify`):
     `{"verified": true, "valid": true, "verified_count": 318, "total_records": 318}`.
   - **Đánh giá: PASS — Chuỗi kiểm toán mật mã SHA-256 toàn vẹn 100%, không bị can thiệp.**

2. **Payment Allocation (`payment_allocations`):**
   - Các cột: `id`, `payment_id`, `invoice_id`, `allocated_amount`, `created_at`.
   - Tồn tại và liên kết đúng khóa ngoại tới `payments` và `invoices`.
   - **Đánh giá: PASS**.

3. **Unapplied Amount (`bank_transactions`):**
   - Cột `unapplied_amount numeric` tồn tại trên bảng `bank_transactions`.
   - Cho phép ghi nhận và cô lập số tiền chuyển thừa khi đối soát ngân hàng.
   - **Đánh giá: PASS**.

4. **Recurring Billing (`recurring_plans`):**
   - Các cột: `code`, `customer_id`, `service_title`, `contract_ref`, `frequency`, `amount_per_period`, `next_run_date`, `completed_cycles`, `total_cycles`, `status`, `auto_sign`, `last_error`.
   - 10 gói định kỳ đang tồn tại trong hệ thống.
   - **Đánh giá: PASS**.

5. **RBAC & Granular Permissions:**
   - 5 vai trò trong `roles`: `admin`, `staff`, `ROLE_BILLING_MANAGER`, `ROLE_ACCOUNTANT`, `ROLE_AUDITOR`.
   - 19 quyền hạn trong `permissions`: từ `invoice.read`, `invoice.create`, `invoice.issue`, `invoice.cancel`, đến `adjustment.approve`, `audit.verify`.
   - 54 liên kết vai trò-quyền trong `role_permissions`.
   - **Đánh giá: PASS**.

6. **Credit Note / Adjustment Structure (`invoice_adjustments`):**
   - Các cột: `credit_note_no`, `original_invoice_id`, `adjustment_type`, `amount`, `vat_rate`, `vat_amount`, `total_amount`, `reason`, `status`, `created_by`, `approved_by`, `approved_at`.
   - Ràng buộc phương thức thanh toán trong `payments`: `CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'CREDIT_NOTE'))`.
   - **Đánh giá: PASS**.

---

## 8. API & Frontend Status

Thực hiện kiểm tra READ-ONLY có xác thực với vai trò Quản trị viên (`admin`) trên tất cả các nhóm endpoint nghiệp vụ chính:

| Nhóm API | Tuyến Endpoint | Mã HTTP | Độ trễ | Kết quả Dữ liệu |
|:---|:---|:---:|:---:|:---|
| **Products** | `GET /api/products?limit=10` | 200 OK | 19.99ms | 10 sản phẩm (tổng: 14) |
| **Customers** | `GET /api/customers?limit=10` | 200 OK | 11.52ms | 10 khách hàng (tổng: 82) |
| **Payment Terms** | `GET /api/payment-terms` | 200 OK | 17.58ms | 14 điều khoản thanh toán |
| **Invoices** | `GET /api/invoices?limit=10` | 200 OK | 18.08ms | 10 hóa đơn (tổng: 455) |
| **Payments** | `GET /api/payments?limit=10` | 200 OK | 7.92ms | 10 phiếu thu (tổng: 254) |
| **Aging Report** | `GET /api/reports/aging` | 200 OK | 10.37ms | Ma trận tuổi nợ đầy đủ (`summary`, `customers`, `matrix`) |
| **Revenue Report** | `GET /api/reports/revenue-analytics` | 200 OK | 17.54ms | Doanh thu định kỳ (`mrr`, `arr`, `recurring_mrr`) |
| **VAT Declaration**| `GET /api/reports/vat-declaration` | 200 OK | 10.21ms | Báo cáo thuế GTGT (`period`, `summary`, `totals`, `invoices`) |
| **Adjustments** | `GET /api/adjustments?limit=10` | 200 OK | 9.25ms | 10 điều chỉnh/Credit Note (tổng: 22) |
| **Recurring Plans**| `GET /api/recurring?limit=10` | 200 OK | 19.70ms | 10 gói định kỳ |
| **Reconciliation** | `GET /api/reconciliation/transactions?limit=10` | 200 OK | 13.65ms | 8 giao dịch ngân hàng đối soát |
| **Audit Logs** | `GET /api/audit?limit=10` | 200 OK | 20.05ms | 10 nhật ký kiểm toán (tổng: 318) |
| **Audit Verify** | `GET /api/audit/verify` | 200 OK | 12.19ms | 318/318 bản ghi hợp lệ SHA-256 |
| **Settings** | `GET /api/settings` | 200 OK | 11.12ms | Thông tin công ty & tham số hệ thống |
| **RBAC Roles** | `GET /api/rbac/roles` | 200 OK | 15.96ms | 5 vai trò hệ thống |
| **RBAC Perms** | `GET /api/rbac/permissions` | 200 OK | 10.89ms | 19 quyền hạn hạt nhân |

**Frontend Build & Asset Integrity:**
- Cấu trúc frontend: Pure Vanilla JS / CSS / HTML phục vụ trực tiếp qua Express static handler.
- Kiểm tra cú pháp toàn bộ file JS (`node --check`): **100% hợp lệ, 0 cú pháp lỗi**.
- Dependencies (`npm ls`): Đầy đủ, 0 module thiếu, 0 xung đột phiên bản.

---

## 9. Scheduler Status

Kiểm tra tiến trình lập lịch (**Recurring Billing Scheduler**) ở chế độ **READ-ONLY**:
1. **Sự tồn tại của Process:** Code scheduler nằm tại [`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js), được import và khởi động từ [`app/src/server.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/server.js).
2. **Trạng thái Running:** Tiến trình chạy nền trong container `web`, khởi động thành công với log:
   `{"ts":"2026-10-07T04:12:24.266Z","level":"info","msg":"scheduler.started","interval_ms":60000}`.
3. **Cơ chế chống chạy đồng thời (Concurrency Control):**
   - Sử dụng **PostgreSQL Advisory Lock**: `SELECT pg_try_advisory_lock(88812345) AS acquired`.
   - Khóa bản ghi cấp dòng theo giao dịch: `SELECT ... FOR UPDATE` trên từng gói `recurring_plans`.
   - Nếu lock không lấy được, chu kỳ tự động bỏ qua an toàn với log `scheduler.skipped_locked`.
4. **Tính an toàn toán học ngày tháng:**
   - Sử dụng hàm `addMonthsSafe(dateStr, monthsToAdd)` để giới hạn ngày cuối tháng an toàn (vd: 31/01 -> 28/02 thay vì tràn sang tháng 3).
5. **Không kích hoạt phát sinh dữ liệu:** Không trigger tiến trình sinh hóa đơn nhân tạo trong đợt pre-flight check.

---

## 10. Problems Found

Phân loại theo mức độ nghiêm trọng:

### 10.1. CRITICAL (0 vấn đề)
*Không phát hiện lỗi nghiêm trọng gây sập hệ thống, mất dữ liệu hay lỗi cơ sở dữ liệu.*

### 10.2. HIGH (0 vấn đề)
*Không phát hiện lỗi ngăn cản chức năng cốt lõi.*

### 10.3. MEDIUM (1 vấn đề)
- **ISSUE-01: Uncommitted Working Tree Drift**
  - *Mô tả:* Working tree chứa 10 file modified và 27 file untracked. Mặc dù các file này đã được đóng gói (*baked*) vào container Docker đang chạy, nhưng chưa được commit vào Git repo.
  - *Ảnh hưởng:* Nếu người vận hành chạy `git restore` hoặc build lại image Docker từ branch mà không có file untracked, hệ thống có thể bị mất các tính năng mở rộng và sửa chữa lỗi.
  - *Khuyến nghị trước Deep Audit:* Gắn tag hoặc tạo một commit riêng (ví dụ: `remediation: archive latest working tree state`) trước khi tiến hành can thiệp sâu, hoặc đảm bảo không chạy các lệnh git phá hủy working tree.

### 10.4. LOW (2 vấn đề)
- **ISSUE-02: Self-signed TLS Certificate Warning in CLI**
  - *Mô tả:* Nginx sử dụng chứng chỉ SSL tự ký cho `https://localhost`. Các công cụ như Node.js `fetch` yêu cầu cờ `NODE_TLS_REJECT_UNAUTHORIZED=0` hoặc curl yêu cầu `-k`.
  - *Ảnh hưởng:* Không ảnh hưởng runtime ứng dụng thật; chỉ ảnh hưởng đến việc chạy test script từ bên ngoài nếu không cấu hình bỏ qua kiểm tra chứng chỉ.
- **ISSUE-03: Smoke Test Script Filename Discrepancy**
  - *Mô tả:* Yêu cầu kiểm tra tìm kiếm file `scripts/cp2-smoke-test.mjs`, trong khi file gốc trong dự án là `scripts/cp2-smoke.mjs`.
  - *Ảnh hưởng:* Khiến các script tự động dựa theo tên `*-test.mjs` báo `NOT AVAILABLE`.

### 10.5. INFO (2 thông tin)
- **INFO-01: Intentional 404 on Public /health Endpoint**
  - *Mô tả:* Nginx chặn `location = /health` với HTTP 404 như một phần của chính sách bảo mật H6 (tránh lộ thông tin nội bộ). Nginx cung cấp `/nginx-health` cho edge load balancer và container web cung cấp `/health` nội bộ.
- **INFO-02: Residual Test Containers in Docker Engine**
  - *Mô tả:* Docker daemon hiện có một số container từ phase trước (`billing-phase2-test-database-1`, `invoice-billing-system-database-1`). Các container này không nằm trong compose của Billing_One và không gây xung đột tài nguyên hay cổng mạng.

---

## 11. Comparison With Remediation Final Report

Đối chiếu các tuyên bố trong tài liệu `docs/BILLING_ONE_REMEDIATION_FINAL_REPORT.md` với trạng thái runtime thực tế:

| Claim trong Report | Expected (Kỳ vọng) | Actual (Thực tế) | Status | Ghi chú minh chứng |
|:---|:---|:---|:---:|:---|
| **CP2 Smoke Baseline** | 15/15 checks PASS | Script `cp2-smoke-test.mjs` not found; `cp2-smoke.mjs` exists | **NOT RUN** | Bảo toàn baseline dữ liệu tài chính trước audit; không chạy script ghi đè dữ liệu. |
| **Hardening Verification**| 22/22 checks PASS | 22/22 checks PASS | **VERIFIED** | `verify-hardening.ps1` chạy thực tế: H1-H6 pass 100%. |
| **Frontend & API Contract**| 16/16 views PASS | 16/16 views PASS | **VERIFIED** | `frontend-e2e-test.mjs` chạy thực tế: Zero 404s, 100% 200 OK. |
| **F-01: Dual API Mount** | All alias endpoints 200 OK | 100% endpoints trả về 200 OK | **VERIFIED** | Cả `/audit` & `/audit-logs`, `/recurring` & `/recurring-plans` hoạt động. |
| **F-02: Credit Note Method**| Method `CREDIT_NOTE` trong DB | CHECK constraint đã hỗ trợ | **VERIFIED** | Schema table `payments` có `CREDIT_NOTE`. |
| **F-03: SHA-256 Audit Chain**| Chuỗi băm 100% hợp lệ | 318/318 records verified | **VERIFIED** | `/api/audit/verify` trả về `verified: true, valid: true`. |
| **F-04: Aging Report Schema**| Trả về cả matrix và customers| Có cả `matrix`, `customers`, `summary` | **VERIFIED** | `/api/reports/aging` trả về cấu trúc chuẩn đầy đủ. |
| **F-06: Autonomous Scheduler**| Worker chạy nền với Advisory Lock| Lock 88812345 & interval 60s active| **VERIFIED** | Server log ghi nhận `scheduler.started`, `interval_ms: 60000`. |
| **F-07: E-Invoice Compliance**| Không tuyên bố sai là "Mã CQT"| Hiển thị "Mã mô phỏng nội bộ" | **VERIFIED** | Codebase và API đồng bộ nhãn mô phỏng nội bộ. |
| **F-08: Granular RBAC** | 19 permissions, 5 roles, 403 rule| 5 roles, 19 perms, 54 mappings in DB| **VERIFIED** | Middleware RBAC nạp từ DB và thực thi phân quyền runtime. |
| **F-09: Multi-Invoice Alloc**| Bảng `payment_allocations` tồn tại| Bảng tồn tại với đầy đủ cột | **VERIFIED** | Schema `payment_allocations` có `allocated_amount`. |
| **F-10: Payment Terms Alias**| Hỗ trợ cả `days` và `net_days` | 14 terms trả về đầy đủ | **VERIFIED** | `/api/payment-terms` trả về 200 OK với danh mục terms. |
| **F-12: Unapplied Cash** | Cột `unapplied_amount` tồn tại | Cột tồn tại trong `bank_transactions` | **VERIFIED** | Khớp nối ngân hàng có khả năng cô lập tiền dư. |
| **F-14: Safe Date Math** | Clamping an toàn ngày cuối tháng| Hàm `addMonthsSafe` active trong scheduler| **VERIFIED** | Code logic kiểm soát biên ngày an toàn 100%. |

---

## 12. Pre-Audit Readiness

### Kết luận:
# **READY WITH WARNINGS**

### Căn cứ kết luận:
1. **Đạt điều kiện kỹ thuật:**
   - Docker cụm Billing_One hoạt động hoàn hảo (12/12 containers running, các dịch vụ cốt lõi healthy).
   - Cơ sở dữ liệu PostgreSQL hoạt động ổn định, schema hoàn chỉnh, không có dấu hiệu hỏng dữ liệu (*data corruption*), chuỗi kiểm toán SHA-256 nguyên vẹn 100% trên cả 318 bản ghi.
   - Backend Express phản hồi xuất sắc (độ trễ trung bình < 20ms trên toàn bộ các nhóm API).
   - Bộ kiểm thử bảo mật cứng hóa (Hardening) đạt **22/22 PASS (100%)**.
   - Bộ kiểm thử giao diện và API E2E đạt **16/16 PASS (100%)**, zero 404s.
   - Không có bất kỳ lỗi runtime nghiêm trọng nào trong container log.
2. **Căn cứ mức cảnh báo ("With Warnings"):**
   - Codebase có 10 file modified và 27 file untracked chưa commit vào Git. Trạng thái này không ngăn cản Deep Audit (do code đã được nướng vào Docker image), nhưng đòi hỏi kiểm toán viên không được thực hiện các lệnh Git phá hủy working tree.
   - Cần nhận thức rằng `scripts/cp2-smoke-test.mjs` không tồn tại theo tên này (tên đúng là `scripts/cp2-smoke.mjs`), và việc không chạy `cp2-smoke.mjs` là chủ đích bảo vệ dữ liệu trước kiểm toán tài chính.

**Hệ thống Billing_One đã hoàn tất kiểm tra tiền khởi động và sẵn sàng làm đường cơ sở (Baseline) cho giai đoạn: DEEP ARCHITECTURE & FINANCIAL INTEGRITY AUDIT.**
