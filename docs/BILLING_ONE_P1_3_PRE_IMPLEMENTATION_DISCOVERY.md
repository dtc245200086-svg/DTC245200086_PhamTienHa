# BILLING_ONE — P1.3 PRE-IMPLEMENTATION DISCOVERY REPORT
## OFFICIAL SCOPE DISCOVERY, ARCHITECTURAL REVIEW & IMPLEMENTATION PLAN
## PRE-IMPLEMENTATION DISCOVERY ONLY — ZERO IMPLEMENTATION

**Role:** Senior Technical Lead, Business Systems Architect & Financial Systems Engineer  
**Discovery Target:** Official Scope Discovery, Dependency Analysis & Architecture Plan for P1.3  
**Discovery Date:** October 07, 2026  
**Baseline Commit:** `d794de0461e992122a4c8eddadb1ead2082ae8ac` on branch `main`  
**Operational Status:** DISCOVERY COMPLETE — BASELINE VERIFIED — SCOPE AMBIGUITY IDENTIFIED  
**Operational Mode:** STRICT DISCOVERY ONLY — Zero Code Modifications, Zero Schema Changes, Zero Migrations, Zero Test Data Deletion  

---

## 1. EXECUTIVE SUMMARY

Tài liệu này là **Báo cáo Khảo sát & Đánh giá Tiền Triển khai (Pre-Implementation Discovery Report)** chính thức cho giai đoạn tiếp theo của hệ thống Billing_One, được thực hiện ngay sau khi hoàn tất Mốc Bàn Giao Kỹ Thuật [BILLING_ONE_P1_2_FINAL_HANDOFF_CHECKPOINT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_FINAL_HANDOFF_CHECKPOINT.md).

### A. Hiện trạng Baseline Kỹ thuật Đã Kiểm chứng (Verified Baseline)
- **Git State:** Nhánh `main`, commit HEAD `d794de0461e992122a4c8eddadb1ead2082ae8ac`.
- **P1.2 Payment Allocation V2:** Đã kiểm chứng độc lập (1 Payment $\rightarrow$ N Allocations $\rightarrow$ N Invoices; Unapplied Cash Ledger; Invariant Triggers).
- **P1.2.1 & P1.2.2 Idempotency & Least-Privilege:** Đã kiểm chứng độc lập (100% financial mutation bắt buộc có `Idempotency-Key`; Keyless request trả về HTTP 400 và Zero Financial Effect; `billing_app` có quyền Append-Only trên bảng idempotency).
- **Bất biến tài chính (Financial Invariants):** **0 vi phạm** trên toàn bộ 391 payments ($2,714,580,250.00$ ₫), 366 allocations ($2,575,080,250.00$ ₫) và $139,500,000.00$ ₫ unapplied cash.
- **An ninh & Kiểm toán:** 26/26 kiểm tra bảo mật H1–H6 PASS; 941/941 bản ghi chuỗi băm SHA-256 (`audit_logs`) toàn vẹn 100%.

### B. Phát hiện Cốt lõi của Đợt Khảo sát (Core Discovery Finding)
Kiểm toán viên kỹ thuật đã tiến hành rà soát pháp y toàn bộ kho tài liệu của dự án:
1. `AGENT_MASTER_INSTRUCTIONS.md` & `AGENT_BILLING_ONE_LEDGERFLOW_MASTER_EXECUTION_PROMPT.md`: Xác định LedgerFlow là hệ thống tham chiếu nghiệp vụ, Billing_One là hệ thống chính.
2. `docs/BILLING_ONE_FEATURE_ROADMAP.md`: Định nghĩa 15 giai đoạn tổng thể (từ Phase 1 đến Phase 15), nhưng **không có phân rã chi tiết mang tên "P1.3"**.
3. `docs/FUTURE_SYSTEM_EVOLUTION_PROPOSAL.md`: Định nghĩa 9 giai đoạn chiến lược (từ Phase 0 đến Phase 8) và Top 10 ưu tiên, nhưng **không có định nghĩa cụ thể cho "P1.3"**.
4. Các báo cáo kiểm toán trước đó ([BILLING_ONE_P1_2_1_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_1_CLOSURE_AUDIT.md), [BILLING_ONE_P1_1_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_1_CLOSURE_AUDIT.md)) có nhắc tới các định hướng kế tiếp như:
   - *"Mở rộng sang các luồng thanh toán tự động (Automation/Recurring) ở P1.3"* (P1.2.1 Closure Audit, dòng 330).
   - *"Triển khai module Chi hoàn trả tiền mặt (Cash Outflow / Voucher Out) trong giai đoạn tiếp theo (P2)"* (P1.1 Closure Audit, dòng 452).
   - *"Customer Credit Profile / Credit Limit"* (Roadmap Phase 4).

### C. Kết luận & Quyết định Handoff
Theo đúng nguyên tắc tối thượng **"KHÔNG tự suy đoán P1.3 từ tên phase. P1.3 phải được xác định từ tài liệu chính thức của project. Nếu tài liệu roadmap không đủ để xác định P1.3: KHÔNG TỰ ĐOÁN. Ghi rõ phần còn thiếu"**:
- Báo cáo này chính thức phân tích 4 kịch bản phạm vi tiềm năng (Candidate Scopes), phân rã chi tiết kiến trúc, dữ liệu, bảo mật, tài chính và rủi ro cho từng kịch bản.
- Trạng thái nghiệm thu khảo sát được xác lập: **`P1.3 DISCOVERY BLOCKED — REQUIREMENT AMBIGUITY / BASELINE ISSUE`**.
- Hệ thống dừng lại hoàn toàn, không tự ý viết code, không tự ý sửa schema cho tới khi Product Owner chính thức phê duyệt phạm vi nghiệp vụ cho P1.3.

