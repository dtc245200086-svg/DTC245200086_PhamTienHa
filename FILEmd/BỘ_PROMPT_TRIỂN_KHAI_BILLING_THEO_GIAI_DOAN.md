# BỘ PROMPT TRIỂN KHAI BILLING THEO GIAI ĐOẠN
## Chuẩn kiến trúc → triển khai → kiểm thử → checkpoint → commit → lịch sử thay đổi

**Project:** Hệ thống Quản lý Hóa đơn / Billing
**Mục đích:** dùng bộ prompt này với AI coding agent theo từng giai đoạn, không làm toàn bộ project trong một lần.

---

# 1. LUẬT SỬ DỤNG

Không dán toàn bộ prompt vào AI cùng lúc. Mỗi lần chỉ gửi **một prompt** theo đúng thứ tự.

```text
PROMPT 0 — WORK PROTOCOL
        ↓
PROMPT 1 — CP0 PREFLIGHT
        ↓
CP0 PASS
        ↓
PROMPT 2 — YC1a / REPOSITORY
        ↓
Commit 0a
        ↓
PROMPT 3 — YC2 / BASE APPLICATION
        ↓
CP2 PASS
        ↓
Commit 0b + tag base-app
        ↓
PROMPT 4 — YC3 / NGINX
        ↓
CP3 PASS
        ↓
Commit 1 + tag commit-1-nginx
        ↓
PROMPT 5 — YC4 / MONITORING
        ↓
CP4 PASS
        ↓
Commit 2 + tag commit-2-monitoring
        ↓
PROMPT 6 — YC5 / LOGGING
        ↓
CP5 PASS
        ↓
Commit 3 + tag commit-3-logging
        ↓
PROMPT 7 — YC6 / HARDENING
        ↓
CP6 PASS
        ↓
Commit 4 + tag hardening
        ↓
PROMPT 8 — YC1 FINAL
        ↓
CP-Final PASS
        ↓
Commit 5 + tag docs-final
        ↓
PROMPT 9 — YC7 / REPORT + DEMO
        ↓
Commit 6 + tag v1.0
```

**Cổng chặn:** PASS mới đi tiếp; FAIL phải sửa và chạy lại toàn bộ checkpoint; BLOCKED phải dừng.

---

# 2. NGUYÊN TẮC KIẾN TRÚC KHÔNG TỰ Ý ĐỔI

## Application

- Node.js 24
- Express + `pg`
- `express-session` + `connect-pg-simple`
- `bcryptjs`
- frontend plain HTML/CSS/JS SPA + hash routing
- PostgreSQL 16 + pgAdmin

## Auth

- server-side session, không JWT
- PostgreSQL session store
- bcrypt cost 12
- cookie `billing.sid`
- HttpOnly, SameSite=Strict, Path=/, 8h
- YC2: HTTP tạm + `SESSION_COOKIE_SECURE=false`
- từ Commit 1: HTTPS + `SESSION_COOKIE_SECURE=true`
- `trust proxy = 1`

## Business rules

- invoice: `INV-YYYY-NNNNNN`
- PostgreSQL sequence, unique, tăng dần, không reset theo năm, gaps được phép
- chỉ sinh invoice number khi issue
- chỉ DRAFT được sửa
- issue cần ≥1 item và total > 0
- tiền dùng PostgreSQL `NUMERIC`; Node không tính tiền bằng JS `Number`
- issue/payment dùng transaction
- payment dùng `SELECT ... FOR UPDATE`
- payment > 0 và ≤ outstanding
- tự chuyển PARTIALLY_PAID/PAID
- cancel chỉ admin, chỉ khi unpaid, reason bắt buộc
- không physical delete invoice
- customer có invoice không delete
- payments append-only; không UPDATE/DELETE
- staff không cancel invoice và không delete customer
- `due_date >= issue_date`

## DB roles

```text
postgres
billing_app
billing_readonly
exporter
```

## Networks

```text
edge_net
admin_net
app_net
 db_net
monitoring_net
```

PostgreSQL không ở `edge_net`/`admin_net`. Sau Commit 1 web không publish host port.

---

# 3. FILE LỊCH SỬ BẮT BUỘC

Từ YC1a phải có:

```text
docs/AI_EXECUTION_HISTORY.md
```

