# BÁO CÁO PHÂN TÍCH & KẾ HOẠCH KHẮC PHỤC BÍ MẬT LỊCH SỬ GIT
# SECURITY SECRET REMEDIATION REPORT & SPECIFICATION

> **Document Version:** 1.0.0 — Production Readiness  
> **Target System:** `Billing_One Extended`  
> **Classification:** Security Operations / Hardening Specification  
> **Status:** `OPERATIONAL ACTION REQUIRED`

---

## 1. MỤC ĐÍCH & PHẠM VI (PURPOSE & SCOPE)

Tài liệu này xác định chi tiết kết quả rà soát an ninh bí mật (Secret Hygiene Forensic Analysis) trên toàn bộ kho lưu trữ `Billing_One Extended`, phân định ranh giới rõ ràng giữa:
1. **Trạng thái Cây làm việc Hiện hành (Current Working Tree Status):** Đã được làm sạch, kiểm chứng tự động và bảo vệ tuyệt đối.
2. **Lịch sử Commit Git (Historical Git Exposure):** Các commit lịch sử ban đầu có chứa vết thông tin nhạy cảm.
3. **Thủ tục Vận hành Ngoại vi Bắt buộc (External Operational Actions):** Các bước thu hồi, xoay vòng mật khẩu (Credential Rotation) và thanh lọc lịch sử Git (Git History Scrubbing) trước khi golive.

---

## 2. HIỆN TRẠNG CÂY LÀM VIỆC HIỆN HÀNH (CURRENT TREE AUDIT)

Hệ thống đã triển khai công cụ quét an ninh tự động [`scripts/secret-hygiene-check.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/secret-hygiene-check.mjs) và công cụ tiền kiểm tra phát hành [`scripts/production-preflight.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/production-preflight.mjs). Kết quả xác nhận:

- **File `.env` Môi trường Runtime:**
  - Hoàn toàn **KHÔNG BỊ TRACK** bởi Git (`git ls-files .env` trả về chuỗi rỗng).
  - Được bảo vệ bởi cấu hình loại trừ cấp cao trong `.gitignore` (`.env`, `.env.*`, ngoại trừ `.env.example` và `.env.production.example`).
  - Được cấu hình loại trừ tuyệt đối khỏi mọi quy trình đóng gói artifact release.
- **File Mẫu `.env.example` & `.env.production.example`:**
  - 100% các trường bí mật chỉ chứa ký hiệu placeholder an toàn (`CHANGE_ME_*`).
  - Không có bất kỳ credential, chuỗi băm, hoặc khóa bí mật thực tế nào.
