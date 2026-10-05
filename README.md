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
- YC4 chưa bắt đầu. Commit 1 không có Prometheus, Grafana, exporters, `/metrics`, `stub_status`, Loki hoặc Promtail.

## Công nghệ

- Node.js 24, Express, `pg`, `express-session`, `connect-pg-simple` và `bcryptjs`.
- Frontend HTML/CSS/JavaScript thuần; Nginx unprivileged `1.30.5-alpine`.
- PostgreSQL 16.15, pgAdmin 4 và Docker Compose.
- Thiết kế/roadmap đầy đủ ở [Design Freeze](FILEmd/billing_deployment_roadmap_2.md).

## Chạy cục bộ trên Windows

Cần Docker Desktop với Linux containers, Docker Compose v2+ và OpenSSL (Git for Windows có sẵn OpenSSL). Từ thư mục repository:

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
- Nginx publish host ports 80/443; `web` không publish trực tiếp. PostgreSQL không publish cổng.
- Trình duyệt sẽ cảnh báo certificate self-signed; chỉ chấp nhận trong môi trường demo. Với curl dùng `curl.exe -k`.
- `/health` và `/metrics` trả 404 từ public HTTPS; `/nginx-health` dùng cho healthcheck Nginx trên HTTP.

Tài khoản ứng dụng `admin` và `staff` dùng `ADMIN_PASSWORD` và `STAFF_PASSWORD` từ `.env`. pgAdmin tự đăng ký `Billing PostgreSQL` từ [servers.json](pgadmin/servers.json); nhập `BILLING_READONLY_PASSWORD` tại prompt và để **Save Password** bỏ chọn. `billing_readonly` chỉ đọc các bảng nghiệp vụ.

Database seed và đổi mật khẩu: script trong `db/init` chỉ chạy khi volume PostgreSQL được tạo lần đầu. Thay mật khẩu trong `.env` không tự đổi credential đã lưu trong volume. `docker compose down` giữ dữ liệu; không dùng `docker compose down -v` nếu cần bảo toàn dữ liệu.

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
