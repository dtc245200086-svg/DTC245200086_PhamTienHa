# BILLING_ONE — P1.3 IMPLEMENTATION PREFLIGHT REPORT
## RECURRING BILLING AUTOMATED PAYMENT & UNAPPLIED CASH SETTLEMENT ENGINE
## ARCHITECTURAL PREFLIGHT, CONCURRENCY DEEP-DIVE & IMPLEMENTATION BLUEPRINT

**Role:** Senior Backend Architect + Financial Systems Engineer  
**Source of Truth:** [docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_OFFICIAL_SPEC.md)  
**Baseline Git State:** Commit `d794de0461e992122a4c8eddadb1ead2082ae8ac` on branch `main`  
**Execution Date:** October 07, 2026  
**Operational Mode:** STRICT READ-ONLY / ZERO MODIFICATION — Zero Code Changes, Zero Migrations, Zero DB Mutations  

---

## A. CURRENT ARCHITECTURE MAPPING

Hệ thống Billing_One hiện tại hoạt động theo mô hình **Zero-Trust Multi-Tier Architecture** gồm 4 phân tầng độc lập được bao bọc bởi Docker Compose (12 container services):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           1. TẦNG BIÊN (Edge Tier)                          │
│  - Nginx unprivileged (UID 101, Port 443 HTTPS, TLS 1.2/1.3)                │
│  - HSTS, CSP, X-Frame-Options: DENY, Rate Limiting                          │
│  - Forward headers: X-Request-Id, Idempotency-Key                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                        2. TẦNG ỨNG DỤNG (Application Tier)                  │
│  - Express 5.1.0 on Node.js 24 Alpine (Non-root UID 1000)                   │
│  - Single Page Application Plain HTML/CSS/Vanilla JS (app/public/app.js)     │
│  - Domain Services: PaymentService (Canonical Service cho Dòng tiền)        │
│  - Background Scheduler: app/src/scheduler.js (Advisory lock ID 88812345)   │
│  - Cryptographic Audit Trail: app/src/audit.js (SHA-256 chained logs)       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                         3. TẦNG DỮ LIỆU (Data Tier)                         │
│  - PostgreSQL 16.15 (UID 999, Port 5432 Internal only)                      │
│  - Database Roles: postgres (owner), billing_app (app), billing_readonly    │
│  - Append-Only Tables: payments, payment_idempotency_keys, audit_logs       │
│  - Trigger Invariants: check_payment_allocation_invariants() (Active)       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                     4. TẦNG QUAN SÁT (Observability Tier)                   │
│  - Prometheus 3.15, Grafana 13.2, Loki 3.7, Promtail 3.6, cAdvisor v0.60    │
│  - Metrics: billing_invoices_created_total, billing_payments_amount_vnd     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Vòng đời Dữ liệu Tài chính Hiện hành:
1. **Hóa đơn (`invoices`):**
   $$\text{DRAFT} \longrightarrow \text{ISSUED} \longrightarrow \text{PARTIALLY\_PAID} \longrightarrow \text{PAID}$$
2. **Dòng tiền Thanh toán (`payments`):**
   Đại diện cho dòng tiền thực tế vào tài khoản (`amount > 0`). Cột `invoice_id` là nullable; liên kết khách hàng trực tiếp qua `customer_id`.
3. **Phân bổ Thanh toán (`payment_allocations`):**
   Nguồn sự thật duy nhất (Single Source of Truth) xác định quan hệ **1 Payment $\rightarrow$ N Allocations $\rightarrow$ N Invoices**.
4. **Tiền thừa Ký quỹ (Unapplied Cash):**
   Được hạch toán tự nhiên qua hiệu số: $\text{unapplied} = \text{payment.amount} - \sum \text{allocated\_amount}$.
5. **Chứng từ Bù trừ & Hoàn tiền:**
   `invoice_adjustments` (Credit Note) và `refund_payables` (nghĩa vụ hoàn trả nợ).

---

## B. EXISTING COMPONENTS REUSABLE (CÁC THÀNH PHẦN TÁI SỬ DỤNG)

Kiểm toán kiến trúc xác nhận **100% nền tảng kỹ thuật cần thiết cho P1.3 đã tồn tại sẵn trong hệ thống**, hoàn toàn không cần viết lại từ đầu (No Redesign):

