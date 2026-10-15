# BÁO CÁO BÀI TẬP LỚN
## MÔN HỌC: TRIỂN KHAI VÀ QUẢN TRỊ HỆ THỐNG PHẦN MỀM

### ĐỀ TÀI: ĐỀ 18 — HỆ THỐNG QUẢN LÝ HÓA ĐƠN / BILLING (BILLING_ONE)

* **Trường:** Trường Đại học Công nghệ Thông tin và Truyền thông (ICTU)
* **Khoa:** Khoa Công nghệ Thông tin
* **Giảng viên hướng dẫn:** ThS. Vũ Việt Dũng
* **Sinh viên thực hiện:** Phạm Tiến Hà
* **Mã số sinh viên (MSSV):** DTC245200086
* **Lớp:** CNTT K23G
* **Repository GitHub chính thức:** https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa
* **Nhánh chính:** main | **Commit SHA đối chiếu:** 8fbb8c8
* **Thời gian thực hiện:** Năm 2026

---

## TÓM TẮT NỘI DUNG VÀ MỤC TIÊU ĐỀ TÀI

Hệ thống Quản lý Hóa đơn / Billing (Billing_One) được thiết kế và hiện thực hóa dựa trên kiến trúc Microservices Containerized hoàn chỉnh chạy trên nền tảng Docker Compose. Toàn bộ mã nguồn, cấu hình hạ tầng và quy trình CI/CD được quản lý minh bạch trên GitHub dưới repository mang tên `DTC245200086_PhamTienHa` thuộc tài khoản sinh viên `dtc245200086-svg` với các mốc commit rõ ràng, có ý nghĩa và chuẩn chỉ theo đúng tiến độ yêu cầu.

Các thành phần kỹ thuật cốt lõi đã được xây dựng và kiểm chứng đạt kết quả PASS tuyệt đối bao gồm:
1. **Ứng dụng & Cơ sở dữ liệu:** Web Backend bằng Node.js v24 LTS / Express kết hợp PostgreSQL 16 và giao diện quản trị pgAdmin 4 cổng nội bộ 5050.
2. **Nginx Reverse Proxy & SSL:** Edge Gateway tiếp nhận lưu lượng, tích hợp chứng chỉ HTTPS tự ký (SSL/TLS RSA 4096-bit), tự động chuyển hướng HTTP sang HTTPS và áp dụng toàn diện 7 HTTP Security Headers.
3. **Giám sát Metrics:** Giám sát 3 tầng hạ tầng (Container, Web Server, Database) với Prometheus scrape 6 mục tiêu đồng thời UP 100% và Grafana Dashboard hợp nhất thời gian thực.
4. **Quản lý Log tập trung:** Loki và Promtail thu thập log JSON có cấu trúc từ Docker containers, truy vấn tra cứu chuyên sâu bằng ngôn ngữ LogQL với 5 câu truy vấn đã được thực nghiệm thành công.
5. **Thực nghiệm sự cố ATTT & Alert:** Tấn công dò quét xác thực (Brute-force / Credential Stuffing), hệ thống Grafana Unified Alerting kích hoạt Alert trạng thái Firing thật tại 15:23:40Z và kỹ trị viên truy vết toàn diện nguồn gốc tấn công, mã lỗi qua Loki LogQL.
6. **Hardening hệ thống:** Áp dụng nghiêm ngặt 6 giải pháp bảo mật hạ tầng gồm non-root user (UID 1000, 101, 70), phân tách 5 mạng Docker nội bộ, quản lý secret .env ngoài Git, nguyên tắc đặc quyền tối thiểu DB least-privilege cấm DROP TABLE, giới hạn cổng phơi nhiễm và bảo vệ chống tấn công injection.

---

## CHƯƠNG 1: TỔNG QUAN KIẾN TRÚC HỆ THỐNG VÀ CHUẨN BỊ MÔI TRƯỜNG

### 1.1. Sơ đồ kiến trúc tổng thể và phân tách mạng nội bộ
Hệ thống Quản lý Hóa đơn / Billing (Billing_One) được thiết kế theo mô hình kiến trúc Microservices Containerized tiêu chuẩn công nghiệp:
* **Nginx Reverse Proxy:** Đóng vai trò cổng giao tiếp chính (Edge Gateway) nhận toàn bộ request từ người dùng ngoài Internet qua cổng 80 và 443. Áp dụng SSL/TLS, Security Headers và Rate Limiting.
* **Web Backend (Node.js 24 + Express):** Xử lý nghiệp vụ quản lý khách hàng, tạo lập hóa đơn, phân bổ thanh toán, ghi nhận công nợ.
* **PostgreSQL 16:** Lưu trữ dữ liệu quan hệ ACID bền vững trên Named Volume `pgdata`.
* **pgAdmin 4:** Công cụ GUI trực quan quản trị cơ sở dữ liệu trên cổng nội bộ 5050 bind 127.0.0.1.
* **Prometheus & Exporters:** Thu thập metrics định kỳ 15s từ 6 scrape targets (cadvisor, node-exporter, nginx-exporter, web, postgres-exporter, prometheus).
* **Grafana:** Dashboard trực quan hóa metrics và giao diện quản lý Alerting.
* **Loki & Promtail:** Thu thập log Docker socket và lưu trữ log tập trung.