Mỗi prompt phải **append** một section mới, không xóa lịch sử cũ.

Mẫu bắt buộc:

```text
PHASE / PROMPT:
Ngày giờ:
Người thực hiện:
Checkpoint trước:
Checkpoint sau:

Mục tiêu:

Đã kiểm tra trước:
- git status
- git log
- docker compose ps
- docker compose config
- logs/state liên quan

Đã thực hiện:

File đã tạo:
File đã sửa:
File đã xóa:

Thay đổi quan trọng:
- ...

Test đã chạy:
- command/test
- kết quả

Regression:
- ...

Evidence:
- ...

Commit:
Tag:

NGOÀI ROADMAP:
- NONE / Có dùng

Nếu có dùng ngoài Roadmap:
1. Tên công cụ/thư viện/image/config:
2. Version:
3. Vì sao cần:
4. Requirement nào khiến cần:
5. Vì sao thiết kế hiện tại không đủ:
6. Phương án thay thế đã xem xét:
7. Ảnh hưởng kiến trúc:
8. Ảnh hưởng commit boundary:
9. File bị ảnh hưởng:
10. Test chứng minh:
11. Có cần phê duyệt không:
12. Trạng thái APPROVED/PENDING/REJECTED:

Kết luận: PASS / FAIL / BLOCKED
Checkpoint tiếp theo:
```

## Quy tắc dùng ngoài Roadmap

Không được tự ý thêm framework, database, auth model, network, reverse proxy, monitoring/logging stack hoặc business rule mới.

Chỉ xem xét deviation khi compatibility thực tế, bug thực tế, dependency bắt buộc hoặc security requirement làm thiết kế hiện tại không thể chạy đúng.

Khi phát hiện deviation:

```text
STOP
→ ghi deviation vào AI_EXECUTION_HISTORY.md
→ nêu reason + evidence + impact + alternatives
→ nếu ảnh hưởng kiến trúc/commit boundary thì chờ phê duyệt
→ chỉ tiếp tục sau khi được phép
```

Một dependency nhỏ vẫn phải được ghi lịch sử.

---

# 4. WORKFLOW CHUNG CHO MỌI PROMPT

```text
INSPECT
→ PLAN
→ IMPLEMENT
→ RUN
→ TEST
→ FIX
→ RETEST
→ VERIFY
→ EVIDENCE
→ GIT CHECK
→ COMMIT/TAG
→ REPORT
```

Không đoán healthcheck, binary, metric name, label, runtime user hay compatibility. Phải kiểm tra thực tế.

---

# 5. PROMPT 0 — WORK PROTOCOL

**Chạy một lần ở đầu project.**

```text
BẠN LÀ LEAD SOFTWARE ENGINEER + DEVOPS ENGINEER CỦA PROJECT BILLING.

MỤC TIÊU:
Triển khai đúng Design Freeze và roadmap hiện có.
Không tự ý đổi kiến trúc, công nghệ, network topology, business rule, auth model,
commit boundary hoặc thứ tự checkpoint.

SOURCE OF TRUTH:
Đọc toàn bộ Design Freeze hiện có trong workspace trước khi làm.
Đó là nguồn sự thật cao nhất.

WORKFLOW:
INSPECT → PLAN → IMPLEMENT → RUN → TEST → FIX → RETEST → VERIFY →
EVIDENCE → GIT CHECK → COMMIT/TAG → REPORT.

CHECKPOINT:
PASS → được chuyển tiếp.
FAIL → sửa → chạy lại toàn bộ checkpoint.
BLOCKED → dừng, không giả định PASS.

KHÔNG ĐOÁN:
image tool, healthcheck, runtime user, metric/label, pgAdmin behavior,
Promtail/Loki/Grafana/cAdvisor compatibility.

KHÔNG CHE LỖI:
Không xóa test, không bỏ requirement, không disable security để pass.

GIT:
Trước commit chạy git status, git diff, git diff --cached và secret scan.
Không commit .env, private key, DB dump hoặc secret thật.

LỊCH SỬ:
Mỗi prompt phải cập nhật docs/AI_EXECUTION_HISTORY.md, gồm file tạo/sửa/xóa,
test, evidence, commit/tag và có/không dùng ngoài Roadmap.

NGOÀI ROADMAP:
Không tự ý thêm công nghệ. Nếu bắt buộc phải dùng:
STOP → ghi deviation → phân tích impact → chờ phê duyệt nếu ảnh hưởng kiến trúc
hoặc commit boundary.

Không tự nhảy qua nhiều checkpoint.
Sau mỗi phase báo PASS/FAIL/BLOCKED, việc đã làm, test, file thay đổi,
commit/tag, vấn đề còn lại và checkpoint tiếp theo.
```

