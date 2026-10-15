# BÁO CÁO ĐÁNH GIÁ ĐẢM BẢO CHẤT LƯỢNG VÀ ĐỐI CHIẾU TIÊU CHÍ (QA REPORT)
## ĐỀ TÀI 18: HỆ THỐNG QUẢN LÝ HÓA ĐƠN / BILLING (BILLING_ONE)

* **Trường:** Trường Đại học Công nghệ Thông tin và Truyền thông (ICTU)
* **Khoa:** Khoa Công nghệ Thông tin
* **Học phần:** Triển Khai và Quản Trị Hệ Thống Phần Mềm
* **Giảng viên hướng dẫn:** ThS. Vũ Việt Dũng
* **Sinh viên thực hiện:** Phạm Tiến Hà — MSSV: DTC245200086 — Lớp: CNTT K23G
* **Repository GitHub chính thức:** `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa`
* **Nhánh chính:** `main` | **Commit SHA đối chiếu:** `8fbb8c8` | **Thời điểm kiểm tra:** 2026-10-13

---

## 1. TỔNG HỢP KẾT QUẢ ĐỐI CHIẾU 7 TIÊU CHÍ CHẤM ĐIỂM

| STT | Tiêu chí đánh giá | Trọng số | Trạng thái kỹ thuật | Verdict (Kết luận) | Bằng chứng runtime đối chiếu |
| :---: | :--- | :---: | :---: | :---: | :--- |
| **1** | **Quản lý mã nguồn trên GitHub** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Repo `DTC245200086_PhamTienHa`, remote URL chính xác, 13 commits, 7 release tags, commit message chuẩn Conventional Commits, README chi tiết, `.env` được bảo vệ ngoài Git. (Hình 1.1 - 1.4) |
| **2** | **Ứng dụng Web + PostgreSQL + pgAdmin** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Node.js 24 + Express backend kết nối PostgreSQL 16.15 qua mạng nội bộ cô lập; container migration tự động cập nhật schema (exit 0); pgAdmin 4 cổng 5050 bind 127.0.0.1 kết nối quản trị trực quan. (Hình 2.1) |
| **3** | **Nginx Reverse Proxy & SSL** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Nginx unprivileged (UID 101), chuyển hướng HTTP->HTTPS 301, chứng chỉ TLS tự ký RSA 4096-bit (TLSv1.2/1.3), đủ 7 HTTP Security Headers, ẩn server_tokens, chặn endpoint nội bộ, rate limiting. (Hình 2.2, 2.3) |
| **4** | **Hệ thống giám sát Prometheus + Grafana** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Prometheus scrape 6/6 mục tiêu ở trạng thái UP (100%); Grafana Dashboard "Billing Monitoring" 3 tầng (Container, Web, Database) trực quan hóa đầy đủ metrics thời gian thực. (Hình 3.1 - 3.5) |
| **5** | **Hệ thống log tập trung Loki + Promtail + LogQL** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Promtail thu thập log JSON có cấu trúc từ Docker socket (`/var/run/docker.sock`) với các nhãn `service`, `container`, `stream`; Loki lưu trữ nén trên persistent volume; 5 câu truy vấn LogQL đã chạy thực tế và có kết quả. (Hình 3.6 - 3.11) |
| **6** | **Hardening hệ thống & Kịch bản sự cố ATTT** | 1.5 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Áp dụng 6 biện pháp Hardening (non-root UID 1000/101/70, 5 Docker networks, secrets `.env` an toàn, DB least-privilege cấm DROP TABLE, cổng CSDL 5432 đóng hoàn toàn, web security). Kịch bản brute-force có Grafana Unified Alerting chuyển trạng thái `Firing / Alerting` thật (15:23:40Z) và truy vết LogQL. (Hình 4.1 - 4.6) |
| **7** | **Tổng thể & Trình bày báo cáo** | 1.0 điểm | **PASS (100%)** | Đạt theo bằng chứng hiện có | Khởi chạy toàn bộ hệ thống bằng 1 lệnh `docker compose up -d`; báo cáo hoàn thiện đúng form mẫu DOCX của trường, độ dài > 20 trang, đầy đủ 24 hình minh chứng runtime thực tế, kịch bản demo và mã nguồn đối chiếu. |
| **TỔNG** | **ĐÁNH GIÁ CHUNG TOÀN HỆ THỐNG** | **10.0 / 10.0** | **PASS (100%)** | **XUẤT SẮC** | **ĐỦ ĐIỀU KIỆN NỘP VÀ BẢO VỆ ĐỒ ÁN** |

---

## 2. DANH MỤC MINH CHỨNG RUNTIME ĐÃ XÁC THỰC (EVIDENCE CHECKLIST)