---

## 2. OFFICIAL P1.3 SCOPE ANALYSIS

Qua phân tích có hệ thống tất cả các nguồn tài liệu của dự án, phạm vi của giai đoạn tiếp theo (P1.3) xuất hiện dưới 4 kịch bản ứng viên (Candidate Scopes):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       P1.3 CANDIDATE SCOPE MATRIX                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
         ┌─────────────────────────────┼─────────────────────────────┐
         ▼                             ▼                             ▼
┌───────────────────┐        ┌───────────────────┐        ┌───────────────────┐
│   CANDIDATE 1     │        │   CANDIDATE 2     │        │   CANDIDATE 3     │
│ Recurring Payment │        │ Refund Cash       │        │ Customer Credit & │
│ Auto-Settlement   │        │ Outflow Ledger    │        │ Financial Profile │
├───────────────────┤        ├───────────────────┤        ├───────────────────┤
│ Tự động tất toán  │        │ Xuất tiền chi trả │        │ Hạn mức tín dụng  │
│ hóa đơn định kỳ   │        │ nợ hoàn tiền      │        │ & tài khoản ký    │
│ từ Unapplied Cash │        │ (Cash Outflow)    │        │ quỹ khách hàng    │
└───────────────────┘        └───────────────────┘        └───────────────────┘
```

### Kịch bản 1: Recurring Billing Automated Payment & Settlement Engine (Độ khớp cao nhất với P1.2.1 Audit)
- **Nguồn trích dẫn:** [BILLING_ONE_P1_2_1_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_1_CLOSURE_AUDIT.md) dòng 330:
  > *"Rủi ro này cần được chốt chặn trước khi mở rộng sang các luồng thanh toán tự động (Automation/Recurring) ở P1.3."*
- **Bài toán nghiệp vụ:** Hiện tại, module `app/src/scheduler.js` và `app/src/routes/recurring.js` chỉ tự động sinh hóa đơn (`invoices`) ở trạng thái `DRAFT` hoặc `ISSUED` (nếu `auto_sign: true`). Hóa đơn định kỳ sau khi sinh ra **vẫn ở trạng thái chưa thanh toán (`ISSUED`)**, ngay cả khi khách hàng đang có số dư tiền thừa ký quỹ (Unapplied Cash).
- **Phạm vi giải quyết:**
  - Tích hợp động cơ tự động phân bổ tiền (Auto-allocation): Khi một hóa đơn định kỳ được sinh ra hoặc đến hạn, hệ thống tự động kiểm tra số dư Unapplied Cash của khách hàng. Nếu đủ tiền, tự động tạo `payment_allocations` từ khoản tiền thừa hiện có để tất toán hóa đơn sang `PAID` hoặc `PARTIALLY_PAID`.
  - Áp dụng triệt để khóa cố vấn `pg_advisory_xact_lock` và sinh `Idempotency-Key` quy chuẩn dạng `RECURRING-AUTO-PAY-${plan.id}-${cycleNumber}` để chống chạy trùng lịch.

### Kịch bản 2: Refund Cash Outflow Ledger (Giải quyết Cảnh báo P1.1 Audit)
- **Nguồn trích dẫn:** [BILLING_ONE_P1_1_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_1_CLOSURE_AUDIT.md) dòng 452 (Finding `FIND-P1-AUD-01`):
  > *"Trường `paid_payment_id` hiện tại là NULL và status giữ ở PENDING. Chưa có module thanh toán tiền chi ra thực tế... Triển khai module Chi hoàn trả tiền mặt (Cash Outflow / Voucher Out) trong giai đoạn tiếp theo."*
- **Bài toán nghiệp vụ:** Giai đoạn P1.1 đã tạo ra bảng `refund_payables` để ghi nhận nghĩa vụ nợ phải trả khách hàng khi giảm giá/hủy hóa đơn đã thanh toán. Tuy nhiên, bảng này chỉ dừng ở mức theo dõi nghĩa vụ (Payable Liability). Hiện tại chưa có API hoặc workflow để kế toán thực chi tiền ra khỏi quỹ/tài khoản ngân hàng (Disbursement / Cash Outflow), cập nhật trạng thái sang `PROCESSED/PAID`.
- **Phạm vi giải quyết:**
  - Xây dựng workflow Phiếu chi tiền / Hoàn trả quỹ (`outflow_payments` hoặc `payment_vouchers`).
  - Gắn kết `paid_payment_id` trong `refund_payables` với bản ghi chi tiền thực tế.
  - Cập nhật số dư công nợ khách hàng và ghi nhận dòng tiền âm (Cash Outflow).

### Kịch bản 3: Customer Financial Profile & Credit Limit Engine (Roadmap Phase 4)
- **Nguồn trích dẫn:** [BILLING_ONE_FEATURE_ROADMAP.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_FEATURE_ROADMAP.md) Phase 4 (dòng 69-76):
  > *"Phase 4 — Hồ sơ Khách hàng & Hạn mức Công nợ (Customer Financial Profile & Credit Limit)"*
- **Bài toán nghiệp vụ:** Hệ thống hiện tại theo dõi nợ dựa trên hóa đơn chưa thanh toán trừ đi điều chỉnh, nhưng chưa có cơ chế kiểm soát chặn xuất hóa đơn khi khách hàng vượt hạn mức tín dụng (`credit_limit`), chưa có phân loại cảnh báo rủi ro khách hàng (`ACTIVE`, `WARNING`, `LOCKED`).
- **Phạm vi giải quyết:**
  - Mở rộng bảng `customers` với các chỉ số tài chính thời gian thực.
  - Endpoint `GET /api/customers/:id/financial-profile` tính toán chi tiết: Tổng nợ hiện tại, Hạn mức còn lại, Tổng tiền thừa chưa phân bổ (Unapplied Cash), Tuổi nợ bình quân.
  - Chốt chặn phát hành hóa đơn (`POST /api/invoices/:id/issue`): Cảnh báo hoặc chặn nếu vượt hạn mức tín dụng đã cấp.

### Bảng Phân loại Tính năng theo Trạng thái Kỹ thuật:

| Tính năng đề xuất | Thuộc Kịch bản | Mức độ Ưu tiên | Trạng thái Tài liệu |
| :--- | :--- | :--- | :--- |
| **Recurring Billing Auto-Settlement via Unapplied Cash** | Kịch bản 1 | **Mandatory (Khuyến nghị P1.3)** | Có định hướng rõ ràng từ P1.2.1 Audit |
| **Idempotency Guard cho Background Scheduler** | Kịch bản 1 | **Mandatory** | Bắt buộc để kế thừa P1.2.2 |
| **Refund Disbursement / Outflow Execution** | Kịch bản 2 | **Supporting (Kế tiếp)** | Đã ghi nhận trong P1.1 Closure Audit |
| **Customer Credit Limit Hard Enforcement** | Kịch bản 3 | **Optional / Future Phase** | Đã có schema sơ bộ từ evolution, chưa có logic chặn |
| **Customer Portal / Self-Service PDF** | Roadmap Phase 4 | **Future Phase (P2/P3)** | Thuộc kế hoạch dài hạn |
| **E-Invoice XML Signing & TCT Connector** | Roadmap Phase 7 | **Future Phase (P3/P4)** | Cần chứng thư số HSM và tích hợp TCT |

---

## 3. OUT-OF-SCOPE (RANH GIỚI LOẠI TRỪ TUYỆT ĐỐI)

Để bảo đảm tính ổn định tuyệt đối của hệ thống lõi tài chính, các hạng mục sau đây **HOÀN TOÀN NẰM NGOÀI PHẠM VI P1.3**:

1. **Tuyệt đối không sửa đổi hoặc tái thiết kế Payment Allocation V2:**
   - Cấu trúc `payments` (tiền thực vào) $\rightarrow$ `payment_allocations` $\rightarrow$ `invoices` là chuẩn mực bất biến. Không được gộp lại hay quay về mô hình 1-1 cũ.
2. **Tuyệt đối không làm suy yếu hoặc bypass Mandatory Idempotency:**
   - 100% các thao tác thay đổi tài chính phải giữ nguyên chốt chặn `Idempotency-Key`. Không tạo bất kỳ đường rẽ nhánh (bypass flag) nào cho phép yêu cầu keyless vượt qua.
3. **Tuyệt đối không sửa đổi hoặc nới lỏng Phân quyền Cơ sở dữ liệu (Least Privilege):**
   - User `billing_app` tiếp tục bị cấm quyền `UPDATE` và `DELETE` trên bảng `payments` và `payment_idempotency_keys`.
   - User `billing_readonly` tiếp tục bị cấm truy cập bảng `users`.
4. **Tuyệt đối không xóa hoặc cleanup dữ liệu kiểm thử (Test Data):**
   - Ranh giới 265 legacy cash payments và 126 test payments phải được bảo tồn nguyên vẹn.
5. **Tuyệt đối không thay thế kiến trúc phiên đăng nhập (Session) hoặc cơ sở dữ liệu:**
   - Không chuyển sang JWT; không thay thế PostgreSQL bằng MongoDB/Redis trong giai đoạn này.
6. **Không tích hợp các cổng thanh toán bên thứ ba (VNPay, Momo, Stripe) chưa có sandbox hoặc văn bản đặc tả.**

---

## 4. BUSINESS REQUIREMENTS (PHÂN TÍCH THEO KỊCH BẢN TRỌNG TÂM - CANDIDATE 1)

Nếu Kịch bản 1 (Recurring Billing Automated Settlement & Unapplied Cash Allocation) được phê duyệt cho P1.3:

- **BR-1.3-01: Tự động Trừ Nợ từ Tiền thừa Ký quỹ (Automatic Settlement from Unapplied Cash):**
  - Khách hàng doanh nghiệp ký hợp đồng thuê bao định kỳ (Recurring Plan) thường nộp trước một khoản tiền cọc/ký quỹ lớn (ví dụ: chuyển 50,000,000 ₫ ghi nhận vào `payments` với trạng thái Unapplied Cash).
  - Khi hệ thống chạy chu kỳ định kỳ (`runRecurringCycle`) và phát hành hóa đơn mới (`ISSUED`), hệ thống phải kiểm tra số dư Unapplied Cash của khách hàng.
  - Nếu số dư khả dụng $\ge$ số tiền hóa đơn: Hệ thống tự động phân bổ đủ 100%, chuyển hóa đơn sang `PAID`.
  - Nếu số dư khả dụng $> 0$ nhưng $<$ số tiền hóa đơn: Tự động phân bổ hết số dư khả dụng, chuyển hóa đơn sang `PARTIALLY_PAID`.
- **BR-1.3-02: Tính Toàn vẹn Dòng tiền và Chống Trừ Tiền Kép (Double-Settlement Prevention):**
  - Quá trình tự động trừ nợ phải tuân thủ nghiêm ngặt thứ tự khóa dòng tiền (`SELECT ... FOR UPDATE` trên cả payment nguồn và invoice đích) để loại trừ race condition.
- **BR-1.3-03: Tính Bất biến và Minh bạch Kiểm toán (Audit Transparency):**
  - Mỗi thao tác cấn trừ tự động phải phát sinh bản ghi phân bổ hợp lệ trong `payment_allocations` với ghi chú rõ ràng (`notes: "Tự động phân bổ theo hợp đồng định kỳ [Mã HD]"`).
  - Phải ghi nhận sự kiện kiểm toán bất biến `RECURRING_PAYMENT_AUTO_ALLOCATED` vào `audit_logs` với đầy đủ liên kết SHA-256.

---

## 5. FUNCTIONAL REQUIREMENTS

- **FR-1.3-01: Auto-Allocation Service Extension (`PaymentService.autoAllocateUnappliedCash`):**
  - Hàm nhận vào: `customerId`, `invoiceId`, `recordedBy`, `idempotencyKey`.
  - Tìm kiếm các khoản thanh toán của khách hàng còn tiền chưa phân bổ (`unapplied_amount > 0`), sắp xếp theo thứ tự `paid_at ASC, id ASC` (FIFO - Khoản thanh toán cũ được dùng trước).
  - Thực hiện phân bổ cho đến khi hóa đơn được thanh toán đủ hoặc hết tiền khả dụng.
- **FR-1.3-02: Scheduler Integration with Mandatory Idempotency:**
  - Nâng cấp `app/src/scheduler.js`:
  - Khi sinh hóa đơn cho hợp đồng định kỳ có cờ `auto_sign: true`, tiếp tục kích hoạt luồng kiểm tra và cấn trừ tiền thừa tự động.
  - Sinh khóa Idempotency tất định: `RECURRING-AUTO-ALLOC-INV-${invoiceId}-PLAN-${plan.id}`.
- **FR-1.3-03: API Phân bổ Tự động Theo Yêu cầu (Manual Trigger Auto-Allocation):**
  - Cung cấp endpoint: `POST /api/invoices/:id/auto-allocate` cho phép kế toán viên bấm nút "Tự động cấn trừ từ tiền thừa" trên giao diện chi tiết hóa đơn.
  - Endpoint yêu cầu bắt buộc `Idempotency-Key`.
- **FR-1.3-04: API Truy vấn Số dư Khả dụng của Khách hàng:**
  - Endpoint: `GET /api/customers/:id/unapplied-balance` trả về:
    - `total_unapplied_cash`: Tổng tiền thừa chưa phân bổ hiện có.
    - `available_payments`: Danh sách các payment IDs còn tiền kèm số dư chi tiết.

---

## 6. DATA REQUIREMENTS & SCHEMA IMPACT PREVIEW

### A. Đánh giá Tác động Lược đồ Cơ sở Dữ liệu:

| Bảng dữ liệu | Trạng thái Thao tác | Mô tả thay đổi dự kiến | Ràng buộc & Chỉ mục |
| :--- | :--- | :--- | :--- |
| `public.payments` | **REUSE** | Giữ nguyên cấu trúc P1.2.2. Không thêm cột mới. | Append-Only, khóa bi quan |
| `public.payment_allocations` | **REUSE** | Sử dụng cột `notes` để ghi nhận nguồn gốc cấn trừ tự động. | Invariant trigger P1.2 tự động bảo vệ dung lượng |
| `public.recurring_plans` | **MODIFY (Nhẹ)** | Bổ sung cột cờ: `auto_settle_unapplied boolean DEFAULT true`. | `CHECK (auto_settle_unapplied IS NOT NULL)` |
| `public.invoices` | **REUSE** | Giữ nguyên trạng thái `paid_total`, `status`. | Cập nhật tự động qua trigger |
| `public.payment_idempotency_keys` | **REUSE** | Lưu trữ các key sinh ra từ scheduler và auto-allocate. | `UNIQUE(idempotency_key)` |
| `public.audit_logs` | **REUSE** | Tiếp nhận các sự kiện kiểm toán mới. | SHA-256 Chained |

### B. Xem trước Câu lệnh Migration Dự kiến (Preview Only - Chưa thực thi):
```sql
-- PREVIEW ONLY — DO NOT RUN IN DISCOVERY PHASE
ALTER TABLE public.recurring_plans 
ADD COLUMN IF NOT EXISTS auto_settle_unapplied boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.recurring_plans.auto_settle_unapplied IS 
'Cờ cho phép tự động cấn trừ tiền thừa (unapplied cash) của khách hàng khi phát hành hóa đơn định kỳ';
```

---

## 7. ARCHITECTURE IMPACT

Kiến trúc đa tầng Zero-Trust hiện tại hoàn toàn tương thích và dung nạp tốt tính năng P1.3:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TẦNG BIÊN (Edge - Nginx)                          │
│     HTTPS:443 -> Forward Header Idempotency-Key -> Rate Limiting            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    TẦNG ỨNG DỤNG (Application - Express 5)                  │
│                                                                             │
│  [Background Scheduler]  ──────┐                                            │
│   - pg_try_advisory_lock       │                                            │
│   - Generate Deterministic Key │                                            │
│                                ▼                                            │
│  [API Endpoints]        ──> [PaymentService]                                │
│   - POST /invoices/:id/auto-allocate (Idempotency Mandatory)                │
│   - Verify Fingerprint -> Acquire Advisory Lock                             │
│   - Delegate to FIFO Allocation Logic                                       │
│                                                                             │
│  [Audit Logger] <─────────── Chained SHA-256 Trail                          │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
┌──────────────────────────────────────▼──────────────────────────────────────┐
│                    TẦNG DỮ LIỆU (Database - PostgreSQL 16)                  │
│  - Role billing_app: INSERT payment_allocations, UPDATE invoices            │
│  - Database Trigger: check_payment_allocation_invariants() (Active)         │
│  - Least Privilege: billing_app cấm UPDATE/DELETE idempotency table         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. FINANCIAL IMPACT ANALYSIS

Phân loại tác động tài chính của các thao tác P1.3 dự kiến:

| Thành phần tài chính | Loại tác động | Cơ chế kiểm soát bắt buộc |
| :--- | :--- | :--- |
| **Tổng dòng tiền (`payments.amount`)** | **NO FINANCIAL MUTATION** | Không sinh ra dòng tiền mới; chỉ tái phân bổ tiền hiện có trong quỹ. |
| **Tiền chưa phân bổ (`unapplied_cash`)** | **DIRECT FINANCIAL MUTATION** | Giảm tương ứng với số tiền được cấn trừ vào hóa đơn. |
| **Tiền phân bổ (`payment_allocations`)** | **DIRECT FINANCIAL MUTATION** | Tăng bản ghi mới; chịu sự kiểm soát của `check_payment_allocation_invariants()`. |
| **Đã thanh toán hóa đơn (`invoices.paid_total`)** | **DIRECT FINANCIAL MUTATION** | Tăng tương ứng; cập nhật trạng thái `PARTIALLY_PAID` hoặc `PAID`. |
| **Công nợ khách hàng (Customer Debt)** | **INDIRECT FINANCIAL IMPACT** | Giảm tương ứng với số tiền hóa đơn được tất toán. |
| **Nhật ký kiểm toán (`audit_logs`)** | **MANDATORY AUDIT LOGGING** | Sinh bản ghi `PAYMENT_AUTO_ALLOCATED` có mã băm nối chuỗi. |

---

## 9. API DESIGN PREVIEW (SPECIFICATION LEVEL)

### Endpoint 1: Tự động Cấn trừ Tiền thừa cho Hóa đơn
- **Method & Route:** `POST /api/invoices/:id/auto-allocate`
- **Mục đích:** Kế toán viên hoặc hệ thống chủ động cấn trừ tiền thừa của khách hàng cho hóa đơn này.
- **Yêu cầu Xác thực & Phân quyền:** `requireAuth`, quyền `invoices:edit` hoặc `payments:create`.
- **Yêu cầu Idempotency:** **BẮT BUỘC (MANDATORY)**. Phải có `Idempotency-Key` header.
- **Request Headers:**
  ```http
  Idempotency-Key: AUTO-ALLOC-INV-105-USER-1-1791357890
  ```
- **Phản hồi Thành công (HTTP 200/201):**
  ```json
  {
    "success": true,
    "invoice_id": 105,
    "invoice_no": "INV-2026-000105",
    "allocated_total": "2500000.00",
    "invoice_status": "PAID",
    "allocations_created": [
      {
        "payment_id": 415,
        "allocated_amount": "2500000.00",
        "notes": "Tự động phân bổ từ tiền thừa của khách hàng"
      }
    ],
    "remaining_unapplied_cash": "1500000.00"
  }
  ```
- **Xử lý Lỗi (Error Cases):**
  - Không có key: HTTP `400 IDEMPOTENCY_KEY_REQUIRED`.
  - Hóa đơn không tồn tại: HTTP `404 INVOICE_NOT_FOUND`.
  - Hóa đơn đã tất toán: HTTP `400 INVOICE_ALREADY_PAID`.
  - Khách hàng không có tiền thừa: HTTP `400 NO_UNAPPLIED_CASH_AVAILABLE`.
  - Xung đột payload: HTTP `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`.

### Endpoint 2: Truy vấn Số dư Tiền thừa Khách hàng
- **Method & Route:** `GET /api/customers/:id/unapplied-balance`
- **Mục đích:** Lấy thông tin số dư ký quỹ để hiển thị trên form hóa đơn.
- **Yêu cầu Xác thực:** `requireAuth`.
- **Yêu cầu Idempotency:** Không (Phương thức `GET` an toàn, chỉ đọc).
- **Phản hồi Thành công (HTTP 200):**
  ```json
  {
    "customer_id": 12,
    "customer_name": "Công ty TNHH Giải Pháp Công Nghệ Số",
    "total_unapplied_cash": "15000000.00",
    "payment_count": 2,
    "payments": [
      { "id": 410, "amount": "10000000.00", "unapplied_amount": "10000000.00", "paid_at": "2026-10-01" },
      { "id": 412, "amount": "8000000.00", "unapplied_amount": "5000000.00", "paid_at": "2026-10-05" }
    ]
  }
  ```

---

## 10. FRONTEND IMPACT & UI SPECIFICATION

Không viết mã frontend trong giai đoạn discovery. Dự kiến các màn hình chịu tác động:

1. **Chi tiết Hóa đơn (`app/public/app.js` tại view `#/invoices/:id`):**
   - Khi hóa đơn ở trạng thái `ISSUED` hoặc `PARTIALLY_PAID`, kiểm tra nếu khách hàng có `total_unapplied_cash > 0`:
   - Hiển thị badge thông báo nổi bật: *"Khách hàng có 15,000,000 ₫ tiền thừa khả dụng"*.
   - Bổ sung nút bấm hành động: *"Cấn trừ từ tiền thừa"* (Auto-allocate).
   - Khi kế toán bấm nút: Tự động sinh `crypto.randomUUID()` gửi kèm header `Idempotency-Key` tới API.