---

# 6. PROMPT 1 — CP0 PREFLIGHT

**Mục tiêu:** chỉ kiểm tra môi trường và compatibility. Không viết Billing app, không tạo compose thật, không dựng Billing stack.

```text
THỰC HIỆN CP0 — PREFLIGHT ONLY.

ĐỌC DESIGN FREEZE + MỤC CP0 TRƯỚC.

TUYỆT ĐỐI KHÔNG:
- tạo source code Billing
- tạo docker-compose.yml project
- dựng stack Billing
- tạo DB project
- triển khai YC2-YC5.

CHỈ dùng container/network/file probe tạm thời và phải cleanup.

KIỂM TRA:
1. docker version: phải có Server; ghi Client/Server.
2. docker compose version: xác nhận Compose v2.
3. Pull + inspect 12 upstream/base images; ghi tag, Config.User, HEALTHCHECK.
   node:24.21.0-alpine là base image cho web; web image là project-built ở YC2.
4. Inventory thực tế các tool cần dùng: sh/bash/wget/curl/nc/pg_isready/openssl...
   Không giả định image có tool.
5. Host port probe: 80, 443, 3000, 5050, 8000, 9090. Ghi port đang dùng.
   Không dùng Windows PostgreSQL localhost:5432 để đánh giá DB container.
6. openssl: tạo cert probe có SAN localhost và billing.local, verify rồi xóa.
7. Network probe: kiểm tra tạo/inspect internal network; chưa tạo network project.
8. cAdvisor: sample container; kiểm tra endpoint, container_memory_working_set_bytes và labels.
   Ghi rõ Docker Desktop Linux VM. Nếu không đáp ứng: BLOCKED, không giả vờ PASS.
9. Promtail + Loki probe: push log mẫu, query thấy log, cleanup.
10. Grafana probe: provisioning tối thiểu bằng file tạm, xác minh load.
11. pgAdmin probe: servers.json không có password thật; kiểm tra auto-registration + credential runtime.
12. Ghi bảng CP0: item, command, result, actual version/tag, status, evidence, note.

Nếu bất kỳ prerequisite bắt buộc không đạt: FAIL hoặc BLOCKED.
Không được làm YC1a/YC2 khi CP0 chưa PASS.

LỊCH SỬ:
Cập nhật docs/AI_EXECUTION_HISTORY.md với toàn bộ probe, version/tag/tool đã xác minh,
compatibility issue và deviation nếu có.
Nếu phải đổi tag/tool: ghi old/new/reason/evidence/impact/approval status; không đổi âm thầm.
```

### Sau Prompt 1

Chỉ đi tiếp khi:

```text
CP0 = PASS
```

---

# 7. PROMPT 2 — YC1a / REPOSITORY FOUNDATION

```text
THỰC HIỆN YC1a — REPOSITORY FOUNDATION.

ĐIỀU KIỆN: CP0 PASS.

TẠO:
- cây thư mục chuẩn
- README skeleton
- .gitignore
- .env.example
- docs/
- evidence structure
- docs/AI_EXECUTION_HISTORY.md

BẮT BUỘC:
- .env bị ignore
- nginx/certs/ bị ignore
- không secret thật
- không private key
- không DB dump.

TEST:
- git status
- git diff
- git check-ignore
- secret scan
- clone test sang thư mục tạm.

LỊCH SỬ:
Ghi section YC1a vào docs/AI_EXECUTION_HISTORY.md.
Nêu file tạo/sửa, test, evidence và xác nhận ngoài Roadmap = NONE nếu đúng.

CHỈ KHI PASS:
commit:
chore: init repository structure, README skeleton and .gitignore

push main và kiểm tra git log + git status.
```

### Mốc Git

```text
Commit 0a
chore: init repository structure, README skeleton and .gitignore
```

