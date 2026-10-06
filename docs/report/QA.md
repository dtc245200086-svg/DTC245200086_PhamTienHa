# Q&A — Bảo vệ Đề 18 Billing

1. **Vì sao dùng Nginx?**
   Nginx cung cấp một public entrypoint, TLS termination, HTTP→HTTPS redirect, security headers, login rate limit, request ID và JSON access logs. Web không publish host port.

2. **Vì sao session thay vì JWT?**
   Session dễ thu hồi thật khi logout; session lưu trong PostgreSQL qua `connect-pg-simple`. JWT muốn thu hồi sớm cần thêm blacklist/state.

3. **Vì sao PostgreSQL `NUMERIC` cho tiền?**
   `NUMERIC` biểu diễn decimal chính xác, tránh sai số nhị phân của float. Tổng tiền được tính ở DB và API trả decimal dạng chuỗi.

4. **Vì sao payment dùng `FOR UPDATE`?**
   Khóa invoice trong transaction tuần tự hóa các payment đồng thời, kiểm tra dư nợ trên trạng thái mới nhất và tránh double-payment/overpayment.

5. **Vì sao có 5 network?**
   Tách ingress (`edge_net`), quản trị (`admin_net`), proxy/app (`app_net`), DB (`db_net`) và telemetry (`monitoring_net`) theo luồng giao tiếp tối thiểu. Membership và internal flags được kiểm tra runtime.

6. **Vì sao PostgreSQL không publish port?**
   App, pgAdmin và exporter kết nối qua `db_net`; không cần expose 5432 trên host. Điều này giảm bề mặt truy cập và tránh nhầm với PostgreSQL khác trên host.

7. **Vì sao cần exporters/cAdvisor?**
   Prometheus pull metrics: cAdvisor cho container, nginx-exporter cho Nginx `stub_status`, postgres-exporter cho DB, node-exporter cho Docker Desktop Linux VM, app `/metrics` cho request/business metrics.

8. **Vì sao Loki + Promtail?**
   Loki tập trung log và hỗ trợ LogQL; Promtail phát hiện Docker containers, gắn label gọn và push log. Promtail được giữ do đề yêu cầu, không phải khuyến nghị cho triển khai mới.

9. **Promtail EOL xử lý thế nào?**
   EOL từ 02/03/2026 được công khai như risk/limitation. Không nâng cấp bằng cách đổi agent trong bài; production cần đánh giá Grafana Alloy và kế hoạch migration.

10. **H1–H6 chứng minh ra sao?**
    H1 UID/process non-root và exceptions; H2 network membership/internal flags; H3 `.env` không tracked/default credentials bị từ chối; H4 negative/positive DB role tests; H5 TLS/headers; H6 `docker ps` port bindings. Cả PowerShell và Git Bash verifiers PASS.

11. **Vì sao có support commits?**
    Support commits ghi nhận đồng bộ tài liệu/evidence hoặc dashboard follow-up sau commit mốc mà không amend tag. Chúng giữ lịch sử minh bạch và các tag YC3/YC4/YC5 vẫn bất biến.

12. **Ba commit mốc YC3/YC4/YC5 là commit nào?**
    Commit 1 `d179090de811925ee6b505311edb5c956fea4b98` (`commit-1-nginx`); Commit 2 `7502aa7f067f99f6b976bc553bdc021b79561f48` (`commit-2-monitoring`); Commit 3 `3ff709cee127ce763ee45fa7477e3b8372d8318a` (`commit-3-logging`).

13. **Vì sao RQ4-02/03/04 cần screenshot riêng?**
    Chúng chứng minh trực tiếp ba Grafana rows Container, Web và Database theo rubric. RQ4-07 là truy vấn business metric trong Prometheus, khác nguồn/góc nhìn nên không thay thế.
