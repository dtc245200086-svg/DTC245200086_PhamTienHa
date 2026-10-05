# AI Execution History

## 2026-10-05 — CP0 Preflight

- **Status:** BLOCKED. CP0 did not pass; no implementation checkpoint was started.
- **Source of truth:** `FILEmd/billing_deployment_roadmap_2.md` (DESIGN FREEZE — READY FOR CP0).
- **Files changed:**
  - Updated `FILEmd/billing_deployment_roadmap_2.md` with observed CP0 status/evidence.
  - Created `docs/AI_EXECUTION_HISTORY.md`.
- **Checks performed:**
  - `docker version`: client 29.7.2, context `desktop-linux`; server unavailable because the Docker Desktop Linux engine named pipe was not found.
  - `docker compose version`: v5.4.0 reported; runtime compatibility remains unverified because the daemon is unavailable.
  - OpenSSL: 3.5.7 ran from `C:\Program Files\Git\usr\bin\openssl.exe`.
  - Host listeners: 80, 443, 3000, 5050, 8000, 9090 had no listener at check time. Port 5432 was held by a local `postgres` process (PID 8432); this is not evidence about a Compose database.
- **Not performed:** image pulls, image `Config.User` inspection, healthcheck/binary inventory inside images, certificate generation probe, temporary Docker network/bind probes, cAdvisor probe, Promtail-to-Loki push, Grafana provisioning probe, or pgAdmin auto-registration probe. These require a running Docker daemon.
- **Source/code/Compose changes:** none. No container, project network, or project-built image was created.
- **Tests/evidence:** the host checks above are recorded; there is no runtime evidence for the blocked checks.
- **Git:** workspace has no `.git` metadata, so status/diff/secret-scan/commit/tag were not available or performed. No commit or tag was created.
- **Outside roadmap:** no technologies or services were added. The history file is the requested execution record only.
- **Remaining blocker:** start Docker Desktop and confirm `docker version` reports a server. Then resume CP0 from the unchecked prerequisites; do not start YC1a/YC2 until CP0 passes.
- **Next checkpoint:** CP0 (resume; current state BLOCKED).

## 2026-10-05 — CP0 Resume, Compatibility Probes, PASS

- **Status:** CP0 PASS for the pre-flight prerequisites and compatibility probes. YC1a/CP1a has not started.
- **Source of truth:** reread the complete `FILEmd/billing_deployment_roadmap_2.md` before resuming this prompt.
- **Files changed:**
  - Updated `FILEmd/billing_deployment_roadmap_2.md` with measured CP0 evidence, image digests, Config.User/tool inventory, CP0 PASS state, and deferred CP2–CP5 checks.
  - Updated `docs/AI_EXECUTION_HISTORY.md`.
- **Docker/Compose:** Docker Desktop 4.88.1 and Engine/client 29.7.2; Linux/amd64 server responds. Compose CLI v5.4.0 is an official `docker/compose` release; `docker compose ls` and help work. The command/plugin interface is `docker compose`; no legacy standalone binary was used. Existing projects were only inspected.
- **Images:** all 12 upstream/base images in section 0.5 pulled successfully. Exact digests, Config.User, shell probe UID, declared HEALTHCHECK, and observed candidate binaries are recorded in sections 0.5, 3.10, and 5. No project-built web image was built.
- **OpenSSL:** OpenSSL 3.5.7 generated a short-lived certificate with SAN `localhost` and `billing.local`; validity inspection passed and the key/certificate files were removed.
- **Network/ports:** scratch probes confirmed the five expected `internal` flags; loopback publish on a non-internal admin network returned HTTP 200, while a port publish from the scratch internal app network produced no host mapping/reachability. Scratch resources were removed. Required host ports 80/443/3000/5050/8000/9090 had no listener at final check. Existing external Compose projects `billing-phase2-test` and `invoice-billing-system` were left untouched; they publish 5432/5433/6380.
- **cAdvisor:** v0.60.6 sample probe returned HTTP 200, a labeled `container_memory_working_set_bytes` series, and declared health status `healthy`. This is Docker Desktop Linux VM data, not Windows host data. Probe containers were removed.
- **Promtail/Loki:** Promtail 3.6.11 successfully pushed a sample JSON line into Loki 3.7.8; Loki query returned that line and labels. The default-config `/ready` probe returned HTTP 503 during the short probe; this is not represented as ready and project readiness remains CP5. Probe containers, network, and temp config were removed.
- **Grafana:** Grafana 13.2.3 returned API health `database=ok`; the datasource provisioned from a temporary file appeared through the API. Temporary container/config removed.
- **pgAdmin:** inspected the pinned entrypoint and confirmed `PGADMIN_SERVER_JSON_FILE`; a no-password `servers.json` fixture imported one server row into the internal SQLite database. The probe did not connect to the Billing DB. `/misc/ping` did not respond during the short probe; no custom healthcheck is enabled from that observation, and UI/readiness/real DB integration remain CP2. Temporary container/config removed.
- **Probe corrections:** diagnostic Loki flag and first Promtail config argument were invalid; corrected to use the pinned Loki default config and mount the Promtail fixture at its image-default config path. Final push/query passed. Grafana was checked again after startup. The first pgAdmin fixture email used a reserved `.test` domain and was rejected; a valid probe-only email succeeded. These harness corrections are retained here; no product error was hidden.
- **Source/code/Compose changes:** none. No Billing source, project Compose file, project network, or project-built image was created. No test, data, or security requirement was removed.
- **Evidence:** CP0 measurements and image digests are recorded in section 5 of the Design Freeze. Application/business tests were not run because implementation has not started.
- **Git:** workspace has no `.git` metadata; git status/diff/cached diff and repository secret scan were unavailable. No commit or tag was created.
- **Outside roadmap:** no technology/service was added. Temporary containers and host tools were used only for CP0 probes. Official Docker Compose release metadata was consulted to classify v5.4.0.
- **Remaining work:** YC1a needs the student/repository identity details; project DB/UI, service readiness, metrics/dashboard, project LogQL, and hardening remain untested at their assigned checkpoints.
- **Next checkpoint:** YC1a / CP1a. Do not skip to YC2 or later phases.

## 2026-10-05 — CP0 Resume and PASS

- **Status:** PASS for CP0 prerequisites and compatibility probes. No YC1a/YC2 implementation started.
- **Source of truth:** reread all of `FILEmd/billing_deployment_roadmap_2.md` before resuming.
- **Files changed:**
  - Updated `FILEmd/billing_deployment_roadmap_2.md`: CP0 state/results, image Config.User/tool/health evidence, Compose version clarification, CP0 checkboxes, Final Review, risks and changelog.
  - Updated `docs/AI_EXECUTION_HISTORY.md`.
