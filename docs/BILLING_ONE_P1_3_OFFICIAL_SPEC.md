# BILLING_ONE — P1.3 OFFICIAL SPECIFICATION
## RECURRING BILLING AUTOMATED PAYMENT & UNAPPLIED CASH SETTLEMENT ENGINE
## PRODUCT OWNER APPROVED & SCOPE FROZEN SPECIFICATION

**Document Version:** 1.0.0 (FROZEN)  
**Approval Authority:** Product Owner & Senior Financial Systems Architect  
**Approved Date:** October 07, 2026  
**Target Milestone:** P1.3 Implementation  
**Baseline Git State:** Commit `d794de0461e992122a4c8eddadb1ead2082ae8ac` on branch `main`  
**Operational Status:** SCOPE FROZEN — SPECIFICATION SIGNED OFF — READY FOR IMPLEMENTATION  
**Operational Mode:** SPECIFICATION ONLY — Zero Code Modifications, Zero Migrations, Zero Schema Changes  

---

## 1. PRODUCT OBJECTIVE

Mục tiêu sản phẩm của giai đoạn **P1.3: Recurring Billing Automated Payment & Unapplied Cash Settlement Engine** là khép kín chu trình tự động hóa giữa **Doanh thu Thuê bao Định kỳ (Recurring Billing)** và **Dòng tiền Ký quỹ Chưa phân bổ (Unapplied Cash)**.

Trong thực tế vận hành kế toán doanh nghiệp B2B:
- Khách hàng ký hợp đồng định kỳ (SaaS, bảo trì, hạ tầng, dịch vụ mạng) thường thanh toán trước các khoản tiền lớn (tiền cọc, tiền trả trước theo quý/năm). Các khoản tiền này được ghi nhận vào hệ thống Billing_One dưới dạng **Unapplied Cash** thông qua mô hình Payment Allocation V2 (P1.2).
- Trước P1.3, khi background scheduler chạy định kỳ để sinh hóa đơn (`invoices`), hóa đơn mới phát hành luôn ở trạng thái chưa thanh toán (`ISSUED`), buộc kế toán viên phải rà soát và thực hiện phân bổ thủ công từng hóa đơn, gây lãng phí nhân lực và chậm trễ trong việc cập nhật công nợ thực tế.

**P1.3 giải quyết triệt để nút thắt này:**
Hệ thống cho phép khi hóa đơn định kỳ được phát hành (hoặc khi kế toán viên yêu cầu), hệ thống tự động trích xuất các khoản tiền thừa (Unapplied Cash) khả dụng của khách hàng theo thuật toán **FIFO (First In, First Out)** để tự động tất toán hóa đơn sang `PAID` hoặc `PARTIALLY_PAID`, đồng thời bảo đảm tính toàn vẹn tài chính, chống tương tranh và bảo tồn lịch sử kiểm toán bất biến.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       P1.3 END-TO-END BUSINESS FLOW                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │   Active Recurring Plan   │
                         │ (auto_settle_unapplied)   │
                         └─────────────┬─────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │      Generate Invoice     │
                         │    (DRAFT -> ISSUED)      │
                         └─────────────┬─────────────┘
                                       │
                                       ▼
                         ┌───────────────────────────┐
                         │ Check Customer Unapplied  │
                         │       Cash Balance        │
                         └─────────────┬─────────────┘
                                       │
                    ┌──────────────────┴──────────────────┐
                    ▼                                     ▼
        [Unapplied Cash > 0]                    [Unapplied Cash == 0]
                    │                                     │
                    ▼                                     ▼
     ┌─────────────────────────────┐           ┌─────────────────────┐
     │   FIFO Allocation Engine    │           │ Keep Invoice ISSUED │
     │ (paid_at ASC, payment.id ASC)           │   (No Allocation)   │
     └──────────────┬──────────────┘           └─────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
[Balance >= Invoice]   [Balance < Invoice]
         │                     │
         ▼                     ▼
┌──────────────────┐   ┌──────────────────┐
│ Invoice = PAID   │   │ Invoice =        │
│ (Allocated Full) │   │ PARTIALLY_PAID   │
└────────┬─────────┘   └────────┬─────────┘
         │                      │
         └──────────┬───────────┘
                    │
                    ▼
     ┌─────────────────────────────┐
     │ Cryptographic Audit Trail   │
     │   PAYMENT_AUTO_ALLOCATED    │
     └─────────────────────────────┘