---

# 8. PROMPT 3 — YC2 / BASE BILLING APPLICATION

**Mục tiêu:** Web + PostgreSQL + pgAdmin hoạt động ổn định.

**Không có:** Nginx, Prometheus, Grafana, Loki, Promtail, `/metrics`, `stub_status`.

```text
THỰC HIỆN YC2 — BASE BILLING APPLICATION.

ĐIỀU KIỆN:
- CP0 PASS
- YC1a PASS
- Commit 0a tồn tại
- working tree sạch.

MỤC TIÊU:
Web + PostgreSQL + pgAdmin.

NETWORK:
- db_net
- admin_net

YC2:
- web publish 127.0.0.1:8000
- SESSION_COOKIE_SECURE=false
- HTTP
- chưa có Nginx/monitoring/logging stack
- chưa có /metrics.

AUTH:
- express-session + connect-pg-simple
- PostgreSQL session store
- bcryptjs cost 12
- cookie billing.sid
- HttpOnly, SameSite=Strict, Path=/, 8h.

DB ROLES:
postgres, billing_app, billing_readonly, exporter.

BUSINESS RULES:
- chỉ DRAFT được sửa
- issue cần >=1 item và total >0
- invoice_no INV-YYYY-NNNNNN, PostgreSQL sequence, không reset theo năm, gaps được phép
- chỉ sinh số khi issue
- money NUMERIC; không tính tiền bằng JS Number
- issue/payment transaction
- payment SELECT FOR UPDATE
- payment >0 và <= outstanding
- auto PARTIALLY_PAID/PAID
- cancel admin-only, unpaid-only, reason bắt buộc
- không physical delete invoice
- customer có invoice không delete
- payments append-only
- staff không cancel invoice / delete customer
- due_date >= issue_date.

APP:
- login/logout
- auth state
- dashboard
- customer CRUD
- invoice CRUD
- issue
- payment
- validation/error handling
- hash routing.

HEALTH:
/health phải phản ánh DB readiness thực tế.

LOG:
JSON; không password/cookie/secret.

DOCKER:
Dockerfile web non-root theo kết quả CP0; postgres; pgadmin; compose core.

PGADMIN:
servers.json không có password thật; credential runtime theo compatibility đã xác minh.

TEST E2E:
1 login
2 /api/auth/me
3 logout
4 customer CRUD
5 create DRAFT
6 item
7 issue
8 invoice_no
9 partial payment
10 PARTIALLY_PAID
11 full payment
12 PAID
13 edit ISSUED bị chặn
14 issue không item bị chặn
15 payment over outstanding bị chặn
16 staff cancel = 403
17 delete customer có invoice bị chặn
18 down/up
19 dữ liệu còn
20 pgAdmin thấy dữ liệu
21 /health
22 JSON log hợp lệ
23 không publish 5432.

CP2 KHÔNG nghiệm thu CSP/HTTPS/Prometheus/Grafana/Loki/Promtail/metrics.

LỊCH SỬ:
Ghi YC2: schema, roles, API, frontend, compose, test, regression, evidence, commit candidate,
ngoài Roadmap và deviation nếu có.

TRƯỚC COMMIT:
- docker compose config
- docker compose ps
- git diff --stat
- git diff --cached --stat
- secret scan
- xác nhận không có nội dung phase sau.

CHỈ KHI CP2 PASS:
commit:
feat(app): billing web app with PostgreSQL and pgAdmin via docker-compose

tag:
base-app
```

---

# 9. PROMPT 4 — YC3 / NGINX + HTTPS → COMMIT 1

