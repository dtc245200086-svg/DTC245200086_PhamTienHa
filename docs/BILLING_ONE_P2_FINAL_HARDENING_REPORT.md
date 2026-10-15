# BILLING_ONE — BÁO CÁO NGHIỆM THU & PHÁT HÀNH P2 FINAL HARDENING
# COMPREHENSIVE FINAL VERIFICATION, REGRESSION & RELEASE REPORT

> **Document Version:** 2.0.0 — FINAL RELEASE COMPLETION  
> **Target System:** `Billing_One` (Single Source of Truth)  
> **Verification Date:** 2026-10-08  
> **Final Release Gate:** **`RELEASE READY WITH OPERATIONAL ACTIONS`**

---

## 1. EXECUTIVE SUMMARY

Hệ thống **Billing_One Extended** đã hoàn thành toàn bộ chu trình xác thực, kiểm thử hồi quy toàn diện, kiểm chứng cơ sở dữ liệu sạch (Fresh Database Bootstrap), và hoàn thiện năng lực bảo mật/chứng từ kế toán tại Giai đoạn **P2 Final Hardening**.

- **Tiếp tục từ Workspace Hiện tại (No Reset):** Quá trình resume bảo toàn 100% công sức triển khai trước đó, không revert Git HEAD, không xóa migration, không refactor ngoài scope, và không tạo các phase phụ P2.1/P2.2.
- **Kết quả Hồi quy Hoạt động (Active Suites):** **31/31 Active Suites ĐẠT (100% GREEN)** với tổng thời gian thực thi 209.13s.
- **Bộ Kiểm thử Lỗi thời (Legacy/Deprecated Suites):** **1/1 Suite (`remediation-verification.mjs`)** được phân loại chính xác là kỳ vọng cũ trước P1.1 (phản ánh phương thức thanh toán giả `CREDIT_NOTE`), được chạy informational và ghi nhận `EXPECTED_DEPRECATED` mà không làm nhiễu gate phát hành.
- **Tái tạo Database Sạch (Fresh DB Bootstrap):** Xác thực thành công 100% trên container PostgreSQL 16.15 độc lập: nạp tuần tự 11 migration files (`01` đến `11`), vượt qua **45/45 kiểm tra schema & integrity**, và đạt tính bất biến khi chạy lại (rerun applies 0).
- **An ninh & Toàn vẹn Nhật ký (Audit Security):** Bảng `public.audit_logs` tuân thủ nghiêm ngặt nguyên tắc Least Privilege (chỉ cấp `SELECT`, `INSERT` cho role `billing_app`; cấm hoàn toàn `UPDATE`, `DELETE`). Xác thực mật mã chuỗi băm SHA-256 đạt **100% toàn vẹn trên toàn bộ 15.000+ bản ghi** với **0 liên kết gãy**.
- **Kết luận:** Hệ thống đạt trạng thái **`RELEASE READY WITH OPERATIONAL ACTIONS`** (sẵn sàng chuyển giao sản xuất sau khi thực hiện các thủ tục vận hành xoay vòng khóa bí mật môi trường).

---

## 2. RESUME CHECKPOINT & REMEDIATION CHRONICLE

### 2.1. Hiện trạng Tiếp nhận Trước khi Resume
- Các module nghiệp vụ Hardening H (Refund), I (Recurring), J (Reconciliation), K (VAT), và L (Documents) đã được soạn thảo trong codebase.
- Migration `11_p2_final_hardening.sql` và down migration đã tồn tại.
- Module `app/src/services/documentService.js` đã triển khai các mẫu in Hóa đơn GTGT (NĐ 123) và Phiếu thu/chi (TT 200).
- Gate L (`scripts/p2-gate-l-documents-test.mjs`) đã chạy thử nghiệm và pass 6/6 kịch bản.

### 2.2. Các Khiếm khuyết Kỹ thuật Đã Xử lý Trong Quá trình Resume (Test Harness & Environment Fixes)
1. **Sửa Lỗi Phạm vi Biến (Variable Scope Hoisting) trong `scripts/p1_4-overdue-lifecycle-test.mjs`:**
   - *Nguyên nhân:* Biến `t16Cust` được khai báo dạng block scope `const` bên trong khối T16, khiến T17 ném lỗi `ReferenceError: cust is not defined` và tìm kiếm nhầm khách hàng lịch sử tên `T16`.
   - *Khắc phục:* Hoisted biến `let t16Cust` lên đầu phạm vi và đối chiếu chuẩn xác theo `c.customer_id === t16Cust.id || c.customer_name === t16Cust.name`.
