# BILLING_ONE — P1.3 FINAL CLOSURE & SIGN-OFF
## RECURRING BILLING AUTOMATED PAYMENT & UNAPPLIED CASH SETTLEMENT ENGINE
### FORMAL MILESTONE CLOSURE & PRODUCTION SIGN-OFF DOCUMENT

**Document Version:** 1.0.0 (FINAL SIGN-OFF)  
**Authority:** Senior Financial Systems Architect / Product Owner Delegate  
**Sign-off Date:** October 07, 2026  
**Milestone:** P1.3 Production Milestone  
**Final Operational Status:** **`P1.3 OFFICIALLY CLOSED — VERIFIED`**

---

## 1. OFFICIAL P1.3 SCOPE & BOUNDARIES

Giai đoạn **P1.3: Recurring Billing Automated Payment & Unapplied Cash Settlement Engine** hoàn thành việc kết nối tự động hóa dòng tiền ký quỹ chưa phân bổ (**Unapplied Cash Pool**) và các hóa đơn định kỳ (**Recurring Invoices**).

### Phạm vi Triển khai Chính thức (Official In-Scope):
1. **Schema & Migration:** Cột cấu hình `auto_settle_unapplied BOOLEAN NOT NULL DEFAULT TRUE` trên bảng `public.recurring_plans` ([`db/migrations/06_p1_3_recurring_auto_settlement.sql`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/db/migrations/06_p1_3_recurring_auto_settlement.sql)).
2. **Canonical Service Layer:** Phương thức phân bổ tự động [`PaymentService.autoAllocateUnappliedCash`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) và truy vấn số dư tiền thừa [`PaymentService.getCustomerUnappliedBalance`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js).
3. **FIFO Allocation Algorithm:** Tiêu thụ tiền thừa nghiêm ngặt theo thứ tự ưu tiên thanh toán trước (`paid_at ASC, payments.id ASC`).
4. **Trigger Cơ chế Kép:**
   - *Tự động (Background Scheduler):* Cấn trừ ngay sau khi sinh hóa đơn định kỳ tự động ký số ([`app/src/scheduler.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js)).
   - *Thủ công (Manual Trigger):* Kế toán kích hoạt tại endpoint `POST /api/invoices/:id/auto-allocate` ([`app/src/routes/invoices.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js)). Ngoài ra, endpoint `POST /api/recurring/:id/trigger` ([`app/src/routes/recurring.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/recurring.js)) đóng vai trò tích hợp mở rộng phục vụ kích hoạt chu kỳ thuê bao định kỳ (implementation integration/extension supporting recurring-cycle triggering).
5. **Idempotency & Replay Protection:** Khóa giao dịch phân tán cấp cơ sở dữ liệu trên Idempotency-Key; bảo đảm một request chỉ thực thi phân bổ một lần duy nhất, các lượt gọi lại (Replay) nhận phản hồi lưu trữ nguyên bản và không sinh log trùng.
6. **Kiểm toán Bất biến (Immutable Audit Trail):** Ghi nhận sự kiện `PAYMENT_AUTO_ALLOCATED` vào chuỗi băm SHA-256 của `public.audit_logs`.
7. **Giao diện Người dùng (Frontend UI):** Tích hợp nút *"Tự động cấn trừ từ tiền thừa"* và hiển thị huy hiệu Unapplied Cash trong modal chi tiết hóa đơn ([`app/public/app.js`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js)).

### Giới hạn Phạm vi Tuyệt đối (Absolute Out-of-Scope):
- Không mở rộng sang P1.4 (Automated Dunning & Debt Recovery).
- Không sửa đổi thiết kế Payment Allocation V2 (P1.2).
- Không sửa đổi kiến trúc RBAC hay cấp quyền `UPDATE/DELETE` trên bảng `payments`.
- Không can thiệp hoặc thay đổi các quy tắc kế toán tài chính cơ bản.

---

## 2. BASELINE COMMIT & IMPLEMENTATION SUMMARY

- **Baseline Git Commit:** `d794de0461e992122a4c8eddadb1ead2082ae8ac` on branch `main` (`feat(p1.2.2): mandatory payment idempotency and least-privilege hardening`).
- **Implementation Status:** Đã hoàn thành 100% các hạng mục kỹ thuật theo Đặc tả Chính thức [`docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md) và được ghi nhận tại [`docs/BILLING_ONE_P1_3_IMPLEMENTATION_REPORT.md`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_IMPLEMENTATION_REPORT.md).

---

## 3. AUDIT & REMEDIATION LIFECYCLE SUMMARY

Chu trình kiểm định và khắc phục của P1.3 diễn ra qua 3 đợt đánh giá độc lập nghiêm ngặt:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                P1.3 LIFECYCLE TRAJECTORY                               │
├───────────────────────────┬──────────────────────────────────┬─────────────────────────┤
│ Giai đoạn                 │ Tài liệu Báo cáo                 │ Kết quả Đánh giá        │
├───────────────────────────┼──────────────────────────────────┼─────────────────────────┤
│ 1. Triển khai Ban đầu     │ BILLING_ONE_P1_3_IMPLEMENTATION  │ COMPLETED (Ready Audit) │
│ 2. Kiểm toán Độc lập P1.3 │ BILLING_ONE_P1_3_CLOSURE_AUDIT   │ VERIFIED WITH WARNINGS  │
│ 3. Khắc phục P1.3.1       │ BILLING_ONE_P1_3_1_REMEDIATION   │ REMEDIATION COMPLETED   │
│ 4. Tái Thẩm định Độc lập  │ BILLING_ONE_P1_3_1_RE_AUDIT      │ VERIFIED / READY CLOSURE│
└───────────────────────────┴──────────────────────────────────┴─────────────────────────┘
```

---

## 4. FINDINGS CLOSURE VERIFICATION

Cả hai phát hiện kiểm toán từ đợt kiểm toán độc lập P1.3 đã được đóng chính thức (**CLOSED**) với đầy đủ bằng chứng đối chiếu mã nguồn và pháp y dữ liệu:

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    FINAL FINDINGS CLOSURE STATUS                                  │
├─────────────────┬──────────┬──────────────┬───────────────┬───────────────────────────────────────┤
│ Finding ID      │ Mức độ   │ Trạng thái P1.3│ Trạng thái mới│ Hành động Khắc phục Đã Thẩm định      │
├─────────────────┼──────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ FIND-P1.3-01    │ MEDIUM   │ OPEN         │ CLOSED        │ Chuẩn hóa toàn diện 7 trường metadata │
│                 │          │              │               │ theo Mục 12 Đặc tả; replay không sinh │
│                 │          │              │               │ log trùng; khớp 100% allocations.     │
├─────────────────┼──────────┼──────────────┼───────────────┼───────────────────────────────────────┤
│ FIND-P1.3-02    │ LOW      │ OPEN         │ CLOSED        │ Thiết lập Hierarchical Canonical Lock │
│                 │          │              │               │ Protocol (Level 0->3); triệt tiêu     │
│                 │          │              │               │ deadlock 40P01 trên 5 vòng đua tương  │
│                 │          │              │               │ tranh chéo allocatePayment vs autoAlloc│
└─────────────────┴──────────┴──────────────┴───────────────┴───────────────────────────────────────┘
```

### Chi tiết Khắc phục:
1. **FIND-P1.3-01 (Audit Metadata Compliance):**
   - Sự kiện `PAYMENT_AUTO_ALLOCATED` ghi nhận đầy đủ 7 trường bắt buộc: `invoice_id`, `invoice_no`, `allocated_total`, `allocations_count`, `payment_ids`, `idempotency_key`, `invoice_status`.
   - Bảo toàn các trường chi tiết mở rộng: `allocated_from_unapplied`, `remaining_unapplied_cash`, `settlement_type`, `previous_paid_total`, `new_paid_total`, `allocations`.
   - Bảo đảm nguyên tắc Idempotent Replay: kiểm tra `!result.is_idempotent_replay` ngăn chặn hoàn toàn việc ghi log trùng lặp khi request được gửi lại.
2. **FIND-P1.3-02 (Lock Order Standardization):**
   - Thiết lập Giao thức Khóa Phân tầng Chuẩn tắc áp dụng đồng nhất trên toàn hệ thống:
     - **Level 0:** Idempotency Key Advisory Lock (`hashtext('idemp_...')`)
     - **Level 1:** Invoice Row Lock (`invoices FOR UPDATE ORDER BY id ASC`)
     - **Level 2:** Customer Unapplied Pool Advisory Lock (`hashtext('cust_unapplied_pool')`)
     - **Level 3:** Payment Advisory Lock (`hashtext('payment_lock')`, `paymentId ASC`)
   - Đồ thị tài nguyên là một đồ thị có hướng phi chu trình (**DAG**), loại trừ triệt để nguy cơ deadlock.
   - Thử nghiệm thực tế 5 vòng đua tương tranh giữa `allocatePayment` và `autoAllocateUnappliedCash` ghi nhận **0 lỗi 40P01 Deadlock**.

---

## 5. FINANCIAL INVARIANTS FORENSICS

Kết quả kiểm toán pháp y toàn diện độc lập trên cơ sở dữ liệu `billing` ghi nhận **0 vi phạm trên toàn bộ 9 chỉ số bất biến tài chính**:

```sql
SELECT 
  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.payments p 
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id 
    GROUP BY p.id, p.amount 
    HAVING coalesce(sum(pa.allocated_amount), 0) > p.amount + 0.001
  ) sub) AS payment_over_allocation,

  (SELECT count(*) FROM (
    SELECT p.id, p.amount, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.payments p 
    LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id 
    GROUP BY p.id, p.amount 
    HAVING p.amount - coalesce(sum(pa.allocated_amount), 0) < -0.001
  ) sub) AS negative_unapplied,

  (SELECT count(*) FROM (
    SELECT i.id, i.paid_total, coalesce(sum(pa.allocated_amount), 0) AS alloc_sum 
    FROM public.invoices i 
    LEFT JOIN public.payment_allocations pa ON pa.invoice_id = i.id 
    GROUP BY i.id, i.paid_total 
    HAVING abs(i.paid_total - coalesce(sum(pa.allocated_amount), 0)) > 0.001
  ) sub) AS invoice_allocation_mismatch,

  (SELECT count(*) FROM public.invoices 
   WHERE paid_total + adjusted_total > total + 0.001) AS collectible_capacity_violation,

  (SELECT count(*) FROM (
    SELECT invoice_id 
    FROM public.payment_allocations 
    WHERE notes LIKE 'Tự động cấn trừ theo chu kỳ%' 
    GROUP BY invoice_id, payment_id 
    HAVING count(*) > 1
  ) sub) AS duplicate_scheduler_allocation,

  (SELECT count(*) FROM (
    SELECT idempotency_key 
    FROM public.payment_idempotency_keys 
    WHERE idempotency_key LIKE 'RECURRING-AUTO-ALLOC-%' 
    GROUP BY idempotency_key HAVING count(*) > 1
  ) sub) AS dup_sched_keys,

  (SELECT count(*) FROM public.payments 
   WHERE reference LIKE '%AUTO-ALLOC%' OR notes LIKE '%cấn trừ%') AS p13_created_payments,

  (SELECT count(*) FROM public.payments WHERE amount <= 0) AS non_positive_payments,
  (SELECT count(*) FROM public.payment_allocations WHERE allocated_amount <= 0) AS non_positive_allocations;
```

**Bảng Kết quả Thực thi Pháp y:**
```text
 payment_over_allocation | negative_unapplied | invoice_allocation_mismatch | collectible_capacity_violation | duplicate_scheduler_allocation | dup_sched_keys | p13_created_payments | non_positive_payments | non_positive_allocations 
-------------------------+--------------------+-----------------------------+--------------------------------+--------------------------------+----------------+----------------------+-----------------------+--------------------------
                       0 |                  0 |                           0 |                              0 |                              0 |              0 |                    0 |                     0 |                        0
```

- Không có khoản thanh toán nào bị phân bổ vượt số tiền thực có.
- Không có khoản tiền thừa nào bị âm.
- Không có sai lệch giữa `paid_total` hóa đơn và tổng tiền phân bổ.
- Không có vi phạm trần thu nợ (`paid_total + adjusted_total <= total`).
- Không có bản ghi phân bổ hoặc khóa trùng lặp từ Scheduler.
- P1.3 không sinh ra các khoản thanh toán ảo.

---

## 6. CRYPTOGRAPHIC AUDIT CHAIN VERIFICATION

Xác thực tính toàn vẹn của chuỗi băm mật mã SHA-256 trên toàn bộ bảng `public.audit_logs`:
- **Tổng số bản ghi kiểm toán:** **2.603** bản ghi.
- **Số bản ghi hợp lệ:** **2.603** bản ghi (**100.0%**).
- **Số liên kết gãy vỡ (Broken Links):** **0**.
- **Tính toàn vẹn Genesis Block $\to$ Hiện tại:** Đạt chuẩn bất biến tài chính.

---

## 7. FULL REGRESSION SUITE VERIFICATION

Toàn bộ 12 bộ kiểm thử hệ thống, bảo mật và hồi quy đều đạt tỷ lệ thành công tuyệt đối **100% PASS**:

| STT | Suite Kiểm thử | Script Thực thi | Kết quả Thực tế | Tỷ lệ Đạt | Ghi chú Kỹ thuật |
| :---: | :--- | :--- | :---: | :---: | :--- |
| 1 | **P1.3.1 Remediation Suite** | [`scripts/p1_3_1-remediation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3_1-remediation-test.mjs) | **7/7 PASS** | **100%** | Concurrency cross-flow, metadata assertions |
| 2 | **P1.3 Dedicated Suite** | [`scripts/p1_3-auto-settlement-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3-auto-settlement-test.mjs) | **16/16 PASS** | **100%** | 16 kịch bản FIFO, scheduler, concurrency T01-T16 |
| 3 | **P1.2.2 Mandatory Idempotency** | [`scripts/p1_2_2-mandatory-idempotency-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_2-mandatory-idempotency-test.mjs) | **16/16 PASS** | **100%** | Idempotency-Key validation + 4 bonus checks |
| 4 | **P1.2.1 Direct Payment Idempotency** | [`scripts/p1_2_1-idempotency-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2_1-idempotency-test.mjs) | **10/10 PASS** | **100%** | Anti-replay direct payment |
| 5 | **P1.2 Payment Allocation V2** | [`scripts/p1_2-payment-allocation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_2-payment-allocation-test.mjs) | **18/18 PASS** | **100%** | Phân bổ đa hóa đơn, bảo toàn P1.2 |
| 6 | **P1.1 Refund Ledger Suite** | [`scripts/p1-refund-ledger-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1-refund-ledger-test.mjs) | **10/10 PASS** | **100%** | Credit note, debt harmonization |
| 7 | **P0 Financial Integrity Suite** | [`scripts/p0-remediation-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p0-remediation-test.mjs) | **4/4 PASS** | **100%** | Credit note semantics, bank anti-replay |
| 8 | **CP2 Baseline Smoke Suite** | [`scripts/cp2-smoke.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/cp2-smoke.mjs) | **15/15 PASS** | **100%** | p95 latency = **21.23 ms** (< 100 ms) |
| 9 | **Extended Enterprise Features** | [`scripts/extended-features-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/extended-features-test.mjs) | **12/12 PASS** | **100%** | 12 tính năng nâng cao LedgerFlow |
| 10 | **Frontend Smoke & Asset E2E** | [`scripts/frontend-e2e-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/frontend-e2e-test.mjs) | **23/23 routes** | **100%** | 0 lỗi 404, static assets hợp lệ |
| 11 | **Security Hardening (H1 - H6)** | [`scripts/verify-hardening.ps1`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-hardening.ps1) | **26/26 PASS** | **100%** | Non-root, network isolation, least privilege |
| 12 | **Cryptographic Audit Chain** | [`scripts/verify-audit-chain.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-audit-chain.mjs) | **2.603/2.603 PASS** | **100%** | 100% chuỗi băm hợp lệ, 0 gãy liên kết |

---

## 8. SECURITY HARDENING VERIFICATION

Hệ thống bảo đảm tuân thủ đầy đủ 26 tiêu chí bảo mật (H1 - H6) được xác thực qua [`scripts/verify-hardening.ps1`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/verify-hardening.ps1):
- **H1 (Non-root Execution):** Web (node:1000), PostgreSQL (UID 999), Nginx (UID 101), Grafana (UID 472), Prometheus (UID 65534), Loki (UID 10001). Ngoại lệ cAdvisor được lập văn bản.
- **H2 (Network Isolation):** 5 mạng chuyên biệt, `app_net`, `db_net`, `monitoring_net` cách ly nội bộ. Nginx không kết nối trực tiếp vào `db_net`.
- **H3 (Secret Hygiene):** `.env` không bị theo dõi bởi Git, mật khẩu mặc định của Grafana bị vô hiệu hóa.
- **H4 (Least Privilege):** Role `billing_app` bị cấm quyền `DROP TABLE`, cấm quyền `UPDATE/DELETE` trên bảng `payments` và `payment_idempotency_keys`. Role `billing_readonly` không có quyền ghi hay truy cập bảng `users`.
- **H5 (Header Security):** Đầy đủ 6 tiêu đề bảo mật (HSTS, nosniff, DENY, Referrer, Permissions, CSP); ẩn phiên bản Nginx.
- **H6 (Attack Surface Reduction):** Không publish cổng nội bộ 3000 (web), 5432 (postgres), 3100 (loki) ra máy chủ chủ.

---

## 9. KNOWN DOCUMENTATION OBSERVATIONS

1. **Định danh Bộ kiểm thử Frontend:**
   - [`scripts/frontend-e2e-test.mjs`](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/frontend-e2e-test.mjs) là bộ kiểm thử khói tích hợp tĩnh (HTTP/Static integration smoke) xác thực việc phân phối tài nguyên HTML/CSS/JS và tính khả dụng của 23 endpoint UI. Đây không phải là bộ kiểm thử tự động trên trình duyệt thực (True Browser E2E/Playwright).
2. **Tính Nhất quán trong Văn bản Đếm:**
   - Báo cáo Remediation ghi nhận văn phong "11 bộ kiểm thử" tương ứng với 11 file script kiểm thử chức năng, trong khi bảng biểu liệt kê đầy đủ 12 hàng (bao gồm dòng xác thực toàn vẹn chuỗi kiểm toán qua API). Quan sát này được phân loại là `INFO` và không ảnh hưởng đến bất kỳ khía cạnh kỹ thuật hay tài chính nào.

---

## 10. FINAL OPERATIONAL STATUS & SIGN-OFF

Đại diện Kiến trúc sư Hệ thống Tài chính Cấp cao (Senior Financial Systems Architect / Product Owner Delegate) chính thức ký duyệt đóng giai đoạn **P1.3**:

```text
================================================================================
  FINAL STATUS:
  P1.3 OFFICIALLY CLOSED — VERIFIED
================================================================================
```

Tất cả các điều kiện kỹ thuật, pháp y tài chính, bảo mật và hồi quy đều đã được thỏa mãn trọn vẹn và đóng băng ở trạng thái sản xuất.