```text
THỰC HIỆN YC3 — NGINX / HTTPS / SECURITY.

ĐIỀU KIỆN:
- CP2 PASS
- tag base-app tồn tại
- working tree sạch.

ĐƯỢC THÊM:
nginx, edge_net, app_net, reverse proxy, TLS, security headers, CSP,
rate limit, JSON access log, request id, gen-cert, nginx-health,
chặn /metrics và /health.

TLS:
- HTTP 80 -> 301 HTTPS
- TLS 1.2/1.3
- SAN localhost + billing.local
- server_tokens off
- proxy / -> web:3000
- X-Forwarded headers.

RATE LIMIT:
login 5r/m, burst 5, vượt giới hạn => 429.

AUTH:
SESSION_COOKIE_SECURE=true
trust proxy=1
X-Forwarded-Proto=https.

NETWORK:
- bỏ 127.0.0.1:8000 của web
- web không admin_net
- nginx không db_net
- PostgreSQL không edge_net.

EXTERNAL:
- /metrics => 404
- /health => 404

COMMIT 1 KHÔNG CÓ:
Prometheus, Grafana, cAdvisor, node-exporter, nginx-exporter,
postgres-exporter, prom-client, app /metrics, stub_status, Loki, Promtail.

CSP:
- không inline JS
- không inline style
- không inline handler
- không CDN
- không Google Fonts.

TEST:
https://localhost; HTTP -> 301; login/session/logout; cert SAN; 6 headers;
Server không lộ version; CSP console sạch; rate limit 429; :8000 không truy cập;
/metrics 404; /health 404; nginx -t; compose ps; network membership;
regression E2E invoice/payment.

LỊCH SỬ:
Ghi toàn bộ thay đổi nginx/cert/network, test, regression, evidence và deviation.

COMMIT BOUNDARY:
git diff --stat chỉ gồm YC3.

CHỈ KHI CP3 PASS:
commit:
feat(nginx): reverse proxy with self-signed HTTPS and security headers

tag:
commit-1-nginx
```

---

# 10. PROMPT 5 — YC4 / MONITORING → COMMIT 2

```text
THỰC HIỆN YC4 — MONITORING.

ĐIỀU KIỆN:
- Commit 1 PASS
- tag commit-1-nginx tồn tại
- working tree sạch.

THÊM:
- prom-client
- app /metrics
- Nginx stub_status
- nginx-exporter
- postgres-exporter
- node-exporter
- cAdvisor
- Prometheus
- Grafana
- monitoring_net
- provisioning
- dashboard
- load-test.

TRƯỚC PROMQL:
Đọc /metrics THỰC TẾ của app/exporter/cAdvisor.
Ghi metric name + label + endpoint. Không đoán.

TARGETS BẮT BUỘC UP:
prometheus, cadvisor, nginx, web, postgres.
node-exporter phụ.

DASHBOARD:
3 row: Container / Web / Database.
Không chấp nhận No Data.

LOAD TEST:
Tạo traffic thật và chứng minh số liệu thay đổi.

PERSISTENCE:
down -> up; datasource/dashboard/config provisioning vẫn tồn tại.
Grafana không dùng admin/admin.

DOCKER DESKTOP:
Ghi giới hạn cAdvisor/node-exporter. Nếu cAdvisor không đáp ứng thì chuyển WSL2/Linux
theo thiết kế và xác minh lại, không giả vờ PASS.

REGRESSION:
app, DB, pgAdmin, HTTPS, login/session, network.

KHÔNG THÊM:
Loki, Promtail, LogQL.

LỊCH SỬ:
Ghi metrics thực tế, labels, dashboard, targets, load test, limitation, files, evidence,
regression và deviation nếu có.

CHỈ KHI CP4 PASS:
commit:
feat(monitoring): Prometheus and Grafana for container, web and database

tag:
commit-2-monitoring
```

---

# 11. PROMPT 6 — YC5 / LOGGING → COMMIT 3

```text
THỰC HIỆN YC5 — CENTRALIZED LOGGING.

ĐIỀU KIỆN:
- Commit 2 PASS
- tag commit-2-monitoring tồn tại.

THÊM:
- Loki
- Promtail
- Loki datasource
- log panel
- LogQL documentation.

PROMTAIL:
Dùng version đã được compatibility verify; không tự ý đổi.

LABEL:
service, container, stream.
Không biến mọi log field thành Loki labels.

FLOW:
Docker logs -> Promtail -> Loki -> Grafana.

VERIFY:
Loki /ready, Promtail targets, labels, log thật.

LOGQL:
Q1-Q6; bắt buộc >=3 query có kết quả thật.
Ưu tiên Q2 auth.login_failed, Q3 Nginx 4xx/5xx, Q4 invoice/payment events.

Tạo docs/logql-queries.md.
Mỗi query ghi mục đích, query, cách tạo log test và kết quả.

KHÔNG LOG:
password, cookie, secret.

REGRESSION:
YC2 + YC3 + YC4.

KHÔNG xóa query chỉ vì fail, không giả lập kết quả, không ghi tested khi chưa chạy.

LỊCH SỬ:
Ghi Loki/Promtail/datasource/LogQL/labels/test/regression/evidence/deviation.

CHỈ KHI CP5 PASS:
commit:
feat(logging): centralized logging with Loki, Promtail and LogQL queries

tag:
commit-3-logging
```

