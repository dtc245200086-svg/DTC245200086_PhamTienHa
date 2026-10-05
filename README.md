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
- YC4 / CP4: **PASS**, Commit 2/tag `commit-2-monitoring` ở local; Prometheus, Grafana và exporters có dữ liệu runtime. Commit 2 chưa push theo yêu cầu.
- YC5 chưa bắt đầu; chưa có Loki, Promtail hay LogQL. CP6 hardening tổng thể và CP7 báo cáo/demo vẫn còn.

## Công nghệ

- Node.js 24, Express, `pg`, `express-session`, `connect-pg-simple` và `bcryptjs`.
- Frontend HTML/CSS/JavaScript thuần; Nginx unprivileged `1.30.5-alpine`.
- PostgreSQL 16.15, pgAdmin 4 và Docker Compose.
- Prometheus, Grafana, cAdvisor, node-exporter, nginx-exporter và postgres-exporter (YC4).
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
- `/metrics` và `/stub_status` chỉ dùng nội bộ; Nginx public HTTPS trả 404 cho cả hai. Exporter/cAdvisor không publish host ports.
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

Script tạo customer/invoice/payment với prefix `YC4 LOAD`, gửi login sai và 404; dữ liệu được giữ trong PostgreSQL, không tự xóa. Commit 2/tag hiện ở local và chưa push. YC5 (Loki/Promtail) chưa bắt đầu.

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