- **Runtime checks/evidence:**
  - Docker Desktop 4.88.1 and Engine/client 29.7.2; server reported Linux/amd64.
  - Docker Compose CLI v5.4.0; `docker compose ls` and help work. Confirmed v5.4.0 is an official `docker/compose` release. The CLI command is `docker compose`; no legacy standalone Compose was used.
  - Pulled all 12 upstream/base images successfully. Image digests, `Config.User`, shell-probe UIDs, declared HEALTHCHECKs and observed candidate binaries are recorded in the Design Freeze. No project-built web image was built.
  - OpenSSL 3.5.7 generated a short-lived certificate with SAN `localhost` and `billing.local`; validity check passed; temporary certificate/private key removed.
  - Scratch network probe created/inspected all five topology shapes with expected `internal` flags. Loopback port publishing worked on non-internal admin scratch network; publishing from internal app scratch network did not produce host mapping/reachability. All scratch networks removed.
  - cAdvisor v0.60.6 probe reached `/metrics`, returned a sample-labeled `container_memory_working_set_bytes` metric, and its declared healthcheck became `healthy`. Metric is from the Docker Desktop Linux VM, not the Windows host. Sample and cAdvisor containers removed.
  - Promtail 3.6.11 pushed a sample JSON log into Loki 3.7.8 and a Loki query returned the expected line/labels. The short default-config probe returned HTTP 503 from `/ready`; this is recorded separately and project readiness remains a CP5 check. Probe containers/network/config removed.
  - Grafana 13.2.3 API health returned `database=ok`; a datasource provisioned from a temporary file appeared through the API. Probe container/config removed.
  - pgAdmin 9.18.0 entrypoint supports `PGADMIN_SERVER_JSON_FILE`; a no-password temporary `servers.json` imported one server row into pgAdmin’s SQLite database. This did not test connection to the Billing DB. `/misc/ping` did not respond during the brief probe, so no custom pgAdmin healthcheck is enabled; UI/readiness/DB connection remain CP2 checks. Probe container/config removed.
  - Final check found no `billing-cp0-*` containers, networks or temp files. Host ports 80/443/3000/5050/8000/9090 had no listeners. Existing external Compose projects continue to publish 5432/5433/6380; they were not modified or stopped.
- **Probe corrections, retained transparently:** an initial Promtail command passed its config flag incorrectly; the corrected probe mounted the fixture at the image’s default config path and passed. An initial pgAdmin fixture used a reserved `.test` email and was rejected; the corrected `example.com` probe imported successfully. An early Grafana query ran before startup completed; the later API/provisioning check passed. These were probe-harness issues, not hidden product test failures.
- **Source/code/Compose changes:** none. No Billing service, source file, project network, Compose file or project-built image was created.
- **Git:** workspace has no `.git` metadata; `git status`, diff, cached diff and secret scan were unavailable. No commit/tag was created.
- **Outside roadmap:** no technology or service was added. PowerShell and OpenSSL were used as existing CP0 host tools; official Docker Compose release metadata was consulted to classify the installed CLI version.
- **Remaining work:** YC1a requires the student/repository identity details; then proceed to YC2 only as the next approved checkpoint. Project UI and DB integration, service healthchecks, project metrics/dashboard, project LogQL and hardening remain untested.
- **Next checkpoint:** YC1a / CP1a (do not skip directly to later checkpoints).

## 2026-10-05 — CP0 Validity Audit Against Prompt 1

- **Status:** BLOCKED. The earlier CP0 PASS entries remain intact as historical records, but the PASS cannot be confirmed against every mandatory Prompt 1 item yet.
- **Scope:** compared Prompt 1's complete 12 checks with the CP0 evidence in the Design Freeze and this history. No YC1a/YC2 work was started.
- **Reconfirmed:** `docker version` reports Docker Desktop 4.88.1 / Engine and client 29.7.2 with a Linux/amd64 server; `docker compose version` reports v5.4.0. No listeners were present on host ports 80, 443, 3000, 5050, 8000, or 9090 at the time of audit. Two unrelated Compose projects (`billing-phase2-test` and `invoice-billing-system`) were observed running from `D:\Projects\invoice-billing-system\docker-compose.yml`; they were not changed or stopped.
- **Existing evidence retained:** the earlier same-day record covers all 12 pinned upstream/base image pulls and inspections, binary/healthcheck inventory, OpenSSL SAN certificate probe and cleanup, scratch network probes and cleanup, cAdvisor metric/label probe, Promtail-to-Loki push/query, and Grafana provisioning. These were not rerun because their evidence is recorded and the pinned versions/design have not changed.
- **pgAdmin gap:** prior evidence proves `PGADMIN_SERVER_JSON_FILE` support and imports a no-password server definition, but does not prove runtime credential entry and successful connection. A temporary pinned pgAdmin 9.18.0 + PostgreSQL 16.15 probe used a disposable server definition without a password and throwaway credentials. PostgreSQL became healthy, but pgAdmin's HTTP port and `/misc/ping` did not respond; its startup log stopped at application initialization. Runtime credential entry/connection could not be tested, so this is BLOCKED, not a product PASS or confirmed credential failure.
- **Cleanup:** removed both temporary containers, pgAdmin's anonymous volume, the scratch network, and the temporary server-definition file. Host-port check after cleanup returned no listeners on the six CP0 ports. No Billing source, project Compose file, project database, or project network was created.
- **Files changed:** updated `FILEmd/billing_deployment_roadmap_2.md` to record the current gate and missing mandatory check; appended this audit to `docs/AI_EXECUTION_HISTORY.md`. All earlier history sections remain unchanged.
- **Git:** workspace has no `.git` metadata; no Git status/diff/secret scan, commit, or tag was available or performed.
- **Outside roadmap:** none. Only the disposable CP0 compatibility probe was used.
- **Conclusion:** CP0's earlier PASS remains a historical result, but current validity against Prompt 1 is BLOCKED until the pgAdmin runtime-credential check succeeds. Do not start YC1a/YC2.
- **Next checkpoint:** CP0 only; resume the missing pgAdmin runtime-credential/readiness probe, then re-evaluate CP0. Stop after CP0 PASS; do not automatically proceed to YC1a.

## 2026-10-05 — CP0 Debug: pgAdmin Runtime Credential PASS