---

# 12. PROMPT 7 — YC6 / HARDENING → COMMIT 4

```text
THỰC HIỆN YC6 — HARDENING.

ĐIỀU KIỆN:
- Commit 3 PASS
- hệ thống chạy ổn định.

MỤC TIÊU:
H1-H6 bắt buộc. H7-H13 chỉ áp dụng khi test được.

H1:
Non-root runtime theo thiết kế và ngoại lệ đã chấp nhận.

H2:
Kiểm tra docker network inspect, membership, internal flags, port mapping,
docker ps / docker compose ps.
Phải chứng minh:
- postgres chỉ db_net
- nginx không db_net
- web không publish sau Commit 1
- web đúng network membership theo architecture
- admin tools đúng admin_net.
Không kết luận egress chỉ bằng internal=true.

H3:
strong passwords, no secret in Git, .env ignored, runtime credential.

H4:
DB least privilege. Kiểm tra bằng psql bên trong PostgreSQL container hoặc client thuộc db_net.
Không dùng PostgreSQL localhost Windows.

Phải chứng minh:
billing_app: không DDL, không UPDATE/DELETE payments.
billing_readonly: chỉ SELECT.
exporter: chỉ quyền monitoring cần thiết.

Tạo verify-hardening.
Script phải FAIL nếu thao tác trái phép thành công.

H5:
TLS + security headers.

H6:
không publish internal ports.

H7-H13:
áp dụng từng biện pháp một -> restart -> readiness -> smoke test -> regression.
Không harden hàng loạt rồi mới debug.

CUỐI:
E2E web, pgAdmin, Prometheus targets, Grafana, Loki, LogQL.
Tạo evidence H1-H6.

LỊCH SỬ:
Ghi từng hardening, service ảnh hưởng, test, ngoại lệ, files, evidence, regression, deviation.

CHỈ KHI CP6 PASS:
commit:
security: harden containers, networks, credentials and database roles

tag:
hardening
```

---

# 13. PROMPT 8 — YC1 FINAL / README + CLEAN CLONE

```text
THỰC HIỆN YC1 FINAL.

ĐIỀU KIỆN:
- hardening PASS
- hệ thống ổn định.

HOÀN THIỆN:
- README đủ 16 mục theo Design Freeze
- startup/shutdown
- environment
- auth
- cookie theo phase
- DB
- pgAdmin credential runtime
- Nginx/HTTPS
- monitoring
- logging
- hardening
- H4 verification
- troubleshooting
- image versions
- commit/tag mapping
- evidence index.

SƠ ĐỒ:
architecture, networks, request flow, metrics flow, log flow.

BẢNG:
tag | commit hash | YC | nội dung.

PHẢI CÓ:
base-app, commit-1-nginx, commit-2-monitoring, commit-3-logging, hardening.

CLEAN CLONE:
1. thư mục mới hoàn toàn
2. git clone
3. làm đúng README
4. tạo .env từ .env.example
5. docker compose up -d
6. readiness
7. web
8. login
9. DB
10. pgAdmin
11. Prometheus
12. Grafana
13. Loki
14. regression.

Không dựa vào volume cũ hoặc file ngoài Git.

LỊCH SỬ:
Ghi clean-clone path, command, kết quả, lỗi, README sửa, regression.

CHỈ KHI CP-Final PASS:
commit:
docs: complete README, architecture diagrams and evidence index

tag:
docs-final
```

---

# 14. PROMPT 9 — YC7 / REPORT + DEMO → V1.0

