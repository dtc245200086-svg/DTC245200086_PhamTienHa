# AGENT MASTER INSTRUCTIONS
# Billing_One – Master Development & LedgerFlow Integration Rules

> IMPORTANT:
> Billing_One là HỆ THỐNG CHÍNH.
> LedgerFlow là HỆ THỐNG THAM CHIẾU.
>
> Mục tiêu là mở rộng Billing_One bằng cách nghiên cứu, phân tích và chuyển hóa các nghiệp vụ/tính năng phù hợp từ LedgerFlow vào Billing_One.
>
> KHÔNG được biến LedgerFlow thành hệ thống chính.
> KHÔNG được rewrite Billing_One chỉ vì LedgerFlow có kiến trúc khác.
> KHÔNG được coi mock data của LedgerFlow là dữ liệu production.

---

# 1. PROJECT IDENTITY

## 1.1. Target System

Tên hệ thống chính:

Billing_One

Billing_One là:
- source code chính;
- hệ thống cần phát triển;
- hệ thống production target;
- source of truth về dữ liệu;
- nơi tất cả tính năng mới cuối cùng phải được tích hợp.

## 1.2. Reference System

Hệ thống tham chiếu:

ledgerflow---quản-lý-hóa-đơn-&-tài-chính-doanh-nghiệp

Hệ thống này chỉ dùng để:
- nghiên cứu nghiệp vụ;
- tham khảo chức năng;
- tham khảo workflow;
- tham khảo UI/UX;
- tham khảo domain model;
- phát hiện các tính năng Billing_One còn thiếu;
- tham khảo business rules;
- tham khảo cách tổ chức module.

LedgerFlow KHÔNG phải target system.

---

# 2. HIERARCHY OF AUTHORITY

Khi hai hệ thống có khác biệt, ưu tiên theo thứ tự:

1. Yêu cầu của Billing_One.
2. Kiến trúc và database hiện tại của Billing_One.
3. Business rules đã được xác định cho Billing_One.
4. Security requirements của Billing_One.
5. LedgerFlow chỉ dùng làm nguồn tham khảo.
6. Không sao chép thiết kế LedgerFlow một cách máy móc.

Nếu LedgerFlow có cách triển khai khác Billing_One:

Không được tự động thay thế Billing_One.

Phải:
- hiểu nghiệp vụ;
- đánh giá tính phù hợp;
- thiết kế lại theo kiến trúc Billing_One;
- đảm bảo backward compatibility;
- kiểm tra regression.

---

# 3. FIRST ACTION – DO NOT CODE IMMEDIATELY

Trước khi sửa bất kỳ source code nào:

PHẢI đọc và phân tích toàn bộ cấu trúc Billing_One.

Đồng thời đọc hệ thống LedgerFlow để hiểu:
- module;
- nghiệp vụ;
- workflow;
- entity;
- state;
- UI;
- các chức năng;
- các business rules;
- mock data;
- các dependency.

Không được bắt đầu coding ngay sau khi chỉ đọc README.

---

# 4. BILLING_ONE ARCHITECTURE ANALYSIS

Phải xác định trước:

## Application
- frontend;
- backend;
- API;
- services;
- routes;
- middleware;
- authentication;
- authorization;
- validation;
- error handling.

## Database
- schema;
- tables;
- primary keys;
- foreign keys;
- indexes;
- constraints;
- relationships;
- migrations;
- transaction handling;
- locking/concurrency.

## Infrastructure
- Docker;
- Docker Compose;
- Nginx;
- HTTPS;
- logging;
- monitoring;
- Prometheus;
- Grafana;
- Loki;
- Promtail;
- PostgreSQL;
- pgAdmin;
- scripts.

## Testing
- unit test;
- integration test;
- API test;
- database test;
- regression test.

---

# 5. LEDGERFLOW ANALYSIS

Phải phân tích toàn bộ các module của LedgerFlow.

Tập trung đặc biệt vào:

## Billing
- Invoice
- Invoice Item
- Invoice Lifecycle
- Recurring Invoice
- Payment
- Refund
- Credit Note
- Adjustment

## Customer
- Customer
- Customer Segment
- Credit Limit
- Outstanding Balance
- Payment Terms

## Product
- Product
- Service
- SKU
- Unit
- Price
- Tax