2. **Dọn dẹp Chứng từ Giả lập và Bảo toàn Bất biến Cơ sở Dữ liệu trong `scripts/p1_5-gate7-risk-scanner-test.mjs`:**
   - *Nguyên nhân:* Hàm `createInvoice` của test Gate 7 chèn trực tiếp các hóa đơn có `paidTotal > 0` mà không sinh dòng thanh toán tương ứng trong `payment_allocations`, vi phạm bất biến kế toán `paid_total = sum(allocations)`. Đồng thời, do role `billing_app` bị thu hồi quyền `DELETE` trên bảng `invoices`, khối cleanup bên trong container không thể xóa các hóa đơn này.
   - *Khắc phục:* Cập nhật hàm `createInvoice` để sinh kèm payment và allocation tương ứng khi `paidTotal > 0`, duy trì bất biến kế toán 100% thời gian thực. Bổ sung hàm `cleanupHost` sử dụng quyền `postgres` superuser dọn dẹp triệt để trước và sau khi chạy test.
3. **Dọn dẹp Khóa ngoại Khách hàng trong `scripts/p1_5-gate9-frontend-credit-risk-test.mjs`:**
   - *Nguyên nhân:* Lệnh cleanup cũ chỉ xóa `invoice_no LIKE 'INV-G9-%'` nên bỏ sót các hóa đơn DRAFT (chưa có số hóa đơn), gây lỗi Foreign Key constraint `invoices_customer_id_fkey` khi xóa khách hàng.
   - *Khắc phục:* Xóa hóa đơn theo `customer_id IN (SELECT id FROM customers WHERE code LIKE 'G9_CUST_%')` trước khi xóa khách hàng.
4. **Kiểm soát Nginx Login Rate Limiting (5 requests/phút) trong Test Runner:**
   - *Nguyên nhân:* Nginx áp dụng rate limit `zone=login 5r/m` trên `/api/auth/login`. Khi chạy 32 bộ test liên tiếp, Nginx trả về HTTP 429 HTML.
   - *Khắc phục:* Trong `scripts/run-all-tests.mjs`, runner tự động khởi động lại Nginx (`docker compose restart nginx`) trước mỗi suite để xóa bộ đếm in-memory, đồng thời hỗ trợ cơ chế retry tự động.
5. **Tách biệt Nhóm Test & Giới hạn Thời gian (Timeout Engine) trong `scripts/run-all-tests.mjs`:**
   - *Khắc phục:* Phân loại rõ ràng 31 Active Suites và 1 Legacy Suite. Áp dụng giới hạn `180.000 ms` (3 phút) cho từng suite để ngăn chặn tình trạng treo vô hạn.

---

## 3. H — REFUND SETTLEMENT HARDENING

- **Kiến trúc & Vòng đời:** Mở rộng vòng đời Refund Payable khép kín: `REQUESTED/PENDING` $\to$ `APPROVED` $\to$ `PAID/SETTLED`.
- **Cơ chế Idempotency:**
  - Khóa `Idempotency-Key` được lưu trữ tại `public.payment_idempotency_keys` kèm mã băm SHA-256 payload.
  - Cùng key + cùng payload $\implies$ trả về kết quả đã cache (`is_idempotent_replay: true`, HTTP 200).
  - Cùng key + khác payload $\implies$ từ chối với HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
  - Cùng key + khác khoản hoàn tiền $\implies$ từ chối với HTTP 409.
- **Ràng buộc Nghiệp vụ:**
  - Một khoản hoàn tiền chỉ được thanh toán tối đa 1 lần (`REFUND_ALREADY_SETTLED`).
  - Không thể thanh toán khoản hoàn tiền chưa được phê duyệt (`REFUND_NOT_APPROVED`).
  - Khóa hàng cấp cơ sở dữ liệu `SELECT ... FOR UPDATE` bảo vệ tuyệt đối khi có nhiều luồng thanh toán đồng thời (1 luồng thành công, các luồng còn lại trả về 409 conflict).
- **Kết quả Kiểm chứng:** `scripts/p1-gate-h-refund-settlement-test.mjs` — **13/13 CHECKS PASSED (100%)**.

---

## 4. I — RECURRING BILLING HARDENING

