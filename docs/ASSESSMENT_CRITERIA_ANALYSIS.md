# Phân tích Chi tiết Tiêu chí Đánh giá Đề tài và Kế hoạch Chứng minh

> **Tài liệu chiến lược bảo vệ đồ án — Đồ án Triển khai và Quản trị Hệ thống Phần mềm**
> **Đề tài:** Hệ thống Quản lý Hóa đơn / Billing (Đề 18)
> **Sinh viên:** Phạm Tiến Hà — MSSV: DTC245200086 — Lớp: CNTT K23G
> **Giảng viên hướng dẫn:** Vũ Việt Dũng
> **Repository GitHub:** `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git`
> **Release Target:** `v1.0` (Milestone Commit: `fded947d98441446e8c424e657a51f88ea5edfbb`)

---

## I. Bảng Tổng hợp Rubric Đánh giá (10.0 / 10.0 Điểm)

| STT | Tiêu chí đánh giá | Thang điểm | Thành phần kỹ thuật đáp ứng | Mã minh chứng chính | Trạng thái nghiệm thu |
|:---:|---|:---:|---|---|:---:|
| **1** | **Quản lý mã nguồn trên GitHub** | **1.5 điểm** | GitHub remote repo, 8 milestone/support commits có ý nghĩa, 7 tags, README chi tiết, `.gitignore` bảo vệ secret | `RQ1-01` đến `RQ1-04` | **PASS (1.5/1.5)** |
| **2** | **Triển khai ứng dụng + Database** | **1.5 điểm** | Node.js 24/Express, PostgreSQL 16.15, pgAdmin 4, 3 roles DB, named volume persistence, CRUD, sequence `INV-YYYY-NNNNNN` | `RQ2-07`, `cp2-smoke` (15/15) | **PASS (1.5/1.5)** |
| **3** | **Nginx Reverse Proxy & HTTPS** | **1.5 điểm** | Nginx unprivileged 1.30.5, HTTP->HTTPS 301, SSL self-signed có SAN, 6 security headers, CSP, Rate limit login, JSON access log | `RQ3-01`, `RQ3-02` | **PASS (1.5/1.5)** |
| **4** | **Giám sát Prometheus + Grafana** | **1.5 điểm** | Prometheus v3.15.0 (6 scrape jobs UP), Grafana 13.2.3, 3 rows dashboard: Container, Web, Database, PromQL business metrics | `RQ4-01` đến `RQ4-04`, `RQ4-07` | **PASS (1.5/1.5)** |
| **5** | **Hệ thống Log tập trung Loki** | **1.5 điểm** | Loki 3.7.8 (retention 72h), Promtail 3.6.11, Docker socket collector, 3 LogQL queries: Q2 (login failed), Q3 (HTTP 4xx), Q4 (invoice/payment) | `RQ5-01` đến `RQ5-06` | **PASS (1.5/1.5)** |
| **6** | **Hardening hệ thống (H1–H6)** | **1.5 điểm** | H1 non-root, H2 5 networks/internal, H3 secret policy, H4 DB least privilege & append-only, H5 TLS & headers, H6 port isolation | `RQ6-01` đến `RQ6-06`, `verify-hardening` | **PASS (1.5/1.5)** |
| **7** | **Tổng thể và Trình bày Demo** | **1.0 điểm** | Khởi động 1 lệnh `docker compose up -d`, 12 services healthy/running, Demo rehearsal 7.07s / 7–9 min (≤ 10 min), báo cáo 18 trang | `Final_Report.pdf`, `Demo_Script.md` | **PASS (1.0/1.0)** |
| **TỔNG** | **Toàn bộ 7 Tiêu chí Đề tài** | **10.0 điểm** | **Hệ thống đáp ứng toàn diện, đầy đủ bằng chứng runtime và tài liệu chuẩn xác** | **24 artifacts** | **XUẤT SẮC (10.0/10.0)** |

---

## II. Phân loại Mức độ Hoàn thiện Bằng chứng

Trong mỗi tiêu chí, đồ án áp dụng nguyên tắc kiểm chứng 4 cấp độ nghiêm ngặt:
- **[A] IMPLEMENTED:** Đã có cấu hình và mã nguồn được kiểm thử trong repository.
- **[B] RUNTIME VERIFIED:** Đã chạy trực tiếp trong container và quan sát kết quả thực tế qua terminal/API.
- **[C] EVIDENCE CAPTURED:** Đã chụp ảnh màn hình / lưu log minh chứng vào thư mục `docs/evidence/`.
- **[D] DEMO READY:** Đã xây dựng sẵn kịch bản và thao tác trực tiếp mượt mà trước hội đồng.

---

## III. Phân tích Chi tiết Từng Tiêu chí Đánh giá

---

### Tiêu chí 1: Quản lý Mã nguồn trên GitHub (1.5 Điểm)

#### 1. Yêu cầu của Giảng viên
- Repository đầy đủ mã nguồn và file cấu hình cần thiết để chạy hệ thống.
- Lịch sử Git có ít nhất 03 commits với commit message có ý nghĩa, thể hiện từng giai đoạn phát triển.
- Có file `README.md` hướng dẫn rõ ràng cách cài đặt, cấu hình và khởi chạy dự án.
- Không để lộ thông tin nhạy cảm (secrets, passwords) trên Git.