- **Toàn bộ Mã nguồn và Tài liệu Theo dõi (Tracked Source & Docs):**
  - Đã rà soát và thanh lọc toàn bộ các chuỗi hash mật khẩu mẫu (ví dụ: tài liệu [`docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md) đã thay thế thành `<FROM_ENV>`).
  - Không còn bất kỳ private key (`BEGIN RSA/OPENSSL PRIVATE KEY`), literal JWT, hay connection string chứa mật khẩu nào trong working tree.

---

## 3. PHÁT HIỆN LỊCH SỬ GIT (HISTORICAL GIT EXPOSURE FORENSICS)

### 3.1. Các Commit Lịch sử Chứa Vết Credential
Phân tích lịch sử commit (`git log -S`) xác định các commit lịch sử ban đầu của dự án đã từng ghi nhận cấu hình môi trường hoặc tài liệu hướng dẫn:
- Commit `aa0d392` (`feat(app): billing web app with PostgreSQL and pgAdmin via docker-compose`): Khởi tạo khung docker-compose ban đầu.
- Commit `94dc8f0` (`security: harden containers, networks, credentials and database roles`): Triển khai các kịch bản hardening H1-H6.
- Commit `0222e34` (`docs: add startup and assessment guides`): Bổ sung hướng dẫn vận hành chứa ví dụ thiết lập ban đầu.
- Commit `459d45a`: Ghi nhận tài liệu nghiệm thu kỹ thuật ban đầu.

### 3.2. Danh mục Biến Môi trường Nhạy cảm Cần Xoay vòng (Compromised Variables Requiring Rotation)
Mọi credential đã từng xuất hiện trong lịch sử Git đều phải được coi là đã bị phơi bày theo tiêu chuẩn an ninh thông tin doanh nghiệp (Zero Trust Secret Management). Bắt buộc phải thực hiện xoay vòng (Rotate) toàn bộ 9 biến sau:

1. `POSTGRES_PASSWORD` — Mật khẩu tài khoản superuser PostgreSQL (`postgres`).
2. `BILLING_APP_PASSWORD` — Mật khẩu kết nối ứng dụng web chính (`billing_app`).
3. `BILLING_READONLY_PASSWORD` — Mật khẩu tài khoản chỉ đọc báo cáo (`billing_readonly`).
4. `EXPORTER_PASSWORD` — Mật khẩu tài khoản Prometheus metrics collector (`exporter`).
5. `ADMIN_PASSWORD` — Mật khẩu đăng nhập quản trị ứng dụng web (`admin`).
6. `STAFF_PASSWORD` — Mật khẩu đăng nhập nhân viên kế toán (`staff`).
7. `PGADMIN_DEFAULT_PASSWORD` — Mật khẩu giao diện pgAdmin4 nội bộ.
8. `GRAFANA_ADMIN_PASSWORD` — Mật khẩu tài khoản quản trị Grafana.
9. `SESSION_SECRET` — Khóa bí mật băm ký cookie phiên Express session.

---

## 4. NGUYÊN TẮC BẢO TOÀN LỊCH SỬ & QUY CHUẨN THAO TÁC AN TOÀN

> [!CAUTION]
> **TUYỆT ĐỐI KHÔNG TỰ Ý REWRITE LỊCH SỬ GIT BẰNG FORCE-PUSH KHI CHƯA ĐƯỢC ỦY QUYỀN.**  
> Thao tác force-push (`git push --force`) làm gián đoạn toàn bộ các nhánh làm việc của các lập trình viên khác, phá vỡ commit tree và có nguy cơ gây mất mát dữ liệu nghiêm trọng. Việc rewrite lịch sử Git dùng chung bắt buộc phải là một **Hành động Vận hành Có Kế hoạch (Planned Operational Action)**.

---

## 5. QUY TRÌNH THỦ TỤC THANH LỌC LỊCH SỬ GIT (GIT HISTORY SCRUBBING RUNBOOK)

Đội ngũ DevOps / Security Engineer thực hiện quy trình chuẩn mực ngoài giờ (Maintenance Window) theo các bước:

### Bước 1: Tạo Bản Sao Lưu An Toàn (Bare Backup)
```bash
git clone --mirror https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git billing_one_backup.git
```

### Bước 2: Sử dụng `git-filter-repo` để Thanh Lọc Vĩnh Viễn
Tạo file biểu thức thay thế `expressions.txt`:
```text
regex:(?i)(ADMIN_PASSWORD=)['"]?[a-f0-9]{32,}['"]?==>\1CHANGE_ME_ADMIN_PASSWORD
regex:(?i)(STAFF_PASSWORD=)['"]?[a-f0-9]{32,}['"]?==>\1CHANGE_ME_STAFF_PASSWORD
regex:(?i)(POSTGRES_PASSWORD=)['"]?[a-zA-Z0-9_\-]{8,}['"]?==>\1CHANGE_ME_POSTGRES_PASSWORD
regex:(?i)(SESSION_SECRET=)['"]?[a-zA-Z0-9_\-]{16,}['"]?==>\1CHANGE_ME_SESSION_SECRET
```
Thực thi lệnh thanh lọc:
```bash
git-filter-repo --replace-text expressions.txt
```

### Bước 3: Kiểm Chứng Tính Sạch Sẽ Sau Khi Viết Lại
```bash
git log -S "BILLING_APP_PASSWORD" --oneline
node scripts/secret-hygiene-check.mjs
```

### Bước 4: Điều Phối & Đẩy Lên Remote (Coordinated Force-Push)
- Thông báo cho toàn bộ thành viên clone lại kho mã nguồn mới.
- Thực hiện cập nhật remote:
```bash
git push origin --force --all
git push origin --force --tags
```

---

## 6. QUY TRÌNH XOAY VÒNG BÍ MẬT SẢN XUẤT (CREDENTIAL ROTATION)

Chi tiết đầy đủ các bước xoay vòng theo thứ tự phụ thuộc được đặc tả tại tài liệu:
👉 [`docs/PRODUCTION_CREDENTIAL_ROTATION.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/PRODUCTION_CREDENTIAL_ROTATION.md)

---

## 7. KẾT LUẬN & ĐÁNH GIÁ TRẠNG THÁI (STATUS DETERMINATION)

- **Cây làm việc hiện tại:** `PASS (100% SANITIZED)`
- **Lịch sử Git:** `HISTORICAL EXPOSURE DOCUMENTED`
- **Hành động cần thiết:** `EXTERNAL CREDENTIAL ROTATION & GIT SCRUBBING REQUIRED`
- **Xếp loại Trạng thái:** **`RELEASE READY WITH OPERATIONAL ACTIONS`**
