# BILLING_ONE — P1.2 FINAL HANDOFF CHECKPOINT
## OFFICIAL SYSTEM BASELINE & ARCHITECTURAL HANDOFF BEFORE P1.3
## AUDIT / HANDOFF ONLY — NO IMPLEMENTATION

**Role:** Senior Technical Lead & Financial Systems Architect  
**Handoff Target:** Formal Baseline Handover from P1.2 / P1.2.1 / P1.2.2 to P1.3  
**Handoff Date:** October 07, 2026  
**Status:** P1.2.2 VERIFIED — FINDINGS CLOSED — READY FOR P1.3  
**Operational Mode:** STRICT HANDOFF ONLY — Zero Code Mutations, Zero Schema Changes, Zero Test Data Deletion, Zero Remediation  

---

## 1. EXECUTIVE SUMMARY

Tài liệu này xác lập **Mốc Bàn Giao Kỹ Thuật Chính Thức (Official Handoff Baseline)** cho toàn bộ hệ sinh thái thanh toán và kế toán của Billing_One, chuyển tiếp từ giai đoạn hoàn tất **P1.2.2 (Mandatory Payment Idempotency & Least-Privilege Hardening)** sang giai đoạn tiếp theo **P1.3**.

Sau chuỗi cải tiến và kiểm toán pháp y độc lập:
1. **P1.2 (Payment Allocation V2):** Tách bạch bản chất dòng tiền thanh toán thực tế (Payment) khỏi việc phân bổ hóa đơn (Allocation), cho phép 1 giao dịch thanh toán phân bổ cho nhiều hóa đơn và quản lý dòng tiền chưa phân bổ (Unapplied Cash).
2. **P1.2.1 (Direct Payment Idempotency Remediation):** Thiết lập cơ chế chống trùng lặp thanh toán trực tiếp qua `Idempotency-Key` với khóa cố vấn cấp giao dịch PostgreSQL (`pg_advisory_xact_lock`).
3. **P1.2.2 (Mandatory Idempotency & Least-Privilege Hardening):** Đóng triệt để 02 phát hiện còn lại (`FIND-P1.2.1-01` và `FIND-P1.2.1-02`), bắt buộc 100% các thao tác thay đổi thanh toán phải có `Idempotency-Key` (từ chối mọi yêu cầu keyless với hiệu ứng tài chính bằng 0), đồng thời thu hồi triệt để quyền `UPDATE/DELETE` trên bảng idempotency khỏi role `billing_app`.