#### 2. Thành phần Kỹ thuật Đáp ứng
- **Repository chính thức:** `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git`
- **Mã nguồn và cấu hình:** Đầy đủ `app/`, `db/`, `nginx/`, `monitoring/`, `logging/`, `pgadmin/`, `scripts/`, `docker-compose.yml`, `.env.example`, `.gitignore`.
- **Lịch sử Git mốc:** Vượt xa yêu cầu 3 commit, hệ thống có chuỗi commit mốc chuẩn mực:
  1. `aa0d392` (tag: `base-app`) — Baseline ứng dụng Web + PostgreSQL + pgAdmin (YC2).
  2. `d179090` (tag: `commit-1-nginx`) — Tích hợp Nginx Reverse Proxy HTTPS và Security Headers (YC3).
  3. `7502aa7` (tag: `commit-2-monitoring`) — Hệ thống giám sát Prometheus và Grafana (YC4).
  4. `3ff709c` (tag: `commit-3-logging`) — Hệ thống log tập trung Loki, Promtail và LogQL (YC5).
  5. `94dc8f0` (tag: `hardening`) — Hiện thực và xác minh 6 chuẩn bảo mật H1–H6 (YC6).
  6. `2141b24` (tag: `docs-final`) — Hoàn thiện tài liệu tổng thể và clean-clone gate (YC1 final).
  7. `fded947` (tag: `v1.0`) — Phát hành bản nghiệm thu chính thức, hoàn tất báo cáo và demo rehearsal (YC7).
  8. `1138c8c` — Support commit cập nhật tài liệu hậu kỳ.
- **README.md:** Trình bày chi tiết thông tin đồ án, bảng dịch vụ, kiến trúc mạng, hướng dẫn khởi chạy, sơ đồ cổng và bảng ánh xạ commit.
- **Bảo mật Git:** File `.env`, thư mục chứng chỉ `nginx/certs/`, và file dữ liệu nhạy cảm được cấu hình loại trừ triệt để trong `.gitignore`. File `.env.example` chỉ chứa placeholder `CHANGE_ME`.

#### 3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `.gitignore`, `.env.example`, `README.md`.
- `[B] RUNTIME VERIFIED`: `git status --short` clean, `git ls-remote` xác nhận đồng bộ 100%.
- `[C] EVIDENCE CAPTURED`: `RQ1-01` (Giao diện repo), `RQ1-02` (Danh sách commit), `RQ1-03` (Chi tiết commit), `RQ1-04` (README trên GitHub).
- `[D] DEMO READY`: Mở trực tiếp link GitHub trên trình duyệt cho giảng viên xem.

#### 4. Kịch bản Demo Trực tiếp
1. Mở trình duyệt truy cập: `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa`.
2. Mở tab **Commits**: Chỉ ra các commit mang tiền tố chuẩn Conventional Commits (`feat`, `security`, `docs`) gắn liền với từng checkpoint.
3. Mở tab **Tags**: Chỉ ra các milestone tags (`base-app`, `commit-1-nginx`, `commit-2-monitoring`, `commit-3-logging`, `hardening`, `docs-final`, `v1.0`).
4. Cuộn xuống xem giao diện `README.md` hiển thị trực quan và chuyên nghiệp.

#### 5. Câu hỏi Giảng viên Thường gặp & Câu trả lời
- **Hỏi:** *Tại sao lại có các commit support xen kẽ giữa các commit mốc?*
  - **Trả lời:** Các commit mốc (`commit-1-nginx`, `commit-2-monitoring`, `commit-3-logging`, `hardening`, `v1.0`) là **bất biến**, đại diện cho trạng thái nghiệm thu kỹ thuật tại từng checkpoint. Các support commit được tạo để bổ sung tài liệu và biên bản kiểm thử sau khi hoàn thành checkpoint mà không sửa đổi lịch sử mốc đã chốt.
- **Hỏi:** *Làm sao đảm bảo bạn không vô tình đẩy mật khẩu lên GitHub?*
  - **Trả lời:** Em sử dụng `.gitignore` chặn file `.env`, dùng script tự động kiểm tra `git ls-files .env` (tiêu chí H3.1 trong bộ verify-hardening) và chỉ chia sẻ mẫu `.env.example` với các giá trị placeholder.

#### 6. Rủi ro Mất điểm & Cách Phòng tránh
- *Rủi ro:* Giảng viên mở repository nhưng thấy báo lỗi 404 (do để chế độ Private).
- *Phòng tránh:* Repository đã được đặt ở chế độ **Public**, có thể truy cập từ bất kỳ trình duyệt nào.

#### 7. Kết luận Tiêu chí 1: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 2: Triển khai Ứng dụng + Database (1.5 Điểm)

