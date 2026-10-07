# BILLING_ONE — MASTER EXECUTION PROMPT
## Tích hợp phần lớn nghiệp vụ phù hợp từ LedgerFlow vào Billing_One

> ĐÂY LÀ PROMPT THỰC THI CHÍNH CHO CODING AGENT.
>
> Mục tiêu: đọc, phân tích, thiết kế, triển khai, kiểm thử và hoàn thiện việc tích hợp các tính năng/nghiệp vụ phù hợp từ hệ thống tham chiếu LedgerFlow vào hệ thống chính Billing_One.
>
> QUAN TRỌNG NHẤT:
> - Billing_One là TARGET SYSTEM và SOURCE OF TRUTH.
> - LedgerFlow chỉ là REFERENCE SYSTEM.
> - Không được biến LedgerFlow thành hệ thống chính.
> - Không được merge hai project một cách cơ học.
> - Không được rewrite Billing_One chỉ vì LedgerFlow dùng công nghệ/kiến trúc khác.
> - Tất cả tính năng sau cùng phải chạy bằng dữ liệu thật, backend thật, database thật và tích hợp vào Billing_One.
> - Hãy làm việc tuần tự cho đến khi hoàn thành toàn bộ phạm vi phù hợp; không dừng ở mức phân tích hoặc prototype nếu vẫn còn công việc có thể thực hiện được.

---

# 0. FILE VÀ THƯ MỤC CẦN TUÂN THỦ

Project root:

```text
Billing_One/
```

Hệ thống chính:

```text
Billing_One/
├── app/
├── db/
├── docs/
├── logging/
├── monitoring/
├── nginx/
├── pgadmin/
├── scripts/
├── docker-compose.yml
├── README.md
├── AGENT_MASTER_INSTRUCTIONS.md
└── ...
```

Hệ thống tham chiếu:

```text
Billing_One/_reference/LedgerFlow/
```

Luật tổng quát nằm trong:

```text
Billing_One/AGENT_MASTER_INSTRUCTIONS.md
```

PHẢI đọc file này trước khi bắt đầu.

---

# 1. MỤC TIÊU CUỐI CÙNG

Xây dựng:

```text
Billing_One Extended
```

bằng cách:

```text
Billing_One hiện tại
        +
nghiệp vụ/tính năng phù hợp được phân tích từ LedgerFlow
        ↓
Billing_One Extended
```

Không tạo:

```text
Billing_One + LedgerFlow chạy song song
```

Không giữ các luồng production phụ thuộc vào mock state của LedgerFlow.

---

# 2. NGUYÊN TẮC KHÔNG ĐƯỢC PHÁ VỠ

## 2.1. Billing_One là hệ thống chính

Mọi quyết định kỹ thuật phải ưu tiên:

1. Tính toàn vẹn dữ liệu Billing_One.
2. Security.
3. Business correctness.
4. Backward compatibility.
5. Maintainability.
6. Scalability.
7. Khả năng test.
8. Sau cùng mới đến tốc độ triển khai.

## 2.2. LedgerFlow chỉ để tham khảo

LedgerFlow dùng để tìm hiểu:

- nghiệp vụ;
- workflow;
- domain;
- UI/UX;
- chức năng;
- business rules;
- báo cáo;
- trạng thái;
- các module còn thiếu.

Không được mặc định rằng cách cài đặt trong LedgerFlow là cách phải dùng trong Billing_One.

## 2.3. Không được phá code hiện tại chỉ để code nhanh

Không được tự ý:

- xóa backend;
- thay database;
- thay toàn bộ authentication;
- thay Docker architecture;
- thay Nginx;
- thay logging;
- thay monitoring;
- đổi framework;
- rewrite toàn bộ frontend;
- xóa dữ liệu/migration hiện có.

Chỉ thay đổi lớn khi thực sự cần thiết, có lý do kỹ thuật và có migration/rollback plan.

---

# 3. CHẾ ĐỘ LÀM VIỆC

Agent phải làm theo chu trình:

```text
INSPECT
↓
UNDERSTAND
↓
ANALYZE
↓
PLAN
↓
IMPLEMENT
↓
TEST
↓
REVIEW
↓
FIX
↓
DOCUMENT
↓
VERIFY
↓
NEXT FEATURE
```

