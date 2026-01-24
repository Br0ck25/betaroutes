# Staging Runbook — Storage Key Migration

Purpose: Step-by-step instructions to run a small _staging_ dry-run cohort and safe apply batches for the Storage Key Migration. Follow `AI_AGENTS.md` and `SECURITY.md` (security-first) — do not proceed without checks.

Preconditions

- You must be an **admin** user and have appropriate access to staging environment KVs and DOs.

**Granting admin via ops script (if you are not admin)**

If you are not currently an admin, a scoped ops script `tools/grant-admin.js` can safely grant `role: 'admin'` on the canonical user core in the USERS KV. This script is dry-run by default and requires explicit `--apply` and confirmation to perform any writes.

Prerequisites (production example):

- CLOUDFLARE_ACCOUNT_ID — your account id
- CLOUDFLARE_API_TOKEN — API token with KV write permissions (ops use only)
- USERS_KV_ID — the namespace id for the `BETA_USERS_KV` binding in production
- MIGRATIONS_KV_ID — the namespace id for `BETA_MIGRATIONS_KV` (audit writes)

Example (dry-run):

CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... USERS_KV_ID=... MIGRATIONS_KV_ID=... node tools/grant-admin.js --env=production --userId=0d9df646-f89b-4ea8-ae70-f5d3bf3de322

Apply (requires confirmation and an explicit actor):

CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... USERS_KV_ID=... MIGRATIONS_KV_ID=... node tools/grant-admin.js --env=production --userId=0d9df646-f89b-4ea8-ae70-f5d3bf3de322 --apply --actor "your.name@example.com"

Verification (after apply):

- Call the admin status endpoint with your session cookie:

  curl -X POST https://staging.example.com/api/admin/migration/status \
   -H "Content-Type: application/json" \
   -H "Cookie: session_id=..." \
   -d '{"users":["0d9df646-f89b-4ea8-ae70-f5d3bf3de322"]}'

- A successful response should return `results` for your user; if you see 403, check that the user core contains `"role":"admin"`.

Security notes: Do NOT run the grant script with an insufficiently scoped API token; record the operator identity in `--actor` so the action is auditable.

- Ensure `npm run check` and `npm run lint` pass locally and in CI.
- Confirm GitHub Actions `E2E Migration Tests` job is passing for the branch.
- Take full snapshot/backups of staging KVs (or export JSON). Do not skip this step.

Terminology

- Dry-run: Simulation mode; `apply: false` (default) — returns counts and state without copying data.
- Apply: `apply: true` — perform actual copies to ID-prefixed keys; idempotent and cautious (skips new keys).

1. Prepare environment

- Ensure staging env bindings exist and are correct:
  - `BETA_LOGS_KV`, `BETA_MIGRATIONS_KV`, `BETA_TRASH_KV`, `BETA_EXPENSES_KV`, `TRIP_INDEX_DO`.
- Take KV snapshot: (team ops command; example)
  - `node tools/kv-snapshot.js --env=staging --out=snapshots/pre-migration-$(date +%F).json`

2. Validate admin status endpoint for sample users

- Use `POST /api/admin/migration/status` with admin session or API token
- Example curl (replace AUTH headers with your session):

  curl -X POST https://staging.example.com/api/admin/migration/status \
   -H "Content-Type: application/json" \
   -H "Cookie: session_id=..." \
   -d '{"users":["exists","11111111-1111-4111-8111-111111111111"]}'

- Confirm response contains `trip_legacy`, `trash_legacy`, and any `migrationState`/`doMigrationState`.

3. Dry-run cohort (10-50 users)

- Build a small list of representative staging users (varying data shapes and sizes).
- For each batch (e.g., 10 users):
  - POST dry-run: `POST /api/admin/migration` with `{ users: [...], apply: false }`.
  - Verify dry-run response: relevant `migrated` counts and `done` flags.
  - Check `BETA_MIGRATIONS_KV` keys: `migration:{userId}:state` updated with lastRun and stats.
  - Check audit entries: look for `storage_migration` events logged using `logAdminAction` behavior.
  - If any user shows suspicious counts or errors: stop and investigate.

    3.a Auto-migration on login (conservative)

- We have implemented a conservative, auditable auto-migration path that can be enabled via environment variable `MIGRATION_AUTO_ON_LOGIN=true`.
- The auto-migration is designed to be safe-by-default and runs only for a targeted user ID (set by `MIGRATION_AUTO_ON_LOGIN_UID` or defaulting to the current test user `cd29a839-4167-4f79-bf3f-ed63daaa7352` in staging).

How it works:

- Trigger: scheduled in background via `platform.context.waitUntil()` on successful login (does not block login response).
- Guards:
  - Feature flag must be enabled (`MIGRATION_AUTO_ON_LOGIN=true`).
  - Only runs for the targeted user (UID default: `cd29a839-4167-4f79-bf3f-ed63daaa7352`).
  - Per-user rate-limit: the system records `migration:{userId}:auto:lastAttempt` and will not re-run if last attempt was within `rateLimitHours` (default 24h).
  - Threshold: auto-apply will only run if the user's trip count (KV key `meta:user:{userId}:trip_count`) is below the configured threshold (default 500 trips).
  - If `migration:{userId}:state` indicates `done`, auto-run is skipped.
- Behavior:
  - Uses `runBatchedMigration(..., { apply: true, batchLimit: 500, maxIterations: 10 })` for a bounded, idempotent apply.
  - Persists summarized migration state to `migration:{userId}:state` and records the attempt timestamp in `migration:{userId}:auto:lastAttempt`.
  - Emits an audit event (`action: 'auto_migration'`, `actor: 'system:auto'`) to `BETA_MIGRATIONS_KV` with success/failure details.

Why this was added:

- Operator requested an automated path for the verified staging user to avoid manual cohort runs during testing. This automated path is intentionally conservative (flag-gated, rate-limited, size-limited, auditable) and is intended for controlled, incremental rollout.

Code changes (files):

- `src/routes/login/+server.ts` — replaced the ad-hoc background dry-run with a feature-flag check and a scheduled call to `autoMigrateOnLogin`.
- `src/lib/server/migration/storage-key-migration.ts` — added `export async function autoMigrateOnLogin(...)` (top-level helper) which performs guard checks, calls `runBatchedMigration`, persists state, and logs audit events.

Validation & testing:

- Unit tests added for `autoMigrateOnLogin` to validate gating, rate-limiting, threshold behavior, and successful persist/audit flows.
- Login route tests updated to assert that `platform.context.waitUntil` is scheduled when the flag is enabled and the user ID matches.

Operational notes:

- Keep `MIGRATION_AUTO_ON_LOGIN` OFF in production unless explicitly authorized by ops + security. For now enable only in staging for the targeted UID.
- If the auto-run detects a user above the threshold it will record a last attempt timestamp and emit an audit event; follow runbook steps to evaluate and consider a manual apply for that user.

4. DO Index check / repair

- For users with DO inconsistencies, call `repairDOIndex` via admin endpoint or run `migrateDOIndex(..., apply: true)` for the user.
- Verify DO `list` matches KV meta `meta:user:{userId}:trip_count`.

5. Apply small batch (5-20 users) — manual and audited

- If dry-run cohort is successful and alerts are green, run `POST /api/admin/migration` with `{ users: [...], apply: true }` for a small batch.
- After apply, verify:
  - Keys exist under canonical `trip:{userId}:...` prefixes.
  - No overwrites of newer ID-keyed records (migration should have skipped newer destination keys).
  - `BETA_MIGRATIONS_KV` shows the migration completed: `{ done: true, migrated: N }`.
  - Audit logs contain `storage_migration` success events.
- Monitor metrics for 30–60 minutes for any application errors or elevated failure rates.

6. Verification & acceptance

- Acceptance criteria to continue Rolling / Larger Apply:
  - Dry-run vs apply counts match expected values (within tolerance).
  - `migration.failure_rate < 1%` for cohort.
  - DO index consistent with KV metadata for users tested.
  - No P0/P1 incidents in logs or errors in telemetry.

7. Rollback — immediate actions if anomalies detected

- Stop all apply runs and notify on-call.
- Revert state by restoring KV snapshots (procedural; requires ops). Document snapshot used and reason.
- If partial apply occurred, consult `BETA_MIGRATIONS_KV` audit log to identify affected users and re-run dry-run for diagnostics.

8. Post-apply cleanup (after waiting window and verifying stability)

- Schedule final cleanup PR + removal of `getLegacyStorageId()` and dual-read code after N days (90 suggested) and after 95% coverage.
- Ensure runbook and docs are updated with lessons learned.

Appendix: Helpful commands

- Clear E2E mock before local E2E runs: `node tools/clear-kv-mock.js`
- Run E2E tests: `npm run pretest:e2e && npm run test:e2e`
- Example dry-run via local proxy (replace host and auth):
  curl -X POST http://localhost:5173/api/admin/migration -H "Content-Type: application/json" -d '{"users":["exists"], "apply": false}' -b "session_id=..."

Contact: ping @ops and @security on Slack if any unexpected behavior is observed.

---

Please follow these steps in order and stop at any verification failure — escalate to security and on-call ops if failure indicates data loss, incorrect ownership checks, or broken DO indexing.