- **Status:** PASS. The missing Prompt 1 pgAdmin runtime-credential prerequisite is verified. CP0 is now PASS; YC1a was not started.
- **Source of truth:** reread `FILEmd/billing_deployment_roadmap_2.md` and the prior entries in this history. All older PASS/BLOCKED entries are retained unchanged.
- **Image inspection:** `dpage/pgadmin4:9.18.0`, digest `sha256:c332c5f6dfba995d9ebc4af261d93506d6876085d712eaaa3defc8dd1a3f26de`; Config.User `5050`; entrypoint `/entrypoint.sh`; image exposes `80/tcp` and `443/tcp`; no declared HEALTHCHECK. Entrypoint inspection confirmed `PGADMIN_LISTEN_PORT` controls Gunicorn's actual bind port and `PGADMIN_SERVER_JSON_FILE` loads servers before Gunicorn starts.
- **Probe configuration:** disposable network `cp0-pgadmin-runtime-20261005`; PostgreSQL `postgres:16.15-trixie` with database `billing`; role `billing_readonly` received a temporary throwaway password and SELECT on `public.cp0_probe_table`. pgAdmin server definition used `Host=cp0-pgadmin-db`, `Port=5432`, `MaintenanceDB=billing`, `Username=billing_readonly`, and omitted `Password` entirely.
- **Actual ports:** `PGADMIN_LISTEN_PORT=5050`; pgAdmin logs reported `Listening at: http://[::]:5050`. `docker inspect` confirmed `5050/tcp` mapped to host `127.0.0.1:5051`. Host `GET /misc/ping` returned `200 PING`; the browser loaded the pgAdmin 4 login UI.
- **Import/UI/runtime credential:** logs reported `Added 0 Server Group(s) and 1 Server(s)`. The Object Explorer showed the imported server. Selecting it displayed the runtime password prompt for `billing_readonly`; `Save Password` remained unchecked. Login succeeded and pgAdmin displayed “Server connected.”
- **Database evidence:** pgAdmin Object Explorer showed database `billing`, schema `public`, and table `cp0_probe_table`. Direct read-only verification returned database `billing`, current user `billing_readonly`, PostgreSQL `16.15`, and row `(1, 'runtime credential verified')`. The `servers.json` parsed successfully and `PasswordPropertyPresent=False`.
- **Root cause:** the prior BLOCKED result was premature: the first-start pgAdmin process was still initializing its SQLite configuration/import and had not reached Gunicorn. In this successful run, startup began at 12:46:49 and Gunicorn listened at 12:47:35 (about 46 seconds); the entrypoint log then showed one imported server. No pgAdmin/PostgreSQL incompatibility was found. A first connection attempt in this run separately exposed a probe-only DNS alias mismatch (`cp0-pgadmin-db` versus the actual container name); adding that alias corrected the probe, after which connection succeeded.
- **Credential handling:** both passwords were throwaway values held in terminal runtime environment; neither is recorded here. The server JSON never contained a password, the Save Password checkbox was left unchecked, and runtime environment variables were removed during cleanup.
- **Cleanup/evidence:** both probe containers were removed with anonymous volumes (`docker rm -fv`), the scratch network was removed, the temporary JSON file was deleted, runtime password variables were cleared, browser tab navigated away, and host port 5051 had no listener. `docker ps`, `docker network ls`, and `docker volume ls` were checked. Remaining containers/networks/volumes belong to pre-existing unrelated Compose projects; the remaining anonymous volumes predate this probe, and Docker events showed two probe volume destroy events. No unrelated resource was stopped or removed.
- **Files changed:** updated `FILEmd/billing_deployment_roadmap_2.md` to record current CP0 PASS and appended this section to `docs/AI_EXECUTION_HISTORY.md`; temporary `cp0-pgadmin-servers.json` was created for the probe and deleted afterward. No source code or project Compose file was created or changed.
- **Git:** no `.git` metadata in the workspace; no Git status/diff/secret scan, commit, or tag was available or performed.
- **Outside roadmap:** NONE. No architecture or project configuration was changed.
- **Conclusion:** CP0 = PASS; pgAdmin runtime credential = PASS. Stop here. Next checkpoint is YC1a, but do not start it automatically.

## 2026-10-05 20:00:08 +07:00 — YC1a / Repository Foundation

- **PHASE / PROMPT:** YC1a — Repository Foundation.
- **Date/time:** 2026-10-05 20:00:08 +07:00.
- **Performed by:** GitHub Copilot.
- **Checkpoint before:** CP0 PASS (2026-10-05).
- **Checkpoint current:** CP1a PASS; commit creation is the remaining step.
- **Goal:** establish repository metadata/foundation, README skeleton, ignore rules, placeholder-only `.env.example`, evidence directory and this append-only history entry. No YC2 implementation.
- **Checked before:** `git status` showed existing untracked `FILEmd/`, `docs/`, and `LICENSE`; `.git` already existed, branch was `main`, the configured `origin` matched `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git`, and `git log` confirmed there were no prior commits. No Billing Compose file exists, so project `docker compose ps/config` and Billing container/network checks were not run. CP0 was not rerun.
- **Performed:** retained the existing repository, `main` branch, remote, LICENSE, Design Freeze, phase-prompt document, and all history. Added the foundation files below. Removed one trailing space from line 4 of the existing phase-prompt document so the required staged whitespace check passes; prompt content and architecture are unchanged. No GitHub push was performed.
- **Files created:** `README.md`, `.gitignore`, `.env.example`, `docs/evidence/README.md` (which makes the evidence directory meaningful without an empty placeholder).
- **Files modified:** appended this section to `docs/AI_EXECUTION_HISTORY.md`; whitespace-only normalization on line 4 of `FILEmd/BỘ_PROMPT_TRIỂN_KHAI_BILLING_THEO_GIAI_DOAN.md`.
- **Files deleted:** NONE.
- **Important changes:** README identifies DTC245200086 / Phạm Tiến Hà / CNTT K23G / Vũ Việt Dũng, states CP0 PASS, lists the planned stack and YC1-YC7 roadmap, and explicitly says Billing application/services are not implemented. `.env.example` contains only a `CHANGE_ME` session-secret placeholder and the frozen YC2 cookie flag. `.gitignore` covers env files, certificates/private keys, dependencies, logs, database dumps, and temporary/editor files while keeping `.env.example` and SQL source files trackable.
- **Tests/evidence:** README required-section, env-placeholder, evidence-directory and ignore checks PASS. `git status` confirms branch `main`; `git diff` is empty; `git diff --cached --check` PASS. The staged allowlist is exactly eight files: the four YC1a foundation files plus LICENSE and the existing Design Freeze, phase prompt and history. `git check-ignore .env` and `git check-ignore nginx/certs/example.key` PASS; `.env.example` remains trackable. Secret/private-key pattern scan found 0 matches; implementation/Compose/Dockerfile scan found 0 files. A disposable clean copy retained README, `.gitignore`, `.env.example`, LICENSE, all design/history files and evidence guide; `.env` ignore and CP0 history checks PASS. The temporary copy was removed.
- **Git status:** repository is on `main`, has no commits yet, and `origin` is configured for the supplied GitHub repository. Candidate commit message: `chore: init repository structure, README skeleton and .gitignore`. No tag. No push.
- **Outside Roadmap:** NONE.
- **Regression/scope:** no Billing backend/frontend/schema, Dockerfile, `docker-compose.yml`, service config, database, project container, or project network was created. Existing architecture documents were not modified.
- **Conclusion:** CP1a PASS; ready for Commit 0a after final staged verification.
- **Next checkpoint:** YC2 is gated by CP1a PASS; do not start it automatically.

## 2026-10-05 — YC1a Commit 0a Push Verification (BLOCKED)