2. **Quản lý Hợp đồng Định kỳ (`#/recurring`):**
   - Bổ sung checkbox trong modal tạo/sửa hợp đồng: *"Tự động cấn trừ tiền thừa khi phát hành hóa đơn"*.
3. **Chi tiết Khách hàng (`#/customers/:id`):**
   - Bổ sung thẻ thông tin thống kê: *"Tiền ký quỹ chưa phân bổ (Unapplied Cash)"* hiển thị số dư thực tế.

---

## 11. SECURITY & RBAC IMPACT

1. **Phân quyền Route (Route Guards):**
   - Endpoint `POST /api/invoices/:id/auto-allocate` bắt buộc kiểm tra phiên đăng nhập và phân quyền `invoices:edit` hoặc vai trò `admin`/`staff`.
2. **Bảo mật Tương tranh Cơ sở Dữ liệu:**
   - Bảo đảm thực hiện khóa dòng tiền theo thứ tự nhất quán: Luôn khóa hóa đơn (`SELECT ... FROM invoices WHERE id = $1 FOR UPDATE`) trước khi khóa các khoản thanh toán nguồn (`SELECT ... FROM payments WHERE id = ANY($2) FOR UPDATE ORDER BY id ASC`) để ngăn ngừa Deadlock.
3. **Phân quyền Role PostgreSQL:**
   - Không cần cấp thêm quyền mới cho `billing_app` vì role này đã có sẵn quyền `SELECT, INSERT` trên `payment_allocations` và `UPDATE` trên `invoices`.
   - Giữ nguyên trạng thái Append-Only của bảng `payments` và `payment_idempotency_keys`.