- **Loại bỏ Số học Số thực (Zero Float Math):** Toàn bộ các phép tính toán giá trị chu kỳ, dòng hàng, thuế và tổng tiền được thực hiện trực tiếp bằng kiểu dữ liệu `NUMERIC` của PostgreSQL và chuyển đổi cents nguyên tử, xóa bỏ hoàn toàn `Number()`, `parseFloat()`, `Math.round()` ở các đường dẫn tài chính trọng yếu.
- **Xóa bỏ Thuế 10% Ẩn:** Thuế suất được quản lý tường minh trên từng kế hoạch định kỳ (`recurring_plans.vat_rate`), kế thừa chính xác xuống các dòng hàng `invoice_items.vat_rate` và `vat_amount`.
- **Thẩm quyền Điều khoản Thanh toán (Authoritative Terms):** Loại bỏ hardcode 30 ngày; ngày đáo hạn `due_date` được tính toán thông qua `PaymentTermsService` dựa trên điều khoản của gói hoặc hồ sơ khách hàng.
- **Kiểm soát Rủi ro Tín dụng Tự động:** Scheduler tự động gọi `CustomerCreditService.checkInvoiceIssueEligibility` trước khi ký phát hóa đơn. Khách hàng mang trạng thái `LOCKED` hoặc vượt hạn mức sẽ bị tạm dừng phát hành, ghi nhận `RECURRING_INVOICE_BLOCKED_BY_RISK` và giữ nguyên chu kỳ.
- **Kết quả Kiểm chứng:** `scripts/p1-gate-i-recurring-risk-test.mjs` — **10/10 CHECKS PASSED (100%)**.

---

## 5. J — RECONCILIATION DEDUPLICATION & BATCH INGESTION

- **Định danh Giao dịch Chuẩn mực (Canonical Transaction Identity):**
  - Hàm PostgreSQL `compute_canonical_bank_tx_hash` tạo mã băm SHA-256 xác định từ tài khoản, ngày giao dịch, số tiền, loại giao dịch và mã tham chiếu (hoặc nội dung mô tả khi không có mã tham chiếu).
  - Trigger `trg_ensure_bank_transaction_hash` bảo vệ tại ranh giới DB, ngăn chặn mọi hành vi client tự gửi `tx_hash` giả mạo để lách luật.
- **Khảo sát Dữ liệu Thực tế:**
  - Câu truy vấn kiểm tra trùng lặp trên các giao dịch không có mã tham chiếu trả về **0 dòng**. Cơ sở dữ liệu sạch và không chứa bất kỳ giao dịch trùng lặp nào.
- **Nhập Sao kê Hàng loạt (Batch Ingestion):**
  - Hỗ trợ cả hai định dạng JSON array và CSV text qua endpoint `POST /api/bank-transactions/batch`.
  - Cơ chế deduplication đa tầng: lọc trùng lặp ngay trong lô (in-batch) và lọc trùng lặp đối chiếu với cơ sở dữ liệu.
  - Ngữ nghĩa nghiệm thu từng phần (partial acceptance semantics): chấp nhận dòng hợp lệ, phân loại dòng trùng lặp, thông báo dòng sai định dạng mà không rollback toàn bộ lô.
- **Kết quả Kiểm chứng:** `scripts/p1-gate-j-reconciliation-dedup-test.mjs` — **22/22 CHECKS PASSED (100%)**.

---

## 6. K — VAT REPORTING HARDENING

- **Nguyên tắc Tổng hợp Dòng hàng (Sum-of-Lines Authority):**
  - Thuế GTGT được tổng hợp trực tiếp từ các dòng hàng `invoice_items` (`vat_rate`, `vat_amount`, `total_amount`), thay thế triệt để logic gom nhóm theo `tax_rate` đầu hóa đơn cũ.
  - Hỗ trợ đầy đủ hóa đơn hỗn hợp thuế (Mixed VAT): một hóa đơn chứa đồng thời các dòng thuế suất 0%, 5%, 8%, 10% được bóc tách và cộng dồn chính xác vào từng xô thuế riêng biệt.
- **Cấn trừ Credit Note Đa Thuế suất:**
  - Các khoản điều chỉnh giảm doanh thu được cấn trừ chính xác theo từng mức thuế suất tương ứng của dòng hàng điều chỉnh.
- **Bất biến Cân đối Tài chính:**
  $$\Sigma \text{rate\_breakdown.net\_amount} = \text{summary.subtotal}$$
  $$\Sigma \text{rate\_breakdown.vat\_amount} = \text{summary.vat\_amount}$$
  $$\text{summary.total} = \text{summary.subtotal} + \text{summary.vat\_amount}$$
- **Xuất Dữ liệu CSV:** Endpoint `GET /api/reports/vat?format=csv` xuất bảng kê thuế GTGT với tiêu đề tiếng Việt chuẩn mực kế toán.
- **Kết quả Kiểm chứng:** `scripts/p1-gate-k-vat-reporting-test.mjs` — **33/33 CHECKS PASSED (100%)**.

---

## 7. L — OFFICIAL PRINT DOCUMENTS & RECEIPT VOUCHERS

- **Động cơ Kết xuất Phía Máy chủ (`app/src/services/documentService.js`):**
  - Kết xuất HTML/JSON hoàn toàn ở server-side, truy vấn trực tiếp từ dữ liệu đã commit trong PostgreSQL. Trình duyệt client không thể làm sai lệch dữ liệu tài chính.
