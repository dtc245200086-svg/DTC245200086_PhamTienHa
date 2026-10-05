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
- YC2 / CP2: **PASS**, ứng dụng, PostgreSQL và pgAdmin đã được kiểm tra runtime; Commit 0b có tag `base-app`.
- YC3 chưa bắt đầu. Phạm vi đang chạy chỉ gồm `web`, `postgres` và `pgadmin`; chưa cấu hình reverse proxy, HTTPS, metrics hay logging tập trung.

## Công nghệ trong YC2

- Node.js 24, Express, `pg`, `express-session`, `connect-pg-simple` và `bcryptjs`.
- Frontend HTML/CSS/JavaScript thuần.
- PostgreSQL 16.15, pgAdmin 4 và Docker Compose.
- Thiết kế/roadmap đầy đủ ở [Design Freeze](FILEmd/billing_deployment_roadmap_2.md).

## Chạy cục bộ trên Windows

Cần Docker Desktop với Linux containers và Docker Compose v2+. Từ thư mục repository:

```powershell
Copy-Item .env.example .env
```

Sửa `.env`: thay mọi giá trị `CHANGE_ME` bằng credential riêng, mạnh; `SESSION_SECRET` phải có ít nhất 32 ký tự ngẫu nhiên. Không commit `.env`.

```powershell
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

- Web: http://127.0.0.1:8000
- pgAdmin: http://127.0.0.1:5050
- PostgreSQL không publish cổng lên host. pgAdmin kết nối nội bộ tới `postgres:5432` trên database `billing`.

Tài khoản ứng dụng `admin` và `staff` dùng mật khẩu `ADMIN_PASSWORD` và `STAFF_PASSWORD` từ `.env`. pgAdmin tự đăng ký `Billing PostgreSQL` từ [servers.json](pgadmin/servers.json); khi kết nối, nhập `BILLING_READONLY_PASSWORD` tại prompt và để **Save Password** bỏ chọn. `billing_readonly` chỉ đọc các bảng nghiệp vụ.

Database seed và đổi mật khẩu: script trong `db/init` chỉ chạy khi volume PostgreSQL được tạo lần đầu. Thay mật khẩu trong `.env` không tự đổi credential hoặc mật khẩu người dùng đã lưu trong volume. `docker compose down` giữ dữ liệu; không dùng `docker compose down -v` nếu cần bảo toàn dữ liệu.

## Kiểm thử CP2

Với Node.js 24, đặt `ADMIN_PASSWORD` và `STAFF_PASSWORD` trong môi trường PowerShell theo giá trị trong `.env`, sau đó chạy:

```powershell
npm run test:cp2 --prefix app
```

Smoke test gọi API runtime tại `http://127.0.0.1:8000`, tạo dữ liệu kiểm thử và kiểm tra auth/session, customer, invoice, payment, cancellation, dashboard, validation, quyền và p95 danh sách hóa đơn. Evidence runtime được lưu trong [docs/evidence](docs/evidence/README.md).

## Các checkpoint tiếp theo

Roadmap YC1-YC7 nằm trong Design Freeze. CP2 là cổng chặn riêng; các thành phần thuộc YC3 trở đi chưa được triển khai trong baseline `base-app`.