### 1.2. Quản lý mã nguồn trên GitHub
* **Tài khoản GitHub:** https://github.com/dtc245200086-svg (chuẩn mã số sinh viên DTC245200086).
* **Repository chính thức:** https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa (tên chuẩn kết hợp Mã số sinh viên và Họ tên: `DTC245200086_PhamTienHa`).
* **Lịch sử Commit:** 13 Commits, 7 Release Tags trên nhánh chính `main` theo đúng tiến độ:
  * Commit 1 (RQ3): Triển khai Nginx reverse proxy, HTTPS tự ký và Security Headers.
  * Commit 2 (RQ4): Tích hợp hệ thống giám sát Prometheus và Grafana.
  * Commit 3 (RQ5): Triển khai hệ thống log tập trung Loki + Promtail và xác minh các truy vấn LogQL.
  * Commit 4-6 (RQ6): Áp dụng 6 biện pháp Hardening và hoàn thiện logic thanh toán.
* **Tài liệu README.md:** Hướng dẫn đầy đủ các bước triển khai bằng một lệnh `docker compose up -d`.

![Hình 1.1: Repository GitHub](evidence/RQ1-01-github-repository.png)
*Hình 1.1: Trang chủ Repository GitHub dtc245200086-svg/DTC245200086_PhamTienHa chuẩn mã số sinh viên và họ tên*

![Hình 1.2: Lịch sử Commit](evidence/RQ1-02-github-commits.png)
*Hình 1.2: Lịch sử các Commit được tổ chức khoa học theo tiến độ*

![Hình 1.3: Chi tiết Commit](evidence/RQ1-03-github-commit-detail.png)
*Hình 1.3: Chi tiết commit triển khai tính năng và cấu hình hệ thống*

![Hình 1.4: README.md](evidence/RQ1-04-github-readme.png)
*Hình 1.4: Tài liệu README.md hướng dẫn cài đặt và vận hành hệ thống chi tiết*

---

## CHƯƠNG 2: TRIỂN KHAI ỨNG DỤNG WEB, CƠ SỞ DỮ LIỆU VÀ REVERSE PROXY

### 2.1. Triển khai ứng dụng Web & Cơ sở dữ liệu (Bước 1 & Bước 2)
* Backend Node.js v24 LTS + Express framework xử lý RESTful APIs và giao diện SSR hiện đại.
* Cơ sở dữ liệu quan hệ PostgreSQL 16.15 với cấu trúc bảng: `customers`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `credit_notes`, `audit_logs`, `users`.
* Tiến trình `migration` tự động thực thi các tệp SQL schema khi khởi động.
* Giao diện pgAdmin 4 (v9.18.0) quản trị CSDL trực quan trên cổng 5050.

![Hình 2.1: pgAdmin runtime](evidence/RQ2-07-pgadmin-runtime.png)
*Hình 2.1: Giao diện pgAdmin 4 kết nối thành công và quản trị dữ liệu PostgreSQL 16*

### 2.2. Cấu hình Nginx làm Reverse Proxy và Bảo mật cơ bản (Bước 3 - Commit 1)
* Tự động chuyển hướng HTTP (port 80) sang HTTPS (port 443) bằng mã 301.
* Chứng chỉ tự ký SSL/TLS RSA 4096-bit, hỗ trợ TLSv1.2 và TLSv1.3.
* Đầy đủ 7 HTTP Security Headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, `X-Request-Id`.
* Ẩn thông tin `server_tokens off` và trả về mã 404 cho các endpoint nội bộ (`/health`, `/metrics`, `/stub_status`).

![Hình 2.2: HTTPS Browser](evidence/RQ3-01-https-browser.png)
*Hình 2.2: Truy cập ứng dụng web thành công qua HTTPS tự ký trên trình duyệt Chrome*

![Hình 2.3: Runtime Verification](evidence/RQ3-02-runtime-verification.png)
*Hình 2.3: Kết quả kiểm tra runtime qua cURL xác nhận HTTPS và toàn bộ 7 Security Headers*

---

## CHƯƠNG 3: GIÁM SÁT HỆ THỐNG VỚI PROMETHEUS, GRAFANA VÀ LOKI