---

## 12. AUDIT LOGGING IMPACT

Mọi thao tác cấn trừ tự động trong P1.3 bắt buộc ghi nhận sự kiện kiểm toán bất biến:

- **Action Name:** `PAYMENT_AUTO_ALLOCATED`
- **Module:** `payments`
- **Actor:** `req.user` (đối với lời gọi API từ kế toán) hoặc `SYSTEM / SCHEDULER` (đối với luồng chạy tự động theo lịch).
- **Target Reference:** Mã hóa đơn được cấn trừ (Ví dụ: `INV-2026-000105`).
- **Severity:** `INFO`.
- **Metadata Payload:**
  ```json
  {
    "invoice_id": 105,
    "allocated_total": "2500000.00",
    "allocations_count": 1,
    "payment_ids": [415],
    "idempotency_key": "AUTO-ALLOC-INV-105-USER-1-1791357890"
  }
  ```
- **Ràng buộc Mật mã:** Tự động kế thừa chuỗi băm mật mã SHA-256 từ bản ghi trước đó trong `public.audit_logs`.

---

## 13. TESTING STRATEGY (P1.3 TEST MATRIX PLAN)

Kế hoạch kiểm thử dự kiến cho P1.3 được thiết kế tách biệt và bao phủ toàn diện:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       P1.3 TEST SUITE DECOMPOSITION                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. Keyless Auto-allocate Rejection (400 IDEMPOTENCY_KEY_REQUIRED)           │
│ 2. Single Payment Partial Allocation to Invoice                             │
│ 3. Multi-Payment FIFO Allocation (Gộp nhiều khoản tiền thừa để trả 1 hóa đơn)│
│ 4. Exact Amount Invoice Full Settlement (Status -> PAID)                    │
│ 5. Over-Balance Retention (Tiền thừa còn lại được bảo toàn chính xác)       │
│ 6. Zero Balance Rejection (400 NO_UNAPPLIED_CASH_AVAILABLE)                 │
│ 7. Concurrent Auto-Allocation Race Condition (Advisory Lock Guard)          │
│ 8. True Replay Cache Verification (200 OK + is_idempotent_replay: true)     │
│ 9. Payload Mismatch Detection (409 Conflict)                                │
│ 10. Scheduler Cron Integration with Auto-Allocation                         │
│ 11. Transaction Rollback Cleanliness (Zero Stale Keys)                      │
│ 12. Post-Test Financial Forensics & Zero Invariant Violations Assertions    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 14. REGRESSION PROTECTION PLAN