- **Danh mục Chứng từ Triển khai:**
  1. **Hóa đơn Giá trị Gia tăng:** `GET /api/invoices/:id/print` & `/document` — Tuân thủ Nghị định 123/2020/NĐ-CP & Thông tư 78/2021/TT-BTC, hiển thị bảng chi tiết từng loại thuế suất Mixed VAT, dòng điều chỉnh Credit Note, và số tiền viết bằng chữ tiếng Việt.
  2. **Phiếu thu Tiền mặt / Chuyển khoản:** `GET /api/payments/:id/receipt` & `/voucher` & `/print` — Tuân thủ Mẫu 01-TT / C40-BB theo Thông tư 200/2014/TT-BTC, ghi nhận số tiền, phương thức, mã tham chiếu, và bảng phân bổ vào các hóa đơn liên quan.
  3. **Phiếu chi Hoàn tiền:** `GET /api/refunds/:id/voucher` & `/print` — Tuân thủ Mẫu 02-TT theo Thông tư 200/2014/TT-BTC, ghi nhận số tiền hoàn trả, lý do hoàn tiền từ Credit Note và phương thức thanh toán.
- **Tính năng An toàn & Hiển thị:**
  - `docTienBangChu()`: Thuật toán dịch số thành chữ tiếng Việt chuẩn xác cho mọi quy mô tiền tệ.
  - `escapeHtml()`: Khử khuẩn chuỗi đầu vào ngăn chặn triệt để lỗ hổng XSS.
  - Bố cục `@media print` A4 chuẩn, ngăn ngừa ngắt trang gãy bảng (`page-break-inside: avoid`), hỗ trợ hóa đơn dài trên 30 dòng hàng.
  - Bảo vệ phân quyền RBAC: `invoice.read`, `payment.read`, `adjustment.read`.
- **Kết quả Kiểm chứng:** `scripts/p2-gate-l-documents-test.mjs` — **6/6 CHECKS PASSED (100%)**.

---

## 8. SECURITY & RBAC ARCHITECTURE

- **Danh mục 5 Vai trò Chuẩn (Canonical Roles):** `admin` (toàn quyền), `staff` (nghiệp vụ hóa đơn chuẩn), `ROLE_BILLING_MANAGER` (duyệt override, mở khóa nợ), `ROLE_ACCOUNTANT` (đối soát, thanh toán, báo cáo), `ROLE_AUDITOR` (chỉ đọc).
- **Danh mục 21 Quyền Hạn Nguyên tử:** Kiểm soát chi tiết từ `customer.read/create/update/unlock`, `invoice.read/create/update/issue/issue_override/cancel`, `payment.read/create`, `adjustment.create/approve`, `reconciliation.manage`, `report.view`, `audit.view`, đến `settings.manage`.
- **Kiểm soát Quyền Hạn Cơ sở Dữ liệu (Least Privilege):**
  - Bảng `public.audit_logs`: Role `billing_app` chỉ có quyền `ar` (SELECT, INSERT).
  - Quyền `UPDATE` và `DELETE` bị thu hồi tuyệt đối ở mức schema PostgreSQL.
- **Kết quả Kiểm chứng:** `scripts/p1_5-gate8-rbac-permission-test.mjs` — **38/38 CHECKS PASSED (100%)**.

---

## 9. AUDIT INTEGRITY & CONCURRENCY CONTROL

- **Tuần tự hóa Giao dịch Kiểm toán (Transaction Advisory Lock):**
  - Mọi thao tác ghi audit đều sử dụng `pg_advisory_xact_lock` để lấy mã băm trước đó và chèn bản ghi mới, ngăn chặn hoàn toàn hiện tượng phân nhánh chuỗi băm (hash branching) khi có nhiều luồng ghi đồng thời.
- **Đóng gói Giao dịch Nguyên tử (Atomic Coupling):**
  - Ghi nhận nhật ký kiểm toán nằm trong cùng một database transaction với biến động nghiệp vụ. Nếu nghiệp vụ lỗi rollback, bản ghi audit tương ứng cũng rollback, không để lại bản ghi rác.
- **Xác thực Mật mã Lịch sử:**
  - Kết quả kiểm chứng qua `scripts/verify-audit-chain.mjs`: **100% bản ghi (15.075+ records) có mã băm SHA-256 hợp lệ tuyệt đối, ZERO BROKEN LINKS**.

---

## 10. MIGRATION 11 AUDIT & REVERSIBILITY

- **File Migration:**
  - Forward: `db/migrations/11_p2_final_hardening.sql`
  - Reversible Down: `db/migrations/11_p2_final_hardening_down.sql`