| Thành phần kỹ thuật | Vị trí mã nguồn | Khả năng tái sử dụng cho P1.3 |
| :--- | :--- | :--- |
| **`PaymentService` Class** | [app/src/services/paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) | Tái sử dụng cấu trúc Transaction, hàm phụ trợ `sortIds(ids)` chống deadlock, và mẫu thiết kế Fingerprint SHA-256. |
| **Idempotency Engine** | [app/src/services/paymentService.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/services/paymentService.js) & DB | Bảng `payment_idempotency_keys` với khóa cố vấn `pg_advisory_xact_lock` tái sử dụng nguyên vẹn để lưu trữ kết quả phân bổ tự động. |
| **Validation Helper** | `extractAndRequireIdempotencyKey` trong [payments.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/payments.js) | Tái sử dụng để kiểm tra bắt buộc header `Idempotency-Key` cho endpoint manual trigger. |
| **Database Trigger Invariants** | `trg_check_payment_allocation_invariants` trên `payment_allocations` | Tự động bảo vệ mức engine PostgreSQL: Chặn tuyệt đối over-allocation cả về phía Payment và phía Invoice. |
| **Background Scheduler** | [app/src/scheduler.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js) | Tái sử dụng hàm `runRecurringCycle(pool)`, khóa `SCHEDULER_LOCK_ID`, hàm tính ngày an toàn `calculateNextSafeDate`. |
| **Audit Logger** | [app/src/audit.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/audit.js) | Hàm `recordAudit(client, { ... })` tự động tính mã băm SHA-256 xâu chuỗi bản ghi kiểm toán bất biến. |
| **Error & Transaction Handler** | [app/src/errors.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/errors.js) & [app/src/db.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/db.js) | `AppError(status, code, message)` và `inTransaction(client, callback)`. |

---

## C. REQUIRED CHANGES (CHI TIẾT CÁC THAY ĐỔI CẦN THIẾT)

Để đáp ứng đầy đủ yêu cầu từ Official Spec mà không gây xáo trộn kiến trúc, các thay đổi được khoanh vùng tối thiểu:

1. **Cơ sở dữ liệu (Database Migration):**
   - Tệp mới: `db/migrations/06_p1_3_recurring_auto_settlement.sql`.
   - Bổ sung cột: `auto_settle_unapplied boolean NOT NULL DEFAULT true` vào bảng `public.recurring_plans`.
   - Bổ sung composite index: `payments_customer_fifo_idx ON public.payments (customer_id, paid_at ASC, id ASC)`.
2. **Tầng Domain Service (`app/src/services/paymentService.js`):**
   - Bổ sung hàm tiện ích: `computeAutoAllocateRequestFingerprint(customerId, invoiceId)`.
   - Bổ sung static method: `PaymentService.autoAllocateUnappliedCash(client, { customerId, invoiceId, recordedBy, idempotencyKey, source })`.
3. **Tầng API Endpoints:**
   - Trong [app/src/routes/invoices.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/invoices.js): Bổ sung route `POST /api/invoices/:id/auto-allocate`.
   - Trong [app/src/routes/customers.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/routes/customers.js): Bổ sung route `GET /api/customers/:id/unapplied-balance`.
4. **Tầng Background Scheduler (`app/src/scheduler.js`):**
   - Trong vòng lặp `runRecurringCycle`, sau khi hóa đơn được chuyển sang `ISSUED` (hoặc sau `auto_sign`): Kích hoạt `PaymentService.autoAllocateUnappliedCash` với khóa tất định `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`.
5. **Giao diện Người dùng (`app/public/app.js`):**
   - Màn hình Chi tiết Hóa đơn (`renderInvoiceDetail`): Gọi API unapplied-balance, hiển thị thanh thông báo và nút bấm cấn trừ tự động `[⚡ Cấn trừ từ tiền thừa]`.
   - Màn hình Hợp đồng Định kỳ (`renderRecurringPlanForm`): Thêm checkbox `auto_settle_unapplied`.

---

## D. DATABASE IMPACT & RBAC VERIFICATION

### A. Đánh giá Phân quyền PostgreSQL (Least Privilege)
Truy vấn `information_schema.role_table_grants` xác nhận hiện trạng quyền của role ứng dụng:
- **`billing_app`:**
  - `public.recurring_plans`: Đã có quyền `SELECT, INSERT, UPDATE, DELETE`.
  - `public.invoices`: Đã có quyền `SELECT, INSERT, UPDATE`.
  - `public.payments`: Đã có quyền `SELECT, INSERT` (Append-Only).
  - `public.payment_allocations`: Đã có quyền `SELECT, INSERT`.
  - `public.payment_idempotency_keys`: Đã có quyền `SELECT, INSERT` (Thu hồi UPDATE/DELETE).
  - `public.audit_logs`: Đã có quyền `SELECT, INSERT` (Append-Only).