Giai đoạn P1.3 bắt buộc bảo vệ 100% các thành quả kỹ thuật đã được chứng nhận từ các giai đoạn trước:

1. **Bảo vệ P0 (Financial Integrity):**
   - Không được quay lại việc dùng Credit Note làm payment bù trừ giả tạo.
   - Không làm sai lệch báo cáo doanh thu và thuế GTGT.
2. **Bảo vệ P1.1 (Refund Ledger):**
   - Không can thiệp hoặc làm biến dạng cấu trúc `refund_payables` và công nợ điều chỉnh `adjusted_total`.
3. **Bảo vệ P1.2 (Payment Allocation V2):**
   - Cơ chế 1-N allocations và Unapplied Cash tiếp tục là nền tảng cốt lõi; mọi phân bổ mới phải tuân thủ nghiêm ngặt trigger bảo vệ dung lượng `check_payment_allocation_invariants()`.
4. **Bảo vệ P1.2.1 & P1.2.2 (Mandatory Idempotency & Least Privilege):**
   - Mọi endpoint tài chính mới bắt buộc phải có `Idempotency-Key`.
   - Quyền hạn cơ sở dữ liệu của `billing_app` giữ vững trạng thái Append-Only.
5. **Bộ Kiểm thử Hồi quy Toàn diện:**
   - Chạy lại toàn bộ 09 test suites hiện hành (`cp2-smoke.mjs`, `verify-hardening.ps1`, `extended-features-test.mjs`, `p0-remediation-test.mjs`, `p1-refund-ledger-test.mjs`, `p1_2-payment-allocation-test.mjs`, `p1_2_1-idempotency-test.mjs`, `p1_2_2-mandatory-idempotency-test.mjs`, `audit-verify`).

