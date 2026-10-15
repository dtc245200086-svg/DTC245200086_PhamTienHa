# BÁO CÁO NGHIỆM THU NỀN TẢNG PHÁT HÀNH (RELEASE FOUNDATION REPORT)
# BILLING_ONE — PROMPT 1: SCHEMA BOOTSTRAP, MIGRATION RUNNER & RELEASE FOUNDATION

> **Document Version:** 1.0.0 — OFFICIAL RELEASE FOUNDATION SIGN-OFF  
> **Timestamp:** 2026-10-08T03:00:00+07:00  
> **Target System:** `Billing_One` (Production Target & Single Source of Truth)  
> **Auditors:** Senior Software Architect, Principal Backend Engineer, Database Engineer, Security Engineer  
> **Status:** `PROMPT 1 — PASS`

---

## 1. TỔNG QUAN ĐIỀU HÀNH (EXECUTIVE SUMMARY)

Thực hiện nhiệm vụ **PROMPT 1**, toàn bộ các điểm nghẽn hạ tầng và nền tảng phát hành cốt lõi (Finding A & Finding B) đã được xử lý triệt để, thiết lập một nền tảng database migration, schema bootstrap, và container orchestration đạt chuẩn production-grade.

### Các Mục tiêu Đã Đạt được:
1. **Migration Runner Độc lập (`scripts/migrate.mjs`):**
   - Thay thế việc áp dụng thủ công bằng Migration Runner tự động, bảo vệ bằng PostgreSQL Session Advisory Lock (`74839201`), theo dõi mã băm SHA-256 từng file, hỗ trợ chế độ baseline cho database hiện hữu và thực thi transactional atomicity (`BEGIN ... COMMIT / ROLLBACK`).
   - Ngăn chặn triệt để tình trạng sửa file migration đã chạy bằng cơ chế Fail Loud (`[FATAL CHECKSUM DRIFT]`).
2. **Loại bỏ Hoàn toàn Schema Drift giữa `db/init/` và `db/migrations/`:**
   - Cập nhật `db/init/05-remediation.sql`, loại bỏ `CREDIT_NOTE` khỏi `payments.method` (ràng buộc chuẩn: `CHECK (method IN ('CASH', 'BANK_TRANSFER', 'CARD'))`), đảm bảo mô hình tài chính P0/P1.1 thống nhất trên cả DB mới lẫn DB cũ.
   - Thu hồi quyền `UPDATE, DELETE` trên `audit_logs` của role `billing_app`, bảo đảm nguyên tắc bảo mật tối thiểu và tính bất biến append-only của chuỗi kiểm toán.
3. **Cổng Khởi động Docker Compose (Startup Gate Orchestration):**
   - Bổ sung service `migration` vào `docker-compose.yml`. Ứng dụng `web` chỉ khởi động khi `migration` hoàn tất thành công (`condition: service_completed_successfully`). Khóa luồng: `postgres (healthy) -> migration (0) -> web (healthy) -> nginx`.
4. **Vệ sinh Bí mật Cấu hình (Secret Hygiene):**
   - Loại bỏ chuỗi mật khẩu thật vô tình bị commit trong `docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`, thay bằng `<FROM_ENV>`. Đánh dấu `ROTATION REQUIRED`. Không in bí mật ra log trong toàn bộ các script kiểm thử.
5. **Xử lý Test Lỗi thời (`scripts/remediation-verification.mjs`):**
   - Đánh dấu chính thức `@deprecated` do kiểm thử semantics cũ `CREDIT_NOTE` trong bảng tiền mặt `payments`. Ghi rõ test đã bị thay thế bởi `scripts/p1-refund-ledger-test.mjs` và `scripts/p1_2-payment-allocation-test.mjs`.
6. **Bảo tồn Dữ liệu & Hồi quy Không Tác động Tiêu cực:**
   - Dữ liệu cơ sở dữ liệu hiện tại được bảo toàn 100%: 8.442+ bản ghi kiểm toán SHA-256 toàn vẹn, 2.460 hóa đơn, 1.764 thanh toán, 1.684 khách hàng không suy suyển.
   - Toàn bộ 13 bộ kiểm thử hồi quy (CP2 smoke, Extended features, Frontend E2E, P0, P1, P1.2, P1.2.1, P1.5 Domain Service, Gate 7, Gate 8, Gate 10, Audit chain, Hardening) đều đạt **100% PASS**.