- **Nội dung Kỹ thuật:**
  - Tối ưu hóa chỉ mục cho `bank_transactions.tx_hash`.
  - Củng cố ràng buộc cho `refund_payables` và `invoice_items`.
  - Khóa quyền hạn append-only và hoàn tất các thủ tục dọn dẹp kỹ thuật.
- **Tính Bất biến & Khả năng Hoàn nguyên:** Đã được kiểm chứng trong runner; không làm mất mát hoặc biến đổi sai lệch dữ liệu tài chính của khách hàng.

---

## 11. FRESH DATABASE BOOTSTRAP VERIFICATION

Quá trình kiểm thử Fresh Deployment độc lập (`scripts/test-fresh-deployment.mjs`) thực thi trên container PostgreSQL `billing-fresh-test-pg` hoàn toàn mới:

1. **Khởi tạo Database Mới:** Khởi tạo container và mạng độc lập `billing_fresh_test_net`.
2. **Thực thi Migration Runner (`scripts/migrate.mjs`):**
   - Áp dụng thành công tuần tự **11/11 migrations** (`01` đến `11`).
   - Tổng số bản ghi theo dõi trong `schema_migrations`: 11.
3. **Kiểm tra Schema Drift & Ràng buộc (`scripts/verify-schema.mjs`):**
   - **45/45 kiểm tra ĐẠT (0 FAILED)** bao gồm: 20 bảng vật lý, các cột trọng yếu, ràng buộc không chứa `CREDIT_NOTE` trong payment method, ràng buộc trạng thái `OVERDUE`, trigger phân bổ thanh toán, quyền append-only của `audit_logs`, và hàm băm canonical.
4. **Kiểm tra Tính Bất biến Khi Chạy Lại (Rerun Idempotency):**
   - Chạy lại migration runner lần thứ hai: ghi nhận **Applied migrations: 0**, mã băm SHA-256 của toàn bộ 11 file khớp 100%.
5. **Dọn dẹp Tài nguyên:** Container và mạng thử nghiệm được giải phóng sạch sẽ.

---

## 12. FULL REGRESSION EXECUTION MATRIX

Kết quả thực thi chính thức từ consolidated runner `scripts/run-all-tests.mjs` (Tổng thời gian: 209.13s):

| STT | Nhóm Kiểm thử | Tên File Test Suite | Thời gian | Trạng thái |
|:---:|---|---|:---:|:---:|
| 1 | Group A: P0 / Security | `scripts/p0-security-audit-test.mjs` | 6.51s | **PASS** |
| 2 | Group A: P0 / Security | `scripts/p0-remediation-test.mjs` | 1.10s | **PASS** |
| 3 | Group A: P0 / Security | `scripts/cp2-smoke.mjs` | 2.01s | **PASS** |
| 4 | Group B: Core Accounting | `scripts/p1-refund-ledger-test.mjs` | 1.25s | **PASS** |
| 5 | Group B: Core Accounting | `scripts/p1_2-payment-allocation-test.mjs` | 1.78s | **PASS** |
| 6 | Group B: Core Accounting | `scripts/p1_2_1-idempotency-test.mjs` | 1.07s | **PASS** |
| 7 | Group B: Core Accounting | `scripts/p1_2_2-mandatory-idempotency-test.mjs` | 6.67s | **PASS** |
| 8 | Group B: Core Accounting | `scripts/p1_3-auto-settlement-test.mjs` | 7.83s | **PASS** |
| 9 | Group B: Core Accounting | `scripts/p1_3_1-remediation-test.mjs` | 8.43s | **PASS** |
| 10 | Group B: Core Accounting | `scripts/p1_4-overdue-lifecycle-test.mjs` | 67.27s | **PASS** |
| 11 | Group C: Credit & RBAC | `scripts/p1_5-domain-service-test.mjs` | 0.63s | **PASS** |
| 12 | Group C: Credit & RBAC | `scripts/p1_5-gate3-rbac-issue-test.mjs` | 11.76s | **PASS** |
| 13 | Group C: Credit & RBAC | `scripts/p1_5-gate4-customer-hardening-test.mjs` | 8.08s | **PASS** |
| 14 | Group C: Credit & RBAC | `scripts/p1_5-gate5-manager-override-test.mjs` | 11.06s | **PASS** |
| 15 | Group C: Credit & RBAC | `scripts/p1_5-gate6-manual-unlock-test.mjs` | 7.36s | **PASS** |
| 16 | Group C: Credit & RBAC | `scripts/p1_5-gate7-risk-scanner-test.mjs` | 2.85s | **PASS** |
| 17 | Group C: Credit & RBAC | `scripts/p1_5-gate8-rbac-permission-test.mjs` | 8.36s | **PASS** |
| 18 | Group C: Credit & RBAC | `scripts/p1_5-gate9-frontend-credit-risk-test.mjs` | 7.79s | **PASS** |
| 19 | Group C: Credit & RBAC | `scripts/p1_5-gate10-frontend-unlock-risk-test.mjs` | 6.18s | **PASS** |
| 20 | Group C: Credit & RBAC | `scripts/p1_5-gate10-idempotency-lifecycle-test.mjs` | 0.15s | **PASS** |
| 21 | Group D: Financial Core | `scripts/p1-gate-c-payment-terms-test.mjs` | 2.46s | **PASS** |
| 22 | Group D: Financial Core | `scripts/p1-gate-d-mixed-vat-test.mjs` | 1.21s | **PASS** |
| 23 | Group D: Financial Core | `scripts/p1-gate-e-dso-cei-test.mjs` | 1.53s | **PASS** |
| 24 | Group E: P1/P2 Final | `scripts/p1-gate-h-refund-settlement-test.mjs` | 1.01s | **PASS** |
| 25 | Group E: P1/P2 Final | `scripts/p1-gate-i-recurring-risk-test.mjs` | 1.25s | **PASS** |
| 26 | Group E: P1/P2 Final | `scripts/p1-gate-j-reconciliation-dedup-test.mjs` | 1.30s | **PASS** |
| 27 | Group E: P1/P2 Final | `scripts/p1-gate-k-vat-reporting-test.mjs` | 1.14s | **PASS** |
| 28 | Group E: P1/P2 Final | `scripts/p2-gate-l-documents-test.mjs` | 1.11s | **PASS** |
| 29 | Group F: Extended & E2E | `scripts/extended-features-test.mjs` | 1.33s | **PASS** |
| 30 | Group F: Extended & E2E | `scripts/frontend-e2e-test.mjs` | 0.85s | **PASS** |
| 31 | Group G: Integrity | `scripts/verify-audit-chain.mjs` | 0.56s | **PASS** |

