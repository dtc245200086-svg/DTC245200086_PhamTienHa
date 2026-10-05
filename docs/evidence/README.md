# Evidence

Checkpoint evidence is added only after the corresponding runtime check passes. Files use the Design Freeze naming convention `RQ{n}-{nn}-{description}.png`.

| File | Verified result |
|---|---|
| `RQ2-07-pgadmin-runtime.png` | pgAdmin logged in; imported `Billing PostgreSQL` connected to database `billing` as `billing_readonly`; password was entered at runtime and not saved. |
| `RQ3-01-https-browser.png` | Real HTTPS Billing login page after HTTP navigation redirected to `https://localhost`. |
| `RQ3-02-runtime-verification.png` | Runtime summary of observed TLS/certificate/headers, browser/CSP/session checks, proxy/rate-limit/log checks, service ports/networks, and HTTPS CP2 regression. |
| `RQ4-01-prometheus-targets.png` | Prometheus Targets UI showing the YC4 scrape jobs after CP4 target checks passed. |
| `RQ4-07-prometheus-business-metric.png` | Prometheus query result for the real invoice business counter. |

### YC4 Evidence ID Map

| ID | Evidence | Status |
|---|---|---|
| RQ4-01 | Prometheus Targets | Captured: `RQ4-01-prometheus-targets.png` |
| RQ4-02 | Grafana Container row | Not captured; required for final report |
| RQ4-03 | Grafana Web row | Not captured; required for final report |
| RQ4-04 | Grafana Database row | Not captured; required for final report |
| RQ4-05 | Prometheus datasource/provisioning | Runtime API verified; screenshot optional and not captured |
| RQ4-06 | Before/after load-test data | Runtime queries verified; screenshot optional and not captured |
| RQ4-07 | Prometheus application/business metric query | Captured: `RQ4-07-prometheus-business-metric.png` |

IDs RQ4-01 through RQ4-06 follow the Design Freeze. The application-metric screenshot uses the next unused ID, RQ4-07, and does not substitute for any Grafana row screenshot.

Never store `.env` files, passwords, session secrets, private keys, or database dumps in this directory.
