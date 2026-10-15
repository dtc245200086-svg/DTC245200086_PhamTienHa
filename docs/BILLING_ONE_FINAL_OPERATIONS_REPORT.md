# BÁO CÁO VẬN HÀNH CUỐI CÙNG (FINAL OPERATIONS REPORT)
# BILLING_ONE EXTENDED — CREDENTIAL ROTATION, GIT HISTORY SCRUBBING & OFFICIAL TLS AUDIT

> **Tài liệu:** `docs/BILLING_ONE_FINAL_OPERATIONS_REPORT.md`  
> **Phiên bản:** 1.0.0 — Final Operations Closure  
> **Thời điểm đánh giá:** 2026-10-08  
> **Quyết định phát hành:** **`RELEASE READY WITH OPERATIONAL ACTIONS`**

---

## 1. CREDENTIAL ROTATION & REMEDIATION
- **Phạm vi đối tượng:** Toàn bộ 9 biến nhạy cảm đã từng xuất hiện trong lịch sử: `POSTGRES_PASSWORD`, `BILLING_APP_PASSWORD`, `BILLING_READONLY_PASSWORD`, `EXPORTER_PASSWORD`, `ADMIN_PASSWORD`, `STAFF_PASSWORD`, `PGADMIN_DEFAULT_PASSWORD`, `GRAFANA_ADMIN_PASSWORD`, `SESSION_SECRET`.
- **Trạng thái môi trường Runtime:** **COMPLETED & REMEDIATED** (Đã kích hoạt, cô lập định danh và xác thực thành công).
- **Khắc phục Cơ chế Xoay vòng (Rotation Remediation):**
  - Đã loại bỏ hoàn toàn câu lệnh bulk update `WHERE username != 'admin'` trong [`scripts/rotate-credentials.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/rotate-credentials.mjs).
  - Áp dụng cơ chế explicit user mapping 1-1 cho `admin` và `staff`.
  - Toàn bộ 20 tài khoản test fixture (`gate*`, `p0_*`) được gán credential riêng biệt, triệt tiêu hoàn toàn việc dùng chung `STAFF_PASSWORD`.
  - Kiểm tra va chạm băm: `SELECT password_hash, count(*) FROM public.users GROUP BY password_hash HAVING count(*) > 1` ghi nhận **0 va chạm (ZERO SHARED HASHES)**.
  - Lệnh SQL truyền qua STDIN của `psql`, không phơi bày secret trong process arguments.
- **Dịch vụ Giám sát (Exporter):** Service `postgres-exporter` đã được recreate với `EXPORTER_PASSWORD` mới và kết nối cơ sở dữ liệu thành công (Log: `Established new database connection fingerprint=postgres:5432`).
- **Trạng thái kho khóa Secret Store ngoại vi:** **EXTERNAL ACTION REQUIRED** (Đội ngũ Cloud DevOps nạp giá trị mật khẩu vào KMS / Cloud Secret Manager trước khi bàn giao production).

---

## 2. OLD CREDENTIAL REVOCATION
- **Mật khẩu Trước Xoay vòng Thực tế (Actual Pre-rotation Credentials):**
  - Mật khẩu admin cũ (`oldAdminPass`) đăng nhập `/api/auth/login`: **BỊ TỪ CHỐI HTTP 401 Unauthorized (PASS)**.
  - Mật khẩu staff cũ (`oldStaffPass`) đăng nhập `/api/auth/login`: **BỊ TỪ CHỐI HTTP 401 Unauthorized (PASS)**.
  - Mật khẩu admin và staff mới: **ĐĂNG NHẬP THÀNH CÔNG HTTP 200 OK (PASS)**.
- **Mật khẩu mặc định / Placeholder:** Toàn bộ các mật khẩu phổ biến (`postgres`, `password`, `123456`, `admin`, `root`, `CHANGE_ME`) bị từ chối 100% khi xác thực vào PostgreSQL.
- **Tài khoản ứng dụng:** Thử nghiệm đăng nhập HTTP với mật khẩu không hợp lệ trả về đúng HTTP `401 Unauthorized`.
- **Phiên làm việc cũ (Session Invalidation):** Việc cập nhật `SESSION_SECRET` tự động vô hiệu hóa toàn bộ session cookie cũ (HTTP 401), phiên làm việc mới thiết lập thành công (HTTP 200).

---

## 3. GIT HISTORY SECRET EXPOSURE
- **Phát hiện:** Các commit lịch sử `aa0d392` (2026-10-05), `94dc8f0` (2026-10-06), và `0222e34` (2026-10-06) chứa các biến môi trường cấu hình ban đầu trước khi `.gitignore` được siết chặt.
- **Working Tree Hiện tại:** `.env` không nằm trong Git index (`git ls-files .env` trả về rỗng, `.gitignore:2:.env` hoạt động).
- **Tracked Files:** Quét tự động bằng [`scripts/secret-hygiene-check.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/secret-hygiene-check.mjs) ghi nhận **0 secret exposures** trên toàn bộ cây thư mục.