- **Checkpoint before:** CP0 PASS.
- **Checkpoint after:** CP1a remains BLOCKED because publishing `main` did not succeed.
- **Commit 0a:** `d58e25d` — `chore: init repository structure, README skeleton and .gitignore`; local `main` is clean at this commit before this history append. No tag was created.
- **Pre-push checks:** `git status` clean; `git diff` and `git diff --cached` empty; `git diff --cached --check` passed. The committed foundation contains exactly eight YC1a files: `.env.example`, `.gitignore`, `README.md`, `docs/evidence/README.md`, `docs/AI_EXECUTION_HISTORY.md`, LICENSE, and the two existing `FILEmd/` documents. No `.env`, private key, database dump, Billing source, Dockerfile, Compose file, Nginx, monitoring, or logging files were included.
- **Push:** `git push -u origin main` failed with HTTP 403. GitHub reported `Permission to dtc245200086-svg/DTC245200086_PhamTienHa.git denied to nguyenthinga27052006-cpu`. No credentials were changed and no alternate identity was attempted.
- **Remote/branch verification:** configured `origin` fetch/push URLs both point to `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git`; local `main` remains at `d58e25d`. The push did not establish upstream tracking. Post-push `git remote -v`, `git branch -vv` and `git log --oneline --decorate -n 5` are the required verification after authorization is corrected.
- **Files:** this section is appended to the history after Commit 0a; it is currently an unstaged working-tree change and is not included in `d58e25d` because the push was rejected. No prior history was changed or deleted.
- **Outside Roadmap:** NONE.
- **Scope:** no tag, source implementation, Billing Compose, Docker command, or YC2 work was created or run.
- **Conclusion:** local Commit 0a exists; push is BLOCKED by GitHub authorization. CP1a = BLOCKED until an authorized `git push -u origin main` succeeds and remote tracking/log are verified.
- **Next checkpoint:** finish YC1a push verification only; do not begin YC2.

## 2026-10-05 — YC1a Push Retry After Collaborator Invite (BLOCKED)

- The repository access screenshot showed the collaborator invitation for `nguyenthinga27052006-cpu` as **Pending Invite**.
- Retried `git push -u origin main`; GitHub again returned HTTP 403: permission denied to `nguyenthinga27052006-cpu`.
- Commit 0a remains local at `d58e25d`; no tag was created and no alternate credentials were used.
- **Outside Roadmap:** NONE.
- **Conclusion:** CP1a remains BLOCKED until the collaborator invitation is accepted and the push succeeds. Do not start YC2.

## 2026-10-05 — YC1a / CP1a Final Verification PASS

- **Checkpoint before:** CP0 PASS.
- **Checkpoint after:** CP1a PASS.
- **Commit 0a:** `d58e25d` — `chore: init repository structure, README skeleton and .gitignore`.
- **Push result:** `git push -u origin main` succeeded; remote branch `main` was created and upstream tracking configured.
- **Remote verification:** fetch/push URL is `https://github.com/dtc245200086-svg/DTC245200086_PhamTienHa.git`; `git branch -vv` shows `main` tracking `origin/main`; `git log --oneline --decorate -n 5` shows `d58e25d` at both `HEAD` and `origin/main`; Git reports the branch is up to date.
- **Files in Commit 0a:** `.env.example`, `.gitignore`, `README.md`, `docs/evidence/README.md`, `docs/AI_EXECUTION_HISTORY.md`, `LICENSE`, and the two existing Design Freeze/phase-prompt documents.
- **Files excluded:** `.env`, private keys, database dumps, Billing source, Dockerfile, Billing Compose, Nginx, Prometheus, Grafana, Loki, Promtail, and YC2-YC5 implementation folders.
- **Tests:** `git status`, `git diff`, `git diff --cached`, `git diff --cached --check`, ignore checks, secret/source scan, staged-boundary review, and clean-copy test passed before Commit 0a. Post-push remote, branch, and log verification passed.
- **Files changed:** appended this final verification to `docs/AI_EXECUTION_HISTORY.md`; all prior CP0 PASS/BLOCKED and YC1a push-attempt entries remain intact.
- **Outside Roadmap:** NONE.
- **Tag:** none; `base-app` was not created.
- **Conclusion:** CP1a = PASS. YC2 is unlocked as the next checkpoint, but was not started.

## 2026-10-05 — YC2 / CP2 Final Verification PASS

- **Checkpoint before:** CP0 PASS; CP1a PASS at Commit 0a (`d58e25d`).
- **Checkpoint after:** YC2 and CP2 PASS. YC3 was not started.
- **Source of truth:** Design Freeze, README, Prompt 3, current runtime and repository tests.
- **Compose/build/runtime:** `docker compose config --quiet` passed; `docker compose up -d --build` built the web image. The project contains and runs exactly `postgres`, `web`, and `pgadmin`. Postgres and web reported healthy; pgAdmin readiness was verified through its UI and DB connection. Web is published at `127.0.0.1:8000`, pgAdmin at `127.0.0.1:5050`, and PostgreSQL has no host port mapping. `db_net` is internal and `admin_net` is non-internal.
- **Persistence:** ran plain `docker compose down` (no `-v`) followed by `docker compose up -d --build`. Both named volumes were preserved. The customer `CP2 persistence 20261005 verification`, created through the application, was still returned by the application after restart (`CP2_PERSISTENCE_PASS`).
- **Database:** confirmed `users`, `customers`, `invoices`, `invoice_items`, `payments`, and `user_sessions`; `invoices.due_date` is NOT NULL; invoice number has a unique constraint/index; `invoice_no_seq` starts at 1, increments by 1 and does not cycle. Required indexes and invoice constraints were present. Seed password hashes use bcrypt `$2a$12$`.
- **Least privilege:** `postgres` is superuser; `billing_app` and `billing_readonly` are not. `billing_app` has no schema CREATE, invoice DELETE, or payment UPDATE/DELETE; it has sequence USAGE but not SELECT. `billing_readonly` can SELECT only `customers`, `invoices`, `invoice_items`, and `payments`; it cannot SELECT `users` or `user_sessions` and has no business-table DML. Eight attempted prohibited operations executed as those roles inside the PostgreSQL container were denied.
- **Authentication/session:** verified correct and incorrect login, unauthenticated protected-route denial, session row in `user_sessions`, session survival across requests and logout invalidation. Login response did not expose password/hash. Cookie is `billing.sid`, HttpOnly, SameSite=Strict, Path=/, expires in eight hours and has no Secure flag in YC2. Runtime `SESSION_COOKIE_SECURE=false`; seed hashes verify at bcrypt cost 12. No plaintext password is stored by the application.
- **Business/API:** `npm run test:cp2` passed all 15 check groups against the restarted runtime; the final post-cleanup invoice-list p95 was 23.18 ms. Coverage includes health/static UI, customer CRUD and role checks, draft/issue rules, invoice number format and uniqueness, NUMERIC totals, issued immutability, due-date and zero-total guards, partial/full payments, overpayment and zero-payment guards, payment concurrency, admin-only unpaid cancellation/reason, customer FK restriction, dashboard/list APIs, logout and validation/error responses. Payment transaction locking and append-only DB privileges were reviewed and verified.
- **pgAdmin:** logged into the fresh pgAdmin UI, confirmed the imported `Billing PostgreSQL` server from `servers.json` (`postgres:5432`, database `billing`, user `billing_readonly`), entered the runtime DB password in the prompt with Save Password unchecked, connected successfully and queried customer rows as the read-only user. `servers.json` contains no Password property. Evidence: `docs/evidence/RQ2-07-pgadmin-runtime.png`.
- **Health/logging:** `/health` returned `{"status":"ok","db":"ok"}`. Parsed 239 recent web log records as JSON; no password, cookie, session or secret fields were present.
- **Scope/security:** no Nginx, monitoring, metrics, Loki/Promtail or SQL Server implementation was found in the YC2 implementation scan. No `.env` exists in the workspace; `.env` is ignored and `.env.example` remains trackable with placeholders only. Private-key marker scans returned no matches. Runtime credentials were read from existing container environments for local verification only and were not written to source/evidence.
- **Files/documentation:** updated the YC2 role initializer to remove excess sequence SELECT and auth-table read privileges; expanded `scripts/cp2-smoke.mjs`; updated README, the CP2 roadmap checklist and evidence index. Earlier history entries were not changed.
- **Commit 0b:** `feat(app): billing web app with PostgreSQL and pgAdmin via docker-compose`; target annotated tag: `base-app`. No push. Stop after Commit 0b/tag; do not start YC3.