---

## 13. ACTIVE TEST SUITES SUMMARY

- **Tổng số Active Suites Thực thi:** 31
- **Số lượng Suites Passed:** 31 (100.0%)
- **Số lượng Suites Failed:** 0 (0.0%)
- **Số lượng Suites Bị Timeout:** 0 (0.0%)
- **Thời gian Thực thi Trung bình mỗi Suite:** 6.74s

---

## 14. LEGACY / DEPRECATED TEST SUITES SUMMARY

- **Tổng số Legacy Suites:** 1
- **File:** `scripts/remediation-verification.mjs`
- **Kết quả Thực thi:** `EXPECTED/DEPRECATED` (0.07s)
- **Lý do Phân loại:** Suite này phản ánh hành vi cũ trước Prompt 1.1 khi Credit Note ghi nhận thanh toán giả với `method = 'CREDIT_NOTE'` trong bảng `public.payments`. Hành vi này đã bị bãi bỏ triệt để để bảo vệ tính toàn vẹn sổ cái tiền mặt (theo FIND-01 và FIND-P0-AUD-01). Suite này đã được thay thế bởi `scripts/p1-refund-ledger-test.mjs` và không còn thuộc release gate.

---

## 14B. FINAL MICRO-HARDENING

Giai đoạn Micro-Hardening cuối cùng tập trung giải quyết 3 trọng điểm kiểm soát phát hành nhằm loại bỏ mọi rủi ro tiềm ẩn mà không tạo phase mới, không reset Git, và không làm thay đổi các business modules đã hoàn thiện:

### 1. Secret Hygiene & Historical Credential Exposure
- **Kiểm tra File Môi trường Runtime:**
  - File `.env` hoàn toàn không bị Git track (`git ls-files .env` trả về rỗng). File `.gitignore` bảo vệ nghiêm ngặt các mẫu `.env`, `.env.*` (ngoại trừ `.env.example`).
  - File mẫu `.env.example` được xác thực chỉ chứa placeholder an toàn (`CHANGE_ME_*`), tuyệt đối không chứa credential thực tế.
- **Rà soát Kho Mã nguồn Hiện hành (Active Tracked Scan):**
  - Quét toàn bộ repository tìm các mẫu `PASSWORD=`, `SECRET=`, `TOKEN=`, `API_KEY=`, và các giá trị chuỗi mật mã hex/base64.
  - Toàn bộ credential-looking values trong tài liệu theo dõi (như `docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md`) đã được thanh lọc và thay thế bằng ký hiệu an toàn `<FROM_ENV>`. Không có bí mật thực tế nào tồn tại trong working tree hoặc tracked files hiện hành.
