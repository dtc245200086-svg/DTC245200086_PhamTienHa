# BILLING_ONE — P1.2.2 PRE-IMPLEMENTATION CHECKPOINT
## MANDATORY PAYMENT IDEMPOTENCY & LEAST-PRIVILEGE HARDENING

- **Date:** 2026-10-07
- **Target Phase:** P1.2.2 — Mandatory Payment Idempotency & Least-Privilege Hardening
- **Scope:** 
  1. Remediation FIND-P1.2.1-01 (Medium): Make Idempotency-Key MANDATORY on all payment/allocation mutations.
  2. Remediation FIND-P1.2.1-02 (Low): Restrict role `billing_app` to `SELECT, INSERT` only on `public.payment_idempotency_keys` (revoke `UPDATE, DELETE`).
- **Auditor/Engineer:** Senior Backend / Database Engineer
- **Status:** BASELINE VERIFIED & RECORDED

---

## 1. Git Baseline

- **Current Branch:** `main`
- **Current HEAD Commit:** `c63f338bc2951d60cc42456e5743453c923449a1`
- **Git Status:**
  ```
  ?? docs/BILLING_ONE_P1_2_1_CLOSURE_AUDIT.md
  ```
- **Commit History Baseline:**
  - `c63f338`: `feat(p1.2.1): remediate direct payment idempotency gap (FIND-P1.2-01)`
  - `4746644`: `feat(p1.2): implement payment allocation v2, unapplied cash, and canonical payment service`
  - `a26e95f`: `feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix`

---

## 2. Review of Prior Audit Findings

1. **FIND-P1.2.1-01 (MEDIUM) — Keyless Direct Payment Deduplication Gap:**
   - Trong P1.2.1, cơ chế Idempotency-Key đã hoạt động chính xác khi có key.
   - Tuy nhiên, header này ở dạng tùy chọn (Optional - Case B). Khi client không gửi key, hệ thống không có cơ chế fallback, dẫn đến nguy cơ nhân đôi dòng tiền nếu request bị lặp do chập chờn mạng.
   - **Mục tiêu P1.2.2:** Chuyển `Idempotency-Key` thành **BẮT BUỘC (MANDATORY)** trên mọi endpoint tạo đột biến tài chính (`POST /api/payments`, `POST /api/invoices/:id/payments`, `POST /api/payments/:id/allocations`, `POST /api/payments/allocate`). Mọi request thiếu key sẽ bị từ chối ngay lập tức với HTTP 400 và mã lỗi `IDEMPOTENCY_KEY_REQUIRED`, không sinh bất kỳ financial effect nào.
2. **FIND-P1.2.1-02 (LOW) — Excessive Grants on Idempotency Table:**
   - Migration 04 đã cấp `GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_idempotency_keys TO billing_app`.
   - Application service chỉ cần `SELECT` và `INSERT`.
   - **Mục tiêu P1.2.2:** Thu hồi quyền `UPDATE, DELETE` từ `billing_app`, thiết lập nguyên tắc Least-Privilege cho bảng lưu trữ idempotency keys.

---

## 3. Hiện trạng Schema & Runtime trước P1.2.2

### A. Schema `public.payment_idempotency_keys`
- Cột: `id`, `idempotency_key`, `request_hash`, `payment_id`, `response_status`, `response_body`, `created_by`, `created_at`.
- Ràng buộc: `payment_idempotency_keys_key_unique UNIQUE (idempotency_key)`.
- Quyền hạn hiện tại: `billing_app` có `SELECT, INSERT, UPDATE, DELETE`.

### B. Hiện trạng API Callers
- `POST /api/payments`: Chấp nhận key optional.
- `POST /api/invoices/:id/payments`: Chấp nhận key optional.
- `POST /api/payments/:id/allocations`: Chấp nhận key optional.
- `POST /api/payments/allocate`: Chấp nhận key optional.
- `reconciliation.js`: Chưa truyền `idempotencyKey` khi gọi `PaymentService.createPayment`.
- Frontend `app.js`: Chưa truyền header `Idempotency-Key` khi tạo thanh toán.

### C. Số liệu Kế toán trong Database
- Tổng payments: **321 payments** (279 legacy + 42 test/audit payments).
- Tổng allocations: **321 allocations**.
- Tổng số tiền thực nhận: **2,202,804,250.00 ₫**.
- Tổng số tiền đã phân bổ: **2,168,304,250.00 ₫**.
- Tổng tiền chưa phân bổ (Unapplied cash): **34,500,000.00 ₫**.
- Tổng `invoices.paid_total`: **2,168,304,250.00 ₫**.
- Độ lệch tài chính: **0.00 ₫**.

---

## 4. Kế hoạch Triển khai P1.2.2

1. **Migration `db/migrations/05_p1_2_2_idempotency_hardening.sql`:**
   - Thực thi `REVOKE UPDATE, DELETE ON public.payment_idempotency_keys FROM billing_app;`.
   - Đảm bảo `billing_app` chỉ có `SELECT, INSERT` trên `payment_idempotency_keys`.
   - Đảm bảo `billing_readonly` chỉ có `SELECT`.
2. **Canonical Idempotency Extractor ([payments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js)):**
   - Viết helper `requireIdempotencyKey(req)`:
     - Kiểm tra canonical header `Idempotency-Key` (hỗ trợ `X-Idempotency-Key` hoặc `body.idempotency_key`).
     - Nếu có cả header và body nhưng giá trị khác nhau $\rightarrow$ Ném `400 CONFLICTING_IDEMPOTENCY_KEYS`.
     - Nếu không có key nào $\rightarrow$ Ném `400 IDEMPOTENCY_KEY_REQUIRED` ("Idempotency-Key is required for financial payment mutations.").
     - Validate độ dài (1 đến 255 ký tự).
   - Áp dụng trên toàn bộ 4 routes đột biến tài chính:
     - `POST /api/payments`
     - `POST /api/invoices/:id/payments`
     - `POST /api/payments/:id/allocations`
     - `POST /api/payments/allocate`
3. **Cập nhật Internal Callers:**
   - `reconciliation.js`: Sinh key xác định từ định danh giao dịch ngân hàng: `BANK-TX-MATCH-${tx.id}` để đảm bảo 1 giao dịch ngân hàng khớp đúng 1 lần vào dòng tiền.
   - Frontend `app.js`: Sinh `crypto.randomUUID()` cho header `Idempotency-Key` khi submit form thanh toán.
   - Cập nhật các test suite (`cp2-smoke.mjs`, `extended-features-test.mjs`, `p1_2-payment-allocation-test.mjs`, `p1-refund-ledger-test.mjs`) để truyền `Idempotency-Key` khi gọi payment mutations.
4. **Bộ kiểm thử P1.2.2 (16 test cases):**
   - Tạo `scripts/p1_2_2-mandatory-idempotency-test.mjs` bao phủ toàn bộ 16 ca kiểm thử.
5. **Kiểm tra Pháp y & Hồi quy Toàn diện.**

---

## 5. Xác nhận

Checkpoint hoàn tất. Hệ thống sẵn sàng bắt đầu implementation.