---

## 15. TEST DATA STRATEGY & ISOLATION

Để bảo đảm tính minh bạch và tránh gây ô nhiễm dữ liệu, chiến lược kiểm thử P1.3 xác lập ranh giới dữ liệu rõ ràng:

1. **Phân định Ranh giới:**
   - **Legacy Baseline:** 265 payments tiền mặt lịch sử ($852,976,250.00$ ₫) + 14 khoản di trú P0 $\rightarrow$ **BẢO TỒN NGUYÊN VẸN, KHÔNG CHẠM VÀO**.
   - **Historical Test Baseline:** 126 payments ($1,861,604,000.00$ ₫) từ P1.2, P1.2.1, P1.2.2 $\rightarrow$ **BẢO TỒN NGUYÊN VẸN, KHÔNG CLEANUP**.
   - **P1.3 Dedicated Test Data:** Tạo mới các khách hàng thử nghiệm riêng biệt (với tiền tố định danh `P13-CUST-*`) và các khoản thanh toán thử nghiệm riêng để kiểm thử.
2. **Cân đối Tài chính Sau Kiểm thử:**
   - Mọi kịch bản kiểm thử phân bổ phải bảo đảm phương trình cân đối kế toán:
     $$\Delta \text{Allocated Total} + \Delta \text{Unapplied Cash} = \Delta \text{Payments Total}$$

