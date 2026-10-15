# BILLING_ONE — BÁO CÁO NGHIỆM THU P1 SETTLEMENT & OPERATIONAL AUTOMATION
# P1 SETTLEMENT & OPERATIONAL AUTOMATION REPORT (FINDINGS H, I, J, K)

> **Phase:** P1 Settlement & Operational Automation  
> **Target System / Source of Truth:** `Billing_One`  
> **Financial Source of Truth:** PostgreSQL (`postgres:16.15-trixie`)  
> **Reference System:** `_reference/LedgerFlow/` (READ ONLY — 100% UNTOUCHED)  
> **Prerequisites:** `DAILY HEALTH CHECK — GREEN`, `P1 FINANCIAL CORE (C + D + E) — PASS`  
> **Scope Processed:** Finding H + Finding I + Finding J + Finding K  
> **Out of Scope (Explicitly Locked):** Finding L (Reserved for P2 Final Hardening)  
> **Status:** `P1 SETTLEMENT & OPERATIONAL AUTOMATION — PASS`  

---

## 1. TỔNG QUAN THỰC HIỆN VÀ NGUYÊN TẮC BẤT BIẾN

Toàn bộ 4 phát hiện còn lại của giai đoạn P1 đã được hoàn thành trong **một phase duy nhất** theo đúng thứ tự kiểm soát nghiêm ngặt:
$$\text{GATE H (Refund Settlement)} \longrightarrow \text{GATE I (Recurring Risk)} \longrightarrow \text{GATE J (Reconciliation Dedup/Batch)} \longrightarrow \text{GATE K (Item VAT Reporting)}$$

Mọi thay đổi đều tuân thủ các nguyên tắc bất biến:
1. **Source of Truth:** `Billing_One` là hệ thống duy nhất; thư mục `_reference/LedgerFlow/` giữ nguyên vẹn 100% không chỉnh sửa.
2. **Toàn vẹn Cơ sở Dữ liệu:** Không viết lại hay sửa đổi checksum các migration lịch sử (01–09). Tiến hành tiến hóa schema qua migration thuận (forward migration) `10_p1_settlement_automation.sql`.
3. **Số học Tài chính Bất biến:** Không dùng số thực (floating point) làm nguồn tính toán tiền tệ; 100% phép toán sử dụng `NUMERIC(14, 2)` và `NUMERIC(5, 4)` trong PostgreSQL và xử lý chuỗi số thập phân làm tròn chính xác trong Node.js.
4. **Bảo mật & Kiểm toán:** Mọi mutation đi qua chu trình chuẩn:
   $$\text{Authentication} \longrightarrow \text{Authorization} \longrightarrow \text{Validation} \longrightarrow \text{Transaction} \longrightarrow \text{Business Logic} \longrightarrow \text{Audit} \longrightarrow \text{Commit}$$
5. **Kiểm toán SHA-256:** Tuần tự hóa tuyệt đối qua transaction-level advisory locks; Append-Only quyền của `billing_app` được bảo toàn.

---

## 2. CHI TIẾT TỪNG PHÁT HIỆN ĐÃ ĐÓNG

### 2.1. FINDING H — VÒNG ĐỜI VÀ THANH TOÁN HOÀN TIỀN (REFUND LIFECYCLE & SETTLEMENT)

#### a. Vòng đời và Trạng thái Nghiệp vụ
Khép kín vòng đời từ khi phát sinh Credit Note vượt công nợ đến khi chi trả tiền mặt hoặc chuyển khoản:
$$\text{Credit Note / Adjustment} \longrightarrow \text{Refund Request (PENDING / REQUESTED)} \longrightarrow \text{Approved (APPROVED)} \longrightarrow \text{Settled / Payout (PAID / SETTLED)}$$