## Financial
- Revenue
- Collected
- Outstanding
- Aging
- DSO
- Collection
- MRR
- ARR

## Tax
- VAT
- Tax Rate
- Tax Reports

## Reconciliation
- Bank Transaction
- Matching
- Auto Matching
- Manual Matching
- Reconciliation Status

## Governance
- RBAC
- Role
- Permission
- Audit Log
- Approval Workflow

## Automation
- Recurring Billing
- Scheduler
- Notifications
- Due Date Processing

## Reporting
- Dashboard
- Revenue Report
- Aging Report
- Tax Report
- Collection Report
- Reconciliation Report

---

# 6. REQUIRED GAP ANALYSIS

Trước khi triển khai feature mới, PHẢI tạo:

docs/LEDGERFLOW_TO_BILLING_ONE_GAP_ANALYSIS.md

Phải có bảng:

| Feature | LedgerFlow | Billing_One | Status | DB Change | API Change | Backend Change | Frontend Change | Dependencies | Risk |
|---|---|---|---|---|---|---|---|---|---|

Status chỉ được dùng:

- EXISTING
- PARTIAL
- MISSING
- NEEDS_REDESIGN
- NOT_APPLICABLE

Không được coi feature là MISSING chỉ vì chưa thấy ở giao diện.

Phải kiểm tra cả:
- database;
- backend;
- API;
- frontend;
- business logic.

---

# 7. FEATURE INTEGRATION RULE

Mỗi tính năng LedgerFlow muốn đưa vào Billing_One phải đi theo pipeline:

LedgerFlow
↓
Analyze
↓
Understand Business Requirement
↓
Map to Billing_One Domain
↓
Database Design
↓
Migration
↓
Backend Service
↓
API
↓
Validation
↓
Authorization
↓
Transaction / Concurrency
↓
Audit
↓
Frontend
↓
Tests
↓
Documentation

Không được coi chỉ làm UI là hoàn thành feature.

---

# 8. DATABASE RULES

PostgreSQL của Billing_One là SOURCE OF TRUTH.

Không được:
- dùng mock data làm database thật;
- lưu business state quan trọng chỉ trong frontend;
- tạo database thứ hai chỉ để phục vụ LedgerFlow;
- xóa database production để dựng lại;
- bỏ foreign key nếu không có lý do kỹ thuật rõ ràng;
- thay đổi schema mà không có migration.

Trước khi tạo bảng mới:

1. Kiểm tra bảng hiện có.
2. Xem có thể mở rộng bảng hiện tại hay không.
3. Kiểm tra normalized design.
4. Xác định quan hệ.
5. Xác định constraints.
6. Xác định indexes.
7. Đánh giá migration.
8. Đánh giá backward compatibility.

---

# 9. BILLING CORE

Billing_One phải giữ vai trò là core.

Các domain chính:

- Users
- Customers
- Products/Services
- Invoices
- Invoice Items
- Payments
- Payment Allocations
- Adjustments
- Recurring Billing
- Reconciliation
- Tax
- Reporting
- Audit
- RBAC

Không được tạo thêm một "Billing Core" riêng bên trong LedgerFlow.

---

# 10. INVOICE INTEGRITY

Invoice là financial record.

Với invoice đã phát hành:

KHÔNG được tùy tiện sửa trực tiếp các giá trị tài chính quan trọng.

Các thay đổi tài chính nên được mô hình hóa thông qua:
- Credit Note;
- Debit Adjustment;
- Invoice Adjustment;
- Refund;
- Payment Allocation.

Phải giữ:
- history;
- audit trail;
- relationship với invoice gốc;
- actor thực hiện;
- timestamp.

---

# 11. PAYMENT ENGINE

Payment phải hỗ trợ theo thiết kế phù hợp:

- full payment;
- partial payment;
- multiple payments;
- outstanding amount;
- payment allocation;
- overpayment handling;
- refund.

Mọi phép thay đổi số tiền phải được bảo vệ bằng:
- server-side validation;
- database constraints;
- transaction;
- concurrency protection;
- idempotency khi cần.

KHÔNG được chỉ cập nhật số dư ở frontend.

---

# 12. PAYMENT ALLOCATION

Không giả định:

1 invoice = 1 payment.

Thiết kế phải có khả năng hỗ trợ:

Invoice
↕
Payment Allocation
↕
Payment