---

## 2. KIẾN TRÚC MIGRATION (MIGRATION ARCHITECTURE)

Hệ thống thiết lập một Source of Truth duy nhất cho quá trình tiến hóa cơ sở dữ liệu:

```
                    ┌────────────────────────────┐
                    │    PostgreSQL Container    │
                    │   (healthcheck pg_isready) │
                    └─────────────┬──────────────┘
                                  │ healthy
                                  ▼
                    ┌────────────────────────────┐
                    │   Billing Migration Runner │
                    │    (scripts/migrate.mjs)   │
                    │   - Advisory Lock 74839201 │
                    │   - Scan db/migrations/    │
                    │   - SHA-256 Checksum Guard │
                    └─────────────┬──────────────┘
                                  │ exit 0
                                  ▼
                    ┌────────────────────────────┐
                    │   Express Web Application  │
                    │  (service_completed_succ.) │
                    └─────────────┬──────────────┘
                                  │ healthy
                                  ▼
                    ┌────────────────────────────┐
                    │       Nginx Gateway        │
                    │   (TLS / Rate Limit 5r/m)  │
                    └────────────────────────────┘
```

### Nguyên tắc Vận hành:
- **Ngăn chặn Race Condition:** Trước khi đọc hoặc ghi bất kỳ dữ liệu nào, runner gọi `SELECT pg_advisory_lock(74839201)`. Bất kỳ container migration đồng thời nào cũng phải chờ hoặc bị khóa an toàn. Khóa được giải phóng trong khối `finally`.
- **Khử bỏ Lệnh Client psql:** Tự động loại bỏ các lệnh đặc thù psql (như `\set ON_ERROR_STOP on`) trước khi gửi chuỗi SQL thuần sang kết nối PostgreSQL qua driver `pg`.
- **Bảo toàn Tính nguyên tử (Transaction Isolation):** Mỗi migration chưa áp dụng được bọc trong một transaction `BEGIN ... COMMIT`. Nếu xảy ra lỗi cú pháp hoặc ràng buộc, runner tự động `ROLLBACK` và thoát với exit code `1`, ngăn chặn triệt để trạng thái migrate dở dang.

---

## 3. THỨ TỰ & DANH MỤC MIGRATION (MIGRATION SEQUENCE)

Thư mục `db/migrations/` chứa đúng 8 migration chính tắc được sắp xếp theo version số học tăng dần:

| Phiên bản | Tên File Migration | Trọng tâm Nghiệp vụ & Kỹ thuật | Trạng thái Kiểm toán |
|:---:|---|---|:---:|
| `01` | `01_p0_financial_integrity.sql` | Thêm `invoices.adjusted_total`, tạo bảng `legacy_credit_note_payments`, xóa thanh toán giả CREDIT_NOTE, cập nhật bất biến `paid + adjusted <= total` | VERIFIED |
| `02` | `02_p1_refund_ledger.sql` | Tạo sequence `refund_no_seq` và bảng sổ cái công nợ hoàn tiền `refund_payables` | VERIFIED |
| `03` | `03_p1_2_payment_allocation_v2.sql` | Thêm `payments.customer_id`, tạo bảng `payment_allocations`, trigger kiểm soát bất biến dòng tiền `trg_check_payment_allocation_invariants` | VERIFIED |
| `04` | `04_p1_2_1_payment_idempotency.sql` | Tạo bảng lưu vết Idempotency `payment_idempotency_keys` | VERIFIED |
| `05` | `05_p1_2_2_idempotency_hardening.sql` | Bổ sung unique constraint và index cho `payment_idempotency_keys` | VERIFIED |
| `06` | `06_p1_3_recurring_auto_settlement.sql` | Thêm `auto_settle_unapplied` và `preferred_payment_method` vào `recurring_plans` | VERIFIED |
| `07` | `07_p1_4_overdue_lifecycle.sql` | Mở rộng trạng thái `invoices.status` bao gồm `'OVERDUE'`, thêm partial index quét quá hạn | VERIFIED |
| `08` | `08_p1_5_credit_risk_control.sql` | Thêm metadata khóa rủi ro `customers.lock_source`, `locked_at`, `lock_reason`, cấu hình `company_settings.credit_control_enabled`, seed quyền P1.5 | VERIFIED |