```

---

## 2. OFFICIAL SCOPE

Phạm vi chính thức của P1.3 được Product Owner phê duyệt bao gồm:

1. **Động cơ Phân bổ Tự động FIFO (FIFO Auto-Allocation Engine):**
   - Mở rộng tầng domain `PaymentService` với hàm quy chuẩn `autoAllocateUnappliedCash`.
   - Tìm kiếm các khoản thanh toán của khách hàng có số dư chưa phân bổ (`unapplied_amount > 0`).
   - Sắp xếp thứ tự tiêu thụ theo nguyên tắc: `paid_at ASC`, sau đó `payment.id ASC` (khoản thanh toán cũ được ưu tiên dùng trước).
2. **Tích hợp Tự động hóa vào Background Scheduler (`app/src/scheduler.js`):**
   - Khi `runRecurringCycle` phát hành hóa đơn định kỳ cho hợp đồng có cấu hình `auto_settle_unapplied = true`:
   - Tự động gọi `PaymentService.autoAllocateUnappliedCash` với khóa Idempotency tất định:
     $$\text{Idempotency-Key} = \text{RECURRING-AUTO-ALLOC-INV-}\{\text{invoiceId}\}\text{-PLAN-}\{\text{plan.id}\}$$
3. **API Kích hoạt Cấn trừ Thủ công (Manual Trigger API):**
   - Cung cấp endpoint: `POST /api/invoices/:id/auto-allocate`.
   - Cho phép kế toán viên chủ động yêu cầu hệ thống cấn trừ tiền thừa cho một hóa đơn cụ thể.
   - Bắt buộc kiểm tra quyền hạn, xác thực phiên và yêu cầu header `Idempotency-Key`.
4. **API Tra cứu Số dư Tiền thừa Khách hàng (Customer Unapplied Balance API):**
   - Cung cấp endpoint: `GET /api/customers/:id/unapplied-balance`.
   - Phục vụ giao diện người dùng hiển thị trực quan số tiền ký quỹ còn lại và danh sách các khoản thanh toán khả dụng.
5. **Cấu hình Hợp đồng Định kỳ (`public.recurring_plans`):**
   - Bổ sung trường: `auto_settle_unapplied boolean NOT NULL DEFAULT true`.
6. **Bảo tồn Tuyệt đối Bất biến Kế toán & Kiểm toán:**
   - 100% các phân bổ mới ghi nhận vào `payment_allocations` có ghi chú nguồn gốc.
   - Ghi nhận sự kiện kiểm toán bất biến `PAYMENT_AUTO_ALLOCATED` vào `public.audit_logs` với liên kết băm SHA-256.

---

## 3. OUT-OF-SCOPE (CÁC HẠNG MỤC LOẠI TRỪ TUYỆT ĐỐI)

Product Owner xác nhận các hạng mục sau **HOÀN TOÀN BỊ LOẠI TRỪ** khỏi P1.3:

- **Refund Cash Outflow / Disbursement:** Không xây dựng module xuất tiền mặt/phiếu chi chi trả nợ hoàn tiền (`refund_payables.paid_payment_id` tiếp tục giữ nguyên hiện trạng).
- **Customer Credit Limit Hard Enforcement:** Không can thiệp logic chặn phát hành hóa đơn theo hạn mức tín dụng khách hàng.
- **Tích hợp Cổng Thanh toán Bên ngoài:** Không tích hợp VNPay, MoMo, ZaloPay, Stripe hay cổng trung gian thanh toán ngoài.
- **E-Invoice CQT / T-VAN Thực tế:** Không ký số XML-DSig, không gửi dữ liệu tới Tổng cục Thuế.
- **Đa Tiền tệ (Multi-currency FX):** Hệ thống chỉ hạch toán nguyên tệ Việt Nam Đồng (VND, `NUMERIC(14,2)`).
- **Tái cấu trúc (Redesign):** Tuyệt đối không thay đổi cấu trúc Payment Allocation V2, không sửa đổi hạ tầng Idempotency P1.2.2, không thay đổi hệ thống RBAC hay kiến trúc N-tier hiện hành.

---

## 4. BUSINESS RULES (CÁC QUY TẮC NGHIỆP VỤ BẮT BUỘC)

| Mã Quy tắc | Tên Quy tắc | Nội dung Chi tiết |
| :--- | :--- | :--- |
| **BR-1.3-01** | **Recurring Invoice Auto-Settlement** | Hóa đơn định kỳ phát sinh từ hợp đồng có `auto_settle_unapplied = true` được tự động tìm kiếm và cấn trừ tiền thừa của khách hàng ngay sau khi phát hành. |
| **BR-1.3-02** | **Strict FIFO Policy** | Thứ tự ưu tiên tiêu thụ tiền thừa bắt buộc tuân theo: `paid_at ASC`, tiếp theo `payment.id ASC`. Tuyệt đối không dùng LIFO hay phân bổ ngẫu nhiên. |
| **BR-1.3-03** | **Partial Settlement Support** | Nếu số dư tiền thừa không đủ tất toán 100% hóa đơn, hệ thống cấn trừ toàn bộ số dư khả dụng, đưa hóa đơn về `PARTIALLY_PAID`. |
| **BR-1.3-04** | **Zero Over-Allocation** | Tổng phân bổ vào một hóa đơn không bao giờ được vượt quá giá trị phải thu còn lại: $\sum \text{allocations} \le \text{total} - \text{adjusted\_total}$. |
| **BR-1.3-05** | **Canonical Service Reuse** | Background scheduler và Manual Trigger endpoint bắt buộc phải gọi chung một domain service (`PaymentService.autoAllocateUnappliedCash`), không viết logic SQL phân bổ trùng lặp ở tầng route. |
| **BR-1.3-06** | **Mandatory Idempotency** | Mọi yêu cầu cấn trừ tài chính phải có định danh `Idempotency-Key`. Scheduler tạo key tất định; API manual trigger yêu cầu header. |
| **BR-1.3-07** | **Scheduler Idempotent Replay** | Khi một chu kỳ định kỳ chạy lại cho cùng một hóa đơn, hệ thống phát hiện idempotency key đã xử lý và bỏ qua, tuyệt đối không nhân đôi phân bổ. |
| **BR-1.3-08** | **No New Payment Record** | Cấn trừ tiền thừa chỉ tạo bản ghi mới trong `payment_allocations`. Tuyệt đối không tạo thêm bản ghi mới trong bảng `payments`. |
| **BR-1.3-09** | **Mandatory Audit Trail** | Mọi thao tác phân bổ tự động thành công đều phải ghi nhận sự kiện `PAYMENT_AUTO_ALLOCATED` vào chuỗi băm SHA-256 của `audit_logs`. |
| **BR-1.3-10** | **Zero Regression** | 100% các bộ kiểm thử P0, P1.1, P1.2, P1.2.1, P1.2.2 và 26 chốt chặn an ninh H1–H6 phải tiếp tục PASS. |

---

## 5. FUNCTIONAL REQUIREMENTS (YÊU CẦU CHỨC NĂNG CHI TIẾT)

### FR-1.3-01: Thuật toán Phân bổ FIFO trong `PaymentService`
Hàm nghiệp vụ mới trong `app/src/services/paymentService.js`:
```javascript
async function autoAllocateUnappliedCash(pool, {
  customerId,
  invoiceId,
  recordedBy,
  idempotencyKey,
  source = 'MANUAL' // 'SCHEDULER' | 'MANUAL'
})
```
**Quy trình thực thi:**
1. **Kiểm tra Idempotency:** Tra cứu `payment_idempotency_keys` với `idempotencyKey`. Nếu đã tồn tại:
   - So sánh `request_hash`. Nếu khớp, trả về cached response (`is_idempotent_replay: true`).
   - Nếu không khớp hash, ném lỗi `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.