```text
THỰC HIỆN YC7 — FINAL DELIVERY.

ĐIỀU KIỆN:
- hardening PASS
- docs-final PASS
- clean clone PASS.

BÁO CÁO:
- bìa
- mục tiêu
- tổng quan
- phân tích
- thiết kế
- kiến trúc
- triển khai
- kiểm thử
- monitoring
- logging
- hardening
- hạn chế
- kết luận
- tài liệu tham khảo
- phụ lục.

TỐI THIỂU >=10 trang nội dung, không tính bìa/mục lục.
Mỗi bước: mục tiêu -> cấu hình -> thực hiện -> kết quả -> evidence.

DEMO <=10 phút:
1 GitHub + tags
2 docker compose ps
3 web
4 tạo invoice
5 issue
6 payment
7 pgAdmin
8 load test
9 Grafana
10 LogQL
11 verify-hardening.

FINAL VERIFY:
git status
git log --oneline --decorate
docker compose config
docker compose ps
port mapping
network membership
E2E
Prometheus targets
Grafana
Loki
LogQL
hardening
secret scan
tag verification.

LỊCH SỬ:
Cập nhật docs/AI_EXECUTION_HISTORY.md với report/demo/evidence/final tests/tags/deviation.

Không tự tuyên bố 10/10; chỉ đối chiếu requirement + evidence + trạng thái thật.

CHỈ KHI CP7 PASS:
commit:
docs(report): add final report and demo script

tag:
v1.0
```

---

# 15. PROMPT 10 — DEBUG MODE KHI CÓ LỖI

Dùng prompt này khi bất kỳ phase nào lỗi thay vì để AI tự sửa lung tung.

```text
DEBUG MODE — KHÔNG ĐỔI KIẾN TRÚC.

TÔI ĐANG BỊ LỖI Ở PHASE/CHECKPOINT HIỆN TẠI.

BƯỚC 1 — STATE
Chạy:
- git status
- git log --oneline --decorate -n 10
- docker compose ps
- docker compose config

BƯỚC 2 — LOG
Lấy log thực tế của service lỗi.

BƯỚC 3 — ROOT CAUSE
Ghi:
- symptom
- root cause hypothesis dựa trên evidence
- affected service
- network
- config
- dependency
- commit boundary.

Không sửa trước khi có bằng chứng đủ để khoanh vùng.

BƯỚC 4 — PATCH
Đề xuất patch nhỏ nhất.
Kiểm tra patch có vượt Roadmap/commit boundary không.

BƯỚC 5 — APPLY
Áp dụng patch.

BƯỚC 6 — VERIFY
- restart đúng service
- readiness
- smoke test
- checkpoint test
- regression.

BƯỚC 7 — OUTSIDE ROADMAP
Nếu cần công nghệ mới:
STOP.
Ghi tool/lib/image + version + reason + requirement + alternatives + impact + approval status
vào docs/AI_EXECUTION_HISTORY.md.

BƯỚC 8 — RESULT
Trả:
ROOT CAUSE
FIX
FILES CHANGED
TESTS RUN
CHECKPOINT RESULT
REGRESSION RESULT
OUTSIDE ROADMAP
COMMIT IMPACT

KHÔNG:
- xóa test
- disable security
- đổi API tùy tiện
- đổi DB/framework/network/auth/business rule
- tự đổi image version không có evidence.
```

---

# 16. CHECKLIST SAU MỖI PROMPT

```text
[ ] Prompt hiện tại đã hoàn thành
[ ] Checkpoint hiện tại PASS
[ ] Không còn FAIL chưa xử lý
[ ] Regression PASS
[ ] Evidence đã ghi
[ ] AI_EXECUTION_HISTORY.md đã cập nhật
[ ] git status phù hợp
[ ] Không có secret
[ ] Đúng commit boundary
[ ] Commit đúng message
[ ] Tag đã tạo nếu phase yêu cầu
```

---

# 17. GIT PLAN

| Mốc | Message | Tag |
|---|---|---|
| 0a | `chore: init repository structure, README skeleton and .gitignore` | — |
| 0b | `feat(app): billing web app with PostgreSQL and pgAdmin via docker-compose` | `base-app` |
| 1 | `feat(nginx): reverse proxy with self-signed HTTPS and security headers` | `commit-1-nginx` |
| 2 | `feat(monitoring): Prometheus and Grafana for container, web and database` | `commit-2-monitoring` |
| 3 | `feat(logging): centralized logging with Loki, Promtail and LogQL queries` | `commit-3-logging` |
| 4 | `security: harden containers, networks, credentials and database roles` | `hardening` |
| 5 | `docs: complete README, architecture diagrams and evidence index` | `docs-final` |
| 6 | `docs(report): add final report and demo script` | `v1.0` |