#### b. Quy tắc Chuyển đổi Trạng thái (State Transition Rules)
- `PENDING` $\to$ `APPROVED`: Thực hiện qua `POST /api/refunds/:id/approve`.
- `APPROVED` $\to$ `PAID`: Thực hiện qua `POST /api/refunds/:id/settle` hoặc `POST /api/refunds/:id/pay`.
- **Chặn chuyển đổi bất hợp lệ:**
  - `PENDING` $\to$ `PAID` trực tiếp bị từ chối với HTTP 409 `REFUND_NOT_APPROVED`.
  - `APPROVED` $\to$ `APPROVED` (duyệt 2 lần) bị từ chối với HTTP 409 `REFUND_ALREADY_APPROVED`.
  - `PAID` $\to$ `APPROVED` hoặc `PAID` $\to$ `PAID` (chi trả 2 lần) bị từ chối với HTTP 409 `REFUND_ALREADY_SETTLED`.

#### c. Phân quyền RBAC Backend-Authoritative
- `POST /api/refunds/:id/approve`: Yêu cầu quyền `adjustment.approve`.
- `POST /api/refunds/:id/settle` và `POST /:id/pay`: Yêu cầu quyền `payment.create`.
- `GET /api/refunds` và `GET /:id`: Yêu cầu quyền `payment.read`.

#### d. Chống Chi trả Đúp & Idempotency
- Sử dụng PostgreSQL Row-Level Lock: `SELECT ... FROM public.refund_payables WHERE id = $1 FOR UPDATE`.
- Khóa giao dịch cấp phiên: `pg_advisory_xact_lock(hashtext('idemp_refund'), hashtext($key))` đảm bảo các luồng đồng thời tranh chấp cùng khóa Idempotency hoặc cùng refund payable được tuần tự hóa an toàn.
- Ghi nhận `Idempotency-Key` vào bảng `public.payment_idempotency_keys`. Gửi lặp cùng khóa Idempotency trả về đúng kết quả cũ với cờ `is_idempotent_replay: true`.
- Ghi nhận đầy đủ thông tin chi trả: `payout_method` (`BANK_TRANSFER`, `CASH`, `CARD`), `payout_reference`, `settled_at`, `settled_by`.

#### e. Kiểm toán Giao dịch (Transaction-Coupled Audit)
Mọi thay đổi trạng thái đều ghi nhận nhật ký kiểm toán trong cùng database transaction:
- `REFUND_REQUESTED`: Ghi nhận khi tạo đề xuất hoàn tiền.
- `REFUND_APPROVED`: Ghi nhận khi phê duyệt hoàn tiền.
- `REFUND_SETTLED`: Ghi nhận khi chi tiền hoàn tất với đầy đủ metadata tài chính.

#### f. Kết quả Kiểm thử Gate H
- Kịch bản kiểm thử: `scripts/p1-gate-h-refund-settlement-test.mjs`
- Kết quả: **11 / 11 CHECKS PASSED (100%)**
- Hồi quy lịch sử: `scripts/p1-refund-ledger-test.mjs` — **10 / 10 TESTS PASSED (100%)**

---

### 2.2. FINDING I — KIỂM SOÁT RỦI RO TÍN DỤNG HÓA ĐƠN ĐỊNH KỲ (RECURRING CREDIT RISK)

#### a. Kiểm tra Tín dụng Tiền Phát hành (Pre-Issuance Risk Gate)
Tích hợp trực tiếp dịch vụ miền `CustomerCreditService.checkInvoiceIssueEligibility` vào quy trình của cả hai luồng:
1. Luồng chạy nền tự động của Scheduler: `scheduler.js` (`runRecurringCycle`).
2. Luồng kích hoạt chu kỳ thủ công: `recurring.js` (`POST /api/recurring-plans/:id/trigger`).