2. **Khóa Tương tranh Bi quan (Pessimistic Row Locking):** Mở transaction và khóa theo thứ tự nghiêm ngặt:
   - Khóa bản ghi hóa đơn: `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`.
   - Kiểm tra điều kiện hóa đơn: Phải thuộc `customerId`, trạng thái phải là `ISSUED` hoặc `PARTIALLY_PAID`.
   - Tính toán số tiền còn thiếu của hóa đơn:
     $$\text{outstandingAmount} = \text{total} - \text{paid\_total} - \text{adjusted\_total}$$
   - Nếu $\text{outstandingAmount} \le 0$: Báo lỗi `INVOICE_ALREADY_PAID`.
3. **Tìm kiếm Tiền thừa Khả dụng (FIFO Query):**
   - Khóa các bản ghi payment của khách hàng có số dư khả dụng theo thứ tự ID:
     ```sql
     SELECT p.id, p.amount,
            coalesce(sum(pa.allocated_amount), 0) AS allocated_total,
            (p.amount - coalesce(sum(pa.allocated_amount), 0)) AS unapplied_amount
     FROM public.payments p
     LEFT JOIN public.payment_allocations pa ON pa.payment_id = p.id
     WHERE p.customer_id = $1
     GROUP BY p.id, p.amount, p.paid_at
     HAVING p.amount > coalesce(sum(pa.allocated_amount), 0)
     ORDER BY p.paid_at ASC, p.id ASC
     FOR UPDATE OF p;
     ```