**Quy tắc:** chỉ commit sau checkpoint; `git diff --cached --stat` phải đúng phase; không `.env`, private key, DB dump; không rebase/force-push sau khi đã tạo evidence lịch sử.

---

# 18. KIỂM SOÁT COMMIT BOUNDARY

## Commit 1 không được có

```text
Prometheus
Grafana
cAdvisor
node-exporter
nginx-exporter
postgres-exporter
prom-client
app /metrics
stub_status
Loki
Promtail
```

## Commit 2 không được có

```text
Loki
Promtail
LogQL
```

## Commit 3 không tự sửa business logic

Chỉ thêm logging stack và tài liệu/query cần thiết; regression phải chứng minh YC2-YC4 không hỏng.

---

# 19. EVIDENCE

Tên evidence:

```text
docs/evidence/RQ{n}-{nn}-{description}.png
```

Một evidence tốt nên cho thấy URL hoặc command + kết quả + thời điểm khi phù hợp. Không chụp ảnh chỉ để đủ số lượng; ưu tiên bằng chứng trực tiếp cho requirement.

---

# 20. KHI MUỐN SỬA DESIGN FREEZE

Không sửa roadmap chỉ vì implementation khó.

```text
Phát hiện vấn đề
↓
Evidence
↓
Root cause
↓
So sánh Design Freeze
↓
Xác định incompatibility thật sự
↓
Đề xuất phương án
↓
Ghi deviation
↓
Phê duyệt nếu ảnh hưởng kiến trúc/commit
↓
Mới sửa Design Freeze + prompt/checkpoint liên quan
```

---

# 21. GIỮ HỆ THỐNG ỔN ĐỊNH KHI DEBUG

Mỗi thay đổi service:

```text
change
↓
config validation
↓
restart service
↓
readiness
↓
smoke test
↓
regression test
```

Không tự ý `docker compose down -v` trong debug vì có thể xóa volume/dữ liệu. Chỉ reset volume khi đó là mục tiêu test rõ ràng và đã kiểm soát tác động.

---

# 22. MẪU BÁO CÁO CUỐI PHASE

```text
PHASE:
CHECKPOINT:
STATUS: PASS / FAIL / BLOCKED

OBJECTIVE:
...

IMPLEMENTED:
...

FILES CREATED:
...

FILES MODIFIED:
...

FILES DELETED:
...

TESTS:
...

REGRESSION:
...

EVIDENCE:
...

OUTSIDE ROADMAP:
NONE
hoặc
DEVIATION: ...

COMMIT:
...

TAG:
...

NEXT CHECKPOINT:
...

BLOCKERS:
...
```

---

# 23. ĐIỀU KIỆN HOÀN TẤT PROJECT

```text
[ ] CP0 PASS
[ ] CP1a PASS
[ ] CP2 PASS
[ ] CP3 PASS
[ ] commit-1-nginx
[ ] CP4 PASS
[ ] commit-2-monitoring
[ ] CP5 PASS
[ ] commit-3-logging
[ ] CP6 PASS
[ ] hardening
[ ] CP-Final PASS
[ ] docs-final
[ ] CP7 PASS
[ ] v1.0
[ ] clean clone PASS
[ ] E2E PASS
[ ] monitoring PASS
[ ] logging PASS
[ ] hardening PASS
[ ] secret scan PASS
[ ] AI_EXECUTION_HISTORY.md đầy đủ
```

---

# 24. QUY TẮC CỐT LÕI

```text
KHÔNG LÀM NHANH HƠN ROADMAP.
LÀM ĐÚNG PHASE.
PASS CHECKPOINT.
ĐÚNG COMMIT BOUNDARY.
GHI LỊCH SỬ.
GHI DEVIATION.
TEST THỰC TẾ.
RỒI MỚI ĐI TIẾP.
```

**Nguồn thiết kế:** bản Design Freeze hiện tại của project Billing. Tài liệu prompt này không thay thế Design Freeze; nó là runbook để thực thi Design Freeze một cách tuần tự và có kiểm soát.