---

## 16. IMPLEMENTATION SUB-PHASES PROPOSAL

Nếu phạm vi P1.3 được phê duyệt chính thức, kế hoạch triển khai sẽ được chia thành 7 tiểu giai đoạn tuần tự:

```text
P1.3-A: Specification Freeze & Product Owner Approval
  └── Thống nhất scope chính thức, đóng băng tài liệu yêu cầu.
P1.3-B: Database Migration & Schema Extensions (nếu có)
  └── Tạo migration 06_p1_3_... an toàn, idempotent.
P1.3-C: Domain Service Implementation
  └── Mở rộng PaymentService với hàm autoAllocateUnappliedCash và FIFO matcher.
P1.3-D: Backend API & Scheduler Updates
  └── Tạo endpoint /api/invoices/:id/auto-allocate và tích hợp scheduler.js.
P1.3-E: Frontend UI Enhancement
  └── Cập nhật app.js hiển thị số dư tiền thừa và nút cấn trừ tự động.
P1.3-F: Comprehensive Test Suite & Live Verification
  └── Viết scripts/p1_3-auto-settlement-test.mjs và chạy kiểm thử 100% PASS.
P1.3-G: Independent Closure Audit
  └── Báo cáo kiểm toán độc lập đóng giai đoạn P1.3.
```

---

## 17. RISK REGISTER

| Mã Rủi ro | Mô tả Rủi ro Kỹ thuật / Tài chính | Mức độ | Biện pháp Giảm thiểu (Mitigation Strategy) |
| :--- | :--- | :--- | :--- |
| **RSK-1.3-01** | **Scope Ambiguity:** Chưa có văn bản PRD chính thức chỉ định ranh giới P1.3 | **CRITICAL** | **DỪNG IMPLEMENTATION**, ban hành tài liệu Discovery này và chờ PO phê duyệt. |
| **RSK-1.3-02** | **Concurrency Deadlock:** Xung đột khóa khi scheduler và người dùng cùng auto-allocate cho 1 khách hàng | **HIGH** | Chuẩn hóa thứ tự khóa bi quan: Khóa `invoices` trước, khóa `payments` theo thứ tự ID tăng dần sau. |
| **RSK-1.3-03** | **Idempotency Bypass:** Lời gọi nội bộ từ scheduler bỏ quên header Idempotency-Key | **HIGH** | Tự động sinh key tất định dựa trên mã hóa đơn và chu kỳ chạy. |
| **RSK-1.3-04** | **Over-allocation Invariant Violation:** Cấn trừ vượt quá giá trị còn lại của hóa đơn | **MEDIUM** | Cơ sở dữ liệu đã có sẵn trigger `check_payment_allocation_invariants()` chặn đứng tại mức PostgreSQL engine. |
| **RSK-1.3-05** | **Test Data Confusion:** Nhầm lẫn giữa tiền thật lịch sử và tiền test unapplied | **LOW** | Duy trì tài liệu ranh giới dữ liệu và cô lập test data theo khách hàng mới. |