4. **Vòng lặp Phân bổ (Allocation Loop):**
   - Khởi tạo `remainingToAllocate = outstandingAmount`.
   - Lặp qua từng payment khả dụng:
     - Số tiền phân bổ từ payment này:
       $$\text{allocAmount} = \min(\text{payment.unapplied\_amount}, \text{remainingToAllocate})$$
     - Thêm bản ghi vào `payment_allocations`:
       - `payment_id`: payment.id
       - `invoice_id`: invoiceId
       - `allocated_amount`: allocAmount
       - `created_by`: recordedBy
       - `notes`: `source === 'SCHEDULER' ? 'Tự động cấn trừ theo chu kỳ thuê bao định kỳ' : 'Kế toán cấn trừ tự động từ tiền thừa'`
     - Giảm `remainingToAllocate = remainingToAllocate - allocAmount`.
     - Nếu `remainingToAllocate == 0`: Dừng vòng lặp.
5. **Cập nhật Trạng thái Hóa đơn:**
   - Cập nhật `invoices.paid_total = paid_total + totalAllocated`.
   - Nếu $\text{paid\_total} \ge \text{total} - \text{adjusted\_total}$: Cập nhật `status = 'PAID'`.
   - Ngược lại: Cập nhật `status = 'PARTIALLY_PAID'`.
6. **Lưu vết Idempotency & Ghi Audit Log:**
   - `INSERT INTO payment_idempotency_keys` lưu lại body phản hồi.
   - Ghi nhận `PAYMENT_AUTO_ALLOCATED` vào `audit_logs` (bỏ qua nếu là idempotent replay).

---

## 6. SCHEDULER POLICY & DETERMINISTIC KEY DERIVATION

### A. Tích hợp trong `app/src/scheduler.js`
Tại vòng lặp xử lý hợp đồng định kỳ trong hàm `runRecurringCycle`:
- Sau khi phát hành hóa đơn (`invoices`) sang trạng thái `ISSUED` (hoặc sau bước `auto_sign`):
- Kiểm tra điều kiện:
  ```javascript
  if (plan.auto_settle_unapplied) {
    const autoAllocKey = `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`;
    await PaymentService.autoAllocateUnappliedCash(pool, {
      customerId: plan.customer_id,
      invoiceId: invoiceId,
      recordedBy: 1, // System User ID
      idempotencyKey: autoAllocKey,
      source: 'SCHEDULER'
    });
  }
  ```

### B. Quy tắc Sinh Khóa Tất định (Deterministic Key Generation):
- **Cấu trúc:** `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`
- **Tính chất:**
  - Không chứa `Date.now()` hay ngẫu nhiên làm phần duy nhất.
  - Mỗi hóa đơn phát sinh từ 1 plan chỉ có duy nhất 1 khóa phân bổ tương ứng.
  - Nếu scheduler bị restart hoặc chạy lại trong cùng một ngày/chu kỳ: Thao tác sẽ được nhận diện là **Idempotent Replay**, trả về kết quả đã cấn trừ và **không trừ thêm tiền**.

---