Một payment có thể được phân bổ cho nhiều invoice nếu nghiệp vụ cho phép.

Một invoice có thể nhận nhiều payment.

Phải bảo đảm:

paid_total <= total

trừ trường hợp hệ thống cố ý hỗ trợ overpayment và đã có business rule rõ ràng.

---

# 13. PAYMENT TERMS

Nghiên cứu và tích hợp Payment Terms từ LedgerFlow.

Có thể cần:
- NET 15;
- NET 30;
- NET 60;
- grace period;
- discount;
- late fee.

Không hard-code payment terms trong frontend.

Nên xây dựng domain riêng nếu cần.

---

# 14. CREDIT LIMIT

Customer có thể có:

- credit limit;
- current debt;
- available credit.

Các giá trị tài chính phải được tính hoặc lưu theo chiến lược rõ ràng.

Không cho frontend tự tính rồi coi đó là source of truth.

Backend phải kiểm tra credit rules.

---

# 15. AGING

Phải hỗ trợ ít nhất:

- Current
- 1–30 days
- 31–60 days
- 61–90 days
- 90+ days

Aging phải được tính từ dữ liệu invoice thật.

Không lưu mock aging data.

Phải xử lý đúng:
- due date;
- paid amount;
- outstanding amount;
- invoice status.

---

# 16. REVENUE / COLLECTION / DSO

Nghiên cứu và tích hợp các KPI phù hợp:

- Revenue
- Collected
- Outstanding
- Overdue
- Collection Rate
- DSO
- MRR
- ARR

KPI phải có định nghĩa rõ ràng.

Không được tạo KPI chỉ để giao diện có số liệu đẹp.

Mỗi KPI phải xác định:
- formula;
- data source;
- time range;
- filters;
- treatment of cancelled invoice;
- treatment of refunded payment;
- treatment of credit note.

---

# 17. RECURRING BILLING

Nếu triển khai recurring billing:

Phải thiết kế domain thực sự.

Có thể bao gồm:

- recurring plan;
- customer;
- frequency;
- start date;
- end date;
- next run date;
- billing cycle;
- amount;
- status;
- retry;
- failure handling;
- generated invoice.

Recurring execution phải chạy server-side.

KHÔNG được chỉ sử dụng React state hoặc button để giả lập scheduler.

Phải xem xét:
- worker;
- cron;
- queue;
- idempotency;
- duplicate invoice prevention.

---

# 18. BANK RECONCILIATION

LedgerFlow chỉ cung cấp nghiệp vụ tham khảo.

Billing_One phải xây dựng reconciliation theo kiến trúc backend của Billing_One.

Mô hình:

Bank Transaction
↓
Matching Engine
↓
Candidate Invoice
↓
Match Decision
↓
Payment / Allocation
↓
Reconciliation Result
↓
Audit

Hỗ trợ phù hợp:
- auto matching;
- manual matching;
- unmatched;
- partial match;
- matched;
- reconciliation history.

---

# 19. CREDIT NOTE / ADJUSTMENT

Không sửa trực tiếp invoice đã phát hành khi nghiệp vụ yêu cầu điều chỉnh.

Có thể cần:

invoice_adjustments

với:
- original_invoice_id;
- adjustment_type;
- reason;
- amount;
- tax;
- status;
- created_by;
- approved_by;
- created_at.

Approval workflow phải được xem xét nếu adjustment có ảnh hưởng tài chính lớn.

---

# 20. TAX

Tích hợp tax/VAT theo nghiệp vụ phù hợp.

Không hard-code tất cả tax rule vào UI.

Tax calculation phải được thực hiện ở backend hoặc domain layer phù hợp.

Phải thống nhất:
- subtotal;
- taxable amount;
- tax rate;
- tax amount;
- total.

Tax report phải sử dụng dữ liệu thật.

---

# 21. RBAC

Không xây RBAC chỉ bằng:

if role == admin

Phải hướng đến:

User
↓
Role
↓
Permission

Ví dụ:

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

report.view

audit.view

reconciliation.manage

Quyền phải được enforce ở backend.

Frontend chỉ dùng để ẩn/hiện giao diện.

---

# 22. AUDIT LOG

Phải phân biệt:

## Technical Logging

Ví dụ:
- request;
- response;
- exception;
- performance;
- infrastructure.

## Business Audit