## 2026-10-05 — YC3 / CP3 Runtime Verification PASS

- **Checkpoint before:** CP0, CP1a, YC2/CP2 PASS. HEAD and `base-app` both resolved to `aa0d39222eddec12c41e7379550952ee83085a5e`; `main` was clean and one commit ahead of `origin/main`. No rebase/reset/amend/tag movement/push occurred.
- **Checkpoint after:** YC3/CP3 runtime gates PASS. YC4 has not started. Commit 1 and `commit-1-nginx` remain gated on the staged review recorded below.
- **Pinned image:** `nginxinc/nginx-unprivileged:1.30.5-alpine`; image and running process UID/GID 101; `/usr/sbin/nginx`, `/usr/bin/wget`, `/usr/bin/curl` verified. Nginx healthcheck uses the verified wget binary.
- **Certificate:** `scripts/gen-cert.ps1` ran successfully using OpenSSL 3.5.7. It generated a one-year self-signed RSA certificate with CN `localhost` and SAN `localhost`, `billing.local`; validity was 2026-10-05 through 2027-10-05. Nginx served that exact certificate (SHA-256 fingerprint `70:76:77:06:22:28:8B:A7:84:8A:15:46:EF:DB:F8:A9:E5:81:99:DC:32:7A:8D:DB:88:9B:89:B9:F9:D8:1C:A9`). Private key/certificate are ignored under `nginx/certs/` and are not tracked.
- **Compose/runtime:** `docker compose config --quiet` passed; services are exactly `postgres`, `web`, `pgadmin`, `nginx`. Postgres, web and nginx are healthy; pgAdmin responds on its loopback-only port. Host mappings: Nginx `0.0.0.0:80->8080` and `0.0.0.0:443->8443`; pgAdmin `127.0.0.1:5050->5050`; web and Postgres have no host mappings. `127.0.0.1:8000` connection was refused. Runtime networks: `edge_net` (nginx, non-internal), `app_net` (nginx+web, internal), `db_net` (web+postgres+pgadmin, internal), `admin_net` (pgAdmin only, non-internal). No `monitoring_net`; no egress claim made.
- **Nginx/HTTP/TLS:** live `nginx -t` passed. `http://localhost/` returned 301 with `Location: https://localhost/`; `http://localhost/nginx-health` returned 200. HTTPS `localhost` and `billing.local` returned 200; curl handshakes for TLS 1.2 and 1.3 returned 200. `/health` and `/metrics` returned public 404. Web remained reachable only through Nginx.
- **Headers/CSP:** real HTTPS responses returned HSTS `max-age=86400`, `nosniff`, `DENY`, `strict-origin-when-cross-origin`, the frozen Permissions-Policy and CSP values, plus `X-Request-Id`. `Server` was `nginx` without a version on both HTTPS and HTTP 301. Browser loaded login, dashboard, customer, invoice and payment views with zero CSP violations; only self-hosted JS/CSS were loaded.
- **Proxy headers/request IDs:** a temporary echo sink and disposable Nginx probe on `app_net`, reusing the production `proxy-headers.inc`, confirmed `Host`, `X-Real-IP`, `X-Forwarded-For` (client value plus peer IP), scheme-derived `X-Forwarded-Proto`, and an Nginx-generated request ID replacing a supplied client value. The production HTTPS cookie verified `X-Forwarded-Proto=https`. Both temporary containers and the probe config were removed; final `app_net` membership was rechecked.
- **Rate limit/logging:** 12 consecutive login attempts produced six real HTTP 429s; ordinary HTTPS requests remained 200. Nginx access records parsed as JSON with `ts`, `method`, `path`, `status`, `request_time`, `bytes`, `remote_addr`, `request_id`, and `user_agent`. A response `X-Request-Id` matched the record's `request_id`; no password, cookie or secret is logged.
- **Authentication/browser:** HTTPS login, dashboard/customer/invoice/payment navigation and logout passed in an isolated browser context that accepted the local self-signed cert without changing OS/application trust. The login cookie was `billing.sid`, Secure, HttpOnly, SameSite=Strict, Path=/, and expired after 28,800 seconds. A throwaway bcrypt cost-12 browser test user was deleted after the test. Final API regression used `NODE_EXTRA_CA_CERTS` for this test process, not disabled TLS verification.
- **CP2 regression:** `npm run test:cp2` passed all 15 groups through `https://localhost` after the final web rebuild; final invoice-list p95 was 24.34 ms. Covered login success/failure, protected routes, customer CRUD/permissions, invoice issue and validation, partial/full payments, cancellation, dashboard, session persistence/logout and public `/health` hiding.
- **Failures/corrections retained:** isolated `docker compose run --no-deps nginx nginx -t` could not resolve `web` before it joined `app_net`; after `docker compose up -d --build`, in-service `nginx -t` passed. Initial HTTP browser credential-helper request was blocked by CSP and was not allowed; the authenticated test used a temporary DB account instead. The first HTTP header review found `Server: nginx/1.30.5`; `server_tokens off` was added to the HTTP virtual host, then both HTTP and HTTPS returned `Server: nginx`. A first header-probe test used Node fetch, which rewrote Host; the Node HTTP client rerun passed. Final CP2 test used the local certificate via `NODE_EXTRA_CA_CERTS` after an earlier test-process-only TLS bypass.
- **Evidence:** `docs/evidence/RQ3-01-https-browser.png` and `docs/evidence/RQ3-02-runtime-verification.png`; screenshots contain no credential or private key.
- **Files:** Nginx config and proxy-header include; PowerShell and shell cert scripts; Compose service/network/port changes; `.env.example` Secure setting; CP2 HTTPS-mode assertions; YC3 sidebar label; README, Design Freeze CP3 checklist, evidence index and this append-only entry. No YC4/YC5 service/config/code was added.
- **Git boundary:** intended Commit 1 message is `feat(nginx): reverse proxy with self-signed HTTPS and security headers`; intended annotated tag is `commit-1-nginx`. This record is included in that single commit and was written before Git could create its object ID; the resolved commit hash is reported in the post-commit verification. No amend or second commit will be used. No push. Stop after Commit 1/tag; do not start YC4.

## 2026-10-05 — YC4 / CP4 Runtime PASS and Commit 2