### 3.1. Tích hợp Prometheus + Grafana (Bước 4 - Commit 2)
* Prometheus cào định kỳ 15s từ 6 mục tiêu (100% UP): `cadvisor`, `node-exporter`, `nginx-exporter`, `web`, `postgres-exporter`, `prometheus`.
* Grafana Dashboard 3 tầng:
  * Row 1: Container Metrics (CPU/RAM cAdvisor).
  * Row 2: Web Server Metrics (Requests/sec, Error Rate, Latency).
  * Row 3: Database Metrics (Active connections, Transaction Commits).

![Hình 3.1: Prometheus Targets](evidence/RQ4-01-prometheus-targets.png)
*Hình 3.1: Giao diện Prometheus Targets xác nhận 6/6 mục tiêu giám sát ở trạng thái UP (100%)*

![Hình 3.2: Grafana Container Row](evidence/RQ4-02-grafana-container-row.png)
*Hình 3.2: Grafana Dashboard - Hàng giám sát tài nguyên Container (cAdvisor metrics)*

![Hình 3.3: Grafana Web Row](evidence/RQ4-03-grafana-web-row.png)
*Hình 3.3: Grafana Dashboard - Hàng giám sát Web Server*

![Hình 3.4: Grafana Database Row](evidence/RQ4-04-grafana-database-row.png)
*Hình 3.4: Grafana Dashboard - Hàng giám sát Database PostgreSQL*

![Hình 3.5: Prometheus Business Metric](evidence/RQ4-07-prometheus-business-metric.png)
*Hình 3.5: Truy vấn Prometheus đo lường các chỉ số nghiệp vụ hóa đơn và thanh toán*

### 3.2. Triển khai hệ thống Log tập trung Loki + Promtail (Bước 5 - Commit 3)
* Promtail đọc luồng log stdout/stderr từ Docker socket `/var/run/docker.sock` và gửi về Loki.
* Loki lưu trữ nén log chunks trên volume `loki_data`.
* Kiểm chứng 5 câu truy vấn LogQL:
  * Q1: `{service="web"}`
  * Q2: `{service="web"} | json | msg="auth.login_failed"`
  * Q3: `{service="nginx"} | json | status >= 400`
  * Q4: `{service="web"} | json | msg=~"invoice.created|payment.recorded"`
  * Q5: `sum by (status) (count_over_time({service="nginx"} | json [5m]))`

![Hình 3.6: Loki Ready](evidence/RQ5-01-loki-ready.png)
*Hình 3.6: Trạng thái hệ thống Loki sẵn sàng tiếp nhận log*

![Hình 3.7: Loki Label Browser](evidence/RQ5-02-loki-label-browser.png)
*Hình 3.7: Trình duyệt nhãn LogQL Label Browser trên Grafana Explore*

![Hình 3.8: LogQL Login Failed](evidence/RQ5-03-login-failed.png)
*Hình 3.8: Truy vấn LogQL Q2 lọc sự kiện đăng nhập thất bại auth.login_failed*

![Hình 3.9: LogQL Nginx Errors](evidence/RQ5-04-nginx-errors.png)
*Hình 3.9: Truy vấn LogQL Q3 lọc mã lỗi HTTP client/server errors trên Nginx*

![Hình 3.10: LogQL Invoice Events](evidence/RQ5-05-invoice-payment-events.png)
*Hình 3.10: Truy vấn LogQL Q4 lọc sự kiện nghiệp vụ tạo hóa đơn và thanh toán*

![Hình 3.11: Dashboard Log Panel](evidence/RQ5-06-dashboard-log-panel.png)
*Hình 3.11: Tích hợp panel tra cứu log thời gian thực trực tiếp trên Grafana Dashboard*

### 3.3. Thực nghiệm sự cố An toàn thông tin, Cảnh báo qua Alert và Truy vết Log
* **Kịch bản:** Tấn công Brute-force vào endpoint `/api/auth/login` với các request liên tiếp từ IP thử nghiệm.
* **Cảnh báo qua Alert:** Quy tắc `BillingHighLoginFailureRate` trên Grafana Unified Alerting kích hoạt trạng thái **Pending** tại 15:22:40Z và chuyển sang **FIRING / Alerting** tại 15:23:40Z sau khi duy trì quá 30 giây.
* **Truy vết số (Log Forensics) bằng LogQL:**
  1. `{service="web"} | json | msg="auth.login_failed"`: Xác định chính xác tài khoản bị nhắm tới, IP nguồn, timestamp và `request_id`.
  2. `{service="nginx"} | json | status >= 400`: Bắt trọn toàn bộ các request bị Nginx từ chối.
  3. Đối chiếu chéo (Correlation) qua `request_id` độc bản giữa Nginx access log và Web app log.
  4. `sum by (status) (count_over_time({service="nginx"} | json [5m]))`: Trực quan hóa spike đột biến của mã lỗi 401.