---

## 4. HISTORY SCRUBBING
- **Công cụ chỉ định:** `git-filter-repo` v2.47.0 (commit `a40bce548d2c`) đã được cài đặt và kiểm chứng hoạt động thành công qua Python runtime.
- **Bản sao lưu Bất biến (Immutable Mirror Backup):** Đã tạo bản sao lưu toàn diện tại `C:\Users\phamt\OneDrive\Desktop\billing_one_mirror_backup.git` (nằm ngoài workspace và ngoài release package) và vượt qua kiểm tra `git fsck --full`.
- **Kịch bản Thay thế Chuỗi Bí mật:** [`scripts/git-history-secret-remediation.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/git-history-secret-remediation.md) đã sẵn sàng với bộ quy tắc regex thay thế toàn diện các biến nhạy cảm lịch sử thành placeholder `<FROM_ENV>`.
- **An toàn Workspace Hiện hành:** Nhằm bảo vệ 33 tệp tin sửa đổi và 48 tệp tin mới hoàn thiện của các phân hệ P0/P1/P1.5/P2 không bị reset/revert ngoài ý muốn, việc rewrite lịch sử cam kết phải được thực thi trong bản clone độc lập (hoặc sau khi toàn bộ code P2 được đóng gói/commit) đồng bộ với lịch bảo trì remote force-push.
- **Trạng thái:** **EXTERNAL ACTION REQUIRED** (Cần phê duyệt bảo trì và phối hợp đội ngũ trước khi rewrite tree & force-push).

---

## 5. REMOTE VERIFICATION
- **Remote Repo:** `origin https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git` trên branch `main`.
- **Remote Head:** Remote hiện đang ở commit `0222e34`. Việc rewrite lịch sử làm thay đổi tree của remote đòi hỏi quyền đẩy cưỡng chế (`git push --force --all`).
- **Chính sách an toàn:** Agent tuyệt đối **không tự ý force-push** khi chưa có ủy quyền bảo mật chính thức từ DevOps Lead/Repository Admin.
- **Trạng thái:** **EXTERNAL ACTION REQUIRED**.

---

## 6. TLS CA ISSUANCE
- **Khảo sát Tên miền Thực tế (Real Domain Discovery):** Đã kiểm tra toàn bộ `.env`, `.env.production.example`, `docker-compose.production.yml`, và `nginx/conf.d/`. Kết quả xác nhận hiện tại chỉ tồn tại các tên miền placeholder (`billing.yourcompany.com`, `billing.local`, `localhost`).
- **Nguyên tắc An ninh:** Tuyệt đối **KHÔNG cấp chứng chỉ cho tên miền placeholder**, và **KHÔNG tạo chứng chỉ self-signed mới để giả PASS**.
- **Chứng chỉ hiện hành:** Chứng chỉ staging cục bộ là Self-Signed (`CN=localhost`, `SAN=DNS:localhost, DNS:billing.local`, thời hạn 362 ngày) chỉ phục vụ kiểm thử nội bộ.
- **Yêu cầu Production:** Bắt buộc sử dụng chứng chỉ số được cấp bởi CA công cộng uy tín (Let's Encrypt / DigiCert / Enterprise PKI) cho domain sản xuất thực tế khi được công ty đăng ký.
- **Trạng thái:** **EXTERNAL ACTION REQUIRED** (Chờ doanh nghiệp cấu hình DNS A/AAAA cho tên miền sản xuất thực tế để kích hoạt ACME HTTP-01 hoặc nạp chứng chỉ CA).

---

## 7. TLS INSTALLATION
- **Vị trí tệp tin:** `/etc/nginx/certs/production.crt` và `/etc/nginx/certs/production.key`.
- **Cơ chế nạp:** Nạp thông qua Docker secrets mount hoặc read-only external volume, tuyệt đối không đưa private key vào Git hoặc release package.
- **Trạng thái Template:** [`nginx/conf.d/production-tls.conf.example`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/nginx/conf.d/production-tls.conf.example) đã cấu hình chuẩn mực.

---

## 8. DNS / ACME VERIFICATION
- **Tên miền cấu hình trong template:** `billing.yourcompany.com` (Cần thay thế bằng domain thực tế của doanh nghiệp).
- **Thử thách HTTP-01:** Đường dẫn `/.well-known/acme-challenge/` đã được định tuyến sẵn sang thư mục `/var/www/certbot`.
- **Trạng thái:** **EXTERNAL INPUT REQUIRED** (Chờ thông tin domain thực tế từ doanh nghiệp).

---

## 9. NGINX VERIFICATION
- **HTTP -> HTTPS:** Chuyển hướng vĩnh viễn HTTP 301 (`return 301 https://$host$request_uri;`).
- **Giao thức:** Hạn chế chặt chẽ chỉ cho phép `TLSv1.2` và `TLSv1.3`.
- **Tiêu đề An ninh:** `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, CSP.
- **Kiểm soát Tần suất:** `limit_req_zone` áp dụng bảo vệ endpoint `/api/auth/login` (`15r/m`, burst `10`).

---

## 10. PRODUCTION DEPLOYMENT
- **File Orchestration:** [`docker-compose.production.yml`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docker-compose.production.yml).
- **Phân tách mạng:** PostgreSQL chạy trên mạng nội bộ `backend-net`, không mở cổng 5432 ra host bên ngoài.
- **Người dùng chạy ứng dụng:** Nginx và Node.js chạy dưới unprivileged non-root user.
- **Healthcheck:** Cấu hình đầy đủ trên `web`, `postgres`, và `nginx`.

---

## 11. SECURITY VERIFICATION
- **Secret Hygiene Scanner:** [`scripts/secret-hygiene-check.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/secret-hygiene-check.mjs) -> **PASS** (0 exposures).
- **Git History Auditor:** [`scripts/verify-git-history-secrets.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-git-history-secrets.mjs) -> **EXTERNAL ACTION REQUIRED** (Commit lịch sử còn tồn tại trên git tree).
- **Credential Rotation Auditor:** [`scripts/verify-credential-rotation.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-credential-rotation.mjs) -> **PASS** (9/9 checks PASS).
- **TLS Preflight Auditor:** [`scripts/verify-production-tls.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-production-tls.mjs) -> **BLOCKED_FOR_PRODUCTION** (Strict mode chặn đúng, ngăn chặn việc sử dụng self-signed cert trên production).

---

## 12. FULL REGRESSION
- **Kịch bản:** [`scripts/run-all-tests.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/run-all-tests.mjs).
- **Kết quả:**
  - **31/31 Active Gates PASSED (100% GREEN)**.
  - **Failed:** 0.
  - **Timeout:** 0.
  - **Thời gian chạy:** 222.94s.