- **Checkpoint before:** CP0, CP1a, CP2 and CP3 PASS; `HEAD`/`commit-1-nginx`=`d179090de811925ee6b505311edb5c956fea4b98`; `base-app`=`aa0d39222eddec12c41e7379550952ee83085a5e`; worktree clean. The tags were not moved.
- **Checkpoint after:** YC4/CP4 runtime PASS; Commit 2 `7502aa7f067f99f6b976bc553bdc021b79561f48`, annotated tag `commit-2-monitoring`. No push. YC5 was not started.
- **Files created in Commit 2:** `app/src/metrics.js`; `monitoring/prometheus/prometheus.yml`; Grafana datasource/dashboard provisioning files and `monitoring/grafana/dashboards/billing-monitoring.json`; `scripts/load-test.ps1`, `scripts/load-test.sh`; `docs/evidence/RQ4-01-prometheus-targets.png` and the invoice-metric screenshot (renamed post-commit to `RQ4-07-prometheus-business-metric.png` to avoid colliding with the Design Freeze RQ4-03 Web-row ID).
- **Files modified in Commit 2:** `.env.example`; `app/package.json`/lockfile; app middleware and invoice/payment routes; `docker-compose.yml`; `nginx/conf.d/default.conf`. Commit 2 contains no Loki/Promtail, `.env`, password or private key.
- **Runtime:** Compose configuration passed; all 10 project services ran. Postgres, web, Nginx and cAdvisor declared healthchecks were healthy. Grafana/Prometheus bound to `127.0.0.1`; web, Postgres and exporter/cAdvisor ports were not published.
- **Prometheus:** all 6 jobs (`prometheus`, `cadvisor`, `node`, `nginx`, `web`, `postgres`) were UP. cAdvisor returned CPU/RAM metrics; node-exporter returned host/VM metrics; nginx-exporter returned `nginx_up=1` and connection metrics; app returned process/Node/event-loop, request counter/histogram and business metrics; PostgreSQL exporter returned `pg_up`, activity, transaction, size and cache series.
- **Grafana:** API health `ok`, Prometheus datasource `OK`, provisioned Billing Monitoring dashboard with 15 panels; login `admin/admin` returned 401. Datasource/dashboard were present after `docker compose down`/`up` without deleting volumes.
- **Traffic/regression:** PowerShell load-test created three real `YC4 LOAD` customer/invoice/payment sets through HTTPS, plus invalid-login and 404 traffic; public `/metrics` remained 404. Full CP2 HTTPS smoke passed 15 groups; persistence-only check passed after down/up. Nginx redirect/TLS 1.2/1.3/headers/login rate-limit 429/public `stub_status` 404 were verified.
- **Networks:** `edge_net`: Nginx; `app_net`: Nginx, web, nginx-exporter; `db_net`: web, PostgreSQL, pgAdmin, postgres-exporter; `admin_net`: pgAdmin, Prometheus, Grafana; `monitoring_net`: web, Prometheus, Grafana, cAdvisor, node-exporter, nginx-exporter, postgres-exporter. `monitoring_net` was internal; Nginx/PostgreSQL were not members.
- **Security:** Role `exporter` was non-superuser and a member of `pg_monitor`. Runtime membership/ports matched the YC4 topology. Secret and YC5 implementation scans were clean.
- **Evidence:** `docs/evidence/RQ4-01-prometheus-targets.png` and `docs/evidence/RQ4-07-prometheus-business-metric.png` (Prometheus invoice business-counter query). Separate Grafana row screenshots RQ4-02/03/04 remain needed for the final report; this does not change the CP4 runtime gate.
- **Post-tag YC4 follow-up, not in Commit 2:** cAdvisor exposes labels for other Compose projects on this Docker Desktop host. Updated the working-tree dashboard queries to filter `container_label_com_docker_compose_project="billing"`; Prometheus returned 10 CPU and 10 RAM series for the Billing project, and after restarting Grafana its API served the scoped queries with datasource still `OK`. This follow-up is not folded into/amended to `commit-2-monitoring` and remains uncommitted for review.
- **Remaining work:** YC1 final README/evidence completion; Grafana row screenshots; YC5/CP5 Loki, Promtail and at least three LogQL results; YC6/CP6 full H1–H6 hardening verification; YC7/CP7 final report, cover, demo and Q&A. Do not start YC5 without the next prompt.

## 2026-10-05 — Prompt 5C Design Freeze / Current Git State Sync

- **Baseline verification:** `base-app=aa0d39222eddec12c41e7379550952ee83085a5e`; `commit-1-nginx=d179090de811925ee6b505311edb5c956fea4b98`; `commit-2-monitoring=7502aa7f067f99f6b976bc553bdc021b79561f48`.
- **Current Git state:** support commit `5743031f9c39a3960a87d40e92cb7eef5d9e40eb` (`docs: finalize YC4 monitoring records and evidence`) is HEAD. `commit-2-monitoring` remains at `7502aa7`; baseline tags were not moved. Working tree is clean. Support commit has not been pushed.
- **Checkpoint state:** CP0, CP1a, CP2, CP3 and YC4/CP4 technical gates PASS. CP4 Final Evidence remains incomplete until actual Grafana row screenshots RQ4-02 Container, RQ4-03 Web and RQ4-04 Database are captured. RQ4-01 is Prometheus Targets; RQ4-05/06 are optional datasource/provisioning and before/after evidence; RQ4-07 is the Prometheus business metric query.
- **Dashboard scoping:** the cAdvisor CPU/RAM project filter `container_label_com_docker_compose_project="billing"` was included in support commit `5743031`; this follow-up does not amend Commit 2. It limits the panels to the Billing Compose project and excludes other Docker Desktop Compose projects.
- **Network/runtime distinction:** current Commit 2 runtime does not include Loki or Promtail. Final network design shows them as future YC5/Commit 3 members of `monitoring_net`; they have not been deployed.
- **Remaining:** YC5/CP5 has not started; YC6/CP6 and YC7/CP7 are not complete. No Loki, Promtail, LogQL or logging pipeline was added. No push was performed.

## 2026-10-06 — YC5 / CP5 Runtime PASS and Commit 3