Không được nhảy trực tiếp từ đọc LedgerFlow sang coding.

---

# 4. GIAI ĐOẠN A — ĐỌC VÀ KIỂM KÊ TOÀN BỘ

## A1. Đọc Master Instructions

Đọc:

```text
AGENT_MASTER_INSTRUCTIONS.md
```

và coi đó là rule bắt buộc.

## A2. Kiểm kê Billing_One

Đọc và lập inventory cho:

- source code;
- frontend;
- backend;
- routes;
- controllers;
- services;
- middleware;
- auth;
- validation;
- database;
- migrations;
- scripts;
- Docker;
- Nginx;
- logging;
- monitoring;
- tests;
- docs;
- env/config;
- startup flow;
- health checks;
- API endpoints.

Không giả định cấu trúc từ tên file; phải mở và đọc source thực tế.

## A3. Kiểm kê LedgerFlow

Đọc toàn bộ phần source cần thiết trong:

```text
_reference/LedgerFlow/
```

Tập trung:

- pages/views;
- components;
- state;
- types;
- mockData;
- business calculations;
- workflows;
- routing;
- reports;
- dashboard;
- invoice;
- payment;
- customer;
- product/service;
- tax;
- recurring;
- reconciliation;
- audit;
- RBAC;
- settings.

Phải phân biệt rõ:

```text
REAL BUSINESS LOGIC
vs
FRONTEND MOCK/SIMULATION
```

---

# 5. GIAI ĐOẠN B — GAP ANALYSIS

Tạo/cập nhật:

```text
docs/LEDGERFLOW_TO_BILLING_ONE_GAP_ANALYSIS.md
```

Phải lập ma trận ít nhất:

| Feature | LedgerFlow | Billing_One | Status | Reuse | DB | API | Backend | Frontend | Tests | Dependencies | Risk | Priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|

Status:

- EXISTING
- PARTIAL
- MISSING
- NEEDS_REDESIGN
- NOT_APPLICABLE

Phải đánh giá từng tính năng.

Không được triển khai mọi thứ chỉ vì LedgerFlow có.

Phải loại bỏ những thứ:
- trùng lặp;
- không phù hợp;
- chỉ là mock;
- quá nguy hiểm để tích hợp nguyên trạng;
- xung đột với business rules Billing_One.

---

# 6. GIAI ĐOẠN C — XÂY TARGET ARCHITECTURE

Tạo/cập nhật:

```text
docs/BILLING_ONE_TARGET_ARCHITECTURE.md
docs/BILLING_ONE_DOMAIN_MODEL.md
docs/BILLING_ONE_DATABASE_EVOLUTION.md
docs/BILLING_ONE_FEATURE_ROADMAP.md
```

Mục tiêu kiến trúc:

```text
Frontend
   ↓
Billing_One API
   ↓
Business Modules / Services
   ↓
PostgreSQL
```

Infrastructure hiện tại của Billing_One tiếp tục được sử dụng nếu phù hợp:

```text
Nginx
Docker
PostgreSQL
Prometheus
Grafana
Loki
Promtail
```

Nếu cần thêm worker/scheduler/queue thì tích hợp vào kiến trúc Billing_One, không tạo hệ thống riêng chỉ vì LedgerFlow có.

---

# 7. DOMAIN MỤC TIÊU

Đánh giá và tích hợp phù hợp các domain sau:

```text
Authentication
Users
Roles
Permissions

Customers
Customer Accounts
Credit Management
Payment Terms

Products
Services

Invoices
Invoice Items
Invoice Lifecycle

Payments
Payment Allocations
Refunds

Invoice Adjustments
Credit Notes
Debit Adjustments

Recurring Billing

Bank Transactions
Reconciliation
Matching

Tax
VAT Reporting

Revenue
Collections
Aging
DSO
MRR
ARR

Dashboard
Reports

Audit Logs
Approvals
Notifications

Settings
Customer Portal
Documents
```

Không cần tạo tất cả bảng/module nếu GAP Analysis chứng minh chưa cần.

---

# 8. THỨ TỰ TRIỂN KHAI

