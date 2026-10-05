# Evidence

Checkpoint evidence is added only after the corresponding runtime check passes. Files use the Design Freeze naming convention `RQ{n}-{nn}-{description}.png`.

| File | Verified result |
|---|---|
| `RQ2-07-pgadmin-runtime.png` | pgAdmin logged in; imported `Billing PostgreSQL` connected to database `billing` as `billing_readonly`; password was entered at runtime and not saved. |
| `RQ3-01-https-browser.png` | Real HTTPS Billing login page after HTTP navigation redirected to `https://localhost`. |
| `RQ3-02-runtime-verification.png` | Runtime summary of observed TLS/certificate/headers, browser/CSP/session checks, proxy/rate-limit/log checks, service ports/networks, and HTTPS CP2 regression. |

Never store `.env` files, passwords, session secrets, private keys, or database dumps in this directory.