- **Resume point:** worktree already contained uncommitted YC5 files and RQ5 screenshots, although the Design Freeze and execution history still said YC5 had not started. No reset/rebase/amend/tag movement or push was performed.
- **Baseline refs:** `base-app=aa0d39222eddec12c41e7379550952ee83085a5e`; `commit-1-nginx=d179090de811925ee6b505311edb5c956fea4b98`; `commit-2-monitoring=7502aa7f067f99f6b976bc553bdc021b79561f48`. These refs remained unchanged. The pre-Commit-3 HEAD was `25944eae9dd7546c31c2083f1e3b0400d43919f8`.
- **Pre-existing YC5 worktree state:** Compose already declared Loki 3.7.8, Promtail 3.6.11, `loki_data` and `promtail_positions`; `logging/` contained both configs and six LogQL queries; Grafana had a Loki datasource and invoice/payment log panel; RQ5-01…RQ5-06 screenshots were present. The README, evidence index and history were stale. No YC2–YC4 source code was changed for logging.
- **Config/runtime:** plain `docker compose config --quiet` was blocked because this workspace has no `.env` and required interpolation values were unset. `docker compose --env-file .env.example config --quiet` passed using the placeholder-only file; no `.env` was created. All 12 Billing services were running. Loki `/ready` returned `ready`; Promtail was running with `promtail_sent_entries_total=1854`, `promtail_dropped_entries_total=0`, and Docker target parsing errors `0` at inspection.
- **Project isolation/labels:** Loki service values contained the 11 Billing services only; Promtail itself is excluded by relabeling. A newly generated Nginx 404 request was queried by its real `request_id`; its indexed labels were exactly `container`, `service`, and `stream`. Loki's effective config has `discover_service_name: []`. Some historical retained series still expose `service_name`; these were not deleted and will expire under the configured 72-hour retention. No `path`, `status`, `user`, or `request_id` label was indexed.
- **LogQL:** Q2 `{service="web"} | json | msg="auth.login_failed"` returned 7 real lines; Q3 `{service="nginx"} | json | status >= 400` returned 41 real lines in the checked one-hour range; Q4 `{service="web"} | json | msg=~"invoice.created|payment.recorded"` returned 21 real application events. Grafana Explore ran these against the provisioned Loki datasource, and the dashboard log panel displayed real invoice/payment events.
- **Persistence:** Loki's `billing_loki_data` named volume was mounted at `/loki`. Only `billing-loki-1` was restarted; readiness recovered to `ready`, and Q4 still returned 21 lines. No `docker compose down` or full-stack restart was used.
- **YC2–YC4 quick regression:** web and PostgreSQL were healthy; HTTPS `/` returned 200; unauthenticated `/api/auth/me` returned 401; pgAdmin `/misc/ping` returned 200; Grafana API health was `ok`; all six Prometheus targets were UP; `pg_up`, `nginx_up`, `up{job="web"}`, and the invoice business metric returned series; public `/metrics` remained 404.
- **Secret scan:** workspace search found no private-key/API-token/Bearer-token markers. `.env` was absent, not tracked, and ignored; no private key was added.
- **Evidence:** RQ5-01, RQ5-03, RQ5-04, RQ5-05 and optional RQ5-06 were already present and inspected. Existing RQ5-02 showed the Label Browser still loading, so it was replaced with a real loaded label-browser screenshot at the same ID. No duplicate evidence file was added.
- **Files modified during this resume:** `FILEmd/billing_deployment_roadmap_2.md`, `README.md`, `docs/evidence/README.md`, `logging/logql-queries.md`, and this appended history entry; `docs/evidence/RQ5-02-loki-label-browser.png` was replaced. Pre-existing Compose, Grafana dashboard/datasource, logging configs, and other RQ5 images were retained.
- **Checkpoint result:** CP5 = PASS. Commit 3 message: `feat(logging): centralized logging with Loki, Promtail and LogQL queries`; annotated tag: `commit-3-logging`. No push. YC6/CP6 and YC7/CP7 remain incomplete; YC4 final screenshots RQ4-02/03/04 are still outstanding.

## 2026-10-06 — Documentation Sync Before CP6

- **Scope:** documentation sync only. No CP6/H1–H6, runtime, source, Compose architecture, monitoring, logging, or evidence-generation work was performed.
- **Files synced:** `README.md` and `FILEmd/billing_deployment_roadmap_2.md`. Appended this entry only; all prior history entries, including the 2026-10-05 Prompt 5C and the YC5 entry, remain unchanged. Evidence index and LogQL documentation were checked and already consistent, so they were not edited.
- **Git state at sync:** branch `main`; current HEAD=`3ff709cee127ce763ee45fa7477e3b8372d8318a`; worktree was clean before documentation edits and is now dirty with documentation-only changes. No documentation-sync commit was created.
- **Immutable refs verified:** `base-app=aa0d39222eddec12c41e7379550952ee83085a5e`; `commit-1-nginx=d179090de811925ee6b505311edb5c956fea4b98`; `commit-2-monitoring=7502aa7f067f99f6b976bc553bdc021b79561f48`; `commit-3-logging=3ff709cee127ce763ee45fa7477e3b8372d8318a`. Historical support commits remain `5743031f9c39a3960a87d40e92cb7eef5d9e40eb` and `25944eae9dd7546c31c2083f1e3b0400d43919f8`; neither is current HEAD.
- **Status preserved:** CP0, CP1a, CP2, CP3, CP4 technical and CP5 remain PASS. YC6/CP6 and YC7/CP7 have not run. YC4 final evidence still lacks RQ4-02, RQ4-03 and RQ4-04. RQ5-01…RQ5-05 remain captured; RQ5-06 remains optional.
- **Validation:** source docs, evidence index and LogQL state were cross-checked. Git tags and hashes were inspected before edits. No runtime tests were run because this prompt is documentation-only. No tag movement, amend, rebase, or push occurred.
- **Result:** Documentation sync is in progress/uncommitted; no CP6 result is claimed. Current HEAD remains `3ff709cee127ce763ee45fa7477e3b8372d8318a`.

## 2026-10-06 — YC6 / CP6 Runtime PASS and Commit 4

- **PHASE / PROMPT:** PROMPT 7 — YC6 / HARDENING → COMMIT 4.
- **Ngày giờ:** 2026-10-06 02:18:00 +07:00.
- **Người thực hiện:** AI Assistant / Pair Programming.
- **Checkpoint trước:** CP5 PASS, Commit 3 (`3ff709c`), tag `commit-3-logging`, support commit `32555a6` (`docs: sync project state before CP6`).
- **Checkpoint sau:** CP6 PASS, Commit 4, tag `hardening`.

- **Mục tiêu:**
  Thực hiện toàn diện các biện pháp bảo mật và kiểm định runtime H1–H6 theo Design Freeze:
  - H1: Non-root container runtime và các ngoại lệ được phê duyệt.
  - H2: Cô lập network (5 network, internal flags, membership, không publish cổng nội bộ).
  - H3: Mật khẩu mạnh, không secret trong Git, `.env` bị ignore, từ chối default credentials.
  - H4: Least privilege DB trên PostgreSQL (`billing_app` cấm DDL/UPDATE/DELETE payments, `billing_readonly` chỉ SELECT, `exporter` trong `pg_monitor`).
  - H5: TLS 1.2/1.3 + đủ 6 security headers + `server_tokens off`.
  - H6: Không publish cổng nội bộ ra host.
  - H11: Nginx login rate limit 5r/m (HTTP 429).
  - H12: Ghim toàn bộ image version, không dùng tag `latest`.
  - Tự động hóa kiểm thử bằng `scripts/verify-hardening.ps1` và `scripts/verify-hardening.sh`.
  - Hồi quy toàn diện E2E nghiệp vụ, pgAdmin, Prometheus targets và LogQL.

- **Đã kiểm tra trước:**
  - `git status`: working tree clean tại HEAD `32555a660f874624c20817e34cab9e37f1b26859`.
  - `docker compose ps`: toàn bộ 12 service đang chạy ổn định.
  - Không có patch chưa kiểm thử nào trong `docker-compose.yml`.