#### b. Hành vi Phân loại Khóa & Cảnh báo (Lock vs Warning Behavior)
- **Khách hàng `LOCKED`:** Bị chặn hoàn toàn việc phát hành hóa đơn tự động. Scheduler không tăng chu kỳ `completed_cycles`, không dịch chuyển `next_run_date`, ghi nhận lý do vào `last_error` của plan và phát sinh audit log `RECURRING_INVOICE_BLOCKED_BY_RISK`.
- **Vượt hạn mức tín dụng (`CREDIT_LIMIT_EXCEEDED`):** Bị chặn tự động và ghi nhận nhật ký rủi ro.
- **Khách hàng `WARNING` (trong hạn mức):** Tiếp tục được phép tạo hóa đơn và phát hành bình thường.
- **Khi `credit_control_enabled = false`:** Cho phép phát hành theo đúng cấu hình chính sách của công ty.

#### c. Loại bỏ Triệt để Giá trị Hardcode Cũ (Legacy Hardcodes Removed)
- **Xóa bỏ hardcode 30 ngày:** Tích hợp `PaymentTermsService.calculateAuthoritativeDueDate` để suy dẫn chính xác `due_date` dựa trên điều khoản thanh toán ràng buộc trên plan (`plan.payment_term_id`) hoặc điều khoản kế thừa từ hồ sơ khách hàng.
- **Xóa bỏ hardcode 10% VAT:** Bổ sung cột `vat_rate NUMERIC(5, 4)` trên bảng `recurring_plans` (Migration 10); scheduler tính toán chính xác tiền thuế từng dòng `invoice_items` và tổng tiền hóa đơn dự kiến.

#### d. Tính Lũy tiến Chu kỳ Bất biến (Cycle Idempotency)
- Sử dụng khóa dòng `FOR UPDATE` trên `recurring_plans`.
- Hai luồng scheduler hoặc trigger thủ công chạy song song chỉ cho phép tối đa 1 hóa đơn được sinh ra cho cùng một chu kỳ; chu kỳ sau đó được tăng tự động và ngày chạy tiếp theo được tịnh tiến an toàn.

#### e. Kết quả Kiểm thử Gate I
- Kịch bản kiểm thử: `scripts/p1-gate-i-recurring-risk-test.mjs`
- Kết quả: **7 / 7 CHECKS PASSED (100%)**

---

### 2.3. FINDING J — ĐỐI SOÁT NGÂN HÀNG: CHỐNG NẠP TRÙNG & NẠP LÔ (RECONCILIATION DEDUP & BATCH)

#### a. Định danh Giao dịch Chuẩn mực (Canonical Identity)
Xác lập công thức sinh mã băm SHA-256 xác định duy nhất cho mỗi giao dịch ngân hàng:
- Nếu có mã tham chiếu ngoài (`reference`):
  $$\text{tx\_hash} = \text{SHA256}(\text{bank\_account} + \text{":"} + \text{trim}(\text{reference}))$$
- Nếu không có mã tham chiếu:
  $$\text{tx\_hash} = \text{SHA256}(\text{bank\_account} + \text{":"} + \text{tx\_date} + \text{":"} + \text{amount} + \text{":"} + \text{tx\_type} + \text{":"} + \text{description})$$

#### b. Ràng buộc Toàn vẹn Cơ sở Dữ liệu (DB-Enforced Deduplication)
- Migration 10 bổ sung cột `tx_hash CHARACTER VARYING(64) NOT NULL` và ràng buộc duy nhất:
  ```sql
  ALTER TABLE public.bank_transactions ADD CONSTRAINT bank_transactions_tx_hash_key UNIQUE (tx_hash);
  ```
- Trigger cơ sở dữ liệu `trg_ensure_bank_transaction_hash` tự động sinh mã băm trước khi chèn nếu client không truyền, đảm bảo chống race condition 100% ở tầng lõi PostgreSQL.
- API đơn lẻ bắt lỗi 23505 và trả về HTTP 409 `DUPLICATE_TRANSACTION`.

#### c. Nhập Lô Chuẩn Hóa (Batch Statement Ingestion)
- Các endpoint hỗ trợ:
  - `POST /api/bank-transactions/batch`
  - `POST /api/reconciliation/batch`
  - `POST /api/bank-transactions/import`
  - `POST /api/reconciliation/import`
  (Yêu cầu quyền `reconciliation.manage`).