## 7. MANUAL TRIGGER POLICY & API CONTRACT

### A. Endpoint Cấn trừ Tiền thừa Thủ công
- **Method & Route:** `POST /api/invoices/:id/auto-allocate`
- **Quyền hạn truy cập:** `requireAuth`, người dùng có quyền cập nhật hóa đơn / thanh toán (`admin` hoặc `staff`).
- **Idempotency Header:** **BẮT BUỘC (MANDATORY)**:
  `Idempotency-Key: <unique-key-from-client>`
- **Hành vi xử lý:**
  - Trích xuất `Idempotency-Key` qua `extractAndRequireIdempotencyKey(req)`.
  - Gọi xuống `PaymentService.autoAllocateUnappliedCash` với `source: 'MANUAL'`.
  - Nếu hóa đơn được phân bổ $\rightarrow$ trả về HTTP `201 Created` (lần đầu) hoặc HTTP `200 OK` (gửi lại).
  - Nếu khách hàng không có tiền thừa khả dụng $\rightarrow$ trả về HTTP `400 NO_UNAPPLIED_CASH_AVAILABLE`.

### B. Endpoint Tra cứu Số dư Tiền thừa Khách hàng
- **Method & Route:** `GET /api/customers/:id/unapplied-balance`
- **Mục đích:** Cung cấp thông tin số dư ký quỹ để hiển thị trên UI.
- **Quyền hạn:** `requireAuth`.
- **Cấu trúc dữ liệu trả về:**
  ```json
  {
    "customer_id": 12,
    "customer_name": "Công ty TNHH Phần Mềm Đại Dương",
    "total_unapplied_cash": "15000000.00",
    "available_payments_count": 2,
    "payments": [
      {
        "id": 410,
        "amount": "10000000.00",
        "allocated_amount": "0.00",
        "unapplied_amount": "10000000.00",
        "paid_at": "2026-10-01",
        "method": "BANK_TRANSFER",
        "reference": "BANK-TX-1001"
      },
      {
        "id": 412,
        "amount": "8000000.00",
        "allocated_amount": "3000000.00",
        "unapplied_amount": "5000000.00",
        "paid_at": "2026-10-05",
        "method": "BANK_TRANSFER",
        "reference": "BANK-TX-1002"
      }
    ]
  }
  ```

---

## 8. CONCURRENCY & LOCK ORDERING POLICY

Khi Background Scheduler và Kế toán viên bấm Manual Trigger chạy đồng thời cho cùng một khách hàng hoặc cùng một hóa đơn, nguy cơ xung đột tài chính được triệt tiêu bằng chính sách khóa có thứ tự:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       STRICT LOCK ORDERING PROTOCOL                         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼ Bước 1
                     ┌───────────────────────────────────┐
                     │   PostgreSQL Advisory Lock        │
                     │  pg_advisory_xact_lock(hashtext)  │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼ Bước 2
                     ┌───────────────────────────────────┐
                     │   Invoice Row Lock (Parent Lock)  │
                     │    SELECT ... FROM invoices       │
                     │            FOR UPDATE             │
                     └─────────────────┬─────────────────┘
                                       │
                                       ▼ Bước 3
                     ┌───────────────────────────────────┐
                     │  Payments Pool Lock (Child Lock)  │
                     │    SELECT ... FROM payments       │
                     │   ORDER BY id ASC FOR UPDATE      │
                     └───────────────────────────────────┘