- **Đã thực hiện:**
  1. H1 Runtime Verification:
     - `web`: `uid=1000(node)` (non-root).
     - `postgres`: các process DB chạy với `UID 999 (postgres)`.
     - `nginx`: `uid=101(nginx)` (unprivileged).
     - `grafana`: `uid=472(grafana)`.
     - `prometheus`: `uid=65534(nobody)`.
     - `loki`: `10001` (non-root distroless).
     - `pgadmin`: `uid=5050(pgadmin)`.
     - `node-exporter` & `postgres-exporter`: `uid=65534(nobody)`.
     - `nginx-exporter`: `1001:1001`.
     - Ngoại lệ được chấp thuận: `cadvisor` (`privileged: true`) và `promtail` (mount `docker.sock`).
  2. H2 Network Isolation:
     - Đầy đủ 5 network: `billing_edge_net` (false), `billing_admin_net` (false), `billing_app_net` (true), `billing_db_net` (true), `billing_monitoring_net` (true).
     - `postgres` chỉ nằm trong `db_net`; `nginx` hoàn toàn tách biệt khỏi `db_net`.
     - `web` không publish cổng sau Commit 1; `admin_net` tách biệt công cụ quản trị khỏi web và db.
  3. H3 Credentials & Secrets:
     - `git ls-files .env` trả về rỗng; `.env` được ignore bởi `.gitignore:2:.env`.
     - `git ls-files .env.example` tồn tại và chỉ chứa placeholder.
     - Đăng nhập Grafana với default `admin/admin` trả về `401 Unauthorized`.
     - Kết nối PostgreSQL qua mạng với default `postgres/postgres` bị từ chối xác thực SCRAM-SHA-256.
  4. H4 PostgreSQL Least Privilege:
     - Chạy kiểm thử trực tiếp bên trong `db_net` qua `psql`:
       - `billing_app` thử `DROP TABLE payments`: `ERROR: must be owner of table payments` (BỊ CHẶN).
       - `billing_app` thử `CREATE TABLE test`: `ERROR: permission denied for schema public` (BỊ CHẶN).
       - `billing_app` thử `UPDATE payments`: `ERROR: permission denied for table payments` (BỊ CHẶN - bảo toàn append-only).
       - `billing_app` thử `DELETE FROM payments`: `ERROR: permission denied for table payments` (BỊ CHẶN).
       - `billing_readonly` truy vấn `SELECT count(*) FROM invoices`: Thành công (329 rows).
       - `billing_readonly` thử `INSERT INTO customers`: `ERROR: permission denied for table customers` (BỊ CHẶN).
       - `billing_readonly` thử `UPDATE customers`: `ERROR: permission denied for table customers` (BỊ CHẶN).
       - `billing_readonly` thử `DELETE FROM customers`: `ERROR: permission denied for table customers` (BỊ CHẶN).
       - `billing_readonly` thử `SELECT * FROM users`: `ERROR: permission denied for table users` (BỊ CHẶN).
       - Role `exporter` thuộc nhóm `pg_monitor`; target `postgres` UP trên Prometheus.
  5. H5 Security Headers & TLS:
     - `curl.exe -k -I https://localhost`: Đầy đủ 6 header (`Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`).
     - `Server: nginx` không lộ số phiên bản (`server_tokens off`).
     - Bắt tay thành công với cả `TLSv1.2` và `TLSv1.3`.
  6. H6 Port Exposure:
     - Chỉ Nginx publish `0.0.0.0:80/443`.
     - pgAdmin, Grafana, Prometheus chỉ bind loopback `127.0.0.1`.
     - `web`, `postgres`, `loki`, `cadvisor`, exporters hoàn toàn không publish cổng ra host.
  7. H11 Rate Limiting:
     - Gửi 12 request liên tiếp tới `/api/auth/login` → 6 request đầu được xử lý, từ request thứ 7 trả về HTTP 429 Too Many Requests.
  8. Tự động hóa kiểm thử:
     - Xây dựng `scripts/verify-hardening.ps1` và `scripts/verify-hardening.sh`.
     - Chạy script kiểm tra thực tế: Tất cả các kiểm tra H1–H6 đều PASS (100% OK).
  9. Sinh minh chứng:
     - Tạo 6 ảnh terminal/card evidence tại `docs/evidence/`: `RQ6-01-non-root-execution.png`, `RQ6-02-network-isolation.png`, `RQ6-03-credentials-and-git.png`, `RQ6-04-db-least-privilege.png`, `RQ6-05-port-exposure.png`, `RQ6-06-verify-hardening.png`.

- **File đã tạo:**
  - `scripts/verify-hardening.ps1`
  - `scripts/verify-hardening.sh`
  - `docs/evidence/RQ6-01-non-root-execution.png`
  - `docs/evidence/RQ6-02-network-isolation.png`
  - `docs/evidence/RQ6-03-credentials-and-git.png`
  - `docs/evidence/RQ6-04-db-least-privilege.png`
  - `docs/evidence/RQ6-05-port-exposure.png`
  - `docs/evidence/RQ6-06-verify-hardening.png`

- **File đã sửa:**
  - `docs/evidence/README.md` (bổ sung YC6 evidence và ID map).
  - `README.md` (cập nhật trạng thái CP6 PASS, hướng dẫn chạy verify-hardening).
  - `FILEmd/billing_deployment_roadmap_2.md` (check off CP6 checklist, cập nhật rubric và kết luận).
  - `docs/AI_EXECUTION_HISTORY.md` (append mục CP6).

- **File đã xóa:** NONE.

- **Thay đổi quan trọng:**
  - Hệ thống đạt 100% các tiêu chí bảo mật H1–H6 mà không cần thay đổi file `docker-compose.yml` (kiến trúc ban đầu đã được thiết kế sẵn sàng).
  - Tạo bộ công cụ kiểm thử tự động `verify-hardening` cho cả môi trường PowerShell và Bash.
  - Bổ sung trọn vẹn bộ ảnh minh chứng RQ6-01..RQ6-06.

- **Test đã chạy:**
  - `scripts/verify-hardening.ps1`: PASS toàn bộ H1–H6.
  - `scripts/cp2-smoke.mjs` qua HTTPS: PASS 15/15 nhóm kiểm thử nghiệp vụ (p95 = 22.57 ms).
  - Prometheus targets: 6/6 UP.
  - Grafana health: `database: ok`.
  - Loki readiness: `ready`.

- **Regression:**
  - YC2–YC5 hoạt động hoàn toàn bình thường, không suy giảm hiệu năng hay lỗi cấu hình.

- **Evidence:**
  - `docs/evidence/RQ6-01-non-root-execution.png`
  - `docs/evidence/RQ6-02-network-isolation.png`
  - `docs/evidence/RQ6-03-credentials-and-git.png`
  - `docs/evidence/RQ6-04-db-least-privilege.png`
  - `docs/evidence/RQ6-05-port-exposure.png`
  - `docs/evidence/RQ6-06-verify-hardening.png`

- **Commit:** `security: harden containers, networks, credentials and database roles`
- **Tag:** `hardening`

- **NGOÀI ROADMAP:** NONE.

- **Kết luận:** CP6 = PASS.
- **Checkpoint tiếp theo:** CP-Final / YC1 Final (README hoàn thiện, clean clone, push tags).