Tất cả các hình ảnh minh chứng dưới đây được lưu trữ nguyên bản trong thư mục `BaoCao/evidence/` và đã được loại bỏ thông tin nhạy cảm (passwords, private keys, cookies):

1. **Hình 1.1 (`RQ1-01-github-repository.png`):** Trang chủ Repository GitHub `dtc245200086-svg/DTC245200086_PhamTienHa`.
2. **Hình 1.2 (`RQ1-02-github-commits.png`):** Lịch sử các Commit được tổ chức khoa học theo chuẩn Conventional Commits.
3. **Hình 1.3 (`RQ1-03-github-commit-detail.png`):** Chi tiết commit triển khai cấu hình và kiểm thử hệ thống.
4. **Hình 1.4 (`RQ1-04-github-readme.png`):** Tài liệu README.md hướng dẫn cài đặt và vận hành hệ thống chi tiết.
5. **Hình 2.1 (`RQ2-07-pgadmin-runtime.png`):** Giao diện pgAdmin 4 quản trị cơ sở dữ liệu PostgreSQL 16 qua cổng nội bộ 5050.
6. **Hình 2.2 (`RQ3-01-https-browser.png`):** Truy cập website Billing_One thành công qua HTTPS tự ký trên trình duyệt web.
7. **Hình 2.3 (`RQ3-02-runtime-verification.png`):** Kết quả kiểm tra runtime qua cURL xác nhận HTTPS và toàn bộ 7 Security Headers.
8. **Hình 3.1 (`RQ4-01-prometheus-targets.png`):** Giao diện Prometheus Targets xác nhận 6/6 mục tiêu giám sát ở trạng thái UP (100%).
9. **Hình 3.2 (`RQ4-02-grafana-container-row.png`):** Grafana Dashboard - Hàng giám sát tài nguyên Container (cAdvisor metrics).
10. **Hình 3.3 (`RQ4-03-grafana-web-row.png`):** Grafana Dashboard - Hàng giám sát Web Server (Requests/sec, Status codes, Latency p95).
11. **Hình 3.4 (`RQ4-04-grafana-database-row.png`):** Grafana Dashboard - Hàng giám sát CSDL PostgreSQL (Active connections, Commits/sec).
12. **Hình 3.5 (`RQ4-07-prometheus-business-metric.png`):** Truy vấn Prometheus đo lường các chỉ số nghiệp vụ hóa đơn và thanh toán.
13. **Hình 3.6 (`RQ5-01-loki-ready.png`):** Trạng thái hệ thống Loki sẵn sàng tiếp nhận log và kết nối Data Source Grafana.
14. **Hình 3.7 (`RQ5-02-loki-label-browser.png`):** Trình duyệt nhãn LogQL Label Browser trên giao diện Grafana Explore.
15. **Hình 3.8 (`RQ5-03-login-failed.png`):** Truy vấn LogQL Q2 lọc sự kiện đăng nhập thất bại `auth.login_failed`.
16. **Hình 3.9 (`RQ5-04-nginx-errors.png`):** Truy vấn LogQL Q3 lọc mã lỗi HTTP client/server errors trên Nginx.
17. **Hình 3.10 (`RQ5-05-invoice-payment-events.png`):** Truy vấn LogQL Q4 lọc sự kiện nghiệp vụ tạo hóa đơn và thanh toán.
18. **Hình 3.11 (`RQ5-06-dashboard-log-panel.png`):** Tích hợp panel tra cứu log thời gian thực trực tiếp trên Grafana Dashboard.
19. **Hình 4.1 (`RQ6-01-non-root-execution.png`):** Kiểm tra tiến trình container chạy dưới quyền non-root user (UID 1000, 70, 101).
20. **Hình 4.2 (`RQ6-02-network-isolation.png`):** Kiểm tra phân tách 5 mạng Docker nội bộ bảo vệ cô lập tầng Database.
21. **Hình 4.3 (`RQ6-03-credentials-and-git.png`):** Quản lý biến môi trường .env và kiểm tra Git clean không lộ mật khẩu.
22. **Hình 4.4 (`RQ6-04-db-least-privilege.png`):** Xác minh nguyên tắc đặc quyền tối thiểu: user billing_app bị từ chối lệnh DROP TABLE.
23. **Hình 4.5 (`RQ6-05-port-exposure.png`):** Kiểm tra giới hạn cổng phơi nhiễm: chỉ cổng 80 và 443 mở ra bên ngoài.
24. **Hình 4.6 (`RQ6-06-verify-hardening.png`):** Script tự động kiểm tra hardening đạt kết quả PASS 100%.
25. **Tệp bằng chứng log (`security_incident_alert_forensics.json`):** Trích xuất chu trình kích hoạt cảnh báo Alerting từ Normal -> Pending -> Firing tại thời điểm 2026-10-13T15:23:40Z và truy vết LogQL.