#### 2.1. Yêu cầu của Giảng viên
- Ứng dụng Web hoạt động ổn định, có giao diện quản lý thực tế.
- Kết nối thành công với hệ quản trị cơ sở dữ liệu (PostgreSQL).
- Có công cụ quản trị Database qua giao diện Web (pgAdmin 4).
- Có cơ chế lưu trữ dữ liệu bền vững (Persistence qua Docker Volumes).

#### 2.2. Thành phần Kỹ thuật Đáp ứng
- **Web Application:** Viết bằng Express/Node.js 24 Alpine, giao diện thuần HTML/CSS/JavaScript, chạy không cần build phức tạp, khởi động tức thì.
- **PostgreSQL 16.15:** Cơ sở dữ liệu quan hệ lưu trữ thông tin khách hàng (`customers`), hóa đơn (`invoices`), chi tiết hóa đơn (`invoice_items`), thanh toán (`payments`) và người dùng (`users`).
- **Khởi tạo dữ liệu tự động (`db/init/`):**
  - `01-init.sql`: Tạo cấu trúc bảng, các ràng buộc toàn vẹn, sequence hóa đơn `invoices_invoice_number_seq`, và phân quyền cho 3 roles chuyên biệt: `billing_app` (nghiệp vụ), `billing_readonly` (chỉ đọc), `exporter` (monitoring).
  - `02-seed.sql`: Khởi tạo sẵn tài khoản quản trị (`admin`) và nhân viên (`staff`) với mật khẩu băm bcrypt cost 12.
- **pgAdmin 4 (v9.18.0):** Giao diện Web quản trị DB tại `http://127.0.0.1:5050`, tự động import kết nối server `Billing PostgreSQL` qua file `pgadmin/servers.json`.
- **Nghiệp vụ tài chính vững chắc:**
  - Tiền tệ dùng kiểu số thực chính xác `NUMERIC(14,2)` trong PostgreSQL, không dùng float.
  - Số hóa đơn phát hành tự động theo format `INV-YYYY-NNNNNN` từ PostgreSQL sequence.
  - Hóa đơn sau khi phát hành (`ISSUED`) là bất biến (không sửa/xóa).
  - Thanh toán có cơ chế khóa bi quan `SELECT ... FOR UPDATE` chống double-payment.
- **Persistence:** Sử dụng named volume `billing_postgres_data` và `billing_pgadmin_data`. Dừng hoặc khởi động lại container dữ liệu không bao giờ bị mất.

#### 2.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `app/`, `db/init/`, `pgadmin/servers.json`, `docker-compose.yml`.
- `[B] RUNTIME VERIFIED`: Bộ test tự động `cp2-smoke.mjs` đạt **15/15 nhóm kiểm thử PASS** (p95 latency 25.15ms).
- `[C] EVIDENCE CAPTURED`: `RQ2-07-pgadmin-runtime.png` (pgAdmin kết nối DB qua role `billing_readonly`).
- `[D] DEMO READY`: Kịch bản tạo khách hàng, tạo hóa đơn DRAFT, Issue hóa đơn thành `INV-2026-NNNNNN`, thanh toán từng phần, và mở pgAdmin xem dữ liệu.

#### 2.4. Kịch bản Demo Trực tiếp
1. Đăng nhập ứng dụng tại `https://localhost` với tài khoản `admin`.
2. Tạo 1 khách hàng mới -> Tạo hóa đơn nháp -> Nhấp **Issue**: Chỉ ra số hóa đơn sinh ra tự động.
3. Ghi nhận thanh toán một phần -> Hóa đơn chuyển trạng thái `PARTIALLY_PAID`.
4. Mở tab trình duyệt thứ 2: `http://127.0.0.1:5050`, đăng nhập pgAdmin, kết nối server `Billing PostgreSQL` bằng mật khẩu `billing_readonly`.
5. Mở bảng `invoices`: Chỉ ra hàng dữ liệu vừa tạo đã nằm trong database PostgreSQL thật.

#### 2.5. Câu hỏi Giảng viên Thường gặp & Câu trả lời
- **Hỏi:** *Tại sao khi khởi động lại container hoặc tắt máy mở lại, dữ liệu không bị mất?*
  - **Trả lời:** Dữ liệu thư mục `/var/lib/postgresql/data` được gắn vào Docker named volume `billing_postgres_data`. Dữ liệu nằm trên ổ đĩa của host (trong Docker storage driver), tách rời hoàn toàn khỏi vòng đời của container.
- **Hỏi:** *Hệ thống chống tình trạng nhân viên bấm thanh toán 2 lần cùng lúc gây trừ tiền thừa như thế nào?*
  - **Trả lời:** Trong mã nguồn `controllers/paymentController.js`, khi xử lý thanh toán, ứng dụng mở một PostgreSQL Transaction và thực thi `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`. Câu lệnh này khóa dòng hóa đơn lại cho đến khi transaction kết thúc (COMMIT/ROLLBACK), ngăn chặn triệt để xung đột đồng thời (Concurrency Lock).

#### 2.6. Kết luận Tiêu chí 2: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 3: Nginx Reverse Proxy (1.5 Điểm)

