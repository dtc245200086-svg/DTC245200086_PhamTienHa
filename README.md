# Hệ thống Quản lý Hóa đơn / Billing

## Thông tin dự án

| Mục | Thông tin |
|---|---|
| Đề tài | Hệ thống Quản lý Hóa đơn / Billing |
| MSSV | DTC245200086 |
| Họ tên | Phạm Tiến Hà |
| Lớp | CNTT K23G |
| GVHD | Vũ Việt Dũng |
| GitHub username | `dtc245200086-svg` |
| Repository | `DTC245200086_PhamTienHa` |

## Trạng thái

- CP0: **PASS**; prerequisite và compatibility probes được ghi trong [AI Execution History](docs/AI_EXECUTION_HISTORY.md).
- YC1a / CP1a: **PASS**, Commit 0a đã push lên `main`.
- YC2 / CP2: **PASS**, baseline `base-app` có ứng dụng, PostgreSQL và pgAdmin.
- YC3 / CP3: **PASS**; website qua Nginx HTTPS tự ký, redirect, security headers/CSP, rate limit và JSON access log đã được kiểm tra runtime.
- YC4 / CP4 technical: **PASS**; immutable Commit 2/tag `commit-2-monitoring`=`7502aa7f067f99f6b976bc553bdc021b79561f48`. Final evidence remains incomplete: RQ4-02, RQ4-03 and RQ4-04 are not captured.
- YC5 / CP5: **PASS**; Loki, Promtail, Grafana Loki datasource, LogQL Q2–Q4, persistence and YC2–YC4 quick regression verified. Immutable Commit 3/tag `commit-3-logging`=`3ff709cee127ce763ee45fa7477e3b8372d8318a` records YC5.
- YC6 / CP6: **PASS**; H1–H6 controls runtime verified (non-root UIDs, network isolation across 5 networks, secret protection, PostgreSQL least privilege, security headers/TLS 1.2/1.3, unexposed internal ports). Automated test suite `scripts/verify-hardening.ps1` and `.sh` passed with 100% checks OK. Tag `hardening` records YC6.
- Historical support commits: `5743031f9c39a3960a87d40e92cb7eef5d9e40eb` (after Commit 2), `25944eae9dd7546c31c2083f1e3b0400d43919f8` (before Commit 3), and `32555a660f874624c20817e34cab9e37f1b26859` (pre-CP6 docs sync).
- YC7/CP7 and YC1 final have not started. No push.

## Công nghệ

- Node.js 24, Express, `pg`, `express-session`, `connect-pg-simple` và `bcryptjs`.
- Frontend HTML/CSS/JavaScript thuần; Nginx unprivileged `1.30.5-alpine`.
- PostgreSQL 16.15, pgAdmin 4 và Docker Compose.
- Prometheus, Grafana, cAdvisor, node-exporter, nginx-exporter và postgres-exporter (YC4).
- Loki 3.7.8 và Promtail 3.6.11 (YC5); Promtail is EOL, retained because the assignment explicitly requires it.
- Thiết kế/roadmap đầy đủ ở [Design Freeze](FILEmd/billing_deployment_roadmap_2.md).

## Chạy cục bộ trên Windows

Cần Docker Desktop với Linux containers, Docker Compose v2+ và OpenSSL (Git for Windows có sẵn OpenSSL). PowerShell load-test không cần thêm package; Bash load-test cần `curl` và `jq`. Từ thư mục repository:

```powershell
Copy-Item .env.example .env
```

Sửa `.env`: thay mọi `CHANGE_ME` bằng credential riêng, mạnh; `SESSION_SECRET` phải có ít nhất 32 ký tự ngẫu nhiên. `SESSION_COOKIE_SECURE=true` là bắt buộc từ YC3. Không commit `.env`.

Tạo certificate self-signed có SAN `localhost` và `billing.local`, rồi khởi động:

```powershell
.\scripts\gen-cert.ps1
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

- Website: https://localhost (HTTP chuyển hướng 301 sang HTTPS).
- pgAdmin: http://127.0.0.1:5050.
- Prometheus: http://127.0.0.1:9090; Grafana: http://127.0.0.1:3000.
- Nginx publish host ports 80/443; `web` không publish trực tiếp. PostgreSQL không publish cổng.
- Compose dùng năm network: `edge_net` (Nginx), `app_net` (Nginx/web/nginx-exporter), `db_net` (web/PostgreSQL/pgAdmin/postgres-exporter), `admin_net` (pgAdmin/Prometheus/Grafana) và `monitoring_net` (web, monitoring/logging services và exporters). Các network internal flags và membership chi tiết được chốt trong [Design Freeze](FILEmd/billing_deployment_roadmap_2.md); `internal: true` không tự chứng minh egress bị chặn.
- `/metrics` và `/stub_status` chỉ dùng nội bộ; Nginx public HTTPS trả 404 cho cả hai. Exporter/cAdvisor không publish host ports.
- App `/metrics` và Nginx `stub_status` chỉ được thêm ở YC4/Commit 2; Nginx vẫn chặn các endpoint này từ public HTTPS.
- Trình duyệt sẽ cảnh báo certificate self-signed; chỉ chấp nhận trong môi trường demo. Với curl dùng `curl.exe -k`.
- `/health` và `/metrics` trả 404 từ public HTTPS; `/nginx-health` dùng cho healthcheck Nginx trên HTTP.

Tài khoản ứng dụng `admin` và `staff` dùng `ADMIN_PASSWORD` và `STAFF_PASSWORD` từ `.env`. pgAdmin tự đăng ký `Billing PostgreSQL` từ [servers.json](pgadmin/servers.json); nhập `BILLING_READONLY_PASSWORD` tại prompt và để **Save Password** bỏ chọn. `billing_readonly` chỉ đọc các bảng nghiệp vụ.

Database seed và đổi mật khẩu: script trong `db/init` chỉ chạy khi volume PostgreSQL được tạo lần đầu. Thay mật khẩu trong `.env` không tự đổi credential đã lưu trong volume. `docker compose down` giữ dữ liệu; không dùng `docker compose down -v` nếu cần bảo toàn dữ liệu.

## Monitoring YC4 / CP4

Grafana dùng `GRAFANA_ADMIN_PASSWORD` trong `.env`; không dùng `admin/admin`. Dashboard `Billing Monitoring` và datasource Prometheus được provision từ file trong `monitoring/`. Sau khi stack lên, mở Prometheus **Status → Targets** và kiểm tra 6 job `prometheus`, `cadvisor`, `node`, `nginx`, `web`, `postgres` ở trạng thái UP.

Tạo traffic nghiệp vụ thật để dashboard có dữ liệu:

```powershell
.\scripts\load-test.ps1
```

Hoặc trên Bash có `curl` và `jq`:

```bash
bash scripts/load-test.sh
```

Script tạo customer/invoice/payment với prefix `YC4 LOAD`, gửi login sai và 404; dữ liệu được giữ trong PostgreSQL, không tự xóa. Commit 2/tag `commit-2-monitoring` vẫn ở `7502aa7`; Commit 3/tag `commit-3-logging` vẫn trỏ tới `3ff709cee127ce763ee45fa7477e3b8372d8318a`. Các support commit là historical; current HEAD là documentation-sync support commit sau Commit 3. Không push.

## Logging YC5 / CP5

Loki và Promtail chạy trong `monitoring_net`; Promtail chỉ giữ Docker targets có Compose project `billing`. Grafana datasource `Loki` được provision từ file. Mở Grafana → Explore → Loki và dùng các query đã kiểm chứng trong [logging/logql-queries.md](logging/logql-queries.md). Q2 (login failed), Q3 (Nginx 4xx/5xx) và Q4 (invoice/payment) đều trả log thật. Log labels cho stream mới là `service`, `container`, `stream`; Loki giữ lại một số log cũ có label `service_name` cho đến khi hết retention 72 giờ. Promtail 3.6.11 được dùng vì yêu cầu bài tập; upstream đã EOL từ 02/03/2026.

## Hardening YC6 / CP6

Hệ thống đã đạt đầy đủ 6 biện pháp hardening bắt buộc H1–H6 và các biện pháp bổ sung:
- **H1 (Non-root containers):** `web` chạy user `node` (UID 1000); PostgreSQL process chạy user `postgres` (UID 999); Nginx chạy user `nginx` (UID 101); Grafana UID 472; Prometheus UID 65534; Loki UID 10001; exporters non-root. Ngoại lệ được chấp nhận: cAdvisor (`privileged: true`) và Promtail (socket Docker) theo mục 3.16.
- **H2 (Network isolation):** 5 network độc lập; `app_net`, `db_net`, `monitoring_net` có `internal: true`. PostgreSQL chỉ nằm trong `db_net`; Nginx không thuộc `db_net`; `admin_net` tách biệt công cụ quản trị khỏi web và database.
- **H3 (Credentials & Secrets):** File `.env` không bị track trong Git, được ignore; `.env.example` chỉ chứa placeholder; mật khẩu mặc định `admin/admin` của Grafana và default password của database bị từ chối (401 / auth failed).
- **H4 (Least privilege DB):** Kiểm tra bằng `psql` trong `db_net`: `billing_app` bị cấm DDL và cấm UPDATE/DELETE bảng `payments` (bảo đảm append-only tài chính); `billing_readonly` chỉ được SELECT bảng nghiệp vụ, bị cấm INSERT/UPDATE/DELETE và cấm truy cập bảng `users`; `exporter` thuộc `pg_monitor`.
- **H5 (Security headers & TLS):** 6 security headers bắt buộc (`HSTS`, `nosniff`, `DENY`, `Referrer-Policy`, `Permissions-Policy`, `CSP`); `server_tokens off` ẩn phiên bản Nginx; hỗ trợ TLS 1.2 và 1.3.
- **H6 (Port exposure):** Chỉ Nginx mở `0.0.0.0:80/443`; công cụ quản trị (pgAdmin, Grafana, Prometheus) chỉ bind `127.0.0.1`; `web`, `postgres`, `loki`, `cadvisor`, exporters không publish cổng ra host.

Chạy script kiểm tra tự động:
```powershell
.\scripts\verify-hardening.ps1
```
Hoặc trên Linux:
```bash
bash scripts/verify-hardening.sh
```

Toàn bộ minh chứng runtime được lưu tại `docs/evidence/RQ6-01` đến `RQ6-06`.

## Kiểm thử YC3/CP3

Với Node.js 24, đặt `ADMIN_PASSWORD` và `STAFF_PASSWORD` trong PowerShell theo giá trị trong `.env`, sau đó chạy suite qua HTTPS. Chứng chỉ self-signed được tin cậy riêng cho test process; TLS verification trong ứng dụng không bị tắt:

```powershell
$env:CP2_BASE_URL = 'https://localhost'
$env:CP2_EXPECT_SECURE_COOKIE = 'true'
$env:CP2_EXPECT_PUBLIC_HEALTH_BLOCKED = 'true'
$env:NODE_EXTRA_CA_CERTS = (Resolve-Path .\nginx\certs\server.crt).Path
npm run test:cp2 --prefix app
```

Smoke test kiểm tra auth/session, customer, invoice, payment, cancellation, dashboard, validation, quyền và p95 danh sách hóa đơn qua Nginx. Evidence runtime ở [docs/evidence](docs/evidence/README.md); execution details ở [AI Execution History](docs/AI_EXECUTION_HISTORY.md).
