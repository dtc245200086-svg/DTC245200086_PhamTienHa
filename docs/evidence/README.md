# Evidence

Checkpoint evidence is added only after the corresponding runtime check passes. Files use the Design Freeze naming convention `RQ{n}-{nn}-{description}.png`.

| File | Verified result |
|---|---|
| `RQ2-07-pgadmin-runtime.png` | pgAdmin logged in; imported `Billing PostgreSQL` connected to database `billing` as `billing_readonly`; password was entered at runtime and not saved. |
| `RQ3-01-https-browser.png` | Real HTTPS Billing login page after HTTP navigation redirected to `https://localhost`. |
| `RQ3-02-runtime-verification.png` | Runtime summary of observed TLS/certificate/headers, browser/CSP/session checks, proxy/rate-limit/log checks, service ports/networks, and HTTPS CP2 regression. |
| `RQ4-01-prometheus-targets.png` | Prometheus Targets UI showing the YC4 scrape jobs after CP4 target checks passed. |
| `RQ4-07-prometheus-business-metric.png` | Prometheus query result for the real invoice business counter. |
| `RQ5-01-loki-ready.png` | Loki `/ready` response and Loki/Promtail Compose status from the Billing runtime. |
| `RQ5-02-loki-label-browser.png` | Loaded Grafana Loki label browser showing Billing containers, services and streams; retained historical `service_name` is noted in the Design Freeze. |
| `RQ5-03-login-failed.png` | Q2 LogQL result containing real `auth.login_failed` web events. |
| `RQ5-04-nginx-errors.png` | Q3 LogQL result containing real Nginx 4xx/5xx access events. |
| `RQ5-05-invoice-payment-events.png` | Q4 LogQL result containing real invoice and payment events. |
| `RQ5-06-dashboard-log-panel.png` | Optional Billing Monitoring dashboard log panel backed by Loki. |
| `RQ6-01-non-root-execution.png` | H1 non-root container runtime verification across all services and documented exceptions. |
| `RQ6-02-network-isolation.png` | H2 network isolation verification of 5 networks, internal flags, and membership. |
| `RQ6-03-credentials-and-git.png` | H3 secret exclusion from Git (.env untracked) and rejection of default credentials. |
| `RQ6-04-db-least-privilege.png` | H4 PostgreSQL least privilege enforcement (billing_app no DDL/append-only, billing_readonly SELECT-only, exporter in pg_monitor). |
| `RQ6-05-port-exposure.png` | H6 port exposure audit proving internal database, web, and collector ports are unexposed. |
| `RQ6-06-verify-hardening.png` | Automated hardening test suite (verify-hardening) execution report with all PASS results. |

### YC4 Evidence ID Map

| ID | Evidence | Status |
|---|---|---|
| RQ4-01 | Prometheus Targets | Captured: `RQ4-01-prometheus-targets.png` |
| RQ4-02 | Grafana Container row | **MISSING**; required for final report |
| RQ4-03 | Grafana Web row | **MISSING**; required for final report |
| RQ4-04 | Grafana Database row | **MISSING**; required for final report |
| RQ4-05 | Prometheus datasource/provisioning | Runtime API verified; screenshot optional and not captured |
| RQ4-06 | Before/after load-test data | Runtime queries verified; screenshot optional and not captured |
| RQ4-07 | Prometheus application/business metric query | Captured: `RQ4-07-prometheus-business-metric.png` |

IDs RQ4-01 through RQ4-06 follow the Design Freeze. The application-metric screenshot uses the next unused ID, RQ4-07, and does not substitute for any Grafana row screenshot.

### YC5 Evidence ID Map

| ID | Evidence | Status |
|---|---|---|
| RQ5-01 | Loki ready and Loki/Promtail status | Captured |
| RQ5-02 | Loki label browser | Captured after labels loaded; legacy `service_name` is disclosed |
| RQ5-03 | Q2 failed login | Captured with real events |
| RQ5-04 | Q3 Nginx errors | Captured with real access logs |
| RQ5-05 | Q4 invoice/payment events | Captured with real application logs |
| RQ5-06 | Dashboard log panel | Optional; captured |

CP5 required evidence RQ5-01 through RQ5-05 is present. RQ5-02 was replaced with the completed runtime label-browser view; no duplicate screenshot was added.

### YC6 Evidence ID Map

| ID | Evidence | Status |
|---|---|---|
| RQ6-01 | H1 non-root container execution | Captured: `RQ6-01-non-root-execution.png` |
| RQ6-02 | H2 network isolation and membership | Captured: `RQ6-02-network-isolation.png` |
| RQ6-03 | H3 credentials and Git secret exclusion | Captured: `RQ6-03-credentials-and-git.png` |
| RQ6-04 | H4 PostgreSQL least privilege | Captured: `RQ6-04-db-least-privilege.png` |
| RQ6-05 | H6 host port exposure matrix | Captured: `RQ6-05-port-exposure.png` |
| RQ6-06 | Automated verify-hardening test suite | Captured: `RQ6-06-verify-hardening.png` |

CP6 required evidence RQ6-01 through RQ6-05 is present; RQ6-06 provides automated verification report.

Never store `.env` files, passwords, session secrets, private keys, or database dumps in this directory.