#### 3.1. Yêu cầu của Giảng viên
- Cấu hình Nginx hoạt động đúng vai trò Reverse Proxy.
- Người dùng chỉ truy cập website qua Nginx, không truy cập trực tiếp cổng ứng dụng.
- Cấu hình HTTPS an toàn (hoặc có chứng chỉ SSL/TLS tự ký) và có HTTP chuyển hướng sang HTTPS.
- Thiết lập các Security Headers cơ bản.

#### 3.2. Thành phần Kỹ thuật Đáp ứng
- **Nginx Container:** Sử dụng image tối ưu bảo mật `nginxinc/nginx-unprivileged:1.30.5-alpine`, chạy với user không đặc quyền `nginx` (UID 101).
- **Cổng kết nối:** Nginx là dịch vụ duy nhất mở cổng công khai ra toàn mạng (`0.0.0.0:80` và `0.0.0.0:443`). Cổng của ứng dụng web (`3000`) **hoàn toàn đóng** với host và chỉ nhận traffic từ Nginx qua mạng nội bộ `app_net`.
- **Chuyển hướng HTTP sang HTTPS:** Mọi truy vấn gửi tới cổng 80 đều nhận mã phản hồi HTTP `301 Moved Permanently` chuyển hướng sang `https://localhost/`.
- **Chứng chỉ TLS/SSL:** Tạo bằng OpenSSL với Subject Alternative Name (SAN) cho cả `localhost` và `billing.local`, hỗ trợ giao thức TLS 1.2 và TLS 1.3 với cipher suites an toàn cao.
- **6 Security Headers bắt buộc:**
  1. `Strict-Transport-Security: max-age=86400` (HSTS ép buộc HTTPS).
  2. `X-Content-Type-Options: nosniff` (Chống MIME-type sniffing).
  3. `X-Frame-Options: DENY` (Chống Clickjacking).
  4. `Referrer-Policy: strict-origin-when-cross-origin` (Bảo vệ thông tin nguồn duyệt).
  5. `Permissions-Policy: camera=(), microphone=(), geolocation=()` (Chặn quyền nhạy cảm).
  6. `Content-Security-Policy (CSP)`: Giới hạn nghiêm ngặt tài nguyên nạp về trình duyệt.
- **Bổ sung chuyên sâu:**
  - `server_tokens off`: Ẩn hoàn toàn phiên bản Nginx trong header `Server: nginx`.
  - Rate limiting: Giới hạn tần suất gọi API đăng nhập `/api/auth/login` (chống brute-force, trả về HTTP 429 nếu vượt ngưỡng).
  - Tracing ID: Header `X-Request-Id` được Nginx sinh tự động và chuyển tiếp vào ứng dụng để hỗ trợ trace log xuyên suốt hệ thống.

#### 3.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `nginx/nginx.conf`, `scripts/gen-cert.ps1`.
- `[B] RUNTIME VERIFIED`: `curl.exe -i http://localhost` trả về 301; `curl.exe -k -i https://localhost/` trả về 200 kèm đủ 6 security headers.
- `[C] EVIDENCE CAPTURED`: `RQ3-01-https-browser.png` (Trang đăng nhập qua HTTPS), `RQ3-02-runtime-verification.png` (Kiểm thử headers và SSL).
- `[D] DEMO READY`: Mở trình duyệt gõ `http://localhost`, bật F12 Network tab để chỉ rõ mã 301 và các headers.

#### 3.4. Kịch bản Demo Trực tiếp
1. Mở trình duyệt, gõ `http://localhost` (chú ý gõ `http` không có `s`).
2. Chỉ cho giảng viên thấy thanh địa chỉ tự động chuyển thành `https://localhost` (ổ khóa xanh/xám).
3. Bấm F12 -> Chuyển sang tab **Network** -> F5 tải lại trang -> Chọn request đầu tiên `localhost`:
   - Chỉ ra mục **Response Headers**: Có đầy đủ `Strict-Transport-Security`, `Content-Security-Policy`, `X-Frame-Options: DENY`, `Server: nginx` (không có số phiên bản).
4. Mở PowerShell gõ: `curl.exe http://localhost:3000` -> Kết quả báo lỗi `Connection refused`, chứng minh ứng dụng không thể bị truy cập trực tiếp từ bên ngoài mà bắt buộc phải qua Nginx.

#### 3.5. Kết luận Tiêu chí 3: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 4: Hệ thống Giám sát Prometheus + Grafana (1.5 Điểm)

#### 4.1. Yêu cầu của Giảng viên
- Cấu hình Prometheus thu thập số liệu giám sát (metrics) định kỳ từ các thành phần trong hệ thống.
- Cấu hình Grafana kết nối với Prometheus để trực quan hóa dữ liệu qua Dashboard.
- Dashboard phải có các biểu đồ giám sát tối thiểu ở 3 mức: Container, Web Application, và Cơ sở dữ liệu.