- Định dạng nạp:
  1. Mảng JSON: `{ rows: [...] }` hoặc `{ transactions: [...] }` hoặc trực tiếp mảng JSON.
  2. Văn bản CSV: `{ csv: "tx_date,amount,description,reference,tx_type,bank_name,bank_account\n..." }` kèm bộ phân tích cú pháp CSV an toàn (hỗ trợ dấu ngoặc kép, dấu phẩy trong văn bản, ký tự xuống dòng).

#### d. Ngữ nghĩa Báo cáo Kết quả (Import Result Semantics)
- Ngữ nghĩa nghiệm thu từng phần (Partial acceptance): Dòng lỗi định dạng hoặc trùng lặp không làm dừng việc nạp các dòng hợp lệ khác.
- Khử trùng 2 lớp:
  1. Khử trùng lặp nội bộ trong cùng lô (In-batch deduplication).
  2. Khử trùng lặp đối chiếu cơ sở dữ liệu (`INSERT ... ON CONFLICT (tx_hash) DO NOTHING`).
- Phản hồi API chuẩn:
  ```json
  {
    "total_rows": 4,
    "accepted": 2,
    "duplicates": 1,
    "rejected": 1,
    "errors": [ ... ],
    "imported_transactions": [ ... ]
  }
  ```
- Nhật ký kiểm toán: Ghi nhận `BANK_TRANSACTION_IMPORTED` và `BANK_TRANSACTION_DEDUPLICATED`.

#### e. Bảo toàn Động cơ Khớp Nối (Matching Engine Preserved)
- Các API khớp tự động (`POST /api/reconciliation/auto-match`) và khớp thủ công (`POST /api/reconciliation/manual-match`) tích hợp chặt chẽ với `PaymentService`, ghi nhận đúng `unapplied_amount`, tạo `payments` và `payment_allocations` chuẩn mực.
- Chặn tuyệt đối khớp đúp trên giao dịch đã khớp (từ chối 409 `TRANSACTION_ALREADY_MATCHED`).

#### f. Kết quả Kiểm thử Gate J
- Kịch bản kiểm thử: `scripts/p1-gate-j-reconciliation-dedup-test.mjs`
- Kết quả: **19 / 19 CHECKS PASSED (100%)** (Bao gồm test bắn 5 luồng đồng thời chèn cùng 1 giao dịch: đúng 1 luồng thành công 201, 4 luồng trả về 409, DB chỉ tồn tại đúng 1 dòng).

---

### 2.4. FINDING K — BÁO CÁO THUẾ GTGT CẤP ĐỘ DÒNG HÀNG (ITEM-LEVEL VAT REPORTING)

#### a. Nguồn Dữ liệu Chuẩn mực (Item-Level Authoritative Data Source)
Viết lại hoàn toàn hàm `vatHandler` (`GET /api/reports/vat` và `/api/reports/vat-declaration`), thay thế toàn bộ logic nhóm theo `i.tax_rate` đầu hóa đơn bằng truy vấn gom trực tiếp từ:
- Bảng `public.invoice_items` (`line_total`, `vat_rate`, `vat_amount`, `total_amount`).
- Bảng `public.invoice_adjustments` (`amount`, `vat_rate`, `vat_amount`, `total_amount`) cho các Credit Note có trạng thái `PROCESSED`.

#### b. Phân nhóm Thuế suất Độc lập (VAT Rate Buckets)
Tổng hợp chính xác doanh số chưa thuế và tiền thuế theo từng nhóm:
- Nhóm 10%: `net_10`, `vat_10`
- Nhóm 8%: `net_8`, `vat_8`
- Nhóm 5%: `net_5`, `vat_5`
- Nhóm 0%: `net_0`, `vat_0`
- Phân tích động: Mảng `rate_breakdown` phản ánh chi tiết mọi mức thuế suất phát sinh.