---

## 3. CHI TIẾT THỰC NGHIỆM SỰ CỐ AN TOÀN THÔNG TIN & ALERT RUNTIME

* **Mục tiêu thử nghiệm:** Kiểm chứng khả năng phát hiện tự động hành vi tấn công dò quét mật khẩu (brute-force) và quy trình điều tra số (log forensics) bằng LogQL.
* **Kịch bản thực thi:** Gửi 6 yêu cầu HTTP POST liên tiếp vào `/api/auth/login` với tài khoản thử nghiệm không hợp lệ qua cổng Nginx HTTPS.
* **Kết quả ghi nhận:**
  1. Web app trả về mã HTTP 401 Unauthorized kèm mã lỗi `INVALID_CREDENTIALS` và `request_id` độc bản.
  2. Web app phát ra log JSON cấu trúc: `{"ts":"...","level":"warn","msg":"auth.login_failed","request_id":"..."}`.
  3. Promtail gom log qua Docker socket chuyển về Loki server lưu trữ nén.
  4. Quy tắc cảnh báo **`BillingHighLoginFailureRate`** trên Grafana Unified Alerting (định nghĩa trong `monitoring/grafana/provisioning/alerting/rules.yaml`) tính toán biểu thức `sum(count_over_time({service="web"} | json | msg="auth.login_failed" [5m])) > 4`.
  5. Sau chu kỳ đánh giá (15:22:40Z), rule chuyển sang trạng thái **`Pending`**.
  6. Sau khi duy trì vượt ngưỡng đủ 30 giây (`for: 30s`), tại thời điểm **`15:23:40Z`**, rule chính thức kích hoạt trạng thái **`Firing / Alerting`**.
  7. Kỹ trị viên thực hiện 5 câu truy vấn LogQL xác định nguồn IP, User-Agent, endpoint bị dò quét và đối chiếu Nginx - Web qua `request_id`.
  8. Hệ thống Nginx áp dụng rate limit 429, tài khoản bị tạm khóa, alert tự động trở về `Normal / Resolved` sau khi hết cửa sổ trượt 5 phút.

---

## 4. CÁC HẠN CHẾ KỸ THUẬT VÀ KHUYẾN NGHỊ VẬN HÀNH

1. **Chứng chỉ SSL tự ký (Self-signed Certificate):**
   * *Hiện trạng:* Sử dụng chứng chỉ RSA 4096-bit tự ký nội bộ cho môi trường phát triển/thử nghiệm, trình duyệt web sẽ hiển thị cảnh báo tin cậy (NET::ERR_CERT_AUTHORITY_INVALID).
   * *Khuyến nghị:* Khi đưa lên môi trường Internet công cộng, cần thay thế bằng chứng chỉ tin cậy từ Let's Encrypt (qua Certbot) hoặc CA thương mại.
2. **Quyền truy cập Docker Socket của Promtail:**
   * *Hiện trạng:* Promtail gắn kết trực tiếp tệp `/var/run/docker.sock` ở chế độ read-only (`:ro`) để thực hiện cơ chế tự động khám phá container (Docker Service Discovery).
   * *Đánh giá rủi ro:* Việc mở Docker socket tiềm ẩn nguy cơ bảo mật nếu container bị chiếm quyền điều khiển. Trong môi trường Kubernetes production, khuyến nghị chuyển sang Promtail DaemonSet đọc tệp log `/var/log/pods` thay vì socket.
3. **Quyền Privileged của cAdvisor:**
   * *Hiện trạng:* cAdvisor được cấu hình `privileged: true` để đọc toàn diện metrics CPU/RAM/IO của các cgroups từ host.
   * *Khuyến nghị:* Điều chỉnh cấp quyền chi tiết (Linux capabilities: `CAP_SYS_ADMIN` hoặc đọc trực tiếp `/sys/fs/cgroup`) khi triển khai ở cấp độ production bảo mật cao.
4. **Kênh thông báo cảnh báo (Alert Notification):**
   * *Hiện trạng:* Cảnh báo hiển thị trạng thái Firing trực quan trên giao diện Grafana Alerting. Chưa cấu hình contact point gửi email hoặc webhook ra bên ngoài (Telegram/Slack) do chạy trên môi trường local cô lập không có internet egress.
   * *Khuyến nghị:* Tích hợp Webhook Alertmanager gửi thông báo tức thời tới kênh vận hành nội bộ của doanh nghiệp.

---

## 5. KẾT LUẬN CUỐI CÙNG

Hệ thống **Billing_One** hoàn toàn đáp ứng các tiêu chuẩn kỹ thuật khắt khe, minh chứng trung thực, tái hiện được và đủ điều kiện nộp báo cáo chính thức.
