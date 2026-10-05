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
| Repository dự kiến | `DTC245200086_PhamTienHa` |
| Remote đã cấu hình | `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git` (chưa xác minh push) |

## Mục tiêu

Triển khai theo Design Freeze và roadmap hiện có một hệ thống quản lý khách hàng, hóa đơn và thanh toán; đồng thời đáp ứng các checkpoint về reverse proxy, giám sát, logging, hardening và báo cáo.

## Stack dự kiến

- Node.js 24, Express, `pg` và frontend HTML/CSS/JavaScript thuần.
- PostgreSQL 16 và pgAdmin 4.
- Docker Compose; Nginx unprivileged; Prometheus, Grafana, cAdvisor và exporters; Loki và Promtail.
- Chi tiết kiến trúc và phiên bản image được ghi trong [Design Freeze](FILEmd/billing_deployment_roadmap_2.md).

## Trạng thái triển khai

- CP0: **PASS**, ngày 05/10/2026; prerequisite và compatibility probes đã được ghi trong [AI Execution History](docs/AI_EXECUTION_HISTORY.md).
- YC1a / CP1a: repository foundation.
- Billing application chưa được triển khai. Chưa có backend, frontend, database implementation, hay `docker-compose.yml` Billing.
- Nginx, monitoring và logging cho Billing chưa được triển khai.
- Tài liệu hiện có trong [FILEmd](FILEmd/) là tài liệu thiết kế/roadmap, không phải ứng dụng chạy được.

## Roadmap YC1-YC7

1. YC1a: khởi tạo repository foundation; YC1 final: hoàn thiện README và repo sau khi triển khai.
2. YC2: ứng dụng nền, PostgreSQL và pgAdmin.
3. YC3: Nginx reverse proxy và HTTPS/security headers.
4. YC4: Prometheus, Grafana và monitoring.
5. YC5: Loki, Promtail và LogQL.
6. YC6: hardening và kiểm thử hồi quy.
7. YC7: báo cáo và demo.

Mỗi checkpoint là cổng chặn riêng. Hoàn tất YC1a không có nghĩa các thành phần YC2-YC7 đã tồn tại hoặc hoạt động.

## CP0

CP0 **PASS** ngày 05/10/2026. Kết quả chi tiết, kể cả xác minh pgAdmin runtime credential, nằm trong [AI Execution History](docs/AI_EXECUTION_HISTORY.md). YC1a chỉ sử dụng kết quả CP0 đã ghi; không chạy lại toàn bộ CP0.

## Trạng thái chạy

> Repository hiện là bộ khung tài liệu. Chưa có lệnh khởi chạy ứng dụng Billing; không chạy `docker compose up` cho Billing trước khi YC2 được thực hiện và kiểm tra.