---

## 18. DRAFT ACCEPTANCE CRITERIA

Một giai đoạn P1.3 chỉ được xem là hoàn tất khi thỏa mãn đầy đủ các tiêu chuẩn nghiệm thu sau:

- [ ] Tài liệu yêu cầu nghiệp vụ P1.3 được Product Owner phê duyệt rõ ràng.
- [ ] Mọi endpoint thay đổi trạng thái phân bổ tài chính đều bắt buộc có `Idempotency-Key` (400 khi thiếu key, 409 khi lệch payload).
- [ ] Logic cấn trừ tự động tuân thủ nguyên tắc FIFO trên các khoản tiền thừa của khách hàng.
- [ ] Dung lượng hóa đơn và số tiền thanh toán không bị vượt quá (Zero Over-allocation).
- [ ] Trạng thái hóa đơn chuyển đổi chính xác (`PARTIALLY_PAID` khi còn thiếu, `PAID` khi đã đủ).
- [ ] Tương tranh đồng thời được bảo vệ an toàn bằng PostgreSQL advisory lock và transaction locking.
- [ ] Toàn bộ các thao tác phát sinh bản ghi kiểm toán bất biến trong `audit_logs` với chuỗi băm SHA-256 toàn vẹn 100%.
- [ ] 09 bộ kiểm thử hồi quy hiện hành tiếp tục đạt 100% PASS.
- [ ] Bộ kiểm thử chuyên biệt P1.3 đạt 100% PASS.
- [ ] Pháp y cơ sở dữ liệu thời gian thực xác nhận **0 vi phạm bất biến tài chính**.

---

## 19. OPEN QUESTIONS & AMBIGUITIES (CÂU HỎI MỞ CẦN PRODUCT OWNER LÀM RÕ)

Trước khi bắt đầu bất kỳ hành động viết mã nào cho P1.3, Product Owner cần làm rõ 4 câu hỏi trọng tâm sau:

1. **Phạm vi Chính thức của P1.3 là gì?**
   - Lựa chọn Kịch bản 1 (Recurring Billing Automated Payment & Unapplied Cash Allocation), Kịch bản 2 (Refund Cash Outflow Ledger), Kịch bản 3 (Customer Financial Profile & Credit Limit), hay một phạm vi khác?
2. **Quy tắc Ưu tiên Cấn trừ Tiền thừa (Allocation Strategy):**
   - Khi khách hàng có nhiều khoản thanh toán còn tiền thừa, hệ thống nên ưu tiên dùng khoản thanh toán cũ nhất trước (FIFO) hay khoản thanh toán mới nhất (LIFO)?
3. **Cơ chế Can thiệp Thủ công:**
   - Kế toán viên có được quyền chọn thủ công khoản payment nào để cấn trừ cho hóa đơn, hay hệ thống bắt buộc tự động chọn theo thuật toán?
4. **Xử lý Hóa đơn Định kỳ:**
   - Khi phát hành hóa đơn định kỳ, việc cấn trừ tiền thừa nên diễn ra tự động 100% trong background job, hay chỉ tạo hóa đơn và gửi thông báo gợi ý kế toán bấm nút xác nhận?

---

## 20. RECOMMENDATION

Đội ngũ Kỹ thuật khuyến nghị:
1. **Phê duyệt Kịch bản 1 (Recurring Billing Automated Payment & Settlement Engine):** Đây là bước tiến tự nhiên, logic và an toàn nhất sau P1.2.2. Kịch bản này khép kín chu trình giữa tiền thừa chưa phân bổ (Unapplied Cash) và hóa đơn định kỳ (Recurring Billing), tận dụng tối đa hạ tầng Idempotency và Allocation V2 vừa xây dựng xong mà không đòi hỏi thay đổi lớn về schema.
2. **Giữ nguyên trạng thái AUDIT / DISCOVERY:** Tuyệt đối không tự ý triển khai code cho đến khi có phản hồi chính thức cho 4 câu hỏi mở nêu trên.

---

## 21. FINAL VERDICT

Căn cứ vào nguyên tắc tối thượng của giai đoạn Discovery:
- Baseline kỹ thuật hiện tại hoàn toàn vững chắc, sạch sẽ và sẵn sàng (Ready).
- Tuy nhiên, tài liệu roadmap hiện hành của dự án chưa có một tài liệu đặc tả phạm vi chính thức mang tên "P1.3" để xác định chính xác danh mục tính năng cần làm.
- Tuân thủ quy tắc không tự suy đoán nghiệp vụ.

Technical Lead chính thức công bố kết luận:

```text
================================================================================
  FINAL VERDICT:
  P1.3 DISCOVERY BLOCKED — REQUIREMENT AMBIGUITY / BASELINE ISSUE
================================================================================
```

> [!IMPORTANT]
> **CHỈ THỊ DỪNG TUYỆT ĐỐI (ABSOLUTE STOP RULE):**
> Giai đoạn Pre-implementation Discovery kết thúc tại đây.
> - **KHÔNG** viết mã nguồn nghiệp vụ.
> - **KHÔNG** tạo migration cơ sở dữ liệu.
> - **KHÔNG** can thiệp frontend hay backend.
> - **KHÔNG** tự ý bắt đầu triển khai P1.3.
> Đội ngũ kỹ thuật dừng lại và bàn giao báo cáo này để Product Owner xem xét, lựa chọn kịch bản và cung cấp chỉ thị chính thức.
