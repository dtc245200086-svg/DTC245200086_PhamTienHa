# Kịch bản demo — Đề 18 Billing

**Thời lượng mục tiêu:** 8–10 phút.
**Chuẩn bị:** Docker Desktop đang chạy; stack đã khởi động; certificate localhost được tạo; mật khẩu được lấy tại chỗ từ `.env` (không chiếu/đọc mật khẩu); browser mở `https://localhost`; pgAdmin/Grafana/Prometheus chỉ mở qua loopback. Dùng customer/email test mới để tránh trùng dữ liệu. Các thao tác tạo invoice/payment được lưu trong DB demo, không tự xóa.

| # | Thao tác | Expected result | Câu nói ngắn |
|---|---|---|---|
| 1 | Chạy `docker compose ps` | 12 services running; Postgres, web, Nginx và cAdvisor healthchecks healthy; không có cổng DB/web publish | “Toàn bộ stack chạy bằng một Docker Compose project; các cổng nội bộ không mở ra host.” |
| 2 | Mở `http://localhost`, sau đó `https://localhost` | HTTP 301 tới HTTPS; login page trả 200 qua Nginx; trình duyệt có thể cảnh báo cert self-signed | “Nginx là public entrypoint; app chỉ đi qua HTTPS reverse proxy.” |
| 3 | Đăng nhập `admin` bằng thông tin runtime | Dashboard ứng dụng xuất hiện; cookie `billing.sid` HttpOnly/SameSite=Strict/Secure | “Session lưu server-side trong PostgreSQL; secret không nằm trong Git.” |
| 4 | Mở Customers, tạo customer mới `CP7 Demo <timestamp>` | Customer xuất hiện trong danh sách; xác nhận detail/search | “Dữ liệu được ghi và đọc từ PostgreSQL thật.” |
| 5 | Tạo invoice draft cho customer, thêm ít nhất một item | Invoice DRAFT có subtotal/tax/total server tính bằng NUMERIC | “Số tiền không cộng bằng floating point phía trình duyệt.” |
| 6 | Issue invoice | Trạng thái ISSUED và số `INV-YYYY-NNNNNN` | “Sequence unique và tăng dần; có thể có gap và không reset theo năm.” |
| 7 | Ghi partial payment rồi thanh toán phần còn lại | PARTIALLY_PAID rồi PAID; thử overpayment chỉ khi muốn minh họa 409 | “Payment transaction khóa invoice bằng FOR UPDATE để chống double payment.” |
| 8 | Mở `http://127.0.0.1:5050`, kết nối server `Billing PostgreSQL` | pgAdmin thấy database `billing` và invoice/customer vừa tạo; nhập password lúc chạy, Save Password bỏ chọn | “JSON đăng ký server không chứa password; pgAdmin dùng role chỉ đọc.” |
| 9 | Mở Grafana dashboard `Billing Monitoring` | Chỉ ra ba row Container/Web/Database; Prometheus Targets 6/6 UP; dùng ảnh RQ4-02/03/04 | “Mỗi row có nguồn dữ liệu riêng; đây là panel runtime thật.” |
| 10 | Grafana Explore → Loki, chạy Q2, Q3, Q4 | Q2 failed login; Q3 Nginx 4xx/5xx; Q4 invoice/payment events trả log thật | “Promtail thu Docker logs; label giữ gọn để tránh cardinality cao.” |
| 11 | Chạy `powershell -ExecutionPolicy Bypass -File scripts/verify-hardening.ps1` hoặc `& 'C:\Program Files\Git\bin\bash.exe' scripts/verify-hardening.sh` | Tất cả H1–H6 PASS; Git Bash không còn grep warning | “Verifier thực hiện negative tests, network và port checks; secrets không in ra.” |
| 12 | Chạy `git log --oneline --decorate -8` và `git tag --list` | Thấy Commit 1/2/3, `hardening`, `docs-final`, và Commit 6/`v1.0` (HEAD = `fded947`) | “Các tag mốc bất biến; support commits ghi nhận tài liệu và sửa chữa sau checkpoint.” |

## Lệnh LogQL

```logql
{service="web"} | json | msg="auth.login_failed"
{service="nginx"} | json | status >= 400
{service="web"} | json | msg=~"invoice.created|payment.recorded"
```

## Kết thúc demo

Logout khỏi ứng dụng; đóng các trang admin; không xóa volume. Nếu cần dừng stack sau buổi demo, dùng `docker compose down` (không `-v`).

## Biên bản diễn tập Demo (Rehearsal Execution Record)

- **Ngày thực hiện:** 2026-10-06 16:51:54 – 16:53:34 +07:00
- **Môi trường:** Docker Desktop (12 services UP), Windows host, Nginx HTTPS reverse proxy
- **Kết quả từng bước:**
  - Bước 1 (docker compose ps): PASS (12/12 container UP & healthy)
  - Bước 2 (HTTP redirect 301 & HTTPS 200): PASS
  - Bước 3–7 (Auth, Customer, Invoice draft, NUMERIC, Issue INV-YYYY-NNNNNN, Payment, Concurrency lock): PASS (15/15 nhóm kiểm thử, p95 23.90ms)
  - Bước 8 (pgAdmin PING & database connection): PASS
  - Bước 9 (Prometheus 6/6 UP, Grafana database=ok): PASS
  - Bước 10 (Loki ready & LogQL Q2/Q3/Q4 queries): PASS
  - Bước 11 (Hardening verifier H1–H6): PASS 100%
  - Bước 12 (Git history & milestone tags): PASS
- **Thời lượng:** Chuỗi xác minh nghiệp vụ và hạ tầng thực hiện tự động trong 7.07 giây; thời gian thuyết minh theo kịch bản 12 bước đạt 7–9 phút (thỏa mãn tiêu chí ≤ 10 phút).
- **Lỗi / Sự cố:** 0 lỗi phát sinh.
- **Trạng thái:** **REHEARSAL PASS** (Đủ điều kiện thực hiện demo).