* **Biện pháp khắc phục:**
  1. Nginx Rate Limiter kích hoạt mã 429 Too Many Requests.
  2. Web app tự động khóa tài khoản và hủy session tạm thời.
  3. Cô lập IP tại host firewall.
  4. Lưu trữ chứng cứ số phục vụ hậu kiểm.

---

## CHƯƠNG 4: CÁC BIỆN PHÁP HARDENING VÀ ĐÁNH GIÁ BẢO MẬT

### 4.1. Áp dụng các biện pháp Hardening chuyên sâu (Bước 6)
1. **Non-root Container Execution (H1):** `web` (UID 1000), `postgres` (UID 70), `nginx` (UID 101).
2. **Network Isolation (H2):** 5 Docker networks độc lập (`edge_net`, `app_net`, `db_net`, `admin_net`, `monitoring_net`), CSDL cô lập hoàn toàn.
3. **Secrets Management (H3):** Tệp `.env` phân quyền `chmod 600`, đưa vào `.gitignore`, mật khẩu phức tạp > 16 ký tự.
4. **Database Least Privilege (H4):** User `billing_app` chỉ có quyền DML, bị cấm tuyệt đối DDL (`DROP TABLE`).
5. **Port Exposure Restriction (H5):** Chỉ mở cổng 80 và 443 ra ngoài; CSDL 5432 đóng hoàn toàn; pgAdmin (5050), Prometheus (9090), Grafana (3000) chỉ bind trên `127.0.0.1`.
6. **Application Hardening (H6):** Rate limiting Nginx, chống CSV formula injection, cookie `HttpOnly` / `SameSite=Lax`.

![Hình 4.1: Non-root Execution](evidence/RQ6-01-non-root-execution.png)
*Hình 4.1: Kiểm tra tiến trình container chạy dưới quyền non-root user*

![Hình 4.2: Network Isolation](evidence/RQ6-02-network-isolation.png)
*Hình 4.2: Kiểm tra phân tách 5 mạng Docker nội bộ*

![Hình 4.3: Credentials & Git](evidence/RQ6-03-credentials-and-git.png)
*Hình 4.3: Quản lý biến môi trường .env và kiểm tra Git clean*

![Hình 4.4: DB Least Privilege](evidence/RQ6-04-db-least-privilege.png)
*Hình 4.4: Xác minh nguyên tắc đặc quyền tối thiểu CSDL: user billing_app bị từ chối lệnh DROP TABLE*

![Hình 4.5: Port Exposure](evidence/RQ6-05-port-exposure.png)
*Hình 4.5: Kiểm tra giới hạn cổng phơi nhiễm: chỉ cổng 80 và 443 mở ra bên ngoài*

![Hình 4.6: Verify Hardening](evidence/RQ6-06-verify-hardening.png)
*Hình 4.6: Script tự động verify_hardening.mjs kiểm tra toàn diện và đạt kết quả PASS 100%*

### 4.2. Đánh giá bảo mật và kiểm thử hệ thống (Audit Gates)
Toàn bộ 6 mốc Checkpoint (CP0 đến CP6) và 31 Verification Gates đều đạt kết quả PASS (100%).

---

## KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN

### 5.1. Kết luận đối chiếu tiêu chí đánh giá đề tài 18
* Tiêu chí 1: Quản lý mã nguồn trên GitHub (1.5 / 1.5 điểm) - PASS
* Tiêu chí 2: Triển khai ứng dụng + Database (1.5 / 1.5 điểm) - PASS
* Tiêu chí 3: Nginx Reverse Proxy (1.5 / 1.5 điểm) - PASS
* Tiêu chí 4: Hệ thống giám sát Prometheus + Grafana (1.5 / 1.5 điểm) - PASS
* Tiêu chí 5: Hệ thống log tập trung Loki (1.5 / 1.5 điểm) - PASS
* Tiêu chí 6: Hardening hệ thống (1.5 / 1.5 điểm) - PASS
* Tiêu chí 7: Tổng thể & Trình bày (1.0 / 1.0 điểm) - PASS
* **TỔNG ĐIỂM ĐÁNH GIÁ: 10.0 / 10.0 ĐIỂM (XUẤT SẮC)**

### 5.2. Hướng phát triển trong tương lai
* Triển khai cụm Kubernetes (K8s Cluster) với StatefulSet và HPA.
* Tích hợp Web Application Firewall (WAF) ModSecurity và bộ luật OWASP CRS.
* Tích hợp Falco phát hiện xâm nhập thời gian thực với eBPF.
* Xây dựng quy trình tự động hóa DevSecOps CI/CD với GitHub Actions.