```

1. **Advisory Lock:** Khóa cố vấn cấp giao dịch dựa trên mã băm của `Idempotency-Key` bảo đảm 2 request trùng key không thể chạy song song.
2. **Thứ tự khóa thực thể (Deadlock Prevention):**
   - Luôn khóa hàng Hóa đơn (`invoices`) trước.
   - Luôn khóa các hàng Thanh toán (`payments`) theo thứ tự tăng dần của ID (`ORDER BY p.id ASC`).
   - Mọi tiến trình cạnh tranh tranh chấp cùng tài nguyên sẽ được xếp hàng tuần tự thay vì gây ra lỗi Deadlock (`40P01`).

---

## 9. FINANCIAL INVARIANTS PRESERVATION

P1.3 cam kết duy trì tuyệt đối các phương trình bất biến tài chính của Billing_One:

### Bất biến 1: Cân đối Thanh toán (Payment Integrity)
Với mọi khoản thanh toán $P$:
$$P.\text{amount} = \sum_{A \in \text{Allocations}(P)} A.\text{allocated\_amount} + P.\text{unapplied\_amount}$$

### Bất biến 2: Cân đối Hóa đơn (Invoice Settlement Integrity)
Với mọi hóa đơn $I$:
$$I.\text{paid\_total} = \sum_{A \in \text{Allocations}(I)} A.\text{allocated\_amount}$$

### Bất biến 3: Giới hạn Dung lượng Hóa đơn (Invoice Collectible Capacity)
Với mọi hóa đơn $I$:
$$I.\text{paid\_total} + I.\text{adjusted\_total} \le I.\text{total}$$
*(Được giám sát và cưỡng chế tự động bởi Database Trigger `check_payment_allocation_invariants()`)*.

---

## 10. DATABASE IMPACT & MIGRATION SPECIFICATION

### A. Tệp Migration Dự kiến: `db/migrations/06_p1_3_recurring_auto_settlement.sql`
- **Tính chất:** Rerun-safe, Idempotent, Non-destructive, Transaction-safe.
- **Nội dung kỹ thuật:**
  ```sql
  BEGIN;

  -- 1. Bổ sung cấu hình auto_settle_unapplied cho recurring_plans
  DO $$
  BEGIN
      IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_schema = 'public' 
            AND table_name = 'recurring_plans' 
            AND column_name = 'auto_settle_unapplied'
      ) THEN
          ALTER TABLE public.recurring_plans 
          ADD COLUMN auto_settle_unapplied boolean NOT NULL DEFAULT true;
      END IF;
  END $$;

  -- 2. Chỉ mục hỗ trợ truy vấn FIFO nhanh cho Unapplied Cash
  CREATE INDEX IF NOT EXISTS payments_customer_fifo_idx 
  ON public.payments (customer_id, paid_at ASC, id ASC);

  COMMIT;
  ```

---

## 11. FRONTEND UI SPECIFICATION

Các điều chỉnh giao diện trên Single Page Application (`app/public/app.js`):

1. **Màn hình Chi tiết Hóa đơn (`#/invoices/:id`):**
   - Khi hóa đơn chưa tất toán (`ISSUED` hoặc `PARTIALLY_PAID`):
   - Tự động gọi API `GET /api/customers/:customerId/unapplied-balance`.
   - Nếu `total_unapplied_cash > 0`: Hiển thị thanh thông báo màu xanh ngọc:
     > 💡 *Khách hàng đang có **{total_unapplied_cash} ₫** tiền thừa ký quỹ.*
   - Hiển thị nút bấm: **`[⚡ Cấn trừ từ tiền thừa]`**.
   - Bấm nút $\rightarrow$ Hiển thị xác nhận $\rightarrow$ Gửi request `POST /api/invoices/:id/auto-allocate` kèm `Idempotency-Key` sinh bằng `crypto.randomUUID()`.
2. **Màn hình Quản lý Hợp đồng Định kỳ (`#/recurring`):**
   - Trong Modal Tạo/Sửa Hợp đồng: Thêm Checkbox:
     > ☑️ *Tự động cấn trừ tiền thừa (Unapplied Cash) khi phát hành hóa đơn định kỳ*
   - Mặc định được tick chọn (`checked = true`).

---

## 12. AUDIT LOGGING REQUIREMENTS

Mọi sự kiện phân bổ tự động thành công bắt buộc phát sinh bản ghi kiểm toán mật mã:

```json
{
  "module": "payments",
  "action": "PAYMENT_AUTO_ALLOCATED",
  "severity": "INFO",
  "actor": "req.user.username (nếu manual) | 'SYSTEM/SCHEDULER' (nếu cron)",
  "target_ref": "INV-2026-000105",
  "summary": "Tự động phân bổ 2,500,000 ₫ từ 1 khoản tiền thừa cho hóa đơn INV-2026-000105 (Nguồn: SCHEDULER)",
  "metadata": {
    "invoice_id": 105,
    "invoice_no": "INV-2026-000105",
    "allocated_total": "2500000.00",
    "allocations_count": 1,
    "payment_ids": [415],
    "idempotency_key": "RECURRING-AUTO-ALLOC-INV-105-PLAN-3",
    "invoice_status": "PAID"
  }
}
```