Ưu tiên theo dependency và độ an toàn:

## Phase 1 — Core Stabilization
- hiểu và bảo vệ Billing Core;
- test baseline;
- chuẩn hóa dữ liệu hiện tại nếu cần.

## Phase 2 — Product / Service
- products;
- services;
- pricing;
- tax metadata.

## Phase 3 — Payment Terms
- NET terms;
- due date;
- grace period;
- early-payment/late-payment rules nếu phù hợp.

## Phase 4 — Customer Credit
- credit limit;
- debt;
- available credit;
- customer financial profile.

## Phase 5 — Payment Allocation
- partial payment;
- multiple payments;
- allocation;
- outstanding balance;
- overpayment strategy.

## Phase 6 — Aging / Collection
- aging buckets;
- overdue;
- collection metrics;
- DSO.

## Phase 7 — Revenue / Financial Reporting
- revenue;
- collected;
- outstanding;
- MRR;
- ARR;
- KPI definitions;
- dashboard.

## Phase 8 — Adjustments
- credit note;
- debit adjustment;
- refund;
- approval workflow.

## Phase 9 — Recurring Billing
- recurring plan;
- billing cycle;
- scheduler/worker;
- invoice generation;
- retry;
- idempotency;
- failure handling.

## Phase 10 — Bank Reconciliation
- bank transaction;
- matching;
- unmatched;
- manual match;
- auto match;
- reconciliation status.

## Phase 11 — RBAC
- role;
- permission;
- permission enforcement;
- UI visibility.

## Phase 12 — Audit
- business audit trail;
- history;
- actor;
- timestamp;
- entity;
- action.

## Phase 13 — Tax
- tax engine improvements;
- VAT reporting;
- tax reports.

## Phase 14 — Advanced Dashboard / Reports
- financial dashboard;
- aging;
- revenue;
- tax;
- collection;
- reconciliation.

## Phase 15 — Portal / Documents
Chỉ triển khai khi nền tảng core đã ổn định.

## Phase 16 — Future Intelligence
AI/automation chỉ triển khai sau khi dữ liệu và nghiệp vụ core đáng tin cậy.

Có thể thay đổi thứ tự nếu dependency thực tế yêu cầu. Mọi thay đổi phải được ghi nhận trong roadmap.

---

# 9. QUY TẮC DATABASE

PostgreSQL của Billing_One là SOURCE OF TRUTH.

Trước mỗi database change:

1. Đọc schema hiện tại.
2. Kiểm tra bảng có thể reuse.
3. Xác định quan hệ.
4. Xác định PK/FK.
5. Xác định unique constraints.
6. Xác định check constraints.
7. Xác định indexes.
8. Xác định nullability/defaults.
9. Kiểm tra dữ liệu hiện có.
10. Tạo migration an toàn.

Không được dùng:

```text
DROP DATABASE
```

hoặc xóa dữ liệu hiện tại để "cho dễ làm".

Không được thêm bảng trùng chức năng chỉ vì LedgerFlow có tên bảng khác.

---

# 10. QUY TẮC INVOICE

Invoice phát hành là financial record.

Không được tùy tiện sửa trực tiếp giá trị tài chính quan trọng của invoice đã issue.

Điều chỉnh nên đi qua domain phù hợp:

```text
Credit Note
Debit Adjustment
Invoice Adjustment
Refund
Payment Allocation
```

Phải giữ history và audit.

Invoice lifecycle phải rõ ràng.

---

# 11. QUY TẮC PAYMENT

Payment phải xử lý chính xác:

- full payment;
- partial payment;
- multiple payment;
- outstanding;
- allocation;
- refund;
- duplicate payment;
- race condition.

Không dựa vào frontend để bảo vệ số tiền.

Phải dùng transaction phù hợp.

Khi cần:

```text
SELECT ... FOR UPDATE
```

hoặc cơ chế locking tương đương.

Phải xem xét idempotency đối với endpoint có thể bị retry.

---

# 12. QUY TẮC FINANCIAL CALCULATION

Mọi số liệu:

- total;
- subtotal;
- tax;
- paid;
- outstanding;
- credit;
- revenue;
- aging;
- DSO;
- MRR;
- ARR;

