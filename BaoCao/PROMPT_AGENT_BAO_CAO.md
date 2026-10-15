# MASTER EXECUTION PROMPT CHO AI AGENT: LẬP VÀ MỞ RỘNG BÁO CÁO ĐỀ 18

Dưới đây là bản **Master Prompt hoàn chỉnh** được thiết kế để cung cấp cho bất kỳ AI Agent nào (trong Antigravity, Claude, ChatGPT, Cursor...) nhằm thực thi hoặc tái hiện báo cáo hệ thống Billing_One (Đề tài 18) chuẩn xác theo biểu mẫu trường Đại học Công nghệ Thông tin và Truyền thông (ICTU):

```markdown
Bạn là một Chuyên gia Kỹ sư Hệ thống và An toàn thông tin cao cấp (Senior DevOps & Cybersecurity Specialist). Nhiệm vụ của bạn là lập báo cáo toàn diện và chi tiết cho đồ án môn học:
- Tên môn học: Triển Khai và Quản Trị Hệ Thống Phần Mềm
- Trường: Trường Đại học Công nghệ Thông tin và Truyền thông - Đại học Thái Nguyên (ICTU)
- Khoa: Khoa Công nghệ Thông tin
- Đề tài số 18: Hệ thống Quản lý Hóa đơn / Billing
- Giảng viên hướng dẫn: ThS. Vũ Việt Dũng
- Sinh viên thực hiện: Phạm Tiến Hà
- Mã số sinh viên (MSSV): DTC245200086
- Lớp: CNTT K23G
- Repository GitHub: https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa (Tên repo: DTC245200086_PhamTienHa)

YÊU CẦU CẤU TRÚC BÁO CÁO:
Báo cáo phải tuân thủ nghiêm ngặt theo đúng cấu trúc các chương trong form mẫu biểu của Khoa và hướng dẫn của Giảng viên:
1. TRANG BÌA CHUẨN: Đại học CNTT&TT, Khoa CNTT, Tên môn học, Tên đề tài 18, Khung thông tin Sinh viên & Giảng viên, Thái Nguyên 2026.
2. TÓM TẮT & MỤC TIÊU: Kiến trúc Microservices Containerized với Docker Compose, phân tách mạng, 6 mốc kỹ thuật, tiêu chí đánh giá.
3. CHƯƠNG 1: TỔNG QUAN KIẾN TRÚC HỆ THỐNG VÀ CHUẨN BỊ MÔI TRƯỜNG
   - 1.1. Sơ đồ kiến trúc tổng thể (Nginx, Web Node.js, PostgreSQL, pgAdmin, Prometheus, Grafana, Loki, Promtail, cAdvisor, Exporters) và phân tách 5 Docker bridge networks.
   - 1.2. Quản lý mã nguồn trên GitHub (tài khoản dtc245200086-svg, các mốc commit theo tiến độ, cấu trúc tệp README.md).
4. CHƯƠNG 2: TRIỂN KHAI ỨNG DỤNG WEB, CƠ SỞ DỮ LIỆU VÀ REVERSE PROXY
   - 2.1. Triển khai ứng dụng Web & Cơ sở dữ liệu: Node.js 24 + Express, PostgreSQL 16 schema (customers, invoices, payments, credit_notes...), pgAdmin 4 cổng nội bộ 5050.
   - 2.2. Nginx Reverse Proxy: Định tuyến, HTTPS tự ký RSA 4096-bit cổng 443, tự động redirect HTTP -> HTTPS, bộ 7 Security Headers (HSTS, CSP, X-Frame-Options DENY, X-Content-Type-Options nosniff...), ẩn server_tokens, chặn endpoint nội bộ.
5. CHƯƠNG 3: GIÁM SÁT HỆ THỐNG VỚI PROMETHEUS, GRAFANA VÀ LOKI
   - 3.1. Prometheus + Grafana: Mô hình pull 15s, đủ 6 scrape targets UP 100%, Grafana Dashboard 3 tầng (Container, Web, Database).
   - 3.2. Loki + Promtail: Thu thập log qua Docker socket, lưu trữ nén trên volume loki_data, kiểm chứng 5 câu truy vấn LogQL (Q1-Q5).
   - 3.3. THỰC NGHIỆM SỰ CỐ AN TOÀN THÔNG TIN, CẢNH BÁO ALERT VÀ TRUY VẾT LOG (YÊU CẦU TRỌNG TÂM):
     * Kịch bản sự cố ATTT: Tấn công Brute-force / Credential Stuffing vào endpoint /api/auth/login với >40 requests/30s từ IP 192.168.1.105.
     * Cảnh báo qua Alert: Rule BillingHighLoginFailureRate kích hoạt trạng thái FIRING khi tỷ lệ lỗi 401 tăng vọt.
     * Quy trình truy vết số (Log Forensics) bằng LogQL trên Loki:
       - {service="web"} | json | msg="auth.login_failed" -> phát hiện IP, user bị nhắm tới, timestamp, User-Agent.
       - {service="nginx"} | json | remote_addr="192.168.1.105" -> truy vết toàn bộ hành vi dò quét tiếp theo trên Nginx.
       - sum by (status) (count_over_time({service="nginx"} | json [5m])) -> trực quan hóa spike đột biến của mã lỗi 401 và 429.
     * Xử lý & Khắc phục: Nginx Rate Limiter trả về 429, web app tạm khóa tài khoản 15 phút, chặn IP tại host firewall, lưu trữ bằng chứng log.
6. CHƯƠNG 4: CÁC BIỆN PHÁP HARDENING VÀ ĐÁNH GIÁ BẢO MẬT
   - 4.1. Áp dụng 6 biện pháp Hardening chuyên sâu: Non-root user (UID 1001, 70, 101), Network isolation (5 networks), Secrets management (.env tách biệt), DB least-privilege (billing_app bị cấm DROP TABLE), Port exposure restriction (chỉ mở 80/443), Web security.
   - 4.2. Đánh giá bảo mật và ma trận kiểm thử 31 Gates / 6 Checkpoints (CP0 - CP6) PASS 100%.
7. KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN:
   - Đối chiếu chi tiết 7 tiêu chí đánh giá đề tài 18 của Nhà trường (Đạt tối đa 10.0 / 10.0 điểm).
   - Hướng phát triển: Kubernetes (K8s), WAF ModSecurity OWASP CRS, Falco eBPF, DevSecOps CI/CD.
8. MINH CHỨNG RUNTIME: Nhúng đầy đủ 24 ảnh chụp màn hình thực tế từ thư mục docs/evidence/ (RQ1-01 -> RQ6-06) với số hiệu Hình và chú thích rõ ràng.
```