---

## 13. SECURITY, RBAC & LEAST PRIVILEGE

1. **Cơ chế Phân quyền Role:**
   - User `billing_app` tiếp tục chỉ sử dụng các quyền `INSERT` trên `payment_allocations`, `UPDATE` trên `invoices` và `INSERT/SELECT` trên `payment_idempotency_keys`.
   - Quyền `UPDATE/DELETE` trên `payments` và `payment_idempotency_keys` tiếp tục bị cấm tuyệt đối.
2. **Bảo vệ Endpoint:**
   - Endpoint `POST /api/invoices/:id/auto-allocate` yêu cầu bắt buộc đăng nhập (`requireAuth`).
   - Cấm người dùng chưa đăng nhập hoặc user bị khóa (`is_active = false`).

---

## 14. TEST REQUIREMENTS & MATRIX

Bộ kiểm thử chuyên biệt `scripts/p1_3-auto-settlement-test.mjs` sẽ bao gồm 12 ca kiểm thử bắt buộc:

1. **Test 1: Keyless Manual Trigger Rejection:** Gọi `POST /api/invoices/:id/auto-allocate` không có `Idempotency-Key` $\rightarrow$ Nhận lỗi HTTP 400 và Zero DB Mutation.
2. **Test 2: Single Payment Full Settlement:** Tiền thừa lớn hơn hóa đơn $\rightarrow$ Phân bổ đủ, hóa đơn chuyển sang `PAID`, số dư tiền thừa còn lại chính xác.
3. **Test 3: Single Payment Partial Settlement:** Tiền thừa nhỏ hơn hóa đơn $\rightarrow$ Phân bổ hết tiền thừa, hóa đơn chuyển sang `PARTIALLY_PAID`.
4. **Test 4: Multi-Payment FIFO Settlement:** Khách hàng có 3 khoản tiền thừa $\rightarrow$ Hệ thống cấn trừ chính xác theo thứ tự ngày thanh toán cũ nhất trước.
5. **Test 5: Zero Unapplied Cash Rejection:** Khách hàng không có tiền thừa $\rightarrow$ Trả về lỗi `400 NO_UNAPPLIED_CASH_AVAILABLE`.
6. **Test 6: Already Paid Invoice Rejection:** Hóa đơn đã thanh toán đủ $\rightarrow$ Trả về lỗi `400 INVOICE_ALREADY_PAID`.
7. **Test 7: Idempotent Replay Verification:** Gửi lại cùng `Idempotency-Key` $\rightarrow$ Trả về HTTP 200 kèm `is_idempotent_replay: true` và không tạo thêm allocation.
8. **Test 8: Payload / Target Conflict:** Cùng key nhưng gửi cho hóa đơn khác $\rightarrow$ Nhận lỗi HTTP 409 Mismatch.
9. **Test 9: Scheduler Auto-Settlement Integration:** Kích hoạt `runRecurringCycle` $\rightarrow$ Hóa đơn định kỳ được tự động cấn trừ ngay lập tức.
10. **Test 10: Scheduler Disabled Configuration:** Plan có `auto_settle_unapplied = false` $\rightarrow$ Hóa đơn sinh ra nhưng giữ nguyên `ISSUED`, không cấn trừ.
11. **Test 11: Concurrency Advisory Lock Guard:** 5 luồng cùng cấn trừ đồng thời $\rightarrow$ Đúng 1 luồng tạo allocation, 4 luồng replay/xếp hàng, không âm tiền.
12. **Test 12: Financial Invariants & Forensics:** Chạy 8 truy vấn pháp y tài chính $\rightarrow$ Xác nhận 0 vi phạm bất biến trên toàn bộ cơ sở dữ liệu.

---

## 15. ACCEPTANCE CRITERIA (TIÊU CHÍ NGHIỆM THU CHÍNH THỨC)

Giai đoạn P1.3 chỉ được xem là hoàn tất và cấp chứng nhận khi:

- [ ] Migration `06_p1_3_recurring_auto_settlement.sql` chạy an toàn, idempotent.
- [ ] Hàm `PaymentService.autoAllocateUnappliedCash` hoạt động chuẩn xác theo thuật toán FIFO.
- [ ] Endpoint `POST /api/invoices/:id/auto-allocate` bảo vệ bằng `Idempotency-Key` (HTTP 400 khi thiếu key, HTTP 409 khi xung đột).
- [ ] Endpoint `GET /api/customers/:id/unapplied-balance` trả về đúng số dư tiền thừa.
- [ ] Background scheduler tự động cấn trừ tiền thừa khi phát hành hóa đơn định kỳ.
- [ ] Không tạo bản ghi `payments` mới khi cấn trừ tiền thừa.
- [ ] Mọi phân bổ tự động phát sinh bản ghi kiểm toán SHA-256 trong `audit_logs`.
- [ ] Toàn bộ 12/12 bài test trong `scripts/p1_3-auto-settlement-test.mjs` đạt PASS 100%.
- [ ] Toàn bộ 09 bộ kiểm thử hồi quy (P0, P1.1, P1.2, P1.2.1, P1.2.2, CP2 Smoke, Extended Features, Security Hardening 26/26, Audit Hash 941/941) duy trì 100% PASS.
- [ ] Pháp y tài chính xác nhận **0 vi phạm bất biến**.

---

## 16. KNOWN LIMITATIONS

1. **Khách hàng Không có Tiền thừa:** Nếu khách hàng không có Unapplied Cash, hóa đơn định kỳ vẫn được phát hành ở trạng thái `ISSUED` bình thường; hệ thống không tạo giao dịch tiền giả.
2. **Không Can thiệp Tỷ giá:** Toàn bộ dòng tiền tính toán theo VND.
3. **Phân bổ Toàn bộ hoặc Theo Thứ tự:** Thuật toán tự động tuân thủ nghiêm ngặt FIFO; kế toán viên nếu muốn phân bổ chỉ định số tiền lẻ tùy ý cho từng payment cụ thể vẫn có thể sử dụng màn hình phân bổ chi tiết hiện có của P1.2 (`POST /api/payments/:id/allocations`).

---

## 17. TRACEABILITY TO DISCOVERY REPORT

Đặc tả kỹ thuật này kế thừa trực tiếp và giải quyết trọn vẹn 4 câu hỏi mở đã nêu trong [BILLING_ONE_P1_3_PRE_IMPLEMENTATION_DISCOVERY.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_3_PRE_IMPLEMENTATION_DISCOVERY.md):

1. **Phạm vi Chính thức:** Được chốt cố định tại Kịch bản 1 — *Recurring Billing Automated Payment & Unapplied Cash Settlement Engine*.
2. **Chiến lược Phân bổ:** Chốt cố định chính sách **FIFO** (`paid_at ASC, id ASC`).
3. **Cơ chế Can thiệp:** Cung cấp song song cả **Background Scheduler** (tự động) và **Manual Trigger API** (thủ công qua nút bấm UI).
4. **Xử lý Hóa đơn Định kỳ:** Cấu hình linh hoạt qua cờ `auto_settle_unapplied` (mặc định: `true`).

---

## 18. FINAL VERDICT & STOP DIRECTIVE

Căn cứ vào sự phê duyệt và đóng băng phạm vi chính thức từ Product Owner:

```text
================================================================================
  FINAL VERDICT:
  P1.3 OFFICIAL SCOPE FROZEN — READY FOR IMPLEMENTATION
================================================================================
```

> [!IMPORTANT]
> **CHỈ THỊ DỪNG TUYỆT ĐỐI (ABSOLUTE STOP DIRECTIVE):**
> Giai đoạn Đặc tả Kỹ thuật (Official Specification) hoàn thành tại đây.
> - **TUYỆT ĐỐI KHÔNG BẮT ĐẦU VIẾT MÃ NGUỒN.**
> - **TUYỆT ĐỐI KHÔNG TẠO MIGRATION.**
> - **TUYỆT ĐỐI KHÔNG CHỈNH SỬA DATABASE HOẶC API.**
> Việc triển khai mã nguồn thực tế sẽ được bắt đầu trong phiên làm việc kế tiếp khi có chỉ thị implementation chính thức.