#### c. Trường hợp Hóa đơn Hỗn hợp Thuế (Mixed VAT Invoices)
Khi một hóa đơn chứa đồng thời các dòng thuế suất khác nhau (ví dụ: Dòng 1 chịu thuế 10%, Dòng 2 chịu thuế 8%):
- Dòng 1 được cộng dồn chính xác vào `net_10` và `vat_10`.
- Dòng 2 được cộng dồn chính xác vào `net_8` và `vat_8`.
- Báo cáo không còn gom sai toàn bộ hóa đơn vào một thuế suất duy nhất.

#### d. Cân đối Số học Tài chính Tuyệt đối (Mathematical Reconciliation)
Bất biến toàn vẹn số học được bảo toàn tuyệt đối không sai lệch một xu:
$$\text{subtotal} = \sum \text{net\_buckets} = \sum \text{item.line\_total} - \sum \text{adj.amount}$$
$$\text{vat\_amount} = \sum \text{vat\_buckets} = \sum \text{item.vat\_amount} - \sum \text{adj.vat\_amount}$$
$$\text{total} = \text{subtotal} + \text{vat\_amount}$$
- Hóa đơn bị hủy (`CANCELLED`) hoặc nháp (`DRAFT`) bị loại bỏ hoàn toàn khỏi kỳ kê khai thuế.
- Kỳ báo cáo không có hóa đơn (Empty period) trả về kết quả `0.00` sạch sẽ, không gây lỗi runtime.

#### e. Xuất Báo cáo Kế toán (Export Functionality)
- Bổ sung hỗ trợ xuất định dạng CSV: `GET /api/reports/vat?format=csv` (hoặc `export=csv`).
- Trả về tệp CSV đúng chuẩn Bảng kê Mẫu 01-1/GTGT với tiêu đề tiếng Việt:
  `Số HĐ,Ngày lập,Tên người mua,Mã số thuế,Thuế suất,Doanh số chưa thuế,Thuế GTGT,Tổng thanh toán`

#### f. Kết quả Kiểm thử Gate K
- Kịch bản kiểm thử: `scripts/p1-gate-k-vat-reporting-test.mjs`
- Kết quả: **30 / 30 CHECKS PASSED (100%)**

---

## 3. THAY ĐỔI CƠ SỞ DỮ LIỆU & TIẾN HÓA SCHEMA

### 3.1. Chi tiết Migration 10
- **File migration thuận:** `db/migrations/10_p1_settlement_automation.sql`
- **File migration nghịch:** `db/migrations/10_p1_settlement_automation_down.sql`
- **Các bổ sung vật lý:**
  1. `public.refund_payables`: Thêm `settled_at`, `settled_by`, `payout_method`, `payout_reference`, ràng buộc `refund_payables_payout_method_check`.
  2. `public.recurring_plans`: Thêm `vat_rate NUMERIC(5, 4) DEFAULT 0.1000`, `payment_term_id BIGINT`, ràng buộc `recurring_plans_vat_rate_check`.
  3. `public.bank_transactions`: Thêm `tx_hash CHARACTER VARYING(64) NOT NULL`, ràng buộc `UNIQUE (tx_hash)`, trigger hàm `ensure_bank_transaction_hash()`.
  4. Cấp quyền tường minh: Cấp quyền `SELECT, INSERT, UPDATE, DELETE` cho role `billing_app` và `SELECT` cho role `billing_readonly`.

### 3.2. Trạng thái Theo dõi & Checksum
- Cơ sở dữ liệu ghi nhận đầy đủ 10/10 bản ghi migration trong `public.schema_migrations`.
- Checksum mã băm SHA-256 được lưu trữ và thẩm tra tự động qua `scripts/migrate.mjs`.

---

## 4. BẢNG TỔNG HỢP KIỂM THỬ HỒI QUY TOÀN DIỆN (FULL REGRESSION MATRIX)