#### 4.2. Thành phần Kỹ thuật Đáp ứng
- **Prometheus Server (v3.15.0):** Thu thập metrics tự động với chu kỳ `scrape_interval: 15s`. Cấu hình trong `monitoring/prometheus.yml` quản lý **6 Scrape Jobs độc lập** và đều ở trạng thái **UP**:
  1. `cadvisor`: Thu thập tài nguyên phần cứng (CPU, Memory, Network I/O) của từng Docker container.
  2. `node`: Thu thập tài nguyên cấp hệ điều hành máy chủ Linux VM.
  3. `nginx`: Thu thập qua `nginx-prometheus-exporter:1.5.3` đọc số liệu từ Nginx `stub_status`.
  4. `web`: Thu thập trực tiếp từ endpoint nội bộ `/metrics` của ứng dụng Express (sử dụng thư viện `prom-client`).
  5. `postgres`: Thu thập qua `postgres-exporter:v0.20.1` sử dụng role chuyên dụng `exporter` (thuộc nhóm `pg_monitor`).
  6. `prometheus`: Tự giám sát tiến trình Prometheus server nội bộ.
- **Grafana (v13.2.3):**
  - Tự động nạp cấu hình Datasource Prometheus từ `monitoring/grafana/provisioning/datasources/prometheus.yml`.
  - Tự động nạp Dashboard **Billing Monitoring** từ `monitoring/grafana/dashboards/billing-monitoring.json`.
- **3 Rows Giám sát Chuyên sâu trên Dashboard:**
  - **Row 1 — Container Metrics (cAdvisor & Node Exporter):** Biểu đồ CPU Usage per container, Memory Usage per container, System Load.
  - **Row 2 — Web Application Metrics (Nginx & Express):** Request Rate, HTTP Latency p95/p99, HTTP Status Codes (2xx, 3xx, 4xx, 5xx), Metric nghiệp vụ tùy biến: `billing_invoices_created_total` (đếm số hóa đơn tạo thành công).
  - **Row 3 — Database Metrics (PostgreSQL Exporter):** Active Connections, Transactions Committed/Rolled back, Cache Hit Ratio (>95%), Database Size.

#### 4.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `monitoring/prometheus.yml`, `monitoring/grafana/`, `app/src/metrics.js`.
- `[B] RUNTIME VERIFIED`: API `http://127.0.0.1:9090/api/v1/targets` trả về 6/6 jobs `health: "up"`. Grafana API `http://127.0.0.1:3000/api/health` trả về `database: "ok"`.
- `[C] EVIDENCE CAPTURED`:
  - `RQ4-01-prometheus-targets.png`: Giao diện Prometheus Status Targets hiển thị 6/6 UP.
  - `RQ4-02-grafana-container-row.png`: Row biểu đồ tài nguyên container CPU/RAM.
  - `RQ4-03-grafana-web-row.png`: Row biểu đồ Web Express và Nginx.
  - `RQ4-04-grafana-database-row.png`: Row biểu đồ PostgreSQL connections và transactions.
  - `RQ4-07-prometheus-business-metric.png`: Biểu đồ metric nghiệp vụ hóa đơn `billing_invoices_created_total`.
- `[D] DEMO READY`: Mở giao diện Grafana chỉ rõ 3 rows, mở Prometheus kiểm tra Status Targets.

#### 4.4. Kịch bản Demo Trực tiếp
1. Mở tab: `http://127.0.0.1:9090/targets`. Chỉ cho giảng viên thấy danh sách 6 scrape targets đều có nhãn xanh **UP (1/1)**.
2. Mở tab: `http://127.0.0.1:3000`, đăng nhập bằng `admin` và mật khẩu trong `.env`.
3. Mở Dashboard **Billing Monitoring**:
   - Thu nhỏ và mở rộng lần lượt 3 hàng: **Container**, **Web Application**, và **Database**.
   - Chỉ ra biểu đồ CPU của container `billing-web-1` và `billing-postgres-1`.
   - Chỉ ra biểu đồ đếm số hóa đơn nghiệp vụ đang tăng tương ứng với số lượng hóa đơn đã thao tác trên web.

#### 4.5. Kết luận Tiêu chí 4: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 5: Hệ thống Log Tập trung Loki (1.5 Điểm)

#### 5.1. Yêu cầu của Giảng viên
- Triển khai thành công cụm dịch vụ Loki và Promtail thu thập log tập trung.
- Log của các containers trong hệ thống được đẩy về Loki và gắn nhãn (labels) rõ ràng.
- Có khả năng truy vấn log bằng ngôn ngữ LogQL trên giao diện Grafana Explore.
- Thực hiện được tối thiểu 2–3 câu truy vấn LogQL có ý nghĩa nghiệp vụ hoặc phân tích sự cố.