Ví dụ:
- create invoice;
- issue invoice;
- cancel invoice;
- create payment;
- refund payment;
- create credit note;
- approve adjustment;
- change customer;
- reconcile bank transaction;
- change permission.

Business audit nên có:
- actor;
- action;
- entity;
- entity_id;
- timestamp;
- metadata;
- old/new values khi cần.

---

# 23. FRONTEND RULES

Nếu LedgerFlow dùng React nhưng Billing_One đang có frontend khác:

KHÔNG được kết luận rằng phải rewrite toàn bộ frontend chỉ vì LedgerFlow dùng React.

Đầu tiên phải đánh giá:
- quy mô;
- maintainability;
- coupling;
- migration cost;
- benefit.

Có thể:
- giữ frontend hiện tại;
- hoặc migrate frontend có kế hoạch.

Nhưng dù chọn cách nào:

Frontend
↓
Billing_One API
↓
Billing_One Backend
↓
PostgreSQL

Không được:

Frontend
↓
Mock Data

sau khi feature đã được productionized.

---

# 24. LEDGERFLOW CODE REUSE

Không được copy nguyên:
- mockData;
- React state;
- mock service;
- fake API;
- UI state;
- business logic frontend;

và coi đó là backend implementation.

Có thể reuse hoặc tham khảo:
- UI concept;
- component concept;
- domain concept;
- workflow;
- naming;
- business rules.

Mọi code được reuse phải được kiểm tra:
- license;
- dependency;
- compatibility;
- security;
- architecture.

---

# 25. SECURITY

Mọi feature mới phải kiểm tra:

- authentication;
- authorization;
- input validation;
- SQL injection;
- XSS;
- CSRF nếu phù hợp;
- rate limiting;
- secrets;
- logging sensitive data;
- password handling;
- session handling;
- tenant isolation nếu sau này có multi-tenant.

Không được đưa secret vào source code.

Không commit `.env`.

---

# 26. API DESIGN

API mới phải:
- nhất quán;
- versionable nếu cần;
- RESTful theo convention hiện tại;
- validation rõ ràng;
- status code phù hợp;
- error response thống nhất;
- authorization đầy đủ.

Không tạo endpoint chỉ để phục vụ một component frontend nếu có domain API hợp lý hơn.

---

# 27. TRANSACTION & CONCURRENCY

Đặc biệt với:

- payment;
- refund;
- invoice state transition;
- adjustment;
- allocation;
- credit limit;
- reconciliation.

Phải xem xét:
- transaction;
- row locking;
- unique constraints;
- idempotency;
- race conditions.

Không được dựa vào JavaScript frontend để ngăn duplicate transaction.

---

# 28. TESTING

Mỗi feature mới phải có test phù hợp.

Ít nhất xem xét:

### Unit Test
Business logic.

### Integration Test
API + database.

### Regression Test
Không làm hỏng feature cũ.

### Security Test
Authorization/validation.

### Concurrency Test
Với các nghiệp vụ tài chính nhạy cảm.

Không được đánh dấu DONE chỉ vì "API trả 200".

---

# 29. DOCUMENTATION

Mỗi feature quan trọng phải cập nhật:

- architecture;
- database;
- API;
- business rules;
- workflow;
- setup;
- testing.

Tạo hoặc cập nhật docs phù hợp.

---

# 30. CHANGE MANAGEMENT

Trước thay đổi lớn:

Phải ghi rõ:

### Why
Tại sao cần thay đổi?

### What
Thay đổi những gì?

### Impact
Ảnh hưởng module nào?

### DB Impact
Ảnh hưởng database thế nào?

### API Impact
Ảnh hưởng API nào?

### Risk
Rủi ro gì?

### Migration
Rollback/migration thế nào?

### Test
Kiểm thử thế nào?

---

# 31. DO NOT REWRITE WITHOUT JUSTIFICATION

Không được:
- xóa toàn bộ backend;
- thay database;
- thay framework;
- thay authentication;
- thay Docker architecture;
- thay Nginx;
- thay monitoring;
- thay logging;

chỉ vì LedgerFlow sử dụng cách khác.

Rewrite chỉ được xem xét khi có lý do kỹ thuật mạnh và có migration plan.

---

# 32. PRIORITY ORDER

Ưu tiên triển khai theo thứ tự:

## Phase 1
Billing Core stabilization