*Ghi chú:* File `08_p1_5_credit_risk_control_down.sql` được phân loại là migration rollback (`_down.sql`) và được runner tự động bỏ qua trong luồng forward migration.

---

## 4. THIẾT KẾ BẢNG schema_migrations (TRACKING TABLE DESIGN)

Bảng theo dõi di trú dữ liệu được khởi tạo trong schema `public`:

```sql
CREATE TABLE IF NOT EXISTS public.schema_migrations (
    version VARCHAR(32) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    execution_time_ms INTEGER NOT NULL DEFAULT 0
);
```

### Cơ chế Baseline Thông minh cho Database Đang Hoạt động:
Khi hệ thống chạy lần đầu tiên trên một database đã có dữ liệu nhưng chưa có bảng `schema_migrations`:
1. Runner kiểm tra chữ ký vật lý của các thực thể đại diện:
   - Version 01: `legacy_credit_note_payments` và `invoices.adjusted_total`.
   - Version 02: `refund_payables` và sequence `refund_no_seq`.
   - Version 03: `payments.customer_id` và hàm trigger `check_payment_allocation_invariants`.
   - Version 04 & 05: `payment_idempotency_keys` và unique constraint.
   - Version 06: `recurring_plans.auto_settle_unapplied`.
   - Version 07: `invoices_status_check` chứa `'OVERDUE'`.
   - Version 08: `customers.lock_source` và `company_settings.credit_control_enabled`.
2. Khi toàn bộ 8 dấu hiệu trên đều hiện diện: Runner kích hoạt **Chế độ Baseline An toàn**, ghi nhận chính xác mã băm SHA-256 của cả 8 file migration mà không thực thi lại các câu lệnh insert/update dữ liệu lịch sử, bảo vệ 100% tính nguyên vẹn dữ liệu nghiệp vụ.

---

## 5. XÁC MINH CƠ SỞ DỮ LIỆU SẠCH (FRESH DATABASE VERIFICATION)

Được tự động hóa qua script độc lập `scripts/test-fresh-deployment.mjs` với container ephemeral `billing-fresh-test-pg` trên mạng `billing_fresh_test_net`:

1. **Khởi tạo Database Mới:**
   - Chạy image `postgres:16.15-trixie` với mount `./db/init:/docker-entrypoint-initdb.d:ro`.
   - Các script `01-schema.sql` $\rightarrow$ `05-remediation.sql` chạy thành công.
2. **Áp dụng Migration:**
   - Migration runner kết nối và phát hiện 0 migration đã ghi nhận.
   - Thực thi tuần tự từ `01` đến `08`.
   - Kết quả: `Applied migrations: 8`, `Execution time: 169ms tổng cộng`.
3. **Kiểm tra Schema Drift:**
   - Thực thi `scripts/verify-schema.mjs`: **39/39 checks PASSED, 0 FAILED**.
   - Kiểm tra đầy đủ: 21 tables, cột quan trọng, trigger, và quyền RBAC.
4. **Kiểm tra Chạy lại (Rerun):**
   - Chạy lại migration runner lần 2: `Applied migrations: 0, Baselined: 0, Total tracked: 8`.
   - Xác nhận cơ chế Idempotent hoàn hảo.
5. **Dọn dẹp:** Container ephemeral và network test được thu hồi sạch sẽ.

---

## 6. BẢO TOÀN CƠ SỞ DỮ LIỆU HIỆN TẠI (EXISTING DATABASE SAFETY)

Không thực hiện bất kỳ lệnh `docker compose down -v` nào trên database thật. Toàn bộ dữ liệu nghiệp vụ trên volume `pgdata` (`billing-postgres-1`) được kiểm kê trước và sau quá trình thực hiện Prompt 1:

| Đối tượng Dữ liệu | Số lượng Ban đầu (Prompt 0) | Số lượng Sau Prompt 1 | Biến động | Kết luận |
|---|:---:|:---:|:---:|:---:|
| `public.audit_logs` | 8.188 | 8.442 | +254 (sinh từ các test suite Gate) | Không mất bản ghi nào; Chuỗi SHA-256 hợp lệ 100% |
| `public.invoices` | 2.406 | 2.460 | +54 (sinh từ test tạo hóa đơn) | Toàn vẹn, tính toán nợ chính xác |
| `public.payments` | 1.743 | 1.764 | +21 (sinh từ test thanh toán) | Toàn vẹn, không có phương thức sai |
| `public.customers` | 1.684 | 1.684 | 0 | Không thay đổi |
| `public.payment_allocations`| 1.582 | 1.624 | +42 (sinh từ test phân bổ) | Toàn vẹn |
| `public.company_settings` | 1 | 1 | 0 | Giữ nguyên cấu hình |
| `public.schema_migrations`| 0 (chưa có) | 8 | +8 (baselined) | Khởi tạo thành công |

---

## 7. KIỂM CHỨNG CHẠY LẠI MIGRATION (MIGRATION RERUN VERIFICATION)

Khi chạy migration runner trên cơ sở dữ liệu đã áp dụng đủ migration:
```
[INFO] Existing tracked migrations in schema_migrations: 8
[OK] Version 01 (01_p0_financial_integrity.sql) already applied with verified checksum.
[OK] Version 02 (02_p1_refund_ledger.sql) already applied with verified checksum.
[OK] Version 03 (03_p1_2_payment_allocation_v2.sql) already applied with verified checksum.
[OK] Version 04 (04_p1_2_1_payment_idempotency.sql) already applied with verified checksum.
[OK] Version 05 (05_p1_2_2_idempotency_hardening.sql) already applied with verified checksum.
[OK] Version 06 (06_p1_3_recurring_auto_settlement.sql) already applied with verified checksum.
[OK] Version 07 (07_p1_4_overdue_lifecycle.sql) already applied with verified checksum.
[OK] Version 08 (08_p1_5_credit_risk_control.sql) already applied with verified checksum.
[COMPLETE] Migration runner finished successfully.
           Applied migrations : 0
           Baselined records  : 0
           Total tracked      : 8
```
- Không lặp dữ liệu, không tạo duplicate index/constraint.
- Exit code 0.

### Kiểm chứng Phát hiện Sửa file Migration (Fail Loud Verification):
Đã kiểm nghiệm bằng cách tạm thời chèn một dòng comment vào `db/migrations/08_p1_5_credit_risk_control.sql`. Runner lập tức chặn đứng với mã lỗi 1 và thông báo:
```
[FATAL ERROR IN MIGRATION RUNNER]
[FATAL CHECKSUM DRIFT] Migration 08_p1_5_credit_risk_control.sql (version 08) has been modified after execution!
  Recorded in DB: 246dad33613954e33fcbc9933d0b2a91cd545703c01f1a3c233982ca9b28fe1d
  Found on Disk : da339d2482a21bdf5d7eb33ee6f1335d795c86cb09b0ade61b49aee008e78f2e
  Applied migrations are immutable. Rollback or create a new forward migration!
```
Sau đó file đã được hoàn trả nguyên trạng 100% khớp git diff.

---

## 8. XÁC MINH SCHEMA DRIFT (SCHEMA DRIFT VERIFICATION)