- **Xác định Lịch sử Phơi bày (Historical Git Exposure):**
  - Rà soát lịch sử commit (`aa0d392`, `94dc8f0`, `0222e34`) cho thấy trong quá khứ đã từng có các chuỗi credential-looking được commit vào tài liệu.
  - Tuân thủ nguyên tắc an toàn vận hành: **KHÔNG tự ý rewrite lịch sử Git dùng chung bằng force-push** khi chưa có phê duyệt vận hành trực tiếp.
  - Thay vào đó, lịch sử Git được ghi nhận là phơi bày vận hành và bắt buộc phải thực hiện Credential Rotation ngay lập tức.
  - Trạng thái Finding B được điều chỉnh chính xác thành: **`PARTIAL / OPERATIONAL REMEDIATION REQUIRED`** (không tuyên bố resolved giả tạo khi dữ liệu lịch sử Git vẫn còn lưu vết).
- **Yêu cầu Thu hồi & Xoay vòng Khóa (Credential Rotation Mandate):**
  - Đội ngũ DevOps/Vận hành bắt buộc phải thay đổi toàn bộ 9 biến môi trường nhạy cảm sau đây trước khi golive (danh sách tên biến, không in giá trị):
    1. `POSTGRES_PASSWORD`
    2. `BILLING_APP_PASSWORD`
    3. `BILLING_READONLY_PASSWORD`
    4. `EXPORTER_PASSWORD`
    5. `ADMIN_PASSWORD`
    6. `STAFF_PASSWORD`
    7. `PGADMIN_DEFAULT_PASSWORD`
    8. `GRAFANA_ADMIN_PASSWORD`
    9. `SESSION_SECRET`
- **Quy tắc Xuất bản / Đóng gói ZIP (Export Hygiene):**
  - Nghiêm cấm tạo các bản nén release đính kèm `.env`, chứng chỉ TLS private key, hoặc runtime secret credentials.

### 2. Recurring VAT Authority
- **Hiện trạng Trước Xử lý:** Tuyến `POST /api/recurring-plans` có fallback ngầm `'0.1000'` tại tầng ứng dụng JavaScript khi `vat_rate` không được gửi lên.
- **Xác lập Thẩm quyền Thuế suất Đơn nhất (Single Authoritative Policy):**
  - **Thẩm quyền Chính (Primary Authority):** Giá trị `vat_rate` tường minh được chỉ định trên từng hợp đồng thuê bao định kỳ (`recurring_plans.vat_rate`). Được xác thực định dạng số học không âm (`TAX_RATE` regex) trong biên độ `0.00` đến `0.20`.
  - **Nguồn Sự thật Mặc định Pháp định (Statutory Default Source of Truth):** Khi client không truyền `vat_rate`, tầng ứng dụng loại bỏ hoàn toàn việc inject `'0.1000'` thủ công trong code JavaScript; thay vào đó, hệ thống sử dụng mệnh đề `DEFAULT` trong câu lệnh SQL để ủy quyền cho định nghĩa lược đồ PostgreSQL (`recurring_plans.vat_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.1000` từ Migration 10) làm nguồn chân lý duy nhất.
  - **Ràng buộc Thực thi Vận hành (Runtime Invariant):** Cả scheduler nền (`scheduler.js`) và trigger thủ công (`recurring.js`) khi phát hành hóa đơn chu kỳ đều truy vấn trực tiếp `plan.vat_rate` từ cơ sở dữ liệu làm căn cứ duy nhất để ghi nhận vào `invoice_items.vat_rate` và tính tiền thuế exact decimal. Nếu `plan.vat_rate` bị null hoặc thiếu, hệ thống chặn phát hành với lỗi `RECURRING_PLAN_VAT_RATE_REQUIRED`. Tuyệt đối không có policy authority thứ hai ngoài nguồn sự thật.

### 3. Financial Numeric Audit & Reconciled Claim
- **Kết quả Rà soát Hàm Số học (`Number`, `parseFloat`, `Math.round`, `toFixed`):**
  - Đã quét toàn diện trên `scheduler.js`, `routes/recurring.js`, thư mục `services/`, và toàn bộ `routes/`.
  - **Nhóm A — Tính toán Tài chính Cốt lõi (Financial Arithmetic):** Toàn bộ phép tính tổng hóa đơn, chiết khấu dòng hàng, thuế suất GTGT dòng hàng, giảm trừ nợ, hoàn tiền, phân bổ thanh toán, và số dư nợ còn lại (`outstanding`) đều được thực thi tại tầng PostgreSQL thông qua kiểu dữ liệu `NUMERIC(14,2)` và các trigger/hàm số học nguyên vẹn, loại bỏ triệt để sai số IEEE 754 float.
  - **Nhóm B — Chuyển đổi Phi tài chính (Non-financial Conversion):** Các lệnh `Number()` chỉ dùng để parse số nguyên định danh khóa chính (`id`, `customer_id`, `invoice_id`), đếm số vòng lặp (`total_cycles`), số ngày quá hạn (`days_overdue`), hoặc so sánh ngưỡng logic (`outstandingNum <= 0.0001`).
  - **Nhóm C — Định dạng Chứng từ Hiển thị (Document Formatting):** Sử dụng `.toFixed(2)` để render chuỗi số tiền trên bản in hóa đơn/phiếu thu và ghi text tóm tắt vào audit log mà không làm thay đổi các giá trị kế toán lưu trữ trong database.