## Phase 2
Products / Services

## Phase 3
Payment Terms

## Phase 4
Credit Limit

## Phase 5
Payment Allocation

## Phase 6
Aging

## Phase 7
Revenue / Collection / DSO

## Phase 8
Credit Note / Adjustments / Refund

## Phase 9
Recurring Billing

## Phase 10
Bank Reconciliation

## Phase 11
RBAC

## Phase 12
Audit

## Phase 13
Tax Reporting

## Phase 14
Advanced Dashboard

## Phase 15
Customer Portal / Advanced Documents

## Phase 16
Further Automation / AI

Thứ tự thực tế có thể thay đổi sau GAP Analysis nhưng phải giải thích dependencies.

---

# 33. REQUIRED DELIVERABLE BEFORE IMPLEMENTATION

Trước khi code feature đầu tiên, phải tạo:

1. `docs/LEDGERFLOW_TO_BILLING_ONE_GAP_ANALYSIS.md`

2. `docs/BILLING_ONE_TARGET_ARCHITECTURE.md`

3. `docs/BILLING_ONE_DOMAIN_MODEL.md`

4. `docs/BILLING_ONE_DATABASE_EVOLUTION.md`

5. `docs/BILLING_ONE_FEATURE_ROADMAP.md`

Trong đó phải xác định:
- feature nào lấy từ LedgerFlow;
- feature nào giữ nguyên Billing_One;
- feature nào cần redesign;
- feature nào không tích hợp;
- dependency;
- thứ tự triển khai.

---

# 34. AGENT WORK MODE

Khi làm việc:

## Step 1
Inspect.

## Step 2
Understand.

## Step 3
Analyze.

## Step 4
Plan.

## Step 5
Implement.

## Step 6
Test.

## Step 7
Review.

## Step 8
Document.

Không được bỏ qua bước Inspect/Analyze/Plan đối với thay đổi lớn.

---

# 35. STOP CONDITIONS

Agent phải dừng và báo cáo trước khi tiếp tục nếu phát hiện:

- database corruption risk;
- breaking API change;
- authentication/security architecture change;
- destructive migration;
- cần rewrite toàn hệ thống;
- không thể giữ backward compatibility;
- nghiệp vụ LedgerFlow mâu thuẫn với business rules Billing_One;
- không đủ thông tin để xác định business rule.

Không được tự đoán những nghiệp vụ tài chính quan trọng.

---

# 36. FINAL ACCEPTANCE CRITERIA

Một feature được coi là hoàn thành khi:

[ ] Nghiệp vụ đã được phân tích.

[ ] Database đã được thiết kế phù hợp.

[ ] Migration đã được tạo.

[ ] Backend đã hoàn thành.

[ ] API đã hoàn thành.

[ ] Validation đã hoàn thành.

[ ] Authorization đã hoàn thành.

[ ] Transaction/concurrency đã được xem xét.

[ ] Audit đã được xem xét.

[ ] Frontend đã kết nối API thật.

[ ] Không còn mock data cho production flow.

[ ] Unit/integration/regression tests đã được thực hiện.

[ ] Documentation đã được cập nhật.

[ ] Không phá chức năng Billing_One hiện có.

---

# 37. CORE PRINCIPLE

Luôn ghi nhớ:

Billing_One = TARGET SYSTEM

LedgerFlow = REFERENCE SYSTEM

Mục tiêu:

KHÔNG PHẢI

Billing_One + LedgerFlow

Mà là:

BILLING_ONE
+
các nghiệp vụ và tính năng phù hợp được phân tích từ LedgerFlow
=
BILLING_ONE EXTENDED

Billing_One phải trở thành một hệ thống duy nhất, nhất quán, có backend thật, database thật, business logic thật, security thật và có khả năng mở rộng lâu dài.

---

# 38. GOLDEN RULE

Nếu phải lựa chọn giữa:

A. Copy LedgerFlow nhanh chóng

và

B. Thiết kế lại chức năng LedgerFlow theo kiến trúc Billing_One

LUÔN ƯU TIÊN:

B.

Chất lượng kiến trúc, tính toàn vẹn dữ liệu, bảo mật, khả năng mở rộng và tính đúng đắn của Billing_One quan trọng hơn việc hoàn thành nhanh.

END OF MASTER INSTRUCTIONS