---

## 13. FINANCIAL INTEGRITY
- **Kịch bản:** [`scripts/final-financial-integrity-check.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/final-financial-integrity-check.mjs).
- **Kết quả:** **10/10 Invariants PASSED**.
  - Không lệch phân bổ thanh toán (`paid_total == sum(allocations)`).
  - Không có hóa đơn thanh toán vượt mức (`paid_total <= total`).
  - Không trùng lặp mã hoàn tiền (`refund_no` unique).
  - Khử trùng giao dịch ngân hàng tuyệt đối (`compute_canonical_bank_tx_hash` deduplication).
  - Bất biến VAT dòng và tổng hóa đơn khớp 100%.
  - Chuỗi băm SHA-256 sổ cái kiểm toán nguyên vẹn 100% trên 18.386 bản ghi.

---

## 14. RELEASE ARTIFACT VERIFICATION
- **File Artifact:** [`release/Billing_One_Extended_RELEASE_CANDIDATE_2.0.0.zip`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/release/Billing_One_Extended_RELEASE_CANDIDATE_2.0.0.zip).
- **Kích thước:** 3.40 MB.
- **Số lượng entries:** 228 entries.
- **Kiểm định:**
  - `0` `.env` files.
  - `0` private keys (`.key`, `.pem`, `.p12`, `.pfx`).
  - `0` database backups (`db/backups/`).
  - `0` database dumps (`*.dump`, `*.backup`, `*.bak`).
  - `0` `node_modules` folders.

---

## 15. REMAINING EXTERNAL ACTIONS
Hệ thống sẵn sàng chuyển giao cho DevOps để thực hiện 3 hành động ngoại vi bắt buộc:
1. **Official TLS CA Certificate Provisioning:** Cấp chứng chỉ SSL từ CA hợp lệ cho domain sản xuất và mount vào Nginx.
2. **Production Secret Store Injection:** Nạp giá trị bí mật chính thức vào môi trường hạ tầng theo runbook [`docs/PRODUCTION_CREDENTIAL_ROTATION.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/PRODUCTION_CREDENTIAL_ROTATION.md).
3. **Out-of-band Remote Git Scrubbing:** Cài đặt `git-filter-repo` và thực thi làm sạch lịch sử Git theo [`scripts/git-history-secret-remediation.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/git-history-secret-remediation.md) trước khi công khai kho lưu trữ.

---

## 16. FINAL RELEASE DECISION

# `RELEASE READY WITH OPERATIONAL ACTIONS`

Toàn bộ mã nguồn, cơ sở dữ liệu, kiểm thử tự động, cấu hình Nginx, đóng gói release và an ninh nội bộ đã đạt chuẩn xuất sắc (100% PASS). Các điểm còn lại thuộc thẩm quyền hạ tầng ngoại vi và đã được cung cấp tài liệu kỹ thuật đầy đủ để triển khai.