#### 5.2. Thành phần Kỹ thuật Đáp ứng
- **Loki Server (v3.7.8):** Hệ thống lưu trữ log tối ưu, cấu hình lưu trữ filesystem trong volume `billing_loki_data`, retention 72 giờ, chạy bằng non-root user (UID 10001). Endpoint `http://loki:3100/ready` trả về trạng thái sẵn sàng.
- **Promtail Collector (v3.6.11):** Chạy như một daemon thu thập log từ Docker socket (`/var/run/docker.sock`). Promtail lọc chính xác các container thuộc Compose project `billing` và gắn các nhãn chỉ mục: `service`, `container`, `stream`.
- **Datasource Loki trên Grafana:** Tự động nạp sẵn từ `monitoring/grafana/provisioning/datasources/loki.yml`, cho phép truy vấn trực tiếp từ tab Grafana Explore mà không cần cấu hình thủ công.
- **3 Câu lệnh Truy vấn LogQL Thực tế (đã lưu trong `logging/logql-queries.md`):**
  1. **Truy vấn Q2 (Bảo mật — Đăng nhập thất bại):**
     ```logql
     {service="web"} | json | msg="auth.login_failed"
     ```
     Trích xuất log JSON từ ứng dụng web lọc ra các sự kiện người dùng nhập sai mật khẩu (hiển thị IP nguồn và tài khoản vi phạm).
  2. **Truy vấn Q3 (Vận hành — Lỗi Nginx HTTP 4xx/5xx):**
     ```logql
     {service="nginx"} | json | status >= 400
     ```
     Trích xuất log truy cập Nginx định dạng JSON lọc ra các request bị lỗi client hoặc lỗi server.
  3. **Truy vấn Q4 (Nghiệp vụ — Tạo hóa đơn và Thanh toán):**
     ```logql
     {service="web"} | json | msg=~"invoice.created|payment.recorded"
     ```
     Trích xuất các dòng log nghiệp vụ khi hóa đơn mới được khởi tạo hoặc thanh toán được ghi nhận thành công.

#### 5.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `logging/loki-config.yaml`, `logging/promtail-config.yaml`, `logging/logql-queries.md`.
- `[B] RUNTIME VERIFIED`: Loki labels API trả về đủ các nhãn `cadvisor`, `nginx`, `postgres`, `web`...; cả 3 câu lệnh LogQL đều trả về các dòng log thật đã thu thập.
- `[C] EVIDENCE CAPTURED`:
  - `RQ5-01-loki-ready.png`: Kiểm tra endpoint Loki ready.
  - `RQ5-02-loki-label-browser.png`: Giao diện Label Browser trong Grafana Explore.
  - `RQ5-03-login-failed.png`: Kết quả truy vấn LogQL Q2.
  - `RQ5-04-nginx-errors.png`: Kết quả truy vấn LogQL Q3.
  - `RQ5-05-invoice-payment-events.png`: Kết quả truy vấn LogQL Q4.
  - `RQ5-06-dashboard-log-panel.png`: Panel log tích hợp trên Grafana Dashboard.
- `[D] DEMO READY`: Mở Grafana Explore, dán từng câu lệnh LogQL và nhấn "Run query" để giảng viên trực tiếp xem dữ liệu log.

#### 5.4. Kịch bản Demo Trực tiếp
1. Trong Grafana (`http://127.0.0.1:3000`), nhấp vào menu **Explore** (biểu tượng la bàn).
2. Chọn datasource: **Loki**.
3. Dán câu lệnh Q4: `{service="web"} | json | msg=~"invoice.created|payment.recorded"`.
4. Nhấp nút **Run query**: Chỉ cho giảng viên thấy dòng log ghi nhận sự kiện tạo hóa đơn vừa thực hiện ở phần demo ứng dụng web.
5. Dán câu lệnh Q2: `{service="web"} | json | msg="auth.login_failed"` -> Nhấn **Run query**: Thấy log phát hiện đăng nhập sai.

#### 5.5. Kết luận Tiêu chí 5: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 6: Hardening Hệ thống (1.5 Điểm)

#### 6.1. Yêu cầu của Giảng viên
- Áp dụng tối thiểu 3–4 biện pháp làm vững chắc (hardening) hệ thống.
- Các biện pháp phải được cấu hình thực tế và kiểm chứng được trong môi trường runtime.
- Có script hoặc tài liệu minh chứng kiểm tra các biện pháp hardening.

#### 6.2. Thành phần Kỹ thuật Đáp ứng (6 Tiêu chuẩn H1–H6 Toàn diện)
Hệ thống hiện thực và đạt **toàn bộ 6/6 biện pháp Hardening**, vượt xa yêu cầu tối thiểu:
1. **H1 — Non-root Execution:** Tất cả các container ứng dụng và dịch vụ chính đều chạy với người dùng không có quyền root:
   - `web`: Chạy user `node` (UID 1000).
   - `postgres`: Tiến trình server chạy user `postgres` (UID 999).
   - `nginx`: Chạy user `nginx` (UID 101).
   - `grafana`: Chạy UID 472.
   - `prometheus`: Chạy UID 65534 (`nobody`).
   - `loki`: Chạy UID 10001.
   *(Ngoại lệ kỹ thuật được ghi chép rõ ràng: cAdvisor cần `privileged: true` để đọc số liệu cgroups hệ thống, Promtail cần đọc Docker socket).*
