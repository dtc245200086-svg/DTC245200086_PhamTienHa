# Billing LogQL Queries

These queries are based on the observed web JSON (`msg`, `level`, `request_id`, `path`, `status`, `duration_ms`) and Nginx JSON (`ts`, `method`, `path`, `status`, `request_time`, `request_id`) Docker log lines. Validate every query against the running Loki datasource before marking it PASS.

| ID | Purpose | LogQL | Traffic to generate |
|---|---|---|---|
| Q1 | All web events | `{service="web"}` | Sign in or load a page |
| Q2 | Failed login event | `{service="web"} \| json \| msg="auth.login_failed"` | Submit an invalid password |
| Q3 | Nginx client/server errors | `{service="nginx"} \| json \| status >= 400` | Request a missing URL and submit an invalid login |
| Q4 | Invoice and payment business events | `{service="web"} \| json \| msg=~"invoice.created|payment.recorded"` | Create an invoice, issue it, and record a payment |
| Q5 | Nginx request counts by status | `sum by (status) (count_over_time({service="nginx"} \| json \| __error__="" [5m]))` | Run the load-test script |
| Q6 | Application error events (optional) | `{service="web"} \| json \| level="error"` | Run only if a safe application error is available; do not break the database to create one |

Q2, Q3, and Q4 are required CP5 evidence queries. Q6 is optional and must not be reported PASS unless it returns a real line.

## CP5 Runtime Verification — 2026-10-06

The queries below were executed against the Billing Loki datasource with real project logs. Q2 returned 7 lines, Q3 returned 41 lines, and Q4 returned 21 lines in the checked one-hour window. After restarting only Loki, Q4 still returned 21 lines from the named volume. Query result counts vary as logs arrive and are retained.

Q1, Q5, and Q6 are not included in the CP5 gate result. Do not describe them as PASS unless each is run and returns the expected result. Loki's current config disables automatic `service_name` discovery; some already-retained historical streams still have that label, while newly observed log streams use only `service`, `container`, and `stream`.