- **Đánh giá:** Role `billing_app` **hoàn toàn có đủ đặc quyền cần thiết** để thực hiện toàn bộ nghiệp vụ P1.3 mà không cần cấp thêm bất kỳ đặc quyền dư thừa nào (`GRANT`).
- Quyền hạn của `billing_readonly` tiếp tục chỉ là `SELECT` trên các bảng nghiệp vụ và bị cấm đọc bảng `users`.

---

## E. API IMPACT & CONTRACT VALIDATION

### 1. `POST /api/invoices/:id/auto-allocate`
- **Mục đích:** Kế toán viên chủ động yêu cầu cấn trừ tiền thừa cho hóa đơn.
- **Middleware:** `requireAuth`, `requirePermission` (`invoices:edit` hoặc `payments:create`).
- **Idempotency:** Bắt buộc có header `Idempotency-Key`.
- **Validation:** `id` phải là số nguyên dương hợp lệ.
- **Mã lỗi dự kiến:**
  - 400 `IDEMPOTENCY_KEY_REQUIRED`: Thiếu key.
  - 400 `INVALID_IDEMPOTENCY_KEY`: Key vượt quá 255 ký tự.
  - 400 `NO_UNAPPLIED_CASH_AVAILABLE`: Khách hàng không có tiền thừa.
  - 400 `INVOICE_ALREADY_PAID`: Hóa đơn đã thanh toán đủ hoặc đã hủy.
  - 404 `INVOICE_NOT_FOUND`: Không tìm thấy hóa đơn.
  - 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`: Cùng key nhưng gửi cho hóa đơn khác.

### 2. `GET /api/customers/:id/unapplied-balance`
- **Mục đích:** Truy vấn số dư ký quỹ phục vụ hiển thị trên giao diện.
- **Middleware:** `requireAuth`.
- **Method:** `GET` (Safe, Read-Only, không làm biến động dữ liệu, không cần Idempotency-Key).
- **Cấu trúc phản hồi:**
  ```json
  {
    "customer_id": 1,
    "customer_name": "Công ty TNHH Giải Pháp Công Nghệ Số",
    "total_unapplied_cash": "2000000.00",
    "available_payments_count": 1,
    "payments": [
      {
        "id": 317,
        "amount": "5000000.00",
        "allocated_amount": "3000000.00",
        "unapplied_amount": "2000000.00",
        "paid_at": "2026-10-06",
        "method": "BANK_TRANSFER",
        "reference": "BANK-TX-317"
      }
    ]
  }
  ```

---

## F. SCHEDULER INTEGRATION POINT (PHÂN TÍCH ĐIỂM CHÈN SCHEDULER)

Trong tệp [app/src/scheduler.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/scheduler.js), hàm `runRecurringCycle` xử lý từng plan theo vòng lặp:
- Dòng 86-114: Tạo hóa đơn và dòng hàng trong transaction `inTransaction(async (txClient) => { ... })`.
- Dòng 120-133: Nếu `plan.auto_sign` bật, cấp số hóa đơn `invoice_no`, mã CQT `e_invoice_code`, và cập nhật `status = 'ISSUED'`.

### Điểm chèn kỹ thuật chính xác:
Ngay sau dòng 133 (khi hóa đơn đã mang trạng thái `ISSUED` và đã có `invoiceId` hợp lệ):
```javascript
// P1.3 Integration Point: Auto-settle using Unapplied Cash
if (plan.auto_sign && (plan.auto_settle_unapplied ?? true)) {
  const autoAllocKey = `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`;
  try {
    await PaymentService.autoAllocateUnappliedCash(txClient, {
      customerId: plan.customer_id,
      invoiceId: invoiceId,
      recordedBy: 1, // System User
      idempotencyKey: autoAllocKey,
      source: 'SCHEDULER'
    });
  } catch (allocErr) {
    // Nếu khách hàng không có tiền thừa, ghi log debug và tiếp tục bình thường (hóa đơn giữ nguyên ISSUED)
    if (allocErr.code === 'NO_UNAPPLIED_CASH_AVAILABLE') {
      writeLog('debug', 'scheduler.auto_alloc_skipped_no_balance', { invoice_id: invoiceId });
    } else {
      throw allocErr; // Lỗi nghiêm trọng khác sẽ rollback transaction
    }
  }
}
```
**Ưu điểm kiến trúc:**
1. Thực thi ngay trên `txClient` của chu kỳ: Đảm bảo tính nguyên tử tuyệt đối (All-or-Nothing).
2. Nếu khách hàng không có tiền thừa: Không làm sập luồng tạo hóa đơn định kỳ, hóa đơn vẫn được tạo và phát hành bình thường.

---

## G. FRONTEND INTEGRATION POINT

Trong tệp [app/public/app.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/public/app.js):

1. **Điểm chèn 1: Chi tiết Hóa đơn (`renderInvoiceDetail`, dòng 928):**
   - Hiện tại:
     ```javascript
     if (['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status)) {
       actions.append(actionButton('+ Ghi nhận thanh toán', 'button-primary', () => setHash(`#/invoices/${invoice.id}/payment`)));
       actions.append(anchor('+ Tạo biên bản điều chỉnh / C/N', `#/adjustments/new?invoice_id=${invoice.id}`, 'button button-secondary'));
     }
     ```
   - Nâng cấp P1.3:
     Thêm lời gọi bất đồng bộ lấy số dư tiền thừa:
     ```javascript
     const unappliedData = await api(`/customers/${invoice.customer_id}/unapplied-balance`).catch(() => ({ total_unapplied_cash: '0.00' }));
     if (Number(unappliedData.total_unapplied_cash) > 0) {
       // Hiển thị nút cấn trừ tự động
       actions.append(actionButton('⚡ Cấn trừ từ tiền thừa', 'button-success', async () => {
         if (!window.confirm(`Xác nhận cấn trừ tiền thừa (Khả dụng: ${money(unappliedData.total_unapplied_cash)}) cho hóa đơn này?`)) return;
         try {
           const idempKey = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `auto-alloc-${Date.now()}`;
           await api(`/invoices/${invoice.id}/auto-allocate`, {
             method: 'POST',
             headers: { 'Idempotency-Key': idempKey }
           });
           setHash(`/invoices/${invoice.id}`);
         } catch (err) {
           content.prepend(alertBox(err.message, 'error'));
         }
       }));
     }
     ```
2. **Điểm chèn 2: Form Hợp đồng Định kỳ (`renderRecurringPlanForm`, dòng 1340):**
   - Thêm checkbox `auto_settle_unapplied` (mặc định checked).

---

## H. CONCURRENCY ANALYSIS (CHUYÊN SÂU TƯƠNG TRANH & TRUY VẤN FIFO)

### 1. Thẩm tra Kỹ thuật về Câu lệnh FIFO trong Official Spec
Trong mục 5 của Official Spec có đề xuất truy vấn:
```sql
SELECT p.id, p.amount, ...
FROM public.payments p
LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
WHERE p.customer_id = $1
GROUP BY p.id, p.amount, p.paid_at
HAVING p.amount > coalesce(sum(pa.allocated_amount), 0)
ORDER BY p.paid_at ASC, p.id ASC
FOR UPDATE OF p;
```

> [!WARNING]
> **KẾT QUẢ KIỂM CHỨNG RUNTIME POSTGRESQL THỰC TẾ:**
> Khi thực thi câu lệnh trên trực tiếp trong PostgreSQL 16:
> `ERROR: FOR UPDATE is not allowed with GROUP BY clause`
> **Nguyên nhân kỹ thuật:** Chuẩn SQL và PostgreSQL engine không cho phép sử dụng mệnh đề khóa hàng `FOR UPDATE` đồng thời với phép tổng hợp nhóm `GROUP BY` hoặc hàm kết hợp (aggregate function).

### 2. Giải pháp Triển khai Tương đương Chuẩn mực (Equivalent Implementation):
Để đạt được chính xác 100% ngữ nghĩa nghiệp vụ và bảo vệ an toàn tương tranh tuyệt đối mà không vi phạm cú pháp PostgreSQL, ta áp dụng quy trình **Khóa Hai Giai đoạn (Two-Phase Row Locking)** bên trong transaction:

```sql
-- GIAI ĐOẠN 1: Khóa hàng loạt các Payments của khách hàng theo thứ tự ID tăng dần
-- (Ngăn chặn triệt để mọi luồng khác can thiệp vào các payments của khách hàng này)
SELECT id FROM public.payments 
WHERE customer_id = $1 
ORDER BY id ASC 
FOR UPDATE;

-- GIAI ĐOẠN 2: Thực thi truy vấn tính toán số dư Unapplied Cash theo thứ tự FIFO
-- (Lúc này các hàng payments đã được khóa an toàn, kết quả aggregate được bảo vệ tuyệt đối)
SELECT p.id, p.amount,
       coalesce(sum(pa.allocated_amount), 0) AS allocated_total,
       (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied_amount
FROM public.payments p
LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
WHERE p.customer_id = $1
GROUP BY p.id, p.amount, p.paid_at
HAVING p.amount > coalesce(sum(pa.allocated_amount), 0)
ORDER BY p.paid_at ASC, p.id ASC;
```

### 3. Phân tích Khóa và Chống Deadlock (Deadlock Prevention Proof):
Mọi giao dịch phân bổ (cả Manual Trigger và Background Scheduler) đều bắt buộc tuân theo thứ tự khóa bất biến:
1. **Khóa 1 (Parent Lock):** Khóa hóa đơn thụ hưởng:
   `SELECT id FROM invoices WHERE id = $1 FOR UPDATE`
2. **Khóa 2 (Child Lock Pool):** Khóa toàn bộ các payments nguồn của khách hàng theo thứ tự ID tăng dần:
   `SELECT id FROM payments WHERE customer_id = $1 ORDER BY id ASC FOR UPDATE`

**Chứng minh không xảy ra Deadlock:**
Vì tất cả các tiến trình đều khóa `invoices` trước và khóa các `payments` theo đúng chiều ID tăng dần (`ORDER BY id ASC`), không có hiện tượng tiến trình X chờ tiến trình Y theo chiều ngược lại. Tình trạng Deadlock (`40P01`) bị triệt tiêu hoàn toàn.

---

## I. IDEMPOTENCY ANALYSIS & REPLAY SAFETY

1. **Khóa Cố vấn Cấp Giao dịch (Advisory Lock):**
   Trước khi truy vấn hoặc thay đổi dữ liệu, hàm tự động chiếm khóa:
   ```sql
   SELECT pg_advisory_xact_lock(hashtext('idemp_auto_alloc'), hashtext($1));
   ```
2. **Xác thực Dấu vân tay (Fingerprint Verification):**
   Dấu vân tay SHA-256 được tính toán dựa trên cặp định danh:
   ```javascript
   function computeAutoAllocateRequestFingerprint(customerId, invoiceId) {
     const normalized = {
       customerId: String(customerId),
       invoiceId: String(invoiceId)
     };
     return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
   }
   ```
3. **Phản hồi từ Cache (Idempotent Replay):**
   Nếu key đã tồn tại trong `payment_idempotency_keys`:
   - Khớp mã băm $\rightarrow$ Trả về kết quả đã lưu trong `response_body` kèm cờ `is_idempotent_replay: true`.
   - Khác mã băm $\rightarrow$ Ném lỗi `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
4. **Khóa Tất định cho Scheduler:**
   $\text{Key} = \text{RECURRING-AUTO-ALLOC-INV-}\{\text{invoiceId}\}\text{-PLAN-}\{\text{plan.id}\}$
   Bảo đảm rằng nếu scheduler được kích hoạt nhiều lần trong ngày, các lần chạy sau lập tức nhận diện là replay thành công và không trừ thêm tiền.

---

## J. AUDIT CHAIN INTEGRATION

Sự kiện kiểm toán được ghi nhận thông qua hàm `recordAudit` tại [app/src/audit.js](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/app/src/audit.js):

- **Điều kiện ghi nhận:** Chỉ ghi nhận khi `!result.is_idempotent_replay` (Ngăn chặn nhân đôi log kiểm toán trên các request gửi lại).
- **Thuộc tính bản ghi:**
  - `module`: `'payments'`
  - `action`: `'PAYMENT_AUTO_ALLOCATED'`
  - `targetRef`: Mã hóa đơn (Ví dụ: `INV-2026-000105`)
  - `severity`: `'INFO'`
  - `summary`: `Tự động phân bổ ${result.allocated_total} ₫ cho hóa đơn ${result.invoice_no} (Nguồn: ${source})`
  - `metadata`: Toàn bộ kết quả phân bổ chi tiết (`invoice_id`, `payment_ids`, `allocations_count`, `idempotency_key`).
- **Mã băm SHA-256:** Tự động lấy hash của bản ghi cuối cùng trong `public.audit_logs`, băm nối chuỗi bảo đảm tính bất biến 100%.

---

## K. FINANCIAL INVARIANTS (KIỂM CHỨNG BẤT BIẾN TÀI CHÍNH)

Hệ thống bảo đảm 3 phương trình cân đối không bao giờ bị vi phạm:

1. **Phương trình Bảo toàn Thanh toán:**
   $$\text{Payment.amount} = \text{Allocated Total} + \text{Unapplied Cash}$$
   *(Mỗi đồng tiền trích ra từ Unapplied Cash đều được chuyển hóa thành Allocation tương ứng, tổng tiền không đổi).*
2. **Phương trình Tất toán Hóa đơn:**
   $$\text{Invoice.paid\_total} = \sum \text{allocated\_amount}$$
   *(Giá trị `paid_total` của hóa đơn luôn bằng tổng các bản ghi phân bổ).*
3. **Giới hạn Thu tiền Hóa đơn:**
   $$\text{Invoice.paid\_total} + \text{Invoice.adjusted\_total} \le \text{Invoice.total}$$
   *(Được bảo vệ 2 lớp: Ở tầng ứng dụng và bởi Trigger `check_payment_allocation_invariants()` ở tầng database).*

---

## L. TEST STRATEGY & TEST SUITE DESIGN

Bộ kiểm thử tự động chuyên biệt [scripts/p1_3-auto-settlement-test.mjs](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/scripts/p1_3-auto-settlement-test.mjs) được thiết kế với 12 kịch bản độc lập:

| Test ID | Kịch bản Kiểm thử | Kỳ vọng Nghiệp vụ & Kỹ thuật |
| :---: | :--- | :--- |
| **T01** | Keyless Manual Trigger Rejection | Gọi API thiếu key $\rightarrow$ HTTP 400 `IDEMPOTENCY_KEY_REQUIRED`, DB biến động = 0. |
| **T02** | Single Payment Full Settlement | Tiền thừa > Hóa đơn $\rightarrow$ Hóa đơn chuyển `PAID`, số dư còn lại chính xác. |
| **T03** | Single Payment Partial Settlement | Tiền thừa < Hóa đơn $\rightarrow$ Hóa đơn chuyển `PARTIALLY_PAID`, tiền thừa hết sạch. |
| **T04** | Multi-Payment FIFO Settlement | Khách hàng có 3 payments thừa $\rightarrow$ Cấn trừ lần lượt theo ngày cũ nhất trước. |
| **T05** | Zero Unapplied Cash Rejection | Khách hàng hết tiền thừa $\rightarrow$ HTTP 400 `NO_UNAPPLIED_CASH_AVAILABLE`. |
| **T06** | Already Paid Invoice Rejection | Hóa đơn đã thanh toán $\rightarrow$ HTTP 400 `INVOICE_ALREADY_PAID`. |
| **T07** | Idempotent Replay Verification | Gửi lại cùng key $\rightarrow$ HTTP 200 `is_idempotent_replay: true`, không tạo allocation thứ 2. |
| **T08** | Payload Mismatch Detection | Cùng key nhưng gửi cho hóa đơn khác $\rightarrow$ HTTP 409 `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`. |
| **T09** | Scheduler Auto-Settlement Flow | Kích hoạt chu kỳ định kỳ $\rightarrow$ Hóa đơn tự động sinh và tự động cấn trừ ngay. |
| **T10** | Scheduler Disabled Configuration | Plan có `auto_settle_unapplied: false` $\rightarrow$ Hóa đơn sinh ra nhưng giữ nguyên `ISSUED`. |
| **T11** | Concurrency Race Condition Guard | 5 luồng gửi đồng thời $\rightarrow$ Đúng 1 luồng thành công, 4 luồng replay/đợi, không âm tiền. |
| **T12** | Database Forensics & Invariants | Chạy 8 truy vấn pháp y tài chính $\rightarrow$ 0 vi phạm trên toàn bộ cơ sở dữ liệu. |

---

## M. IMPLEMENTATION RISKS & MITIGATIONS

| Rủi ro Kỹ thuật | Mức độ | Biện pháp Xử lý Cụ thể |
| :--- | :--- | :--- |
| **PostgreSQL `FOR UPDATE` with `GROUP BY`** | **MEDIUM (Non-blocking)** | Thay thế bằng mô hình khóa 2 giai đoạn: Khóa các hàng `payments` trước, sau đó aggregate trên các hàng đã khóa. |
| **Scheduler Concurrency Deadlock** | **MEDIUM (Non-blocking)** | Chuẩn hóa thứ tự khóa bi quan: Luôn khóa `invoices` trước, sau đó khóa `payments` theo thứ tự ID tăng dần. |
| **Zero Balance Scheduler Abort** | **LOW** | Bắt lỗi `NO_UNAPPLIED_CASH_AVAILABLE` trong scheduler như một trạng thái bình thường, không hủy chu kỳ. |
| **Ô nhiễm Dữ liệu Kiểm thử** | **LOW** | Tạo khách hàng thử nghiệm riêng với mã tiền tố `P13-TEST-*`, không can thiệp dữ liệu lịch sử. |

---

## N. EXACT IMPLEMENTATION ORDER (TRÌNH TỰ THỰC THI CHUẨN XÁC)

Khi bước vào giai đoạn implementation chính thức, kỹ sư trưởng sẽ thực thi tuần tự theo 7 bước:

1. **Bước 1 — Migration:** Tạo và chạy `db/migrations/06_p1_3_recurring_auto_settlement.sql` (bổ sung cột `auto_settle_unapplied` và index).
2. **Bước 2 — Domain Service:** Cập nhật `app/src/services/paymentService.js` bổ sung hàm `autoAllocateUnappliedCash` với thuật toán khóa 2 giai đoạn và phân bổ FIFO.
3. **Bước 3 — API Endpoints:** Cập nhật `app/src/routes/invoices.js` (`POST /api/invoices/:id/auto-allocate`) và `app/src/routes/customers.js` (`GET /api/customers/:id/unapplied-balance`).
4. **Bước 4 — Background Scheduler:** Cập nhật `app/src/scheduler.js` tích hợp tự động cấn trừ với khóa tất định `RECURRING-AUTO-ALLOC-INV-...`.
5. **Bước 5 — Frontend UI:** Cập nhật `app/public/app.js` bổ sung nút cấn trừ tiền thừa và checkbox cấu hình hợp đồng.
6. **Bước 6 — Automated Testing:** Tạo và chạy bộ kiểm thử `scripts/p1_3-auto-settlement-test.mjs` (12/12 PASS).
7. **Bước 7 — Regression & Closure Audit:** Chạy toàn bộ 9 bộ test hồi quy hiện hành, kiểm tra 0 vi phạm bất biến và lập báo cáo Closure Audit.

---

## O. BLOCKERS & FINAL PREFLIGHT VERDICT

### A. Đánh giá Tồn đọng (Blocker Evaluation):
- **Kiến trúc cốt lõi:** Đầy đủ, vững chắc, sẵn sàng 100%.
- **Phân quyền cơ sở dữ liệu:** Role `billing_app` có đầy đủ quyền cần thiết, bảo đảm nguyên tắc Least Privilege.
- **Rủi ro kỹ thuật:** Cú pháp `FOR UPDATE` trong aggregate đã có giải pháp thay thế chuẩn mực tương đương mà không làm thay đổi ngữ nghĩa nghiệp vụ.
- **Không tồn tại bất kỳ Blocker nào ngăn cản việc triển khai.**

### B. Kết luận Preflight Chính thức:

```text
================================================================================
  FINAL PREFLIGHT VERDICT:
  P1.3 PREFLIGHT — READY WITH NON-BLOCKING RISKS
================================================================================
```

> [!IMPORTANT]
> **CHỈ THỊ DỪNG TUYỆT ĐỐI (ABSOLUTE STOP DIRECTIVE):**
> Giai đoạn Implementation Preflight kết thúc tại đây.
> - **TUYỆT ĐỐI KHÔNG SỬA SOURCE CODE.**
> - **TUYỆT ĐỐI KHÔNG TẠO MIGRATION.**
> - **TUYỆT ĐỐI KHÔNG THAY ĐỔI DATABASE.**
> Toàn bộ kế hoạch và phân tích kỹ thuật đã hoàn tất, sẵn sàng chuyển sang giai đoạn thực thi mã nguồn khi có lệnh chính thức từ Product Owner.