phải có:

- định nghĩa;
- công thức;
- source data;
- time range;
- rounding;
- treatment của cancelled invoice;
- treatment của refund;
- treatment của credit note;
- treatment của partial payment.

Không được tạo KPI "cho đẹp giao diện".

---

# 13. RECURRING BILLING

Nếu triển khai:

Không được làm kiểu frontend:

```text
button → setState → invoice generated
```

Production flow phải là:

```text
Recurring Plan
↓
Scheduler / Worker
↓
Eligibility Check
↓
Idempotency Check
↓
Generate Invoice
↓
Persist
↓
Audit
↓
Notification
```

Phải chống duplicate invoice khi job chạy lại.

---

# 14. BANK RECONCILIATION

Mô hình mục tiêu:

```text
Bank Transaction
        ↓
Matching Engine
        ↓
Candidate Invoice(s)
        ↓
Match Decision
        ↓
Payment
        ↓
Payment Allocation
        ↓
Reconciliation Result
        ↓
Audit
```

Phải phân biệt:
- matched;
- unmatched;
- partial;
- manual;
- automatic;
- conflict.

Không được coi nút UI "match" là feature hoàn thành nếu backend chưa lưu và xử lý đúng.

---

# 15. RBAC

Không hard-code role checks ở quá nhiều nơi.

Hướng mục tiêu:

```text
User
 ↓
Role
 ↓
Permission
```

Ví dụ:

```text
invoice.create
invoice.read
invoice.update
invoice.issue
invoice.cancel

payment.create
payment.read
payment.refund

customer.create
customer.update

reconciliation.read
reconciliation.manage

report.view
audit.view
```

Permission phải được enforce ở backend.

Frontend chỉ hỗ trợ UX.

---

# 16. AUDIT

Phải có business audit cho các thao tác quan trọng.

Ví dụ:

```text
INVOICE_CREATED
INVOICE_ISSUED
INVOICE_CANCELLED

PAYMENT_CREATED
PAYMENT_ALLOCATED
PAYMENT_REFUNDED

CREDIT_NOTE_CREATED
ADJUSTMENT_APPROVED

BANK_TRANSACTION_MATCHED
BANK_TRANSACTION_UNMATCHED

ROLE_CHANGED
PERMISSION_CHANGED
```

Technical logging không thay thế business audit.

---

# 17. FRONTEND

Có thể tham khảo LedgerFlow về:

- navigation;
- dashboard;
- table;
- filter;
- form;
- workflow;
- UX;
- visual hierarchy.

Nhưng phải nối vào Billing_One API.

Không để production flow phụ thuộc:

```text
INITIAL_*
mockData
fake API
React-only state
```

sau khi feature đã được triển khai thật.

---

# 18. CODE QUALITY

Code mới phải:

- phù hợp convention hiện tại;
- modular;
- dễ test;
- có error handling;
- không duplicate business logic;
- không copy-paste vô tội vạ;
- không để magic numbers/string trong nghiệp vụ quan trọng;
- validate input;
- log đúng mức;
- không log secret.

Nếu refactor cần thiết, làm incremental.

---

# 19. SECURITY

Mọi feature mới phải kiểm tra:

- authentication;
- authorization;
- validation;
- SQL injection;
- XSS;
- CSRF nếu áp dụng;
- rate limiting nếu cần;
- secrets;
- session;
- sensitive logs;
- permission bypass;
- IDOR;
- tenant boundaries nếu có.

Không commit secret.

Không đọc/ghi `.env` ra source control.

---

# 20. TESTING BẮT BUỘC

Mỗi feature phải kiểm thử theo khả năng thực tế.

## Unit
Business rules.

## Integration
API + DB.

## Regression
Feature cũ Billing_One vẫn hoạt động.

## Security
Unauthorized / forbidden.

## Concurrency
Payment/allocation/adjustment nếu liên quan.

## Data Integrity
FK, uniqueness, amount constraints.

Feature chỉ được đánh dấu DONE khi test phù hợp đã pass.

---

# 21. BASELINE BEFORE CHANGE

Trước khi sửa lớn:

1. Chạy test hiện có.
2. Chạy health check.
3. Xác nhận app khởi động.
4. Xác nhận database kết nối.
5. Xác nhận API chính hoạt động.
6. Ghi nhận baseline.

Nếu baseline đang lỗi:

- xác định lỗi tồn tại từ trước hay do thay đổi;
- không che giấu lỗi;
- không coi lỗi cũ là lỗi do feature mới.

---

# 22. CHANGE SAFETY

Trước mỗi thay đổi lớn:

- kiểm tra git status;
- không ghi đè file không liên quan;
- không xóa code chỉ vì chưa hiểu;
- tạo migration;
- giữ backward compatibility khi có thể;
- test ngay sau thay đổi.

Sau mỗi feature lớn:

```text
git diff
↓
review
↓
test
↓
fix
```

---

# 23. WORKTREE / REFERENCE SAFETY

Không sửa:

```text
_reference/LedgerFlow/
```

trừ khi task cụ thể yêu cầu chỉnh hệ thống tham chiếu.

Mặc định LedgerFlow là READ-ONLY REFERENCE.

Tất cả code mới phải đi vào Billing_One.

---

# 24. KHÔNG ĐƯỢC DỪNG Ở MOCK

Không chấp nhận trạng thái:

```text
UI xong
↓
mock data
↓
DONE
```

Feature production phải là:

```text
UI
↓
API
↓
Business Logic
↓
DB
↓
Validation
↓
Authorization
↓
Transaction
↓
Audit
↓
Tests
```

---

# 25. DOCUMENTATION SAU MỖI FEATURE

Cập nhật tài liệu khi cần:

```text
docs/
```

Tối thiểu phải cập nhật khi feature ảnh hưởng đến:
- architecture;
- database;
- API;
- business rules;
- setup;
- operations;
- testing.

---

# 26. TODO / TECHNICAL DEBT

Không được giấu phần chưa hoàn thành.

Nếu phải tạm hoãn:

Tạo hoặc cập nhật:

```text
docs/TECHNICAL_DEBT.md
```

Ghi:
- chưa làm gì;
- tại sao;
- impact;
- priority;
- cách hoàn thiện.

Không đánh dấu DONE nếu còn phần bắt buộc chưa làm.

---

# 27. BLOCKER POLICY

Agent không được tự đoán đối với nghiệp vụ tài chính quan trọng.

Nếu gặp ambiguity nhỏ có thể giải quyết an toàn bằng convention hiện tại, chọn phương án nhất quán và ghi lại.

Nếu gặp blocker thật sự:

- mô tả blocker;
- chỉ ra file/module liên quan;
- nêu các phương án;
- chọn phương án an toàn nhất nếu có thể;
- chỉ dừng khi việc tiếp tục có nguy cơ làm hỏng dữ liệu/kiến trúc/security.

Không dừng vì lý do "cần người dùng xác nhận" nếu vấn đề chỉ là implementation detail có thể quyết định bằng quy tắc trong tài liệu này.

---

# 28. EXECUTION LOOP CHO TỪNG FEATURE

Với mỗi feature:

```text
1. Read relevant LedgerFlow code
2. Read relevant Billing_One code
3. Identify existing capability
4. Map business concepts
5. Update GAP/PLAN
6. Design DB
7. Create migration
8. Implement backend/domain
9. Implement API
10. Add validation/security
11. Add transaction/concurrency handling
12. Add audit where required
13. Implement frontend
14. Remove dependency on mock data
15. Add/update tests
16. Run tests
17. Run application
18. Perform smoke test
19. Review diff
20. Fix regressions
21. Update docs
22. Mark feature complete
23. Move to next feature
```

---

# 29. DEFINITION OF DONE

Một feature chỉ COMPLETE khi:

- [ ] business requirement đã hiểu;
- [ ] GAP Analysis đã cập nhật;
- [ ] DB đã đúng;
- [ ] migration đã có;
- [ ] backend đã hoàn thành;
- [ ] API đã hoàn thành;
- [ ] validation đã hoàn thành;
- [ ] authorization đã hoàn thành;
- [ ] transaction/concurrency đã xem xét;
- [ ] audit đã xem xét;
- [ ] frontend đã kết nối API thật;
- [ ] mock production flow đã loại bỏ;
- [ ] test đã pass;
- [ ] regression đã kiểm tra;
- [ ] docs đã cập nhật;
- [ ] app khởi động bình thường;
- [ ] không phá chức năng cũ.