- **Tuyên bố Chuẩn hóa (Reconciled Statement):** Thay thế tuyên bố tuyệt đối cũ bằng khẳng định kỹ thuật chính xác:
  > *"Active financial calculation paths validated for decimal-safe arithmetic; remaining numeric conversions are non-accounting/display/identifier use."*

---

## 15. KNOWN OPERATIONAL ACTIONS

Sau khi phát hành mã nguồn, đội ngũ vận hành cần thực hiện các thao tác tiêu chuẩn bắt buộc trước khi đưa hệ thống vào môi trường Production chính thức:

1. **Bắt buộc Xoay Vòng Toàn bộ Bí mật & Mật khẩu Môi trường (Mandatory Credential Rotation):**
   - Xoay vòng ngay lập tức toàn bộ 9 biến môi trường đã từng xuất hiện trong lịch sử Git:
     * `POSTGRES_PASSWORD`
     * `BILLING_APP_PASSWORD`
     * `BILLING_READONLY_PASSWORD`
     * `EXPORTER_PASSWORD`
     * `ADMIN_PASSWORD`
     * `STAFF_PASSWORD`
     * `PGADMIN_DEFAULT_PASSWORD`
     * `GRAFANA_ADMIN_PASSWORD`
     * `SESSION_SECRET`
   - Tuyệt đối không tái sử dụng các mật khẩu cũ trong bất kỳ môi trường staging hay production nào.
2. **Kế hoạch Xử lý Lịch sử Git (Git History Scrubbing Plan):**
   - Lập kế hoạch bảo trì ngoài giờ để sử dụng `git-filter-repo` hoặc BFG Repo-Cleaner thanh lọc vĩnh viễn các commit lịch sử phơi bày bí mật trên repository trung tâm sau khi có sự đồng thuận của các bên liên quan.
3. **Cấp phát Chứng chỉ TLS Hợp lệ (Production TLS Certificates):**
   - Thay thế chứng chỉ tự ký (`nginx/certs/selfsigned.crt`) bằng chứng chỉ số hợp lệ được cấp bởi Certificate Authority (Let's Encrypt hoặc CA doanh nghiệp).
4. **Cấu hình Ngưỡng Giới hạn Tần suất Nginx (Rate Limit Tuning):**
   - Tinh chỉnh `limit_req_zone` trên Nginx phù hợp với quy mô tải thực tế của doanh nghiệp.

---

## 16. REMAINING BLOCKERS

- **Điểm nghẽn Cấp độ P0:** **NONE (0)**
- **Điểm nghẽn Cấp độ P1:** **NONE (0)**
- **Điểm nghẽn Cấp độ P2:** **NONE (0)**
- **Lỗi Bất biến Kế toán & Sổ cái:** **NONE (0)**
- **Lỗi Toàn vẹn Nhật ký Kiểm toán:** **NONE (0)**

---

## 17. FINAL RELEASE DECISION

Căn cứ vào kết quả kiểm chứng thực tế tại runtime:
- Toàn bộ **31/31 Active Test Suites** đạt trạng thái PASS tuyệt đối.
- Module H, I, J, K, L đạt chuẩn nghiệp vụ và bất biến kỹ thuật.
- Quy trình Fresh Deployment độc lập tái tạo 100% thành công với 11 migrations.
- Bảng `audit_logs` được bảo vệ Append-Only và chuỗi băm SHA-256 hoàn toàn nguyên vẹn.
- Không còn bất kỳ vi phạm kế toán hay lỗ hổng phân quyền nào tồn đọng.

**QUYẾT ĐỊNH PHÁT HÀNH CHÍNH THỨC:**

# `RELEASE READY WITH OPERATIONAL ACTIONS`

Hệ thống **Billing_One Extended** đủ điều kiện phát hành sản xuất ngay lập tức kèm theo việc hoàn tất các thủ tục vận hành xoay vòng khóa bí mật môi trường được nêu tại Mục 15.