| STT | Tên Suite Kiểm thử | Lệnh Thực thi | Kết quả | Tỷ lệ Đạt |
|:---:|---|---|:---:|:---:|
| 1 | P0 Security & Audit Boundary | `node scripts/p0-security-audit-test.mjs` | **PASS** | 18/18 (100%) |
| 2 | P1.5 Gate 8 RBAC Architecture | `node scripts/p1_5-gate8-rbac-permission-test.mjs` | **PASS** | 38/38 (100%) |
| 3 | P1.5 Gate 5 Manager Override | `node scripts/p1_5-gate5-manager-override-test.mjs` | **PASS** | 25/25 (100%) |
| 4 | P1.5 Gate 6 Manual Unlock | `node scripts/p1_5-gate6-manual-unlock-test.mjs` | **PASS** | 25/25 (100%) |
| 5 | P1.5 Domain Service Credit Gate | `node scripts/p1_5-domain-service-test.mjs` | **PASS** | 18/18 (100%) |
| 6 | Schema Drift & Constraints | `docker compose run --rm migration ... verify-schema.mjs` | **PASS** | 44/44 (100%) |
| 7 | Cryptographic Audit Chain Integrity | `node scripts/verify-audit-chain.mjs` | **PASS** | 9,280/9,280 (100%) |
| 8 | Clean Fresh Deployment Bootstrap | `node scripts/test-fresh-deployment.mjs` | **PASS** | 10 migrations, 100% |
| 9 | P1 Gate C Payment Terms & Due Date | `node scripts/p1-gate-c-payment-terms-test.mjs` | **PASS** | 17/17 (100%) |
| 10 | P1 Gate D Item-Level Mixed VAT | `node scripts/p1-gate-d-mixed-vat-test.mjs` | **PASS** | 16/16 (100%) |
| 11 | P1 Gate E DSO & CEI Metrics | `node scripts/p1-gate-e-dso-cei-test.mjs` | **PASS** | 32/32 (100%) |
| 12 | **P1 Gate H Refund Settlement** | `node scripts/p1-gate-h-refund-settlement-test.mjs` | **PASS** | **11/11 (100%)** |
| 13 | **P1 Gate I Recurring Credit Risk** | `node scripts/p1-gate-i-recurring-risk-test.mjs` | **PASS** | **7/7 (100%)** |
| 14 | **P1 Gate J Reconciliation Dedup/Batch** | `node scripts/p1-gate-j-reconciliation-dedup-test.mjs` | **PASS** | **19/19 (100%)** |
| 15 | **P1 Gate K Item-Level VAT Reporting** | `node scripts/p1-gate-k-vat-reporting-test.mjs` | **PASS** | **30/30 (100%)** |

**Tổng số test cases nghiệm thu trong phase:** **318/318 tests đạt 100% PASS, 0 thất bại, 0 regression.**

---

## 5. XÁC NHẬN PHẠM VI DỰ ÁN (SCOPE CONFIRMATION)

- **Finding H (Refund Settlement):** ĐÃ HOÀN THÀNH VÀ NGHIỆM THU.
- **Finding I (Recurring Credit Risk):** ĐÃ HOÀN THÀNH VÀ NGHIỆM THU.
- **Finding J (Reconciliation Dedup/Batch):** ĐÃ HOÀN THÀNH VÀ NGHIỆM THU.
- **Finding K (VAT Reporting):** ĐÃ HOÀN THÀNH VÀ NGHIỆM THU.
- **Finding L (Document Printing & Receipt Vouchers):** **KHÔNG TRIỂN KHAI TRONG PHASE NÀY (Scope locked for P2).**
- **Thư mục tham chiếu:** `_reference/LedgerFlow/` giữ nguyên vẹn 100%.

---

## 6. KẾT LUẬN VÀ BÀN GIAO GIAI ĐOẠN

Phase **P1 Settlement & Operational Automation** đã hoàn tất trọn vẹn, giải quyết dứt điểm 4 finding H, I, J, K theo đúng yêu cầu đề bài. Hệ thống đã sẵn sàng bước vào Giai đoạn P2 Final Hardening / Documents / Release mà không cần thêm bất kỳ bước đệm nào khác.