---

# 30. FINAL SYSTEM ACCEPTANCE

Sau khi hoàn tất phạm vi tích hợp:

## Functional
Kiểm tra:
- customer;
- product/service;
- invoice;
- payment;
- allocation;
- overdue;
- aging;
- credit;
- terms;
- recurring;
- adjustment;
- refund;
- reconciliation;
- tax;
- reports;
- dashboard;
- RBAC;
- audit.

## Technical
Kiểm tra:
- build;
- startup;
- Docker;
- DB;
- API;
- Nginx;
- logs;
- monitoring;
- tests.

## Security
Kiểm tra:
- auth;
- permission;
- validation;
- secret handling;
- data access;
- sensitive logging.

## Data Integrity
Kiểm tra:
- migration;
- constraints;
- foreign keys;
- monetary precision;
- transaction consistency;
- duplicate prevention.

---

# 31. FINAL REPORT

Khi hoàn thành toàn bộ phạm vi có thể triển khai, tạo:

```text
docs/LEDGERFLOW_INTEGRATION_FINAL_REPORT.md
```

Báo cáo phải có:

1. Những feature đã tích hợp.
2. Những feature đã redesign.
3. Những feature không tích hợp và lý do.
4. Database changes.
5. API changes.
6. Backend modules.
7. Frontend modules.
8. Tests.
9. Security changes.
10. Audit changes.
11. Infrastructure changes.
12. Remaining technical debt.
13. Future recommendations.
14. Các file quan trọng đã thay đổi.

---

# 32. BẮT ĐẦU THỰC THI

Ngay sau khi nhận prompt này:

## BƯỚC 1
Đọc:

```text
AGENT_MASTER_INSTRUCTIONS.md
```

## BƯỚC 2
Đọc toàn bộ Billing_One.

## BƯỚC 3
Đọc toàn bộ LedgerFlow ở:

```text
_reference/LedgerFlow/
```

## BƯỚC 4
Lập GAP Analysis.

## BƯỚC 5
Lập target architecture/domain/database roadmap.

## BƯỚC 6
Kiểm tra baseline và test hiện tại.

## BƯỚC 7
Bắt đầu triển khai theo priority/dependency.

## BƯỚC 8
Sau mỗi feature:
- test;
- review;
- fix;
- document.

## BƯỚC 9
Tiếp tục sang feature kế tiếp.

## BƯỚC 10
Khi tất cả feature phù hợp đã được xử lý, chạy final verification.

## BƯỚC 11
Tạo final report.

---

# 33. ABSOLUTE RULE

Hãy luôn ghi nhớ:

```text
Billing_One = TARGET
LedgerFlow  = REFERENCE
```

Mục tiêu:

```text
LedgerFlow
   ↓
Analyze
   ↓
Extract business capabilities
   ↓
Redesign where necessary
   ↓
Implement in Billing_One
   ↓
Test
   ↓
Verify
```

KHÔNG:

```text
Copy LedgerFlow
↓
Merge
↓
Hy vọng chạy được
```

Hệ thống cuối cùng phải là:

```text
                     BILLING_ONE EXTENDED
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
      Billing              Finance              Operations
        │                     │                     │
 Customer/Product         Aging/DSO             Recurring
 Invoice/Payment          Revenue/MRR           Reconciliation
 Allocation               Tax                   Notifications
 Adjustments              Reports               Audit
 Credit                   Dashboard             RBAC
                              │
                              ↓
                         PostgreSQL
                              │
                     SOURCE OF TRUTH
```

Không dừng ở mức prototype nếu implementation production khả thi.

Không phá hệ thống chính.

Không dùng mock làm production data.

Không tự ý rewrite.

Không bỏ qua test.

Không bỏ qua security.

Không bỏ qua data integrity.

Hãy hoàn thành công việc theo tuần tự cho đến khi phạm vi tích hợp được triển khai và kiểm chứng đầy đủ.