Báo cáo Kiểm toán Độc lập [BILLING_ONE_P1_2_2_CLOSURE_AUDIT.md](file:///c:/Users/phamt/OneDrive/Desktop/Billing_One/docs/BILLING_ONE_P1_2_2_CLOSURE_AUDIT.md) đã chính thức phê chuẩn:
$$\text{P1.2.2 VERIFIED — FINDINGS CLOSED — READY FOR P1.3}$$

Handoff checkpoint này ghi nhận toàn diện và bất biến toàn bộ trạng thái kiến trúc, cơ sở dữ liệu, phân quyền bảo mật, hợp đồng API và kết quả kiểm thử để làm căn cứ khởi đầu vững chắc cho P1.3.

---

## 2. VERIFIED P1.2 ARCHITECTURE

Toàn bộ các quy tắc nghiệp vụ và ngữ nghĩa kiến trúc cốt lõi dưới đây đã được xác minh pháp y (VERIFIED) và trở thành chuẩn mực bất biến của hệ thống:

```
               ┌──────────────────────────────────────┐
               │         Bank Transaction             │
               │   (Statement / Account Inflow)       │
               └──────────────────┬───────────────────┘
                                  │
                                  ▼ Deterministic Key: BANK-TX-MATCH-${tx.id}
               ┌──────────────────────────────────────┐
               │             PAYMENT                  │
               │  - id (Primary Key)                  │
               │  - amount (Real Cash Inflow)         │
               │  - customer_id (Direct Reference)    │
               │  - invoice_id (Nullable)             │
               └──────────┬───────────────────────────┘
                          │
         ┌────────────────┴───────────────────────────┐
         │                                            │
         ▼                                            ▼
┌─────────────────────────────┐              ┌─────────────────────────────┐
│    PAYMENT ALLOCATIONS      │              │       UNAPPLIED CASH        │
│  (1 Payment -> N Invoices)  │              │  (Tiền thừa chưa phân bổ)   │
├─────────────────────────────┤              ├─────────────────────────────┤
│ Allocation 1 -> Invoice A   │              │                             │
│ Allocation 2 -> Invoice B   │              │ Payment.amount              │
│ ...                         │              │   - SUM(Allocations)        │
│ Allocation N -> Invoice N   │              │                             │
└──────────────┬──────────────┘              └─────────────────────────────┘
               │
               ▼
┌─────────────────────────────┐
│          INVOICE            │
│  - total                    │
│  - adjusted_total           │
│  - paid_total =             │
│      SUM(Allocations)       │
└─────────────────────────────┘
```

### A. Bản chất Payment (Real Cash Inflow)
- Một bản ghi `payments` đại diện duy nhất cho một dòng tiền thực tế đi vào tài khoản doanh nghiệp.
- Cột `customer_id` xác định trực tiếp chủ thể nộp tiền.
- Cột `invoice_id` được chuyển sang chế độ `NULLABLE` (không còn là nơi lưu trữ duy nhất của mối liên kết thanh toán).

### B. Bản chất Payment Allocation (Single Source of Truth)
- Bảng `payment_allocations` là nguồn sự thật duy nhất (Single Source of Truth) để xác định một khoản thanh toán đã thanh toán cho những hóa đơn nào và với số tiền bao nhiêu.
- Mối quan hệ đa hình linh hoạt: **1 Payment $\rightarrow$ N Allocations $\rightarrow$ N Invoices**.

### C. Cơ chế Tiền chưa phân bổ (Unapplied Cash)
- Số tiền thanh toán chưa được phân bổ ngay lập tức trở thành tiền thừa (Unapplied Cash) của khách hàng:
  $$\text{Payment.amount} = \text{Allocated Total} + \text{Unapplied Cash}$$
- Khoản tiền này được bảo toàn và có thể phân bổ dần cho các hóa đơn hiện tại hoặc hóa đơn phát sinh trong tương lai thông qua API phân bổ.

### D. Toàn vẹn Hóa đơn (Invoice State)
- Giá trị thanh toán tích lũy của hóa đơn được tính toán và cập nhật chuẩn xác:
  $$\text{Invoice.paid\_total} = \sum_{\text{allocations}} \text{allocated\_amount}$$
- Bất biến dung lượng hóa đơn:
  $$\text{Invoice.paid\_total} + \text{Invoice.adjusted\_total} \le \text{Invoice.total}$$

### E. Chính sách Idempotency Bắt buộc (Mandatory Idempotency)
- Mọi API làm thay đổi trạng thái tài chính đều **bắt buộc** phải có `Idempotency-Key` hợp lệ trong HTTP Header hoặc Request Body.
- **Keyless Request:** Bị từ chối ngay lập tức tại tầng HTTP với mã lỗi `400 IDEMPOTENCY_KEY_REQUIRED` và bảo đảm **Zero Financial Mutation**.
- **Same Key + Same Payload:** Nhận diện là thao tác gửi lại (Retry), trả về kết quả thành công từ cache với HTTP `200 OK` (`is_idempotent_replay: true`), tuyệt đối không tạo thêm thanh toán hay phân bổ trùng lặp.
- **Same Key + Different Payload:** Trả về HTTP `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`, ngăn chặn nhầm lẫn dữ liệu.
- **Advisory Lock:** Cơ chế `pg_advisory_xact_lock(hashtext(key))` loại bỏ triệt để Race Condition khi có nhiều luồng gửi đồng thời cùng key.

### F. Đặc quyền tối thiểu (Least Privilege)
- Role cơ sở dữ liệu `billing_app` đối với bảng `payment_idempotency_keys` chỉ có quyền `SELECT` và `INSERT`.
- Quyền `UPDATE` và `DELETE` bị thu hồi tuyệt đối, ngăn chặn bất kỳ hành vi sửa đổi hoặc xóa bỏ nhật ký khóa sau khi đã ghi nhận.

---

## 3. GIT BASELINE

Xác minh trạng thái kho lưu trữ Git tại thời điểm bàn giao:

```bash
git branch --show-current
# Output: main

git rev-parse HEAD
# Output: d794de0461e992122a4c8eddadb1ead2082ae8ac

git log -n 10 --oneline
# Output:
# d794de0 feat(p1.2.2): mandatory payment idempotency and least-privilege hardening
# c63f338 feat(p1.2.1): remediate direct payment idempotency gap (FIND-P1.2-01)
# 4746644 feat(p1.2): implement payment allocation v2, unapplied cash, and canonical payment service
# a26e95f feat(p1.1): implement refund ledger, paid invoice credit note handling, and customer debt fix
# 459d45a checkpoint(p0): complete P0 financial integrity remediation and closure audit
# 0222e34 docs: add startup and assessment guides
# 1138c8c docs: finalize post-release documentation
# fded947 docs(report): add final report and demo script
# 2141b24 docs: complete README, architecture diagrams and evidence index
# 94dc8f0 security: harden containers, networks, credentials and database roles

git status --short
# Output:
# ?? docs/BILLING_ONE_P1_2_2_CLOSURE_AUDIT.md
```

### Thông số Handoff Git:
- **Active Branch:** `main`
- **Full HEAD Hash:** `d794de0461e992122a4c8eddadb1ead2082ae8ac`
- **Latest Commit Message:** `feat(p1.2.2): mandatory payment idempotency and least-privilege hardening`
- **Trạng thái Working Tree:** Sạch sẽ đối với mã nguồn (Chỉ có tệp báo cáo kiểm toán P1.2.2 vừa tạo và tệp handoff này được thêm vào thư mục `docs/`).

---

## 4. CURRENT DATABASE BASELINE

Số liệu tổng hợp được truy vấn trực tiếp từ cơ sở dữ liệu runtime PostgreSQL tại thời điểm bàn giao:

```sql
SELECT 
  (SELECT count(*) FROM payments) AS count_payments,
  (SELECT coalesce(sum(amount),0) FROM payments) AS sum_payments,
  (SELECT count(*) FROM payment_allocations) AS count_allocations,
  (SELECT coalesce(sum(allocated_amount),0) FROM payment_allocations) AS sum_allocated,
  (SELECT coalesce(sum(paid_total),0) FROM invoices) AS sum_invoices_paid_total;
```

### Bảng chỉ số Cơ sở dữ liệu:

| Chỉ số cơ sở dữ liệu (Database Metric) | Giá trị thực tế | Đơn vị / Định dạng | Ghi chú kỹ thuật |
| :--- | :--- | :--- | :--- |
| **Tổng số Payments (`count_payments`)** | **391** | bản ghi | Bao gồm legacy và test/audit payments |
| **Tổng số tiền Payments (`sum_payments`)** | **2,714,580,250.00** | VND | Tổng dòng tiền ghi nhận vào hệ thống |
| **Tổng số Allocations (`count_allocations`)** | **366** | bản ghi | Bản ghi phân bổ hóa đơn |
| **Tổng tiền Allocations (`sum_allocated`)** | **2,575,080,250.00** | VND | Khớp 100% với `invoices.paid_total` |
| **Tổng Invoice `paid_total`** | **2,575,080,250.00** | VND | Độ lệch so với allocations = 0.00 ₫ |
| **Tổng Unapplied Cash (Tiền thừa)** | **139,500,000.00** | VND | Cân đối: 2,714,580,250.00 - 2,575,080,250.00 |
| **Số lượng Idempotency Keys đã ghi** | **79** | bản ghi | Bản ghi bất biến trong `payment_idempotency_keys` |
| **Số lượng Audit Logs mã băm SHA-256** | **941** | bản ghi | Chuỗi băm toàn vẹn 100% |

### Kết quả thẩm tra toàn vẹn chuyên sâu (Integrity Assertions):
1. **Payment Over-allocation:** `0` (Không có payment nào bị phân bổ vượt quá số tiền của chính nó).
2. **Invoice Over-allocation:** `0` (Không có invoice nào nhận phân bổ vượt quá giá trị thực thu).
3. **Orphan Allocations:** `0` (100% allocations đều trỏ tới payment và invoice hợp lệ).
4. **Paid Total Mismatch:** `0` (Tất cả hóa đơn có `paid_total` khớp chính xác với tổng allocations).
5. **Customer Debt Mismatch:** `0` (Không có hóa đơn nào có số dư âm hoặc công nợ sai lệch).
6. **Duplicate Bank Payment Effects:** `0` (Không có giao dịch ngân hàng nào bị khớp thanh toán 2 lần).
7. **Duplicate Idempotency Keys:** `0` (Ràng buộc duy nhất `UNIQUE(idempotency_key)` được bảo đảm tuyệt đối).

---

## 5. FINANCIAL BASELINE & EQUATION VERIFICATION

Toàn bộ các phương trình cân đối tài chính được chứng minh tính đúng đắn trên cơ sở dữ liệu hiện hành:

### Phương trình 1: Cân đối Thanh toán và Phân bổ (Payment Balance)
$$\text{Total Payments Amount} = \text{Total Allocated Amount} + \text{Total Unapplied Cash}$$
$$\mathbf{2,714,580,250.00 \text{ ₫}} = \mathbf{2,575,080,250.00 \text{ ₫}} + \mathbf{139,500,000.00 \text{ ₫}} \quad (\Delta = \mathbf{0.00 \text{ ₫}})$$

### Phương trình 2: Cân đối Phân bổ và Hóa đơn (Invoice Settlement Balance)
$$\sum \text{invoices.paid\_total} = \sum \text{payment\_allocations.allocated\_amount}$$
$$\mathbf{2,575,080,250.00 \text{ ₫}} = \mathbf{2,575,080,250.00 \text{ ₫}} \quad (\Delta = \mathbf{0.00 \text{ ₫}})$$

### Phương trình 3: Công nợ Khách hàng Quy chuẩn (Canonical Customer Debt)
$$\text{Customer Outstanding Debt} = \sum_{\text{invoices} \in \{\text{ISSUED, PARTIALLY\_PAID}\}} (\text{total} - \text{paid\_total} - \text{adjusted\_total})$$
- Kiểm tra toàn bộ cơ sở dữ liệu:
  $$\text{Số hóa đơn có } (\text{total} - \text{paid\_total} - \text{adjusted\_total} < 0) = \mathbf{0}$$
- Không tồn tại hiện tượng âm công nợ trên từng hóa đơn hoặc ghi nhận trùng thanh toán.

---

## 6. LEGACY VS TEST DATA BOUNDARY

Yêu cầu kiểm toán cốt lõi là **không được nhầm lẫn toàn bộ cơ sở dữ liệu hiện tại là dữ liệu sản xuất thuần túy**, mà phải phân định ranh giới rõ ràng giữa 3 phân vùng dữ liệu:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      CURRENT RUNTIME DATABASE                          │
│               Total: 391 Payments ($2,714,580,250.00 ₫)                │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         │                                                   │
         ▼                                                   ▼
┌──────────────────────────────────┐        ┌──────────────────────────────────┐
│     A. LEGACY / HISTORICAL       │        │     B. TEST / AUDIT DATA         │
│  - 265 Physical Cash Payments    │        │  - 126 Payments                  │
│    ($852,976,250.00 ₫)           │        │    ($1,861,604,000.00 ₫)         │
│  - 14 Migrated P0 Credit Notes   │        │  - 37 từ P1.2 & P1.2.1 Tests     │
│    (Đã chuyển sang adjustments)  │        │  - 89 từ P1.2.2 Tests & Audit    │
│  - 265 Allocations (1:1 mapped)  │        │  - 101 Allocations + Unapplied   │
└──────────────────────────────────┘        └──────────────────────────────────┘
```

### Bảng phân tích chi tiết ranh giới dữ liệu:

| Phân vùng dữ liệu (Data Partition) | Dải ID / Tiêu chí | Số lượng Payments | Tổng giá trị (VND) | Allocations tương ứng | Ý nghĩa nghiệp vụ |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A. LEGACY / HISTORICAL DATA** | `id <= 279` | **265** | **852,976,250.00 ₫** | 265 bản ghi ($852,976,250.00$ ₫) | Dữ liệu gốc lịch sử từ baseline P0. 14 payment phi tiền mặt đã được di trú thành Credit Notes trong P0. |
| **B1. P1.2 & P1.2.1 TEST DATA** | `280 <= id <= 321` | **37** | **1,022,552,000.00 ₫** | 56 bản ghi ($988,052,000.00$ ₫) | Dữ liệu sinh ra từ các bộ test phân bổ đa hóa đơn, unapplied cash và idempotency. |
| **B2. P1.2.2 TEST & AUDIT DATA** | `322 <= id <= 424` | **89** | **839,052,000.00 ₫** | 45 bản ghi ($734,052,000.00$ ₫) | Dữ liệu sinh ra từ bộ test bắt buộc key, thử nghiệm tương tranh 5 luồng và đối soát pháp y. |
| **TỔNG CỘNG RUNTIME DATABASE** | `id: 1 .. 424` | **391** | **2,714,580,250.00 ₫** | **366 bản ghi** ($2,575,080,250.00$ ₫) | Toàn bộ dữ liệu hiện hành, cân đối 100% với unapplied cash ($139,500,000.00$ ₫). |

> [!NOTE]
> **QUY TẮC BẢO TOÀN DỮ LIỆU:**
> Dữ liệu nhóm B (Test/Audit) **tuyệt đối không được xóa hoặc cleanup** thủ công bằng các lệnh `DELETE` hay `TRUNCATE`. Việc lưu giữ nguyên trạng giúp bảo đảm tính liên tục của chuỗi khóa ngoại, tính toàn vẹn của mã băm kiểm toán SHA-256 (`audit_logs`) và phục vụ đối chiếu hồi quy trong tương lai.

---

## 7. SECURITY BASELINE

Trạng thái an ninh bảo mật của hệ thống đã được thẩm tra và ghi nhận tại mốc bàn giao:

### A. Phân quyền cơ sở dữ liệu (Database RBAC & Least Privilege)
- **Role `billing_app`:**
  - Bảng `payments`: Quyền `SELECT`, `INSERT` (Append-Only; cấm `UPDATE`, `DELETE`).
  - Bảng `payment_allocations`: Quyền `SELECT`, `INSERT` (Append-Only; cấm `UPDATE`, `DELETE`).
  - Bảng `payment_idempotency_keys`: Quyền `SELECT`, `INSERT` (Append-Only; cấm `UPDATE`, `DELETE`).
  - Identity Sequences: Không cấp quyền dư thừa trực tiếp; PostgreSQL quản lý `nextval()` an toàn qua quyền `INSERT` của bảng.
- **Role `billing_readonly`:**
  - Chỉ có quyền `SELECT` trên các bảng nghiệp vụ.
  - Cấm hoàn toàn `INSERT`, `UPDATE`, `DELETE`.
  - Cấm hoàn toàn truy cập bảng nhạy cảm `users`.
- **Role `exporter`:**
  - Thuộc role `pg_monitor` phục vụ giám sát Prometheus.

### B. Hạ tầng Container & Mạng (Infrastructure Hardening)
- **Non-root Container Runtime:**
  - Web service: user `node:1000`.
  - PostgreSQL: user `postgres:999`.
  - Nginx: user `nginx:101`.
  - Prometheus: user `nobody:65534`.
  - Grafana: user `grafana:472`.
  - Loki: user `10001`.
  - cAdvisor: Quyền `privileged: true` (Ngoại lệ kỹ thuật được phê chuẩn để đọc số liệu cgroups của kernel).
- **Phân tách mạng (Network Isolation):**
  - 05 mạng bridge chuyên biệt: `billing_edge_net`, `billing_admin_net`, `billing_app_net`, `billing_db_net`, `billing_monitoring_net`.
  - 03 mạng nội bộ tuyệt đối (`internal: true`): `app_net`, `db_net`, `monitoring_net`.
  - Nginx bị cô lập hoàn toàn khỏi `db_net` (Nginx không thể kết nối trực tiếp vào Postgres).
  - Web và Postgres bị cô lập hoàn toàn khỏi `admin_net`.
- **Bảo mật Cổng (Port Exposure):**
  - Cổng 3000 của Web, cổng 5432 của PostgreSQL, và cổng 3100 của Loki **không publish** ra ngoài host.
- **Tiêu đề Bảo mật HTTP (Security Headers):**
  - Đầy đủ 6 headers: HSTS (`max-age=86400`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=()`, và CSP.
  - `server_tokens off` (Nginx ẩn thông tin phiên bản).
- **Bảo mật Thông tin Xác thực (Secrets Management):**
  - Tệp `.env` không bị theo dõi bởi Git (Git untracked).
  - Tệp mẫu `.env.example` được theo dõi an toàn.
  - Tài khoản mặc định `admin:admin` của Grafana bị chặn (HTTP 401).

---

## 8. API CONTRACT BASELINE

Mọi endpoint làm biến động thanh toán/tài chính hiện tuân thủ hợp đồng nghiêm ngặt sau:

### Danh mục Endpoints chịu sự điều phối của Idempotency Bắt buộc:
1. `POST /api/payments` (Tạo thanh toán trực tiếp, phân bổ đa hóa đơn, ghi nhận unapplied cash).
2. `POST /api/invoices/:id/payments` (Ghi nhận thanh toán đơn hóa đơn truyền thống).
3. `POST /api/payments/:id/allocations` (Bổ sung phân bổ cho một khoản thanh toán hiện có).
4. `POST /api/payments/allocate` (Phân bổ tổng quát).

### Quy cách Header & Body:
- **Canonical Header:** `Idempotency-Key: <unique-string-max-255>`
- **Alternative Header:** `X-Idempotency-Key: <unique-string-max-255>`
- **Body Fallback:** `body.idempotency_key: <unique-string-max-255>`

### Danh mục Mã lỗi Chuẩn hóa (Standard Error Responses):

| Mã lỗi HTTP | Mã lỗi nghiệp vụ (`error.code`) | Điều kiện kích hoạt | Tác động tài chính |
| :--- | :--- | :--- | :--- |
| **HTTP 400** | `IDEMPOTENCY_KEY_REQUIRED` | Không có key, key rỗng `""`, hoặc key chỉ chứa khoảng trắng `"   "` | **Zero Mutation (Tuyệt đối không thay đổi DB)** |
| **HTTP 400** | `CONFLICTING_IDEMPOTENCY_KEYS` | Header `Idempotency-Key` khác với `body.idempotency_key` | **Zero Mutation** |
| **HTTP 400** | `INVALID_IDEMPOTENCY_KEY` | Chiều dài key vượt quá 255 ký tự | **Zero Mutation** |
| **HTTP 409** | `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | Tái sử dụng cùng 1 key với payload mang nội dung tài chính khác | **Zero Mutation (Không tạo thanh toán thứ 2)** |
| **HTTP 200** | *(None - Success Replay)* | Cùng 1 key + cùng payload đã xử lý trước đó | **Trả về cached response (`is_idempotent_replay: true`)** |
| **HTTP 201** | *(None - Created)* | Key mới + payload hợp lệ lần đầu tiên | **Ghi nhận thanh toán & phân bổ mới an toàn** |

---

## 9. TEST BASELINE (REGRESSION EVIDENCE)

Toàn bộ 09 bộ kiểm thử hồi quy của hệ thống đã được xác nhận đạt 100% PASS:

```text
================================================================================
                    BILLING_ONE TEST BASELINE SUMMARY
================================================================================
 1. P1.2.2 Mandatory Idempotency Suite : 16/16 PASS (+4 bonus checks) [100%]
 2. P1.2.1 Direct Payment Idempotency  : 10/10 PASS                  [100%]
 3. P1.2 Payment Allocation V2 Suite   : 18/18 PASS                  [100%]
 4. P1.1 Refund Ledger Suite           : 10/10 PASS                  [100%]
 5. P0 Remediation Suite               :  4/4  PASS                  [100%]
 6. CP2 Baseline Smoke Suite           : 15/15 PASS (p95: 25.82 ms)  [100%]
 7. Extended Enterprise Features Suite : 12/12 PASS                  [100%]
 8. Security Hardening Suite (CP6)     : 26/26 PASS                  [100%]
 9. Cryptographic Audit Chain Verify   : 941/941 SHA-256 Valid       [100%]
================================================================================
```

---

## 10. KNOWN LIMITATIONS & ARCHITECTURAL NOTES

Trước khi bước vào giai đoạn P1.3, đội ngũ kỹ thuật cần nắm rõ các đặc thù hiện tại của hệ thống:

1. **Khoảng trống dãy số ID (Sequence Gaps in `payments`):**
   - Trong bảng `payments`, tồn tại một số ID bị nhảy cóc (như 14 IDs lịch sử được chuyển thành Credit Notes ở P0, và một số ID do transaction rollback trong các kịch bản kiểm thử tiêu cực). Đây là hành vi hoàn toàn chuẩn mực của PostgreSQL Identity Sequences, không phải là lỗi mất dữ liệu.
2. **Tích lũy Tiền chưa phân bổ (Unapplied Cash Accumulation):**
   - Hiện có $139,500,000.00$ ₫ tiền chưa phân bổ nằm trong tài khoản của các khách hàng thử nghiệm. Các giao dịch hóa đơn mới cho các khách hàng này có thể tiêu thụ khoản tiền này thông qua API phân bổ.
3. **Thời gian lưu trữ Idempotency Key (Retention Policy):**
   - Bảng `payment_idempotency_keys` hiện lưu trữ vĩnh viễn (chưa cấu hình cơ chế dọn dẹp TTL hay tự động xóa định kỳ). Với quy mô hiện tại (79 bản ghi), bảng này cực kỳ nhẹ và phục vụ như một sổ nhật ký kiểm toán không thể xóa.
4. **Phân quyền người dùng Read-Only (`billing_readonly`):**
   - Mọi API truy vấn báo cáo mới xây dựng trong P1.3 cần lưu ý không cố gắng truy cập bảng `users` nếu kết nối qua pool của user read-only, vì quyền này đã bị thu hồi có chủ đích.

---

## 11. CONDITIONS FOR STARTING P1.3

Giai đoạn **P1.3** chỉ được phép kích hoạt khi thỏa mãn đầy đủ ma trận điều kiện tiên quyết dưới đây:

| Điều kiện tiên quyết (Prerequisite Condition) | Trạng thái hiện tại | Đánh giá |
| :--- | :--- | :--- |
| **1. Git Clean & Aligned** | Branch `main`, Commit `d794de0461e992122a4c8eddadb1ead2082ae8ac` | **ĐẠT (SATISFIED)** |
| **2. P1.2.2 Findings Closed** | `FIND-P1.2.1-01` & `FIND-P1.2.1-02` đã đóng hoàn toàn | **ĐẠT (SATISFIED)** |
| **3. Financial Invariants = 0 Violations** | 0 over-allocation, 0 orphan, 0 mismatch | **ĐẠT (SATISFIED)** |
| **4. Payment Allocation V2 Stable** | Cơ chế 1-N allocations & Unapplied Cash hoạt động trơn tru | **ĐẠT (SATISFIED)** |
| **5. Mandatory Idempotency Stable** | 4 endpoint mutations được bảo vệ kép, không bypass | **ĐẠT (SATISFIED)** |
| **6. Database Least Privilege Enforced** | `billing_app` Append-only, `billing_readonly` cô lập | **ĐẠT (SATISFIED)** |
| **7. Legacy vs Test Data Boundary Documented** | Ranh giới 265 legacy cash vs 126 test payments minh bạch | **ĐẠT (SATISFIED)** |
| **8. Security Hardening Active** | 26/26 chốt chặn H1-H6 kiểm tra đều đạt PASS | **ĐẠT (SATISFIED)** |
| **9. Audit Chain Cryptographically Intact** | 941/941 bản ghi SHA-256 xác thực toàn vẹn 100% | **ĐẠT (SATISFIED)** |

---

## 12. FINAL HANDOFF VERDICT

Căn cứ vào kết quả kiểm định độc lập, toàn bộ các tiêu chuẩn an toàn tài chính, tính toàn vẹn dữ liệu và yêu cầu kiến trúc của giai đoạn P1.2 đã đạt mức độ hoàn thiện cao nhất. Hệ thống không có bất kỳ rủi ro hay nợ kỹ thuật tồn đọng nào cản trở việc triển khai giai đoạn kế tiếp.

Technical Lead chính thức công bố quyết định bàn giao:

```text
================================================================================
  FINAL HANDOFF VERDICT:
  P1.2 FINAL HANDOFF — READY FOR P1.3
================================================================================
```

> [!IMPORTANT]
> **CHỈ THỊ DỪNG TUYỆT ĐỐI (ABSOLUTE STOP RULE):**
> Nhiệm vụ tạo mốc bàn giao kỹ thuật kết thúc tại đây.
> - **KHÔNG** bắt đầu triển khai P1.3 trong phiên làm việc này.
> - **KHÔNG** sửa đổi mã nguồn nghiệp vụ hoặc schema cơ sở dữ liệu.
> - **KHÔNG** thực hiện cleanup hay xóa dữ liệu kiểm thử.
> Toàn bộ công việc tiếp theo sẽ do phiên làm việc P1.3 tiếp quản dựa trên mốc bàn giao này.