2. **H2 — Network Isolation (Cô lập mạng đa tầng):** 5 Docker networks độc lập. 3 mạng nhạy cảm (`app_net`, `db_net`, `monitoring_net`) được gắn cờ `internal: true`. PostgreSQL chỉ nằm trong `db_net`, hoàn toàn không thể bị chạm tới từ `edge_net` hay Internet.
3. **H3 — Credentials & Secrets Management:** File `.env` được loại trừ khỏi Git; `.env.example` chỉ có placeholder; Mật khẩu mặc định của Grafana (`admin/admin`) và database bị từ chối truy cập (401 Unauthorized).
4. **H4 — Database Least Privilege (Đặc quyền tối thiểu DB):**
   - Role `billing_app`: Chỉ có quyền CRUD dữ liệu, bị cấm tuyệt đối các lệnh DDL (`DROP TABLE`, `ALTER TABLE`), bị cấm `UPDATE` và `DELETE` trên bảng `payments` (bảo đảm nguyên tắc append-only của kế toán).
   - Role `billing_readonly`: Chỉ được phép `SELECT` trên các bảng nghiệp vụ, bị cấm `INSERT/UPDATE/DELETE` và bị cấm hoàn toàn truy cập bảng nhạy cảm `users`.
   - Role `exporter`: Chỉ cấp quyền giám sát thuộc nhóm hệ thống `pg_monitor`.
5. **H5 — TLS & Security Headers:** Hỗ trợ TLS 1.2/1.3, đủ 6 HTTP security headers, ẩn số phiên bản Nginx (`server_tokens off`).
6. **H6 — Port Exposure Minimization (Thu hẹp diện tích phơi nhiễm cổng):** Chỉ duy nhất Nginx mở cổng ra `0.0.0.0`; Các công cụ quản trị (pgAdmin, Grafana, Prometheus) chỉ bind vào `127.0.0.1` (loopback cục bộ); Các cổng dịch vụ nội bộ (web 3000, postgres 5432, loki 3100) không công bố ra máy host.

#### 6.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `docker-compose.yml`, `nginx/nginx.conf`, `db/init/01-init.sql`.
- `[B] RUNTIME VERIFIED`: Bộ kiểm thử tự động `verify-hardening.ps1` và `verify-hardening.sh` chạy thực tế đạt **PASS 100% tất cả các hạng mục H1–H6**.
- `[C] EVIDENCE CAPTURED`:
  - `RQ6-01-non-root-execution.png` (Xác minh UID non-root).
  - `RQ6-02-network-isolation.png` (Xác minh 5 networks).
  - `RQ6-03-credentials-and-git.png` (Xác minh kiểm soát mật khẩu).
  - `RQ6-04-db-least-privilege.png` (Xác minh phân quyền DB).
  - `RQ6-05-port-exposure.png` (Xác minh ranh giới cổng).
  - `RQ6-06-verify-hardening.png` (Toàn bộ báo cáo chạy test suite).
- `[D] DEMO READY`: Chạy trực tiếp script `verify-hardening.ps1` trong 5 giây trước mặt giảng viên.