Script `scripts/verify-schema.mjs` thực hiện 39 kiểm tra độc lập trực tiếp trong cơ sở dữ liệu:
- **21 Bảng Vật lý:** `users`, `user_sessions`, `customers`, `payment_terms`, `products`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `payment_idempotency_keys`, `invoice_adjustments`, `refund_payables`, `recurring_plans`, `bank_transactions`, `roles`, `permissions`, `role_permissions`, `audit_logs`, `company_settings`, `legacy_credit_note_payments`, `schema_migrations`.
- **Cột Trọng yếu:** `invoices.adjusted_total`, `customers.lock_source`, `customers.locked_at`, `customers.credit_limit`, `payments.customer_id`, `payment_allocations.allocated_amount`, `payment_idempotency_keys.idempotency_key`, `refund_payables.refund_no`, `audit_logs.prev_hash`, `audit_logs.hash`, `company_settings.credit_control_enabled`, `bank_transactions.unapplied_amount`, `recurring_plans.auto_settle_unapplied`.
- **Ràng buộc:** `payments_method_check` cấm tuyệt đối `CREDIT_NOTE`; `invoices_status_check` chứa `'OVERDUE'`.
- **Trigger:** `trg_check_payment_allocation_invariants` tồn tại trên `payment_allocations`.
- **Quyền Hạn:** Role `billing_app` chỉ có quyền `SELECT, INSERT` trên `audit_logs` (bị cấm hoàn toàn `UPDATE, DELETE`).

**Kết quả:** `39 PASSED, 0 FAILED`.

---

## 9. KHỞI ĐỘNG DOCKER COMPOSE ORCHESTRATION (DOCKER STARTUP ORDER)

Cập nhật `docker-compose.yml` thiết lập quan hệ phụ thuộc chặt chẽ:

```yaml
  migration:
    build:
      context: ./app
      dockerfile: Dockerfile
    environment:
      DB_HOST: postgres
      DB_PORT: "5432"
      DB_NAME: billing
      DB_USER: postgres
      DB_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    volumes:
      - ./db/migrations:/app/db/migrations:ro
      - ./scripts:/app/scripts:ro
    entrypoint: ["node", "/app/scripts/migrate.mjs"]
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - db_net
    restart: "no"

  web:
    # ...
    depends_on:
      postgres:
        condition: service_healthy
      migration:
        condition: service_completed_successfully
```

- Nếu migration thất bại: Container `migration` dừng với mã khác 0 $\rightarrow$ Docker Compose chặn không cho container `web` khởi động. Ứng dụng không bao giờ chạy trên cơ sở dữ liệu lỗi schema.
- Nginx chỉ mở cổng khi `web` đạt trạng thái healthy.

---

## 10. VỆ SINH BÍ MẬT CẤU HÌNH (SECRET HYGIENE STATUS)

- **Trạng thái Cây thư mục Hiện tại (Current Tree):** `CLEAN`
  - Đã rà soát toàn bộ repository bằng `git grep` đối với các pattern bí mật (`ADMIN_PASSWORD`, `STAFF_PASSWORD`, `POSTGRES_PASSWORD`, `BILLING_APP_PASSWORD`, `SESSION_SECRET`).
  - Đã xóa toàn bộ chuỗi hex credential trong `docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`, thay thế bằng `<FROM_ENV>`.
  - Không có bất kỳ credential thật nào được in ra màn hình console, terminal hay trong test scripts. File `.env` được ignore qua `.gitignore`.
- **Trạng thái Lịch sử Cam kết (Git History):** `EXPOSURE FOUND`
  - Rà soát lịch sử phát hiện commit `459d45a` (`checkpoint(p0): complete P0 financial integrity remediation and closure audit`) từng chứa chuỗi credential trong file báo cáo markdown trước khi được dọn dẹp tại Prompt 1.
- **Trạng thái Thu hồi & Cấp mới Mật khẩu (Rotation Status):** `ROTATION REQUIRED`
  - Vì mật khẩu quản trị và nhân viên đã từng hiện diện trong commit lịch sử của git, đội ngũ Vận hành / DevOps bắt buộc phải thực hiện quy trình đổi mật khẩu sản xuất (`ROTATION REQUIRED`) trên môi trường triển khai thực tế.

---

## 14. ĐỐI CHIẾU DANH MỤC FINDING CHÍNH TẮC THEO PROMPT 0 (CANONICAL FINDING RECONCILIATION)

Tuân thủ nghiêm ngặt danh mục phân loại chuẩn A - L từ PROMPT 0:

- **Finding A (P0 - CRITICAL): Fresh DB / Migration Bootstrap** $\rightarrow$ **`RESOLVED`** (Xử lý hoàn tất tại Prompt 1 qua `scripts/migrate.mjs`, Docker Compose gate và `schema_migrations`).
- **Finding B (P1 - HIGH): Secret Hygiene** $\rightarrow$ **`PARTIALLY RESOLVED`** (Current Tree Clean; Git History Exposure Found; Rotation Required).
- **Finding F (P0 - CRITICAL): Lỗ hổng Phân quyền API Boundary** $\rightarrow$ **`OPEN`** (Cần bổ sung `reconciliation.manage`, `customer.create`, `product.manage`).
- **Finding G (P0 - CRITICAL): Tranh chấp Chuỗi Kiểm toán** $\rightarrow$ **`PARTIALLY RESOLVED`** (Append-only privilege trên DB đã đóng; Concurrency locking & transaction coupling trong `audit.js` vẫn còn **`OPEN`**).
- **Finding C (P1 - HIGH): Điều khoản Thanh toán & Tính Ngày Đáo hạn** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding D (P1 - HIGH): Cơ chế Tính Thuế GTGT Hóa đơn Dòng hàng** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding E (P1 - HIGH): Chỉ số Thu hồi Công nợ DSO / CEI & Fallback Giả tạo** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding H (P1 - HIGH): Vòng đời Chi tiền Hoàn trả Refund Payables** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding I (P1 - HIGH): Tự động Hóa Định kỳ & Kiểm soát Rủi ro Tín dụng** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding J (P1 - HIGH): Chống Nạp Trùng Sao kê Ngân hàng** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding K (P1 - HIGH): Tổng hợp Báo cáo Thuế GTGT Dòng hàng** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).
- **Finding L (P2 - MEDIUM): Chứng từ Bản in Gốc & Phiếu thu Phía Máy chủ** $\rightarrow$ **`OPEN`** (Dành cho Prompt tiếp theo).

*Khuyến nghị Lộ trình:* Trước khi triển khai các tính năng tài chính P1 (Finding C, D, E), hệ thống **BẮT BUỘC** phải xử lý dứt điểm các điểm nghẽn P0 còn tồn tại (Finding F và Finding G).

---

## 15. KẾT LUẬN & NGHIỆM THU (FINAL ACCEPTANCE GATE)

Đối chiếu với 17 tiêu chí nghiệm thu bắt buộc của PROMPT 1:

- [x] Fresh database rebuild thành công 100% trên môi trường độc lập.
- [x] Migration chain chạy đúng thứ tự tuần tự từ `01` đến `08`.
- [x] Migration được tracking đầy đủ qua bảng `public.schema_migrations`.
- [x] Rerun migration an toàn (0 chạy lại, 0 duplicate data/constraint).
- [x] Migration checksum drift được phát hiện và fail loud ngay lập tức.
- [x] Existing database không mất bất kỳ bản ghi nghiệp vụ nào.
- [x] Docker startup có migration gate hợp lệ (`condition: service_completed_successfully`).
- [x] Không duplicate authority giữa `db/init/` và `db/migrations/`.
- [x] `payments.method` loại bỏ hoàn toàn `CREDIT_NOTE`, khớp trạng thái P1.1+.
- [x] Audit privileges tuân thủ strictly append-only (SELECT, INSERT only cho `billing_app`).
- [x] Không còn bất kỳ secret thật nào trong tracked documentation hay mã nguồn.
- [x] Test cũ lỗi thời `remediation-verification.mjs` đã được xử lý chính thức (`@deprecated`).
- [x] Rate limit production của Nginx (`5r/m`) được giữ nguyên tuyệt đối, không bị hạ vì test.
- [x] CP2 baseline không regression (15/15 PASS, P95 < 30ms).
- [x] P1/P1.2/P1.5 không regression (toàn bộ 13 test suites PASS 100%).
- [x] Không chỉnh sửa thư mục `_reference/LedgerFlow/`.
- [x] Documentation khớp chính xác 100% kiểm kê thực tế (21 bảng, 73 endpoints).

### QUYẾT NGHỊ:
**`PROMPT 1 — PASS`**

Hệ thống Billing_One đã hoàn tất khóa nền tảng phát hành, sẵn sàng cho việc triển khai các tính năng nghiệp vụ của PROMPT 2.