#### 6.4. Kịch bản Demo Trực tiếp
1. Mở PowerShell trong thư mục dự án.
2. Gõ lệnh:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\verify-hardening.ps1
   ```
3. Script chạy kiểm tra tự động lần lượt từng mục H1 -> H6 và hiển thị các dòng màu xanh:
   - `[PASS] H1.1 - Web container runs as non-root user (node:1000)`
   - `[PASS] H2.2 - Network internal flags match design`
   - `[PASS] H4.2 - billing_app cannot UPDATE payments (append-only enforced)`
   - `[PASS] H6.2 - postgres container internal port 5432 is NOT published`
   - `HARDENING VERIFICATION PASSED (All H1-H6 checks OK)`
4. Giải thích ngắn gọn cho giảng viên về nguyên tắc Least Privilege trên bảng `payments`.

#### 6.5. Kết luận Tiêu chí 6: **PASS TUYỆT ĐỐI (1.5 / 1.5 ĐIỂM)**

---

### Tiêu chí 7: Tổng thể và Trình bày Demo (1.0 Điểm)

#### 7.1. Yêu cầu của Giảng viên
- Toàn bộ hệ thống được khởi động và quản lý đồng bộ bằng một cấu hình `docker-compose.yml`.
- Quy trình demo mạch lạc, rõ ràng, diễn ra suôn sẻ trong thời gian quy định (tối đa 10 phút).
- Có đầy đủ tài liệu báo cáo và bộ ảnh minh chứng (evidence).
- Sinh viên nắm vững luồng hoạt động của hệ thống và giải thích được các quyết định thiết kế.

#### 7.2. Thành phần Kỹ thuật Đáp ứng
- **Quản lý đồng nhất:** 12 dịch vụ khởi chạy đồng loạt chỉ bằng 1 lệnh `docker compose up -d`.
- **Báo cáo đồ án chuyên nghiệp:**
  - File báo cáo chính thức `docs/report/Final_Report.pdf` (18 trang chuẩn cấu trúc học thuật, trang bìa ghi rõ Trường Đại học Công nghệ Thông tin và Truyền thông - ICTU, Khoa Công nghệ thông tin, Môn học Triển khai và Quản trị Hệ thống Phần mềm).
  - Cung cấp cả định dạng nguồn `Final_Report.md`, bản web `Final_Report.html` và bản chỉnh sửa `Final_Report.docx`.
- **Kịch bản Demo Diễn tập (Demo Rehearsal):**
  - Tài liệu `docs/report/Demo_Script.md` thiết kế 12 bước logic rõ ràng.
  - Đã diễn tập thực tế và ghi biên bản: Toàn bộ chuỗi test tự động chạy xong trong **7.07 giây**, thời lượng thuyết trình diễn tập đạt **7–9 phút** (thỏa mãn tiêu chuẩn ≤ 10 phút).
- **Bộ Minh chứng Đầy đủ:** 24 ảnh chụp màn hình runtime tại `docs/evidence/` được đánh chỉ mục và giải thích chi tiết trong `docs/evidence/README.md`.

#### 7.3. Mức độ Hoàn thiện
- `[A] IMPLEMENTED`: `docker-compose.yml`, `docs/report/`, `docs/evidence/`.
- `[B] RUNTIME VERIFIED`: Toàn bộ 12 containers chạy ổn định liên tục nhiều giờ không crash hay restart ngoài ý muốn.
- `[C] EVIDENCE CAPTURED`: Đầy đủ danh mục từ `RQ1` đến `RQ7`.
- `[D] DEMO READY`: Thuộc lòng kịch bản 12 bước trong `Demo_Script.md`.

#### 7.4. Kịch bản Phân bổ Thời gian Trình bày (Mục tiêu 8 Phút)
- **Phút 1:** Giới thiệu đề tài, mở GitHub repository, giới thiệu cấu trúc các mốc commit và tags (Tiêu chí 1).
- **Phút 2:** Mở terminal chạy `docker compose ps`, giải thích kiến trúc 12 container và 5 network (Tiêu chí 7).
- **Phút 3–4:** Mở trình duyệt demo HTTP sang HTTPS, đăng nhập web, tạo khách hàng, tạo và phát hành hóa đơn, thanh toán (Tiêu chí 2 & 3).
- **Phút 5:** Mở pgAdmin chỉ ra hóa đơn nằm trong PostgreSQL thật (Tiêu chí 2).
- **Phút 6:** Mở Prometheus Targets (6/6 UP) và Grafana Dashboard chỉ ra 3 hàng biểu đồ (Tiêu chí 4).
- **Phút 7:** Mở Grafana Explore chạy câu lệnh LogQL xem log nghiệp vụ (Tiêu chí 5).
- **Phút 8:** Chạy script `verify-hardening.ps1` chứng minh 6 chuẩn an toàn H1–H6 và kết thúc (Tiêu chí 6).

#### 7.5. Kết luận Tiêu chí 7: **PASS TUYỆT ĐỐI (1.0 / 1.0 ĐIỂM)**

---

## IV. Bảng Đối chiếu Hỏi & Đáp Nhanh Khi Bảo vệ Đồ án

| Vấn đề Giảng viên có thể xoáy sâu | Bản chất Kỹ thuật cốt lõi | Cách trả lời tự tin & chính xác |
|---|---|---|
| **Tại sao không đưa pgAdmin, Prometheus ra ngoài Internet?** | Thu hẹp diện tích phơi nhiễm tấn công (H6). | "Các công cụ này chỉ dành cho người quản trị nội bộ nên em cấu hình bind vào `127.0.0.1`. Chỉ có Nginx mới mở ra ngoài để tiếp nhận người dùng." |
| **Làm sao Nginx biết web application chạy ở đâu?** | Docker Internal DNS. | "Trong mạng `app_net`, Nginx phân giải tên dịch vụ `web` thành IP nội bộ của container Node.js thông qua DNS server nhúng sẵn của Docker." |
| **Tại sao Promtail lại được gắn socket Docker?** | Thu thập log container. | "Promtail cần đọc luồng log stdout/stderr trực tiếp từ Docker daemon qua socket `/var/run/docker.sock` để chuyển tiếp vào Loki." |
| **Nếu cơ sở dữ liệu bị crash giữa lúc thanh toán thì sao?** | Tính toàn vẹn ACID của PostgreSQL. | "Toàn bộ thao tác cập nhật số dư và thêm bản ghi thanh toán nằm trong một Transaction có khóa `FOR UPDATE`. Nếu lỗi xảy ra, transaction sẽ tự động ROLLBACK hoàn toàn." |
| **Tại sao trong database lại chia nhiều roles?** | Nguyên tắc Least Privilege (H4). | "Role `billing_app` của website không có quyền DDL để tránh bị SQL Injection phá hủy bảng; role `billing_readonly` của pgAdmin chỉ được SELECT để tránh người kiểm toán vô tình sửa dữ liệu." |

---

## V. Kết luận Chung về Trạng thái Sẵn sàng Bảo vệ

Hệ thống Quản lý Hóa đơn / Billing Management System (Đề 18) đã hoàn thiện **100% các yêu cầu kỹ thuật, tài liệu, kịch bản demo và bằng chứng kiểm thử**. Dự án đáp ứng đầy đủ và vượt trội toàn bộ 7 tiêu chí đánh giá với điểm số tối đa kỳ vọng **10.0 / 10.0 điểm**.
