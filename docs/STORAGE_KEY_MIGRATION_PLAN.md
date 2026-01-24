# Storage Key Migration Plan

**Status:** Planning (Priority: P0 - Critical security fix)

**Purpose:** Document a controlled, auditable migration from legacy username/token-based KV keys to canonical user ID-based keys. This file consolidates the vulnerability, proposed code changes, phased migration plan, tests, rollout checklist, monitoring, rollback, and timelines.

---

## 1) Executive summary ✅

- Problem: `getStorageId()` currently returns `user.name || user.id || user.token || ''`. Using `name` or `token` as part of KV key spaces enables account takeover (ATO) via username collisions or session token reuse.
- Immediate security fix: Change `getStorageId()` to return only `user.id || ''` and add a deprecated `getLegacyStorageId()` to help dual-read during migration.
- Migration objective: Ensure no data loss, maintain app availability, and migrate all legacy keys to ID-based prefixes in a staged, observable manner.

---

## 2) Critical immediate code change (non-breaking, small PR)

File: `src/lib/server/user.ts`

Current implementation (vulnerable):

```ts
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.name || user.id || user.token || '';
}
```

Proposed immediate change (security fix):

```ts
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// SECURITY FIX: Only use immutable user ID for storage keying
	return user.id || '';
}

/**
 * @deprecated Migration helper - read-only fallback for legacy keys
 * Used only during migration to locate legacy records keyed by username or token.
 */
export function getLegacyStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.name || user.id || user.token || '';
}
```

Rationale: `id` is immutable and unambiguous (UUID). Names and tokens are unsafe for keying sensitive user data.

---

## 3) Files impacted and proposed code-level changes (audit & plan)

Note: The changes below are design-level and **do not** modify production writes; writes remain ID-based.

### High-priority server services

- `src/lib/server/tripService.ts`
  - Reads: modify `get()`, `list()`, `listFromKV()` and `listTrash()` to support _dual-read_ (ID-prefix first, then legacy-name prefix if present).
  - If a legacy key is found, **schedule** non-blocking migration (idempotent) or mark migration status to migrate record to ID-key.
  - Writes (`put`, `delete`): always write to `trip:${trip.userId}:${trip.id}` (ID canonical form) — no change required.

- `src/lib/server/expenseService.ts` and `src/lib/server/mileageService.ts`
  - Apply same dual-read pattern and migration trigger for `list`, `get`, and `listTrash`.

### Routes / Loaders / API endpoints

- `src/routes/api/trash/+server.ts` and `src/routes/api/trash/[id]/+server.ts`
  - Continue to call `getStorageId(user)` for canonical ID read (after fix this returns id only).
  - For listing, pass `user.name` (from `locals.user`) where services expect an optional legacyName argument.

- Dashboard server loads:
  - `src/routes/dashboard/expenses/+page.server.ts`
  - `src/routes/dashboard/mileage/+page.server.ts`
  - Keep `event.locals.user.name` available (hooks already does this); pass it to services for legacy reads during migration.

- `src/routes/api/hughesnet/+server.ts` and HNS routes
  - Replace instances of `user?.name || user?.token || user?.id` with `user.id` for canonical storage.
  - Add optional `legacyName` parameter to HNS reads and migration logic for `hns:settings:${legacyName}` etc.

### Authentication & hooks

- `src/hooks.server.ts`
  - Ensure `event.locals.user` continues to include `name` (already present). This is required for dual-read and to trigger migration safely on login.

- `src/routes/login/+server.ts`
  - After successful login, **trigger background migration** via `platform.context.waitUntil(migrateUserStorageKeys(env, id, name))` (non-blocking). Add logging and tolerate errors.

### User service and cleanup

- `src/lib/server/userService.ts`
  - Add per-user migration status tracking (e.g. `migration.storageKeysMigrated: boolean`, `migratedAt`, `recordsMigrated`).
  - Ensure `deleteUser()` wipes both username and ID prefixed data until cleanup is complete (existing code already wipes both prefixes in places; keep/instrument it).

### Client side (Svelte files)

Many Svelte files use `$user?.name || $user?.token || localStorage.getItem('offline_user_id')`. Plan to:

- Prefer `$user?.id` on the client for local offline keying where possible.
- Add a localStorage migration helper to rename old `offline_user_id` entries and ensure local offline data is reconciled with server ID after migration.
- Avoid relying on client-provided username for server authorization.

(See occurrences using `grep` and handle gradually.)

---

## 4) Migration implementation details

Create: `src/lib/server/migration/storage-key-migration.ts` (idempotent, safe)

Key functions:

- `migrateUserStorageKeys(env, userId, userName)`
  - For each namespace (trips, expenses, mileage, trash, HNS, settings), list legacy prefix `prefix:{userName}:` and copy entries to `prefix:{userId}:` preserving value, metadata, TTL, and tombstone flags. For `settings` use the `BETA_USER_SETTINGS_KV` binding and migrate `settings:{userName}` → `settings:{userId}` when the destination key does not already exist.
  - For trash items, update `metadata.originalKey` if it references `:${userName}:` to `:${userId}:`.
  - For HNS: migrate `hns:settings:${userName}` → `hns:settings:${userId}` and update `hns:order:*` ownerId fields if necessary.
  - Use small batches (e.g., BATCH_SIZE=100) and avoid memory accumulation.
  - Use `kv.getWithMetadata()` where supported to preserve metadata.
  - Always check if new key exists; skip and log if so (avoids overwriting newer data).
  - Maintain an operation log and return migration counts and any error list.

- Idempotency rules:
  - If new key exists and is newer (`updatedAt` compare) skip copying.
  - Do not copy if entry is identical.
  - If legacy key deleted after copy, it's safe to `kv.delete(oldKey)` during migration step or later cleanup.

Trigger:

- Non-blocking, on successful login: `platform.context.waitUntil(migrateUserStorageKeys(env, user.id, user.name))`.
- Also provide an admin-run bulk migration (throttled) for dormant users.

Progress tracking:

- Store per-user migration state in `BETA_USERS_KV` (or in `userCore` as a small `migration` object), and in a central migration log `BETA_MIGRATIONS_KV` for observability.

---

## 5) Tests and verification plan

Unit tests:

- `getStorageId()` returns `id` only, `getLegacyStorageId()` returns fallback values.
- Service dual-read behavior: when `trip:${userId}:tripId` missing but `trip:${userName}:tripId` exists, the `get()` and `list()` return record and schedule migration.
  - IMPLEMENTED: Unit tests added (`src/lib/server/tripService.spec.ts`) validating dual-read `list()` merge and `get()` legacy fallback + normalization.
- Migration utility unit tests: copy, preserve metadata, maintain tombstone semantics, do not overwrite newer items.
- Reversion-loop regression test: simulate migrating a legacy record (value has `userId === userName` and legacy HNS `id`) and then performing a `put()`; assert no writes occur back to legacy `trip:{userName}:...` keys and the final persisted record exists at `trip:{userId}:{expectedId}`.
- Tombstone deep-update test: create a tombstone under `trip:{username}:{id}` whose `backup.userId === username` and `backup.id` contains legacy HNS id, run the migration, call `restore()` and assert the restored trip exists only under `trip:{userId}:{id}` and that no legacy `trip:{username}:{id}` was created as a result of the restore.

Integration tests (mock KV/DO):

- Simulate a user with username-keyed data and confirm login triggers migration and data becomes accessible under ID prefix.
- Confirm no data loss when items are modified during migration (compare `updatedAt` logic).
- Added integration tests that exercise the full KV → DO flow using the dev Durable Object stub (`src/lib/server/migration/storage-key-migration.integration.spec.ts`). These tests validate `migrateDOIndex(...)` apply behavior and `repairDOIndex(...)` triggering, and use `setupMockKV` to simulate the DO sqlite persistence.
- Added an end-to-end (E2E) integration test (`src/lib/server/migration/storage-key-migration.e2e.spec.ts`) that:
  - Seeds legacy username-keyed records (`trip:{username}:...`) in `BETA_LOGS_KV`,
  - Runs `migrateUserStorageKeys(..., apply: true)` to migrate to `trip:{userId}:...`,
  - Runs `migrateDOIndex(..., apply: true)` to populate the `TripIndex` durable object, and
  - Asserts final KV and DO state (keys moved, DO summaries persisted).

- Migration observability: per-user migration state is now persisted (best-effort) in `BETA_MIGRATIONS_KV` using keys:
  - `migration:{userId}:state` — overall storage-key migration state (lastRun, migrated, done, errors)
  - `migration:{userId}:do:state` — DO migration state (lastRun, migrated, done, error)
- Audit logging: migration operations now emit an **audit event** (via `logAdminAction`) to the migrations KV to provide an immutable admin/audit trail for compliance and incident response. Events logged:
  - `storage_migration` — success/failure for per-user storage migration runs
  - `do_migration` — success/failure for DO index migrations
    These are append-only monthly logs and are intended for security auditing (see `src/lib/server/auditLog.ts`).

- Admin endpoint improvements (`POST /api/admin/migration`): when `apply=true` the endpoint will attempt a DO repair and **returns**:
  - `migrationState` and `doMigrationState` (if present in `BETA_MIGRATIONS_KV`), and
  - `doRepair` result (output of `repairDOIndex`) so admins can see if DO repair completed or is needed.

- New admin status endpoint (`POST /api/admin/migration/status`): returns per-user legacy key counts per namespace and persisted cursor/state from `BETA_MIGRATIONS_KV` for the supplied users. This supports cohort staging and provides quick visibility into how many legacy keys remain prior to applying migration for a given user. The endpoint is admin-only and relies on KV list+cursor behavior to avoid scanning the entire keyspace.

- CI + test hygiene: Add an E2E test job that runs integration/E2E migration tests in a fresh workspace to ensure `.kv-mock.json` isolation. Implementation details in repo:
  - `tools/clear-kv-mock.js` — helper script that removes `.kv-mock.json` before E2E runs to ensure isolation.
  - `package.json` scripts: `pretest:e2e` runs the clear helper and `test:e2e` runs E2E tests (`vitest run src/lib/server/migration/*.e2e.spec.ts`).
  - Add `test:e2e` to CI to run in a clean runner (no persisted `.kv-mock.json`) before merging apply-mode changes.

#### CI job: GitHub Actions — E2E Migration Tests (recommended)

Add the following workflow to `.github/workflows/test-e2e.yml` (already added to this repository): it ensures E2E tests run in a single, isolated job and clears the `.kv-mock.json` state before and after the run.

```yaml
name: E2E Migration Tests

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  e2e-migration-tests:
    name: Migration E2E Tests (isolated)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Ensure clean KV mock
        run: node tools/clear-kv-mock.js

      - name: Run E2E migration tests
        run: |
          npm run pretest:e2e
          npm run test:e2e
        env:
          CI: true

      - name: Cleanup KV mock (best-effort)
        if: always()
        run: node tools/clear-kv-mock.js
```

Notes and rationale (security & governance):

- Security & isolation: per `SECURITY.md`, never persist test artifacts or mocks across runs. Clearing `.kv-mock.json` prevents stale state and accidentally leaking sensitive samples.
- Governance: `AI_AGENTS.md` and repo mode instructions emphasize staged validate-before-apply procedures; this job enforces that E2E migration tests pass in a clean runner before apply-mode changes are merged.
- Operational safety: the workflow runs tests only and does not perform apply-mode migrations automatically. Apply actions remain operator-triggered.

Action item: Configure the repository to require `E2E Migration Tests` for PRs that change migration code or introduce apply-mode automation.

- Rationale: the status endpoint provides low-cost, actionable counts for operators to build small apply cohorts (e.g., 50 users/day) and verify migration progress in staging before broader apply.

E2E test:

- Create a user with legacy username-keyed data, login, wait for background migration, then verify that the UI shows the data from ID-based keys and legacy keys are either removed or flagged as migrated.

Metrics to assert:

- migratedItems > 0 for a migrated account
- No 500/503 spike during migration runs

---

## 6) Rollout & timeline (recommended)

- Day 0: Merge small PR changing `getStorageId()` and adding `getLegacyStorageId()` with unit tests.
- Day 1-3: Deploy to staging; smoke tests; run migration on a small set of test accounts using admin tool.
- Day 4: Merge dual-read support into services (trip/expense/mileage) with tests.
- Day 5-7: Deploy dual-read to production; enable logging/telemetry; keep legacy reads enabled.
- Weeks 1–4: Trigger background migration on login; monitor `migrationSuccessRate`. Run targeted admin bulk migration for dormant accounts.
- After 90 days and 95%+ coverage: remove dual-read code and `getLegacyStorageId()` in a final cleanup PR.

---

## 7) Monitoring & telemetry 📊

- Migration success counter, errors counter, per-user migratedCount.
- Track number of legacy keys remaining per namespace (periodic job or admin endpoint).
- Alert on abnormal failure rates (>1% of migrations failing) or high error logs originating from migration utilities.
- Add audit log entries (`logAuditEvent('storage_migration', { userId, migrated, errors })`) for security compliance.

---

## 8) Rollback & failure modes (safety)

- If migration code causes an unexpected error: the operation runs non-blocking and logs errors; no writes are overwritten (we skip existing new keys).
- If dual-read causes regressions: revert the dual-read PR (reads return ID-only again and previous behavior restored).
- If data loss is detected (unlikely if idempotent checks used): halt migration, restore from backups/snapshot (KV snapshots or cold backup), and investigate the migration logs.

---

## 9) PR & QA checklist ✅

- [ ] All changes compile (`npm run check`) and lint clean (`npm run lint`, `npx eslint .`).
- [ ] Unit tests for `getStorageId()`, `getLegacyStorageId()` and dual-read behaviors.
- [ ] Unit + integration tests for tombstone deep-update and restore regression (ensure no legacy-key re-creation).
- [ ] Integration tests for migration utility using mocked KVs & DOs.
- [ ] E2E test that simulates login-triggered migration and verifies data availability & deduplication.
- [ ] Migration metrics & audit logging implemented.
- [ ] Documentation updated (`STORAGE_KEY_MIGRATION.md` and this plan file) and reviewed by security owner.
- [ ] Run migration on staging and verify; then roll to production in small stages.

---

## 10) Notes & governance constraints

- **Stop conditions:** If implementing changes causes >5 TypeScript/Svelte errors, stop and fix immediately. (See repository `modeInstructions`.)
- **Do not** migrate Svelte 4 files opportunistically — any UI changes that would migrate file versions must be approved separately.
- Preserve PWA offline behavior: ensure offline/localStorage data is reconciled and local migrations do not break existing offline sync logic.

---

## 11) Next steps (suggested immediate tasks)

1. Create a small PR to change `getStorageId()` and add `getLegacyStorageId()` plus unit tests (low risk, high value).
2. Implement dual-read prototype in `tripService` (read-only behavior) with tests and deploy to staging.
3. Create `src/lib/server/migration/storage-key-migration.ts` and write unit tests.
4. Add background trigger on login (use `platform.context.waitUntil`).
5. Add monitoring and schedule admin-run migration for dormant accounts.

**Status update:** ✅ An **admin migration endpoint** (`POST /api/admin/migration`) and a small CLI helper (`tools/admin-migrate.js`) were added to support dry-run and apply flows. The endpoint is protected to admin users and accepts `{ users: string[], apply?: boolean }`. The CLI posts to the endpoint and defaults to dry-run. Update: audit logging/metrics, the admin status endpoint (`POST /api/admin/migration/status`), DO repair helpers, integration tests, and the E2E CI workflow have been implemented and validated locally.

---

## 14) Production testing readiness checklist (must pass before production testing) ✅

Refer to `AI_AGENTS.md` and `SECURITY.md` for governance constraints — security and auditability take precedence over schedule. Complete the following before running production-like tests in staging:

- Code quality & tests
  - [ ] `npm run check` (svelte/TypeScript) passes with 0 errors.
  - [ ] `npm run lint` passes without actionable errors.
  - [ ] Unit, integration, and E2E tests pass locally and in CI (`npm run test`, `npm run test:e2e`).

- CI gating
  - [ ] Ensure `.github/workflows/test-e2e.yml` is present and passing on PRs touching migration code.
  - [ ] Add branch protection requiring the `E2E Migration Tests` workflow for PRs that change migration or apply-mode logic (see branch-protection sample below).

- Staging environment readiness
  - [ ] Staging bindings present and correct: `BETA_LOGS_KV`, `BETA_MIGRATIONS_KV`, `BETA_TRASH_KV`, `BETA_EXPENSES_KV`, `TRIP_INDEX_DO`, and any HNS KVs.
  - [ ] Backup/snapshot available for staging KVs; take snapshot before any apply runs.
  - [ ] Monitoring & alerting configured (migration success/failure counters, DO repair alerts).

- Operational tooling & observability
  - [ ] `POST /api/admin/migration/status` returns expected counts for sample users.
  - [ ] Audit events (`storage_migration`, `do_migration`) are recorded in `BETA_MIGRATIONS_KV` and accessible to ops.
  - [ ] Dashboard or short script available to surface per-user migrationState and doMigrationState.

- Dry-run verification (staging cohort)
  - [ ] Complete a dry-run cohort (10–50 users) and verify: dry-run counts match expected, no critical errors, audit logs generated, DO repair behaves correctly.
  - [ ] Confirm acceptance: `migratedItems > 0`, `migration.failure_rate < 1%`, and DO counts consistent with KV metadata.

- Apply readiness
  - [ ] Ops runbook exists and team is ready to manually trigger apply runs in small batches (5–20 users) with immediate monitoring.
  - [ ] Rollback plan and snapshots validated and documented.

**Branch-protection sample (admin action):**

- Require `E2E Migration Tests` workflow and `check` job to be green before merging PRs touching `src/lib/server/migration/**` or `src/routes/api/admin/migration/**`.

---

## 15) Staging runbook (detailed) — created as `docs/STORAGE_KEY_MIGRATION_STAGING_RUNBOOK.md` (operational)

A separate runbook file includes step-by-step commands, example curl samples for `POST /api/admin/migration` and `POST /api/admin/migration/status`, verification steps for KV & DO, monitoring checks, and rollback steps. Operators should follow this runbook exactly when running staging dry-runs and applies.

(See the new `docs/STORAGE_KEY_MIGRATION_STAGING_RUNBOOK.md` for the full runbook.)

---

## References

- `SECURITY_AUDIT_MASTER.md` (priority item 1)
- `STORAGE_KEY_MIGRATION.md` (existing migration draft)
- `src/lib/server/user.ts` (current `getStorageId()` code)

---

## 12) Data-at-rest encryption & PII handling 🔐

**Finding:** Current KV entries (trips, mileage, expenses, settings, sessions, and HughesNet keys) contain PII and sensitive tokens in plaintext (addresses, emails, free-text notes, session cookies, HNS credentials). This must be remediated as part of the migration to meet security goals.

### A. Sensitive data inventory (examples & types)

- Keys with user-based prefixes: `trip:{username}:{id}`, `mileage:{username}:{id}`, `expense:{username}:{id}` — records contain addresses, notes, descriptions, and other PII.
- Settings: `settings:{userId}` — contains default addresses, vehicles, and other user preferences that include personal data.
- Sessions: `sessions:{sessionId}` — stores user name/email and other fields; minimize exposure.
- HughesNet: `hns:settings:{username}`, `hns:session:{username}`, `hns:cred:{username}` — contain session cookies and credentials; treat as secret material.

> Note: For privacy & compliance we will avoid embedding plaintext examples in docs; migrator scripts will operate directly against KV with proper audit logs and retention controls.

### B. Goals

- Encrypt PII & sensitive fields at rest while keeping server-side functionality (authorized servers may decrypt for authenticated responses).
- Minimize searchable/plaintext indexes; where necessary, use hashed or deterministic cryptographic tokens instead of plaintext.
- Preserve tombstone, TTL, and metadata semantics during encryption migration.
- Ensure secrets/keys are managed via environment secrets (never committed to repo) and support key rotation.

### C. Encryption design (recommended)

- Use envelope encryption:
  - Generate a random per-record Data Encryption Key (DEK, 32 bytes) using `crypto.getRandomValues()`.
  - Encrypt sensitive payloads with AES-GCM-256 using a unique 12-byte IV per encryption.
  - Wrap (encrypt) the DEK with a Key Encryption Key (KEK) derived from a base secret stored as a Cloudflare secret (name: `STORAGE_KEY_KEK`, 32 bytes base64). Store wrapped DEK and key version with the record metadata.
- Storage schema (per-record): store encrypted fields as: `{ __enc: true, alg: 'AES-GCM', key_ver: 'v1', iv: '<b64>', data: '<b64>' }` or as an encrypted sub-object keyed by field name.
- Implement `src/lib/server/crypto.ts` with `encryptFields(obj, fields, env)` and `decryptFields(obj, fields, env)` helpers. Use Web Crypto (`crypto.subtle`) for portability to Workers runtime.
- Key rotation: support KEK versions and a background re-wrap job to re-encrypt DEKs when KEK is rotated.

### D. Fields to encrypt (initial list)

- Addresses: `startAddress`, `endAddress`, `stops[].address`, `destinations[]`.
- Notes/Free-text: `notes`, `description`, `maintenanceItems` entries that may contain PII.
- Session & auth: `sessions:{id}` payloads (store only minimal session fields; encrypt rest), `hns:session:*`, `hns:cred:*`.
- Settings: `settings:{userId}` JSON (default addresses, vehicles' owner info, etc.).
- Any field that may contain an email, phone, or physical address.

### E. Search & index strategy

- For features that require searching or deduplication (e.g., place autocomplete):
  - Keep non-sensitive derived data (normalized place keys, lat/lng) in separate index entries that do not contain raw addresses.
  - If equality checks are needed, store a SHA-256 hex digest of the plaintext (not reversible) as `address_hash` to support de-dup and equality checks without exposing addresses.
  - Avoid deterministic encryption for general-purpose search unless the security risk is acceptable and documented.

### F. Migration process (phases)

1. **Preparation**: Implement `crypto` helpers, unit tests, and add dual-write capability where new writes will write encrypted sensitive fields while reads decrypt on demand.
2. **Dual-write (safe writes)**: For a short period, writes put both an encrypted version of sensitive fields and a fallback plaintext (or keep plaintext only in staging). In production prefer encrypted-only from go-live for writes.
3. **Background migration**: Non-blocking worker that lists legacy keys and performs per-record encryption (idempotent). Skip records already marked encrypted or where the new key exists and is newer. Maintain progress in `BETA_MIGRATIONS_KV` and per-user migration flags.
4. **Verification**: Run sampling checks, unit/integration tests, and audit logs to ensure decrypted round-trip matches original (in staging), and that no plaintext remains in KV for migrated users.
5. **Cleanup**: Remove fallback plaintext storage, rotate KEK if needed, and finalize monitoring/alerts.

### G. HughesNet & external credentials

- Treat `hns:cred:*`, `hns:session:*` and any HNS cookies as secrets: encrypt them using the same envelope method.
- Re-evaluate whether storing raw HNS session cookies is necessary; if possible, switch to tokenized or short-lived session references.
- When migrating orders (where `ownerId` or owner references may be username), ensure ownerId updated to userId and any HNS secrets reencrypted.

### H. Sessions & user index changes

- `sessions:{sessionId}` should be minimized to include only `userId` and `session meta`. Avoid storing plaintext emails and names. If additional display data is needed for UX, fetch user data via `findUserById()` and decrypt server-side only.
- Indexes `idx:username:{username}` and `idx:email:{email}` can remain as mappings to userId but do not expose additional PII values.

### I. Logging & audit

- **Do not log** plaintext addresses, full emails, or credential blobs. Replace with `***REDACTED***` or log only `userId` and counts.
- Migration audit logs must not contain plaintext PII. Store counts, key versions, and success/failure status.

### J. Tests & verification for encryption

- Unit tests for `encryptFields`/`decryptFields` ensuring correct behavior and handling of missing keys.
- Key rotation tests to validate re-wrap and ability to decrypt with previous versions during the roll.
- Integration tests to simulate login-triggered migration and ensure UI still receives decrypted data for authenticated users only.

### K. Rollout & timeline alignment

- Fold encryption work into Phase 1/2 of the storage migration plan:
  - Day 0-3: Implement helpers and unit tests.
  - Day 4-10: Add dual-write and deploy to staging; smoke tests.
  - Day 11+: Run background encryption migration during Phase 2 login-triggered migrations.

### L. Backups & recovery

- Take KV snapshots before performing any bulk in-place encryption for easy rollback.
- Keep migration operations idempotent and write a safe re-run procedure.

---

## Appendix A — Key & record patterns (sanitized)

> The following are sanitized examples of the _types_ of KV records observed in the environment. Values are redacted to avoid committing PII to the repo.

- trip:{username}:{tripId}
  - Fields: id, userId, date, startAddress: `<REDACTED: address>`, endAddress: `<REDACTED: address>`, stops: [...], createdAt, updatedAt, netProfit, totalMiles

- mileage:{username}:{id}
  - Fields: id, tripId, userId, date, miles, reimbursement, notes: `<REDACTED: note>`

- expense:{username}:{id}
  - Fields: id, date, category, amount, description: `<REDACTED: description>`, userId

- settings:{userId}
  - Fields: defaultStartAddress: `<REDACTED: address>`, vehicles: [...]

- hns:settings:{username}
  - Contains numeric pay configuration and user-owned settings (must be migrated to `hns:settings:{userId}` and encrypted where appropriate)

- hns:session:{username}, hns:cred:{username}
  - Contain cookies and credential blobs — **treat as secrets** and encrypt.

---

_No production data is stored in this document. The migration scripts will operate directly against KV with appropriate audit and backup._

---

## 13) Simulated code audit — findings & file-by-file notes 🧭

**Summary of simulated run:**

- Observed legacy key patterns in the wild (as provided):
  - Trips: `trip:James:{tripId}` and `trip:James:hns_James_2025-09-24`
  - Mileage: `mileage:James:{id}` and `mileage:James:hns_James_2025-09-24`
  - Expenses: `expense:James:{id}`
  - HNS: `hns:settings:James`, `hns:session:James`, `hns:cred:James`
  - Indexes: `idx:username:james` -> user id (lowercased index)
  - Settings: `settings:{userId}` (already ID keyed)

This simulated audit logs specific change recommendations and edge cases per file to minimize risk during real migration.

---

### A. `src/lib/server/user.ts`

Findings:

- `getStorageId()` currently returns `user.name || user.id || user.token || ''` which is the root cause of ATO.
- Username index entries exist as `idx:username:{username.toLowerCase()}` mapping to userId. Also some KV records use display name capitalization (`James`).

Recommended actions (simulated changes):

- Replace `getStorageId()` with `return user.id || ''`.
- Add `getLegacyStorageId()` that returns `user.name || user.id || user.token || ''` (for read-only migration).
- Add helper `normalizeLegacyPrefixes(user)` that returns possible legacy prefixes to check (e.g., both `user.name` as-is and `user.name.toLowerCase()`), to handle capitalization and historical inconsistencies.

Edge cases:

- If `session` objects contain `session.name` that differs from canonical username index key (lowercased), migration must check both `trip:James:` and `trip:james:` prefixes.

---

### B. `src/lib/server/tripService.ts`

Findings from code inspection:

- `listFromKV(userId)` lists prefix `trip:${userId}:` only. It will miss legacy records under `trip:{username}:`.
- `delete`, `put`, and `incrementUserCounter` rely on `trip.userId` embedded in records and DO index operations.

Simulated change plan:

- Change `listFromKV(userId, legacyName?)` to:
  1. Build prefixes: `trip:${userId}:` plus, if legacyName, `trip:${legacyName}:` and `trip:${legacyName.toLowerCase()}:`.
  2. Call KV list for each prefix and merge keys (dedupe by id). If a key exists in both, prefer ID-prefixed item.
  3. For each legacy key found where a new-key counterpart does not exist, enqueue `migrateKVRecord(oldKey, newKey)` which:
     - Reads old value with metadata
     - If newKey doesn't exist or is older (compare updatedAt), write newKey with preserved metadata and then optionally delete oldKey after verifying write
     - Log the migration and increment per-user migrated counter
- Update `get(userId, tripId, legacyName?)` to try ID key first, then legacy keys; when legacy found, trigger `migrateKVRecord` and return the record.
- When migrating a trip record, also ensure DO index is updated by calling the TripIndexDO `/put` endpoint with the trip summary for the ID-based key and mark the index dirty appropriately if DO returns non-ok.

Tombstone handling:

- Must preserve `deleted` and `deletedAt` properties when copying tombstones. Do not GARBAGE collect legacy tombstones until migration progress completes and verification checks pass.

Concurrency:

- Use compare-and-swap via presence checks and `updatedAt` timestamps to avoid overwriting newer ID-based writes.

---

### C. `src/lib/server/expenseService.ts` & `src/lib/server/mileageService.ts`

Findings:

- Both services perform KV lists with prefix `expense:{userId}:` and `mileage:{userId}:` and self-heal into DOs.
- They also rely on `backup` tombstone semantics.

Simulated changes:

- Implement dual-read in `list`, `get`, `listTrash` similar to `tripService`.
- In `put`/`delete`, continue to write to `prefix:${record.userId}:` only.
- Add migration hook to call `migrateKVRecord` for each legacy item discovered during reads.

---

### D. `src/routes/api/trash/+server.ts` & `src/routes/api/trash/[id]/+server.ts`

Findings:

- Uses `getStorageId(currentUser)` which will become ID-only; listing relies on service implementations.

Simulated change:

- When constructing the storage id for service calls, pass `currentUser.name` as `legacyName` so services can perform dual-read.
- Ensure the endpoint returns consistent results and does not leak other users' data when legacyName matches a common display name.

---

### E. `src/routes/api/hughesnet/+server.ts` and HNS routes

Findings:

- Several places set `const userId = user?.name || user?.token || user?.id || 'default_user'` (explicitly vulnerable).
- HNS data keys and HNS trip IDs embed usernames (`hns_James_2025-09-24`).

Simulated changes & caveats:

- Stop deriving `userId` from `name` or `token`; use `user.id` as canonical storage owner.
- Add `legacyName` parameter for reads and migration operations for `hns:settings`, `hns:session`, `hns:cred`, `hns:db`.
- Migrate `hns:settings:{username}` → `hns:settings:{userId}` and `hns:session:{username}` → encrypted `hns:session:{userId}`.
- For HNS trip IDs that literally contain the username, avoid renaming IDs unless references can be updated; instead keep the `id` field as-is and store the record under `trip:{userId}:{hns_James_...}`.

Security:

- Treat `hns:session` and `hns:cred` as secrets and apply envelope encryption as documented in Sec 12.

---

### F. `src/lib/server/userService.ts` (delete / indexing / migration state)

Findings:

- `deleteUser()` already wipes both `trip:${user.username}:` and `trip:${userId}:` — good.
- DO wipe uses `tripIndexDO.idFromName(user.username)` and assumes username-based DO instance names.

Simulated improvements:

- After migration, also call `tripIndexDO.get(tripIndexDO.idFromName(user.id))` and wipe it, to handle DO instances created under user.id during migration.
- Add per-user migration status object (e.g., `migration.storageKeysMigrated`, `migratedAt`, `recordsMigrated`) in the user core or separate `BETA_MIGRATIONS_KV` to avoid retriggering repeated migrations.

---

### G. `src/hooks.server.ts` & `src/routes/login/+server.ts`

Findings:

- `hooks.server.ts` already populates `event.locals.user` with `name` and `id`. Good for migration.

Simulated change & lockouts:

- On login success, schedule `migrateUserStorageKeys(env, user.id, user.name)` via `platform.context.waitUntil`, but only if `migration.storageKeysMigrated` is false or last attempt was > 7 days ago (throttle).
- Avoid migrating on every worker instance; use a central per-user flag to prevent duplicate concurrent migrations.

---

### H. Client-side Svelte files & offline storage

Findings (grep results): many components rely on `$user?.name || $user?.token || localStorage.getItem('offline_user_id')` for offline keys.
Files observed include:

- `src/routes/dashboard/trips/+page.svelte`
- `src/routes/dashboard/trips/new/+page.svelte` and edit page
- `src/routes/dashboard/mileage/+page.svelte` and new page
- `src/routes/dashboard/settings/components/DataCard.svelte`
- `src/routes/dashboard/hughesnet/+page.svelte`

Simulated migration steps (client):

- Update components to prefer `$user?.id` for offline keying.
- Add a safe local migration helper to scan localStorage for legacy keys like `offline_user_id` and remap them to new `offline_user_id_v2:{userId}` while preserving data after verifying via server-side GETs.
- Add UI telemetry to surface if local data cannot be reconciled (so support can intervene).

Edge case:

- Local devices offline for long periods may have legacy-keyed records; the client should include the legacy name when syncing to allow server dual-read until the device's data has been reconciled and migrated.

---

### I. Index & case-sensitivity issues

Findings:

- Username index keys are lowercased (`idx:username:james`) but KV legacy records may have capitalized usernames (`trip:James:`).
- Migration functions must check multiple legacy variants (`name`, `name.toLowerCase()`) to be comprehensive.

Recommendation:

- Use `getPossibleLegacyPrefixes(user)` helper that returns an ordered list: [user.name, user.name.toLowerCase(), user.usernameIndexValue (if available)]. Document and reuse across services.

---

### J. Edge cases, collisions, and ownership resolution

- If a record exists under `trip:James:{id}` with `userId: 'James'` and there is also `trip:{userId}:{id}` for another user, we must ensure we do not accidentally transfer ownership. Migration must only migrate keys where the legacy owner maps to the same authenticated account (match idx:username -> userId mapping or confirm `userId` in record matches expected legacy owner before updating to canonical ID).
- If both legacy and ID keys exist with different content, prefer the record with the newer `updatedAt` and write it to the ID key; log an audit event detailing the conflict and fields merged.

---

### K. DO (TripIndexDO) & Index Repair

- After copying records to ID-prefixed keys, call DO `/migrate` with summaries or call DO `/put` for each migrated summary to ensure DO indices reflect new keys.
- If DO reports non-ok, mark the user index as dirty and schedule a background re-sync (existing `markDirty()` / `clearDirty()` patterns can be used).

---

### L. Verification queries & admin utilities (simulated commands)

Provide admin scripts (dry-run mode) to help with verification:

- Count legacy trip keys for a username:
  - `await kv.list({ prefix: 'trip:James:' }).then(r => r.keys.length)`
- Report for all usernames top 100 by legacy key counts (stream and batch to avoid OOM).
- Dry-run migration: iterate legacy keys, compute target key, print summary of operations without writing.

---

### M. Performance & cost considerations

- Batch KV operations (BATCH_SIZE=50 or 100) to avoid Cloudflare subrequest limits and keep CPU time controlled.
- Use `Promise.allSettled` to handle partial failures and log counts.
- Limit concurrency for admin bulk runs and for login-triggered background migrations (throttle to, e.g., 10 concurrent migrations per worker instance).

---

### N. Audit, monitoring & ops signals

- Emit `migration:user:migrated` events with `{ userId, migratedCount, errors }` to the audit log.
- Track per-namespace counts remaining (legacy keys) and display in an admin dashboard.
- Add alerts for error rate spikes (>1% of migrations erroring) and for unexpected decreases in counts (which may indicate accidental deletions).

---

### O. Simulated conclusions & recommended next steps

1. Implement the small `getStorageId()` change and `getLegacyStorageId()` immediately (Day 0). Add unit tests covering edge cases (case-sensitivity, missing name).
2. Implement dual-read behavior in `tripService` first (prototype) and deploy to staging for a week to monitor legacy read rates and discovered legacy counts. Keep migration disabled initially (log-only mode).
3. Implement `migrateKVRecord()` utility and `migrateUserStorageKeys()` with dry-run mode and per-user throttling. Add admin dry-run utility to report predicted changes before applying.
4. Add encryption of PII (Sec 12) in parallel; ensure migration re-encrypts migrated records.

---

_Simulated audit complete; this section records the detailed findings and guidance that would be used to implement the migration steps in a safe, auditable manner._

---

## 14) Comprehensive file list to update (scan results) 🗂️

Below is an exhaustive list of repository files identified by search that need review/changes as part of the storage-key migration and PII encryption effort. Each entry includes the rationale and brief guidance for the change.

A. Server helpers & services

- `src/lib/server/user.ts` — Change `getStorageId()` to ID-only; add `getLegacyStorageId()` and `normalizeLegacyPrefixes()` helpers. (Critical)
- `src/lib/server/tripService.ts` — Add dual-read for `listFromKV`, `get`, `listTrash`; add `migrateKVRecord()` hook; ensure DO `/put` calls for migrated summaries. **Additionally**: harden `restore()` to sanitize the restored object (force `restored.userId = userId`, rewrite any embedded HNS ids) and add unit tests to ensure restores after migration remain in the UUID keyspace. (High)
- `src/lib/server/expenseService.ts` — Same dual-read and migration scheduling for expenses. (High)
- `src/lib/server/mileageService.ts` — Same dual-read and migration scheduling for mileage. (High)
- `src/lib/server/userService.ts` — Add per-user migration status flags and ensure `deleteUser()` handles both username and id prefixes (instrumented). (Medium)
- `src/lib/server/migration/storage-key-migration.ts` — New migration utility (dry-run + apply modes). (New)
- `src/lib/server/crypto.ts` — New encryption helpers (encryptFields/decryptFields, KEK handling). (New)

B. Routes & API endpoints

- `src/routes/api/trash/+server.ts` and `src/routes/api/trash/[id]/+server.ts` — Pass `legacyName` into services; ensure list/get use dual-read. (High)
- `src/routes/api/mileage/+server.ts` and `src/routes/api/mileage/[id]/+server.ts` — Use ID-based storageId; pass legacyName for reads. (High)
- `src/routes/api/expenses/+server.ts` and `src/routes/api/expenses/[id]/+server.ts` — Same as mileage. (High)
- `src/routes/api/trips/*` (`+server.ts`, `[id]`) — Ensure reads check legacy prefixes and `put/delete` remain ID-based. (High)
- `src/routes/api/hughesnet/+server.ts` — Remove `user?.name || user?.token` fallbacks, add `legacyName` support, and encrypt HNS secrets during migration. (High)
- `src/routes/api/hughesnet/archived/+server.ts` and `src/routes/api/hughesnet/archived/import/+server.ts` — Update to accept `userId` + `legacyName` and to migrate `hns:db`, `hns:order` ownerId fields. (High)
- `src/routes/api/hughesnet/archived/import/+server.ts` — Ensure `hns:db:${userId}` writes and preserve backups. (High)
- `src/routes/api/user/+server.ts` — Be careful when exposing `name` and consider redacting fields; add migration status endpoints if needed. (Medium)
- `src/routes/api/auth/session/+server.ts` — Minimize stored session payloads; avoid storing plaintext PII; ensure session writes and reads remain compatible with encryption strategy. (Medium)

C. Authentication & hooks

- `src/hooks.server.ts` — Ensure `event.locals.user` continues to include `name` for legacy reads; throttle migration triggers and validate session fields. (High)
- `src/routes/login/+server.ts` — Schedule background `migrateUserStorageKeys` with `platform.context.waitUntil()` in a throttled manner. (High)

D. Client-side & Svelte components (offline & UX)

Files observed using legacy fallbacks (`$user?.name || $user?.token || localStorage.getItem('offline_user_id')`):

- `src/routes/dashboard/+layout.svelte` — user display and initial userId logic.
- `src/routes/dashboard/trips/+page.svelte` and `src/routes/dashboard/trips/new/+page.svelte` and `src/routes/dashboard/trips/edit/[id]/+page.svelte` — offline keying and trip creation.
- `src/routes/dashboard/expenses/+page.svelte` and `src/routes/dashboard/expenses/new/+page.svelte` — offline expense keying.
- `src/routes/dashboard/mileage/+page.svelte` and `src/routes/dashboard/mileage/new/+page.svelte` — offline mileage keying.
- `src/routes/dashboard/settings/components/DataCard.svelte` — export & display logic that falls back to offline keys.
- `src/routes/dashboard/hughesnet/+page.svelte` — HNS user identification using name/token (upgrade to use id + legacyName during migration).
- `src/routes/dashboard/data-management/+page.svelte` — data management tools using `$user?.id || $user?.token`.
- `src/lib/stores/auth.ts` — uses `localStorage.getItem('offline_user_id')` (update to store `offline_user_id_v2:{userId}` and provide migration helper).

Client changes guidance:

- Prefer `$user?.id` for offline keys.
- Add a local migration helper to rename `offline_user_id` and reconcile data with server read verification.
- For offline devices, include `legacyName` in initial sync to allow dual-read during reconciliation.

E. Utilities, scripts & other files

- `subscription-integration.js` — reads `localStorage.getItem('token')` and `username` — ensure no sensitive tokens leaked; update to prefer `id` when applicable. (Low)
- `tools/*` scripts (e.g., migration helpers) — add dry-run and verbose logging; ensure safe limits. (Medium)
- `src/lib/utils/storage.ts` — Add wrappers to support local offline key migration. (Medium)

F. Tests & monitoring

- Add/Update unit tests for: `getStorageId()`, `getLegacyStorageId()`, `normalizeLegacyPrefixes()`, `migrateKVRecord()`, and encryption helpers.
- Add integration tests with mock KVs/DOs for migration dry-run and apply modes.
- Update e2e tests that simulate user flows relying on legacy keys (trip creation, HNS sync) to verify compatibility.

G. Edge items & special cases

- **Case sensitivity:** canonical username index keys are lowercased (`idx:username:{username.toLowerCase()}`) but existing records may be capitalized (`trip:James:`). Migration must check both variants.
- **HNS trip IDs:** Some HNS record IDs embed the username (e.g., `hns_James_2025-09-24`) — do not rename IDs; store records under ID-based prefixes and keep `id` unchanged.
- **Ownership validation:** only migrate legacy keys when the legacy owner maps to the same authenticated account (verify idx:username -> userId or record.userId matches legacy value).

---

## 15) Data migration procedures — how to migrate existing user data 🔁

This section documents exact, auditable steps to migrate legacy username/token-keyed KV records to ID-based keys, including dry-run, safety checks, per-record algorithm, HNS handling, DO indexing, encryption integration, and verification.

Purpose: Convert keys like `trip:James:{id}`, `mileage:James:{id}`, `expense:James:{id}`, `hns:settings:James` into `trip:{userId}:{id}`, etc., without data loss and with full auditability.

### Overview

- Two migration modes:
  1. **Login-triggered per-user migration** (background, non-blocking): safe for active users; runs via `platform.context.waitUntil()`.
  2. **Admin bulk migration** (throttled, dry-run then apply): for dormant accounts and for final cleanup.
- Always run a **dry-run** first that discovers legacy keys and reports predicted changes without writing.
- Migration must be **idempotent**, **race-safe**, **preserve tombstones**, **preserve metadata/TTL**, and **log each operation**.

### Pre-Migration checklist

- Snapshot KV namespaces (or export) used in migration for quick rollback.
- Ensure KEK (`STORAGE_KEY_KEK`) is present and accessible in environment; if not ready, run migration without encryption, but schedule re-encryption pass later (preferred: enable encryption first).
- Enable verbose migration audit logging and metrics ingestion.
- Confirm `idx:username:{username.toLowerCase()}` maps exist and are trusted.

### Discovery / Dry-run

Admin command (dry-run example):

- `node tools/migrate-legacy-keys.js --userName=James --dry-run --namespaces=trip,expense,mileage,hns`

Dry-run behavior:

- List legacy prefixes (see `getPossibleLegacyPrefixes()`): e.g., `['James', 'james']`.
- For each prefix and each namespace, count keys and sample values (no PII in logs; redact addresses/emails).
- Report: counts per namespace, sample key names, sample updatedAt values, conflicts (both legacy and ID keys exist for same id), and recommended operation counts.

Acceptance: Dry-run must complete without modifications and produce a migration plan & summary for that user.

### Per-user migration algorithm (pseudocode)

- Input: `kv`, namespace (e.g., 'trip'), `userId`, `userName`, `options` (dryRun, encrypt, batchSize, deleteLegacy=true/false)
- Steps:
  1. Compute legacy prefixes = getPossibleLegacyPrefixes(userName).
  2. For each prefix P in legacy prefixes:
     - Use paginated `kv.list({ prefix: `${namespace}:${P}:`, limit: BATCH_SIZE })`.
     - For each key `oldKey` returned:
       a. Parse `recordId` from oldKey suffix.
       b. newKey = `${namespace}:${userId}:${recordId}`.
       c. Read `oldRaw = await kv.getWithMetadata(oldKey)` (to preserve metadata/TLL when supported).
       d. If `oldRaw` is null, skip.

       ***

       IMPORTANT: Prevent the _Reversion Loop_ — update internal IDs inside the record before writing the new key.

       // Example (TypeScript) — ensure the record's `userId`/HNS ids are rewritten to the UUID

       ```ts
       // Normalize data to a JSON string
       let value = data;
       if (typeof data === 'object') {
       	value = JSON.stringify(data);
       }
       const record = JSON.parse(value as string);

       let modified = false;

       // 1) Update internal userId to canonical UUID to avoid reversion on save
       if (record.userId === userName) {
       	record.userId = userId;
       	modified = true;
       }

       // 2) Rewrite HughesNet embedded IDs inside the payload
       if (typeof record.id === 'string' && record.id.startsWith(`hns_${userName}_`)) {
       	record.id = record.id.replace(`hns_${userName}_`, `hns_${userId}_`);
       	modified = true;
       }

       if (modified) {
       	value = JSON.stringify(record);
       }
       ```

       e. Optionally decrypt/encrypt fields (per Sec 12) or re-encrypt if encryption enabled.
       f. Read `newRaw = await kv.get(newKey)`.
       g. If `newRaw` exists: - Compare `updatedAt` of `oldRaw` and `newRaw` (parse JSON safely). - If `newRaw` is newer, log conflict, skip migration for this key or optionally merge fields according to policy (prefer newer server-side values). - If `oldRaw` is newer, write `newKey` with `oldRaw.value` and metadata; log and increment migrated count.
       h. If `newRaw` does not exist: - Write `newKey` using `oldRaw.value` and `oldRaw.metadata`. - If `dryRun` = false and `deleteLegacyAfterCopy` = true, delete oldKey **only after** verifying `kv.get(newKey)` returns the expected value (or after checksum verification).
       i. If `record` was a tombstone (`deleted: true`), ensure TTL/expiration is preserved when writing `newKey`.
       j. For trips/expenses/mileage: if migration writes a new record, trigger DO index put for summary and handle DO response; on DO error mark index dirty.

     - Use `Promise.allSettled()` with bounded concurrency to process batch safely.

  3. Return summary (migratedCount, skippedCount, errors[]).

Notes:

- Use BATCH_SIZE=50–100 depending on KV limits and response times; limit concurrent batches per worker (e.g., concurrency 5).
- Always redact PII in logs; store counts and key names only.

### HNS special cases

- Keys: `hns:settings:{username}`, `hns:session:{username}`, `hns:cred:{username}`, `hns:db:{username}`
- Migration steps:
  - Copy `hns:settings:{username}` → `hns:settings:{userId}` (if not present).
  - Copy `hns:session`, `hns:cred` → corresponding `hns:*:{userId}` **encrypted** (treat as secrets).
  - For `hns:order:{orderId}` objects that contain `ownerId` = username, update `ownerId` to `userId`.
  - For HNS trip IDs that embed the username in `id`, keep `id` unchanged but store under ID-prefixed key: `trip:{userId}:{hns_James_...}`.

### DO index & side effects

- After writing a migrated trip/expense/mileage record to KV, invoke the DO `/put` or `/migrate` endpoints to ensure the DO index is updated. If DO returns non-ok, mark user `meta:user:{userId}:index_dirty = 1` and queue repairs.
- For high-volume users, prefer using DO bulk `/migrate` endpoints with batched summaries rather than per-record DO calls when available.

### Encryption integration during migration

- If encryption is enabled, perform `encryptFields()` on sensitive fields before writing `newKey`.
- For legacy plaintext records, read, encrypt, and write to newKey, then optionally delete or overwrite old key with encrypted form.
- Support KEK versioning: include `meta.key_ver` with each migrated record and log key version used.

### Client reconciliation & offline devices

- On first successful login after migration, client should:
  - Check for local data keyed by legacy `offline_user_id` and attempt to sync/migrate to server ID.
  - For each local record missing on server, attempt to POST; server will accept and write to ID-keyed KV.
  - If conflicts occur, client will fetch canonical server copy and ask user to resolve if necessary.

  **Client IndexedDB mismatch / Full Re-Sync** ⚠️

  Finding: Offline records in IndexedDB may still have `userId: "{username}"`. After migration, the UI filters by `currentUser.id` (UUID) and local records will disappear from the UI.

  Minimal mitigation (quick): Increment the service worker cache/version in `src/service-worker.ts` so clients update and you can trigger a full re-sync on activation.

  Robust mitigation (recommended): On client login or on `syncManager.initialize()` perform a check of local data userId vs current user.id. If mismatch, clear the local IndexedDB stores and force a full sync.

  Example (Svelte / client) — add to `src/routes/dashboard/+layout.svelte` or `syncManager.initialize()`:

  ```ts
  // Pseudocode inside client init
  const db = await getDB();
  const tx = db.transaction('trips', 'readonly');
  const cursor = await tx.objectStore('trips').openCursor();
  let foundMismatch = false;
  while (cursor) {
  	const rec = cursor.value;
  	if (rec && rec.userId && rec.userId !== currentUser.id) {
  		foundMismatch = true;
  		break;
  	}
  	cursor = await cursor.continue();
  }

  if (foundMismatch) {
  	// Clear all local stores and reinitialize sync
  	await db.clear('trips');
  	await db.clear('syncQueue');
  	await syncManager.initialize(); // triggers syncDownAll and full refresh
  	// Optionally show a UI toast explaining a full refresh occurred
  }
  ```

  - Verification: After re-sync, the UI should show the user's server-side trips (ID-prefixed) and the local DB `trips` records should have `userId === currentUser.id`.

### Admin bulk migration plan

- Provide an admin CLI/script: `tools/migrate-legacy-keys.js --batch --namespaces=trip,expense,mileage,hns --concurrency=5 --dry-run`.
- Steps:
  1. Run dry-run for desired user set, collect predicted operations.
  2. Run small test set (e.g., 10 users), verify metrics.
  3. Apply to larger batches with throttling and retry support.
- Always cap per-batch operations (e.g., 10k keys/batch) and schedule during low-traffic windows.

- **Stripe mappings backfill** — ensure `stripe:customer:{customerId}` -> `userId` mappings exist so webhooks do not need to scan the entire user KV. Include this in both per-user migration and an admin bulk backfill.

  Example (TypeScript) — called during user migration (if user has a stripeCustomerId):

  ```ts
  async function migrateStripeMappings(kv: KVNamespace, userId: string, stripeCustomerId?: string) {
  	if (!stripeCustomerId) return 0;
  	const mappingKey = `stripe:customer:${stripeCustomerId}`;
  	const existing = await kv.get(mappingKey);
  	if (!existing) {
  		await kv.put(mappingKey, userId);
  		return 1;
  	}
  	return 0;
  }
  ```

  - Where to call: from `migrateUserStorageKeys()` (check `userCore.stripeCustomerId` on the user and call the helper) and provide an admin bulk backfill script to scan users and write mappings in batches.
  - Verification: After backfill, `await usersKV.get(`stripe:customer:${customerId}`)` returns the expected `userId` for test customers.

### Verification & post-migration checks

- For each user migrated, verify:
  - `count_new = kv.list({ prefix: `${ns}:${userId}:` }).keys.length` >= `count_legacy` discovered earlier minus deletions.
  - A small sample of migrated records decrypt correctly and match expected fields (in staging run).
  - No active tickets indicating data loss or missing items for users in test cohort.
- Update per-user migration status: set `meta:user:${userId}:storage_migrated = { v: true, migratedAt: ISO, migratedCount }`.

### Monitoring & metrics

- Emit metrics: `migration.users.started`, `migration.users.completed`, `migration.records.migrated`, `migration.errors`.
- Track legacyKeysRemaining per namespace and set alert if progress stalls.

### Failure modes & rollback

- If repeated errors observed, pause admin migration and investigate logs; do not resume until root cause fixed.
- If accidental deletions detected, use KV snapshot to restore keys and re-run migration in dry-run to reconcile.
- Keep migration idempotent: re-running should not change newer records.

### Example pseudocode (dry-run mode)

```
for user in targetUsers:
  prefixes = getPossibleLegacyPrefixes(user.name)
  for ns in namespaces:
    totalLegacy = 0
    for prefix in prefixes:
      list = kv.list({ prefix: `${ns}:${prefix}:` })
      totalLegacy += list.keys.length
    log(`user=${user.id} ns=${ns} legacyKeys=${totalLegacy}`)

// Now run actual migration on a small sample with apply=true
applyMigration(sampleUser, { dryRun: false, concurrency: 5 })
```

### Critical gaps — MUST fix before Step 1 (do not deploy Step 1 until these are addressed)

1. **Durable Object & Meta Key Migration (Data Loss Risk)** ⚠️
   - Problem: `tripService.list()` compares DO counts to `meta:user:{userId}:trip_count` to detect desyncs. Migrating only `trip:{username}:*` keys without migrating `meta:user:{username}:*` keys (e.g., `trip_count`, `index_dirty`, `monthly_count`) will leave the new ID-based `meta:user:{uuid}:trip_count` empty and the DO empty, causing the app to show an empty dashboard despite KV records being present.
   - Files confirmed: `src/lib/server/tripService.ts` (uses `meta:user:${userId}:trip_count` and `meta:user:${userId}:index_dirty`), `src/lib/server/mileageService.ts` (uses trip verification keys), and other places where `meta:user:` keys exist.
   - Fix: **MUST** add `migrateMetaKeys(kv, userId, userName)` to `storage-key-migration.ts` to copy keys such as:
     - `meta:user:{userName}:trip_count` → `meta:user:{userId}:trip_count`
     - `meta:user:{userName}:index_dirty` → `meta:user:{userId}:index_dirty`
     - `meta:user:{userName}:monthly_count:{YYYY-MM}` → `meta:user:{userId}:monthly_count:{YYYY-MM}`

   Example (TypeScript):

   ```ts
   async function migrateMetaKeys(kv: KVNamespace, userId: string, userName: string) {
   	// 1. Trip Count (Critical for dashboard sync)
   	const countKey = `meta:user:${userName}:trip_count`;
   	const newCountKey = `meta:user:${userId}:trip_count`;
   	const count = await kv.get(countKey);
   	if (count) {
   		await kv.put(newCountKey, count);
   		await kv.delete(countKey);
   	}

   	// 2. Index Dirty Flag
   	const dirtyKey = `meta:user:${userName}:index_dirty`;
   	const newDirtyKey = `meta:user:${userId}:index_dirty`;
   	const dirty = await kv.get(dirtyKey);
   	if (dirty) {
   		await kv.put(newDirtyKey, dirty);
   		await kv.delete(dirtyKey);
   	}

   	// 3. Monthly counts (iterate known month keys)
   	// Optionally list and copy all `meta:user:${userName}:monthly_count:` prefixed keys
   }
   ```

   - Verification: After migrating a test user, assert `kv.get('meta:user:{userId}:trip_count')` equals pre-migration count and DO `/list` + `kv.list({ prefix: 'trip:{userId}:' })` counts match.

2. **Durable Object State Migration** ⚠️
   - Problem: DO instances are keyed by `idFromName(name)`; changing `userId` from username to UUID results in a new DO instance with empty SQLite tables.
   - Files confirmed: `src/lib/server/TripIndexDO.ts` supports `/migrate` and `/list` endpoints. `tripService` calls DO endpoints for indexing and `/migrate` repairs.
   - Fix: Migration must: (a) call old DO instance(s) using `tripIndexDO.idFromName(oldPrefix)` and fetch data (`/list`), (b) call new DO instance using `tripIndexDO.idFromName(userId)` and POST `/migrate` with summaries, and (c) verify row counts and clear old DO state if desired after verification. Pseudocode:
     ```ts
     const oldStub = tripIndexDO.get(tripIndexDO.idFromName(oldName));
     const res = await oldStub.fetch(`${DO_ORIGIN}/list`);
     const data = await res.json();
     const newStub = tripIndexDO.get(tripIndexDO.idFromName(userId));
     await newStub.fetch(`${DO_ORIGIN}/migrate`, {
     	method: 'POST',
     	body: JSON.stringify(data.trips || data)
     });
     ```
   - Note: Use DO `/migrate` rather than per-record `/put` when migrating many records for performance.
   - Verification: DO `/list` on the new DO returns expected counts and `meta:user:{userId}:trip_count` matches KV counts.

3. **Atomic Deploy Requirement: do not ship `getStorageId()` change alone** ⚠️
   - Problem: Deploying `getStorageId()` returning `user.id` _before_ adding dual-read logic in services will immediately cause all reads that rely on username-based keys to return empty results.
   - Files affected: All services that only query `trip:${userId}:` (e.g., `tripService.listFromKV`), as well as endpoints that call `getStorageId()` directly.
   - Fix: Treat Step 1 as an _atomic_ deployment that includes:
     - `getStorageId()` change + `getLegacyStorageId()` helper
     - Dual-read logic in `tripService`, `expenseService`, `mileageService`, and any other read paths
     - Tests verifying that with only dual-read enabled, both legacy-name and ID-keyed records are discoverable
   - Alternative: Use a temporary feature flag so that production `getStorageId()` behavior remains backward compatible until dual-read is deployed simultaneously.

4. **Hardcoded vulnerable patterns (manual refactor required)** ⚠️
   - Problem: Some files bypass `getStorageId()` and directly compute `userId = user?.name || user?.token || user?.id || 'default_user'`. These will not be corrected by changing `getStorageId()` alone.
   - Files confirmed (search results):
     - `src/routes/api/hughesnet/+server.ts` (lines with `user?.name || user?.token || user?.id`) — **must be updated manually** to `userId = user?.id || ''` and pass `legacyName = user?.name` to services for dual-read during migration.
     - `src/routes/api/hughesnet/archived/+server.ts` and `src/routes/api/hughesnet/archived/import/+server.ts`
     - Multiple Svelte pages and other routes (see grep for `user?.name || user?.token || user?.id`) — catalogue and refactor as part of the Phase 1 atomic change.
   - Fix: Identify and update all such occurrences to use canonical `user.id` and explicit `legacyName` for reads during migration.

   Example (HughesNet API fix) — change `src/routes/api/hughesnet/+server.ts` to use UUID and enforce auth:

   ```ts
   // Current (vulnerable)
   // const userId = user?.name || user?.token || user?.id || 'default_user';

   // Fixed
   const userId = user?.id || '';
   if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

   // Pass legacyName where needed for dual-read/migration
   const legacyName = user?.name;
   ```

   - Additional note: Ensure all HNS reads check both `hns:${userId}:` and `hns:${legacyName}:` during rollout and that HNS writes use `userId` only.

   **Widespread hardcoded pattern (TRIPS & peers)** ⚠️

   Finding: Several `api` routes bypass `getStorageId()` and hardcode `userSafe?.name || userSafe?.token || ''` (notably `src/routes/api/trips/+server.ts` and `src/routes/api/trips/[id]/+server.ts`). If left unchanged, these endpoints will continue to reference `trip:{username}:*` and will return empty results after migration.

   Action: Run a targeted grep across `src/routes/api/**` for `userSafe?.name ||` or `user?.name ||` and update each occurrence to use the canonical UUID and pass `legacyName` to service calls for compatibility during rollout.

   Example fix (TRIPS):

   ```ts
   // Old (vulnerable)
   const storageId = userSafe?.name || userSafe?.token || '';

   // New (safe)
   const storageId = userSafe?.id || '';
   ```

---

### CRITICAL OMISSIONS FOUND AFTER CODE AUDIT (MUST FIX BEFORE "Fix Root Cause") 🛑

After auditing the repository the following **four critical omissions** were confirmed in code and must be added to the checklist. If you change `getStorageId()` without these, users will see empty dashboards or the HughesNet vulnerability will remain active.

1. Immediate Data Lockout in Settings
   - File: `src/routes/api/settings/+server.ts`
   - Issue: This endpoint currently reads `settings:${user.id}` only (GET) and writes `settings:${user.id}` (POST). When `getStorageId()` flips to ID-only, legacy users with `settings:{username}` will receive empty settings on load.
   - Fix: Add **Dual-Read** on GET (try `settings:{user.id}` then `settings:{user.name}`) and schedule a `migrateSingleKey()` for any fallback hits so the user's settings are migrated to the UUID key.

2. Vulnerability Persistence in HughesNet
   - File: `src/routes/api/hughesnet/+server.ts` (and archived variants)
   - Issue: This file bypasses `getStorageId()` and computes `userId = user?.name || user?.token || user?.id || 'default_user'` directly.
   - Fix: Change to `userId = user?.id || ''`, return `401` if missing, and pass `legacyName = user?.name` into `HughesNetService` so the service can dual-read during rollout. Do this now — changing `getStorageId()` alone is insufficient.

3. Missing Migration Helper `migrateSingleKey()`
   - File: `src/lib/server/migration/storage-key-migration.ts`
   - Issue: The plan references `migrateSingleKey()` for migrating settings and auth keys, but no such helper exists in code yet. This prevents migrating settings/authenticators safely.
   - Fix: Implement `migrateSingleKey()` in the migration module (see snippet below). Ensure it supports `dry-run` and `apply` modes and does NOT overwrite an existing new key (safety).

4. Service Layer Dual-Read Logic is Missing
   - Files: `src/lib/server/tripService.ts`, `src/lib/server/expenseService.ts`, `src/lib/server/mileageService.ts`
   - Issue: The services currently accept a single `userId` and only read `prefix:{userId}:`. They do not accept or query a `legacyName` fallback.
   - Fix: Update `list()` and `get()` methods to accept an optional `legacyId` (or `legacyName`) parameter. `list()` should merge results from both `prefix:{userId}:` and (if present) `prefix:{legacyId}:` and de-duplicate. `get()` should attempt `userId` first then `legacyId`.

---

### REVISED EXECUTION PLAN (Replace single "Fix Root Cause" step)

**Phase 1: Preparation (Safe to Deploy)** — deploy these before changing `getStorageId()`

- [x] 1. Implement Service Dual-Read ✅
  - Files changed (Phase 1, minimal safe deploy): `src/lib/server/tripService.ts`
  - Action taken: `list()`, `get()`, `listFromKV()`, `listTrash()` and `restore()` now accept an optional `legacyName` parameter and perform dual-read (canonical `trip:{userId}:` first, then `trip:{legacyName}:` and `trip:{legacyName.toLowerCase()}:`). Results are de-duplicated by record id, preferring canonical records when present.
  - Why: Prevents immediate dashboard/data loss when flipping canonical storage and enables safe discovery of legacy keys for later migration.
  - Revert notes (how to revert safely): Revert to prior behavior by restoring the previous `listFromKV`/`list`/`get`/`listTrash`/`restore` implementations (remove `legacyName` parameter and dual-prefix logic). No server-facing behavior was changed for writes in this change (reads-only except `restore()` which persists normalized canonical key — see note below).

  **Concrete file-level change (before → after)**
  - `src/lib/server/tripService.ts` (excerpt)

  BEFORE:

  ```ts
  async function listFromKV(userId: string): Promise<TripRecord[]> { /* only reads `trip:${userId}:` */ }
  async get(userId: string, tripId: string) { const raw = await kv.get(`trip:${userId}:${tripId}`); ... }
  async listTrash(userId: string): Promise<TrashItem[]> { /* only reads `trip:${userId}:` */ }
  async restore(userId: string, itemId: string) { /* reads `trip:${userId}:${itemId}` only */ }
  ```

  AFTER:

  ```ts
  async function listFromKV(userId: string, legacyName?: string): Promise<TripRecord[]> { /* checks `trip:${userId}:`, `trip:${legacyName}:`, `trip:${legacyName.toLowerCase()}:` in order, dedup */ }
  async get(userId: string, tripId: string, legacyName?: string) { /* tries canonical then legacy keys; normalizes returned.userId=canonical */ }
  async listTrash(userId: string, legacyName?: string): Promise<TrashItem[]> { /* merged prefixes; returned.userId = canonical userId */ }
  async restore(userId: string, itemId: string, legacyName?: string) { /* accepts legacy key, normalizes restored.userId=canonical, writes to `trip:{userId}:{id}` */ }
  ```

  - Note about `restore()`: when restoring from a legacy tombstone we now normalize `restored.userId = userId` and write the restored record to the **canonical** `trip:${userId}:${restored.id}` key. This prevents a restore from reintroducing legacy-keyed records (Tombstone Reversion Loop). If you need to revert this specific behavior, revert `restore()` to its original implementation; be aware that older clients may then re-create legacy reversion risk until migration is complete.

- [x] 2. Update API Call Sites ✅
  - Files changed (Phase 1): `src/routes/api/trips/+server.ts`, `src/routes/api/trips/[id]/+server.ts`, `src/routes/api/trash/+server.ts`, `src/routes/api/trash/[id]/+server.ts`
  - Fix: `POST /api/trash/[id]/restore` now accepts an optional `legacyName`, delegates mileage parent-trip validation to `mileageService`, normalizes restored records to the canonical `userId` namespace, and returns clear 200/409/404 responses. Svelte-check now reports 0 errors and unit tests pass (see `tripService.spec.ts`).
  - Action taken: Replaced ad-hoc `user?.name || user?.token || ''` storage-id usage with helpers and passed `legacyName` where applicable. For writes we now prefer canonical `sessionUser.id` when available (`trip.userId = sessionUser.id || storageId`). Counter increments use canonical id when available.
  - Why: Call-site changes ensure services receive the `legacyName` fallback during rollout and that new writes prefer canonical UUIDs (prevents creating new legacy-keyed data going forward).
  - Revert notes: Restore the original storageId derivation at call-sites (replace `getStorageId()`/`getLegacyStorageId()` with previous inline expressions) and revert `trip.userId` assignment to prior `storageId` if you need to roll back to earlier behavior.

  **Concrete file-level changes (before → after)**
  - `src/routes/api/trips/+server.ts`

  BEFORE:

  ```ts
  const storageId = userSafe?.name || userSafe?.token || '';
  const allTrips = await svc.list(storageId, { since: sinceParam, limit, offset });
  ```

  AFTER:

  ```ts
  import { getStorageId, getLegacyStorageId } from '$lib/server/user';
  const storageId = getStorageId(userSafe);
  const legacyName = getLegacyStorageId(userSafe);
  const allTrips = await svc.list(storageId, { since: sinceParam, limit, offset }, legacyName);
  ```

  - `src/routes/api/trips/[id]/+server.ts` and trash endpoints were updated similarly: all `svc.get`/`svc.listTrash` calls now pass the optional `legacyName` argument; restores use canonical counter increments.

- [x] 3. Fix Settings & HughesNet (in progress)
  - `src/routes/api/hughesnet/+server.ts` — **in progress**: converted to `user.id`-first and will accept `legacyName` into HNS service.
  - [x] 3.a Update Settings API for Dual-Read (critical) — **done (Phase 1)**: `migrateSingleKey()` implemented and login-triggered migration now schedules `migrateUserStorageKeys()` in background via `platform.context.waitUntil()`.
    - Note: `migrateSingleKey()` supports `dry-run` and `apply` modes and preserves metadata when migrating keys.

---

**Existing (current) GET:**

```ts
const raw = await kv.get(`settings:${(user as any).id}`);
const settings = raw ? JSON.parse(raw) : {};
return json(settings);
```

**Proposed GET (dual-read + schedule migration):**

```ts
const userId = user.id;
const legacyName = user.name;

const idKey = `settings:${userId}`;
const nameKey = legacyName ? `settings:${legacyName}` : undefined;

let raw = await kv.get(idKey);
let settings = raw ? JSON.parse(raw) : null;
if (!settings && nameKey) {
	const legacyRaw = await kv.get(nameKey);
	if (legacyRaw) {
		settings = JSON.parse(legacyRaw);
		// Schedule background migration from settings:{legacyName} -> settings:{userId}
		if (event.platform?.context?.waitUntil) {
			const p = migrateSingleKey(kv, nameKey, idKey, { apply: false });
			try {
				event.platform.context.waitUntil(p as any);
			} catch {
				void p;
			}
		}
	}
}
return json(settings || {});
```

**Proposed POST behavior (save to UUID key):**

- Continue to write to `settings:${userId}` only. If a legacy key exists, schedule a background `migrateSingleKey()` (dry-run first, then apply via admin tooling once verified).

Why: Without this, switching to ID-only storage will cause users with legacy settings to see defaults on load.
**Phase 2: Execution (The Switch)** — only run after Phase 1 is deployed and validated

- [ ] 4. Complete Migration Scripts
  - File: `src/lib/server/migration/storage-key-migration.ts`
  - Action: Implement `migrateSingleKey()` (and `migrateAuthenticators()` if needed), support `dry-run` and `apply`, and ensure deep payload rewrite for tombstone backups and HNS ownerId fields.

- [ ] 5. Fix Root Cause (The Switch)
  - File: `src/lib/server/user.ts`
  - Action: Update `getStorageId()` to strictly return `user?.id` (or gate behind feature flag) and add `getLegacyStorageId()` for callers who need to pass `legacyName` during rollout.
  - Files: Update call sites to use `getStorageId()` and stop relying on `user?.name || user?.token` once migration is complete.

---

### Suggested helper: `migrateSingleKey()` (MUST be added to `src/lib/server/migration/storage-key-migration.ts`)

Finding: The migration script calls `migrateSingleKey()` but the function is not defined in the file; running the script will crash with `ReferenceError: migrateSingleKey is not defined`.

Add this concrete helper (copy-paste) to `src/lib/server/migration/storage-key-migration.ts`. It uses `oldKey` / `newKey` and supports dry-run vs apply via an `options.apply` flag. Delete of old key should occur only in `apply` mode.

```ts
// Add this helper function to src/lib/server/migration/storage-key-migration.ts
async function migrateSingleKey(
	kv: KVNamespace,
	oldKey: string,
	newKey: string,
	options: { apply?: boolean } = { apply: false }
): Promise<number> {
	// Dry-run: return 1 if the old key exists and new key absent
	const data = await kv.get(oldKey);
	if (!data) return 0; // Nothing to migrate

	// Safety: Do not overwrite the destination
	const exists = await kv.get(newKey);
	if (exists) return 0;

	if (options.apply) {
		await kv.put(newKey, data);
		// Delete old key only in apply mode after verification
		await kv.delete(oldKey);
	}

	return 1;
}
```

## Why: This prevents script crashes and centralizes single-key moves (settings, authenticators, meta counters). Use `options.apply` to keep dry-run safe and non-destructive.

Add tests for all the above (settings GET fallback with scheduled migration, updated HughesNet auth logic, services' merged `list()` behavior, and `migrateSingleKey()` behavior in `dry-run` vs `apply` modes).
const legacyName = userSafe?.name;
if (!storageId) return json({ error: 'Unauthorized' }, { status: 401 });

// When calling tripService.list(), pass legacyName for dual-read
const trips = await tripService.list(storageId, legacyName);

````

- Verification: Add a grep-and-PR checklist as part of the atomic release to ensure no API routes still reference `user?.name` or `userSafe?.name` for storage decisions.

**Concrete file fixes (must be changed before getStorageId flip):**

- `src/routes/api/trips/+server.ts` (and `[id]`): change `const storageId = userSafe?.name || userSafe?.token || ''` → `const storageId = getStorageId(userSafe) || ''` and pass `const legacyName = userSafe?.name` to `tripService.list(storageId, legacyName)` / `restore()` calls.

- `src/routes/api/hughesnet/+server.ts` and `src/routes/api/hughesnet/archived/+server.ts`: change `const userId = user?.name || user?.token || user?.id || 'default_user'` to `const userId = user?.id || ''` and `const legacyName = user?.name` and pass `legacyName` to HNS reads/writes so the HNS service can dual-read.

---

## Per-file code-level audit & suggested replacements (exact code snippets)

Below are the files that must be changed, the exact existing code snippets I found, and the **proposed replacement code** including a brief justification for each change. These are intended to be copy/paste-able into PRs and tests. Do not run migration until the Phase 1 checklist is completed (service dual-read + call-site changes + HNS fix).

---

### 1) `src/lib/server/user.ts` — canonical ID provider

**Existing code:**

```ts
// src/lib/server/user.ts
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.name || user.id || user.token || '';
}
```

**Proposed replacement:**

```ts
// src/lib/server/user.ts
export function getStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	// Canonical: UUID only. Use migration dual-read for legacy names.
	return user.id || '';
}

// Helper for migration & dual-read (deprecated after migration completes)
export function getLegacyStorageId(
	user: { id?: string; name?: string; token?: string } | undefined
): string {
	if (!user) return '';
	return user.name || user.token || '';
}
```

Why: This removes the ATO vector by ensuring KV keys are derived only from opaque UUIDs. Add `getLegacyStorageId()` so call-sites can pass `legacyName` during rollout for dual-read.

---

### 2) `src/routes/api/settings/+server.ts` — SETTINGS DUAL-READ (critical)

**Existing code:**

```ts
// src/routes/api/settings/+server.ts (GET)
const raw = await kv.get(`settings:${(user as any).id}`);
const settings = raw ? JSON.parse(raw) : {};
return json(settings);
```

**Proposed replacement (GET):**

```ts
// Dual-read: try UUID key then legacy username key; schedule migration when fallback used
const idKey = `settings:${(user as any).id}`;
const nameKey = user.name ? `settings:${user.name}` : undefined;
let raw = await kv.get(idKey);
let settings = raw ? JSON.parse(raw) : null;
if (!settings && nameKey) {
	const legacyRaw = await kv.get(nameKey);
	if (legacyRaw) {
		settings = JSON.parse(legacyRaw);
		// Schedule background migration to move `settings:{name}` -> `settings:{id}`
		if (event.platform?.context?.waitUntil) {
			const p = migrateSingleKeyInBackground('settings', user.id, user.name);
			try { event.platform.context.waitUntil(p as any); } catch { void p; }
		}
	}
}
return json(settings || {});
```

**Proposed replacement (POST):**
- Continue writing to `settings:${user.id}` (new only); when saving, if an old `settings:${user.name}` exists, schedule migrateSingleKey in background (apply only after verification in admin dry-run).

Why: Prevents immediate settings loss when flipping `getStorageId()` by falling back to legacy username-stored settings and scheduling safe migration.

---

### 3) `src/routes/api/hughesnet/+server.ts` — Fix hardcoded vulnerable pattern

**Existing code:**

```ts
// src/routes/api/hughesnet/+server.ts
const user = locals.user as SessionUser | undefined;
const userId = user?.name || user?.token || user?.id || 'default_user';
const settingsId = user?.id;
```

**Proposed replacement:**

```ts
// Use canonical UUID as primary identifier, pass legacyName for dual-read
const user = locals.user as SessionUser | undefined;
const userId = user?.id || '';
const legacyName = user?.name;
if (!userId) return json({ success: false, error: 'Unauthorized' }, { status: 401 });
const settingsId = userId; // explicitly UUID

// When calling service methods, pass both userId and legacyName
await service.saveSettings(userId, bodyObj['settings'], legacyName);
// and in reads: await service.getSettings(userId, legacyName);
```

Why: This removes the endpoint-specific ATO bypass and enables HughesNet service to dual-read legacy HNS keys during rollout.

---

### 4) `src/lib/server/migration/storage-key-migration.ts` — add missing helpers

**Issue:** `migrateSingleKey()` and `migrateAuthenticators()` were referenced in the plan but not implemented in this file.

**Suggested additions (safe, dry-run aware):**

```ts
// Dry-run-aware single key migration
async function migrateSingleKey(
	kv: KVNamespace,
	prefix: string,
	oldId: string,
	newId: string,
	options: { apply?: boolean } = { apply: false }
): Promise<{ migrated: boolean; note?: string }> {
	const oldKey = `${prefix}:${oldId}`;
	const newKey = `${prefix}:${newId}`;
	const data = await kv.get(oldKey);
	if (!data) return { migrated: false };
	const existing = await kv.get(newKey);
	if (existing) return { migrated: false, note: 'destination exists' };
	if (options.apply) await kv.put(newKey, data);
	return { migrated: true };
}

async function migrateAuthenticators(kv: KVNamespace, userId: string, userName: string, apply = false) {
	const oldKey = `authenticators:${userName}`;
	const newKey = `authenticators:${userId}`;
	const data = await kv.get(oldKey, 'json');
	if (!data) return 0;
	if (!(await kv.get(newKey))) {
		if (apply) await kv.put(newKey, JSON.stringify(data));
	}
	for (const auth of data as any[]) {
		if (apply) await kv.put(`credential:${auth.credentialID}`, userId);
	}
	return (data as any[]).length;
}
```

Why: Centralizes dry-run vs apply semantics and ensures authenticators & credential index entries are updated to point to UUIDs.

---

### 5) `src/lib/server/tripService.ts` — service dual-read & restore normalization

**Existing code (list/get):**

```ts
async function listFromKV(userId: string): Promise<TripRecord[]> {
	const prefix = prefixForUser(userId);
	let list = await kv.list({ prefix });
	... // read keys under prefix only
}

async list(userId: string, options: {}) { ... }

async get(userId: string, tripId: string) {
	const key = `trip:${userId}:${tripId}`;
	const raw = await kv.get(key);
	return raw ? (JSON.parse(raw) as TripRecord) : null;
}
```

**Proposed replacement highlights:**

- Update signatures to accept `legacyId?: string` (or `legacyName`) and to check/merge both prefixes.
- `listFromKV(userId, legacyId?)` should fetch keys for both `trip:${userId}:` and `trip:${legacyId}:` if provided, parse both sets, deduplicate by `id` (prefer the record whose `updatedAt` is latest or prefer `userId` namespace), and return the combined set.
- `get(userId, tripId, legacyId?)` should try `trip:${userId}:${tripId}` first, then `trip:${legacyId}:${tripId}` if not found. If legacy found, schedule `migrateSingleKey()` in background and normalize `userId` before returning (do not persist until migration run applies if strict rules require it).

Example merging pseudocode:

```ts
async function listFromKV(userId: string, legacyId?: string): Promise<TripRecord[]> {
	const prefixes = [ `trip:${userId}:` ];
	if (legacyId) prefixes.push(`trip:${legacyId}:`);
	const map = new Map<string, TripRecord>();
	for (const prefix of prefixes) {
		let list = await kv.list({ prefix });
		let keys = list.keys;
		while (!list.list_complete && list.cursor) { list = await kv.list({ prefix, cursor: list.cursor }); keys = keys.concat(list.keys); }
		for (const { name } of keys) {
			const raw = await kv.get(name);
			if (!raw) continue;
			try {
				const r = JSON.parse(raw) as TripRecord;
				const existing = map.get(r.id);
				if (!existing || ((r.updatedAt || r.createdAt) > (existing.updatedAt || existing.createdAt))) {
					map.set(r.id, r);
				}
			} catch { /* ignore */ }
		}
	}
	return Array.from(map.values()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
```

Why: This preserves availability during rollout and prevents empty dashboards for legacy users.

**Restore normalization:**
- Before writing restored data back to KV, set `restored.userId = userId` (the canonical UUID), and rewrite any embedded HNS ids as needed to avoid reversion to legacy keys.

---

### 6) `src/lib/server/expenseService.ts` and `src/lib/server/mileageService.ts` — mirror `tripService` changes

**Existing code:** Both services accept a single `userId` and call DO/kv only for that prefix.

**Proposed changes:**
- Add optional `legacyId?: string` to `list()` and `get()` and implement the same merge/fallback/dedup logic shown for `tripService`.
- In `restore()`, set `restored.userId = userId` before writing and normalize any embedded IDs.

Why: Ensures parity across all data types and prevents data loss during the rollout.

---

### 7) `src/lib/server/userService.ts` — Durable Object WIPE uses username only

**Existing code:**

```ts
const id = resources.tripIndexDO.idFromName(user.username);
const stub = resources.tripIndexDO.get(id);
await stub.fetch('http://internal/admin/wipe-user', {...});
```

**Proposed replacement:**

```ts
// Wipe both UUID DO and legacy username DO to be safe
const idByUuid = resources.tripIndexDO.idFromName(userId);
const idByName = resources.tripIndexDO.idFromName(user.username);
const stubUuid = resources.tripIndexDO.get(idByUuid);
const stubName = resources.tripIndexDO.get(idByName);
// Call WIPE on both stubs (ignore 404/404-equivalent errors)
await Promise.all([
	stubUuid.fetch('http://internal/admin/wipe-user', ...),
	stubName.fetch('http://internal/admin/wipe-user', ...)
]);
```

Why: Prevents 'zombie' DO state tied to legacy username from surviving a user deletion.

---

### 8) `src/lib/server/authenticatorService.ts` — credential index migration

**Existing code examples:** uses `await kv.put(`credential:${authenticator.credentialID}`, userId)` when registering.

**Proposed migration addition (script):**

```ts
// In storage-key-migration.ts
async function migrateAuthenticators(kv: KVNamespace, userId: string, userName: string, apply = false) {
	const oldKey = `authenticators:${userName}`;
	const newKey = `authenticators:${userId}`;
	const data = await kv.get(oldKey, 'json');
	if (!data) return 0;
	if (!await kv.get(newKey)) {
		if (apply) await kv.put(newKey, JSON.stringify(data));
	}
	for (const auth of data) {
		if (apply) await kv.put(`credential:${auth.credentialID}`, userId);
	}
	return data.length;
}
```

Why: Ensures passkeys remain usable and that credential lookup returns UUIDs not usernames.

---

### 9) Client-side Svelte files (dashboard pages, offline logic) — local-storage/ID usage

**Examples found:**
- `src/routes/dashboard/trips/+page.svelte` uses `currentUser?.name || currentUser?.token || localStorage.getItem('offline_user_id')` to compute a local key.
- `src/routes/dashboard/hughesnet/+page.svelte` uses `$user?.name || $user?.token`.

**Proposed guidance:**
- Update client code to prefer `user.id` (exposed via `load()` or `$user`) and, during rollout, attempt to read local stores (`IndexedDB` / `localStorage`) using both `id` and legacy `name` prefixes and migrate local drafts to the `id` prefix.
- Example (Svelte):

```js
let storageId = currentUser?.id || currentUser?.name || localStorage.getItem('offline_user_id') || '';
// Prefer ID but accept legacy and schedule a local migration if using legacy name
```

Why: Client must also be resilient to the key flip; otherwise local sync and offline drafts will be lost or duplicated.

---

### 10) HughesNet HNS ID rewrite (prevent duplicates)

**Existing issue in migration:** `migrateKeyspace()` preserves record `id`s. For HNS records with `id` fields like `hns_${userName}_${date}`, this will cause the running service to create `hns_${userId}_${date}` duplicates.

**Proposed change:** During migration, detect `id` fields that embed `userName` (e.g., `/^hns_${userName}_/`) and rewrite to `hns_${userId}_...` both in the key and in the JSON payload `id` field.

Why: Prevents duplicate HughesNet trips after migration and avoids confusing users.

---

### Key parsing vulnerability (colons in usernames) & worker limits ⚠️

Finding: `migrateKeyspace()` extracts the record suffix using `oldKey.split(':')` and `parts.slice(2).join(':')`. If a legacy `userName` contains a colon (e.g., `user:name`), the split indices shift and the extracted `recordId` will be incorrect, leading to missed/misplaced records or failing writes.


**Exact code to change (existing → safe replacement)**

Existing code (vulnerable):

```ts
// src/lib/server/migration/storage-key-migration.ts (current)
const parts = oldKey.split(':');
if (parts.length < 3) {
	log.warn('[MIGRATION] Invalid legacy key format, skipping', { oldKey });
	continue;
}
const recordId = parts.slice(2).join(':'); // fragile when username contains ':'
const newKey = `${newPrefix}${recordId}`;
```

Safer replacement (use known prefix length):

```ts
// REPLACE with this in migrateKeyspace
const legacyPrefix = `${recordType}:${userName}:`;
if (!oldKey.startsWith(legacyPrefix)) {
	log.warn('[MIGRATION] Unexpected key prefix, skipping', { oldKey, expected: legacyPrefix });
	continue;
}
const recordId = oldKey.substring(legacyPrefix.length); // robust regardless of ':' in username
const newKey = `${newPrefix}${recordId}`;
```

Why: `substring(legacyPrefix.length)` extracts the suffix irrespective of characters inside `userName`, avoiding subtle parsing bugs caused by additional colons. It is deterministic because `legacyPrefix` is computed from the known recordType and the supplied `userName` value.

---

### Worker execution limits & batching (implementation guidance)

Finding: `migrateUserStorageKeys()` is triggered from `platform.context.waitUntil()` (e.g., during login). If a user has thousands of records, doing all of them in one invocation can exceed Cloudflare Worker CPU/time limits (wall-time ~30s), causing an abrupt stop and incomplete migration.

Agreement: I agree — add a batching/resume mechanism and limit per-invocation work.

**Status:** ✅ Batched/resumable migration implemented (`runBatchedMigration`, `migrateKeyspace`) with optional `BETA_MIGRATIONS_KV` cursor persistence. (See `src/lib/server/migration/storage-key-migration.ts`)

Recommended changes (add to `storage-key-migration.ts`):

- Add a `BATCH_LIMIT` constant and persist a cursor/offset in `BETA_MIGRATIONS_KV` so the migration can resume across multiple `waitUntil` invocations.
- Apply **dry-run** first (no writes) and then run **apply** with the same cursor progression.

Example batched migration loop to insert into `migrateKeyspace()`:

```ts
const cursorKey = `migration:${userId}:cursor:${recordType}`;
const savedCursor = (await migrationsKV.get(cursorKey)) || undefined;
let list = await kv.list({ prefix: legacyPrefix, cursor: savedCursor, limit: 1000 });
let processed = 0;
const BATCH_LIMIT = 100; // tunable
while (list.keys.length > 0) {
	for (const { name: oldKey } of list.keys) {
		// existing per-key migration logic (use substring approach)
		processed++;
		if (processed >= BATCH_LIMIT) {
			// Save continuation cursor and exit this invocation
			await migrationsKV.put(cursorKey, list.cursor || oldKey);
			log.info('[MIGRATION] Batch limit reached, will resume later', { userId, recordType, processed });
			return processed; // end this run early
		}
	}
	if (list.list_complete) break;
	list = await kv.list({ prefix: legacyPrefix, cursor: list.cursor, limit: 1000 });
}
// If we finish the keyspace, clear the cursor
await migrationsKV.delete(cursorKey);
```

Why: This avoids Worker timeouts and gives operational control over throughput. It also provides better observability and the ability to retry/resume safely.

---

### Non-destructive migration (avoid immediate delete) & race mitigation

Finding: Deleting the legacy key immediately after copying risks a 'lost update' if a concurrent client writes to the legacy key between copy and delete.

Recommendation: Use a two-phase non-destructive approach:
- Phase A (apply): Write the new key and **mark** the legacy key as `migrated: true` using metadata or copy it to a `legacy-backup:` prefix with a TTL (e.g., 30 days).
- Phase B (cleanup): After a grace period and monitoring, run a cleanup pass that deletes legacy keys verified as quiescent.

Example (apply mode per-key):

```ts
// after writing new key
if (options.apply) {
	await kv.put(newKey, data, { metadata: { migratedFrom: oldKey, migratedAt: new Date().toISOString() } });
	// Mark legacy key as migrated rather than deleting immediately
	await kv.put(oldKey, data, { metadata: { migratedAt: new Date().toISOString(), migratedTo: newKey } });
	// Optional: also write a backup copy
	// await backupKV.put(`legacy-backup:${oldKey}`, data, { expirationTtl: 60 * 60 * 24 * 30 });
}
```

Why: This dramatically reduces the 'lost update' window and provides recovery if late writes occur to legacy keys.

---

### Login background trigger: ensure it uses batched/resumable migration

Finding: `src/routes/login/+server.ts` schedules a background migration with `platform.context.waitUntil()` and calls `await (svc as any).migrateUser?.(username, userId);`.

Risk: If `migrateUser` is not batched/resumable, a single login could attempt a full, potentially long-running migration that times out.

Recommendation: Change the background call to a batched runner, or make it schedule an admin job that runs the batched migration across multiple `waitUntil` invocations. Example:

```ts
platform.context.waitUntil(runBatchedMigration(env, userId, username));

// runBatchedMigration would call migrateKeyspace with batch limits and persist cursor to migrationsKV
```

---

### Race-condition summary (acceptance & trade-offs)

There is a small window for 'lost update' as described in the plan — copying and then deleting a legacy key can lose later writes to legacy key. For this personal logging app we agree the pragmatic mitigation (mark + grace period + cleanup pass) is sufficient and more operationally feasible than distributed locking.

---

I will now add explicit unit-test stubs and a grep checklist to the plan for verifying the above changes if you'd like.
### Avoid 'delete on write' race (Lost Update mitigation)

Issue: If you delete the legacy key immediately after copying to the new key, there is a risk of losing concurrent updates that happen between the read and delete window (device A migrates, device B later writes to legacy key, then the migration deletes it).

Recommendation:
- Do NOT delete legacy key immediately. Instead:
  - Option A (safer): Copy to `trip:{userId}:{id}` and then mark the legacy key with `metadata.migratedAt` or `metadata.migratedTo` and set a TTL (e.g., 7 days) before deletion.
  - Option B (robust): Move the legacy key to a backup prefix (e.g., `legacy-backup:{oldKey}` or `trash`) with a TTL so recovery is possible.

Example (apply mode):

```ts
// After writing newKey
if (options.apply) {
  await kv.put(newKey, data, { metadata: { migratedFrom: oldKey, migratedAt: new Date().toISOString() } });
  // Mark legacy key as migrated (do not delete immediately)
  await kv.put(oldKey, data, { metadata: { migratedAt: new Date().toISOString(), migratedTo: newKey } });
  // Optionally move to backup: await backupKV.put(`legacy:${oldKey}`, data, { expirationTtl: 60 * 60 * 24 * 30 });
}
```

After a safe grace period (monitoring shows no writes to legacy keys), run a cleanup pass that deletes legacy keys.

Why: This eliminates the 'lost update' window and gives you an opportunity to detect and reconcile late writes.

---

### Race-condition note (acceptance & trade-offs)

There is a theoretical 'lost update' window (Device A migrates while Device B writes to legacy key). For this personal logging app this risk is small and typically acceptable; if you require absolute protection you'd need distributed locking (complex). The recommended approach above (no immediate delete + grace-period cleanup + reconciliation pass) is a pragmatic mitigation.

---

### HughesNet "Time Bomb" verification (frontend dependency check)

Finding: We will rewrite `hns_${userName}_...` IDs to `hns_${userId}_...` during migration to avoid duplicates. Before applying this, verify the frontend does not parse the ID to extract the username.

What to grep for (example commands):
- `grep -R "hns_" src | sed -n '1,200p'` — find all references to `hns_`.
- `grep -R "split\('\_'\)" src | sed -n '1,200p'` — find splitting by underscore.
- Search for code using `id.split('_')` and indexing into the result to get username.

If you find client code that parses IDs to get username, update it to:
- Treat IDs as opaque strings for identification.
- If a username is needed for UI, include a separate explicit `ownerName`/`ownerDisplayName` field in the trip payload (and migrate it during `migrateKeyspace`).

Why: Changing ID format without updating client-side parsing can break the UI or produce incorrect usernames in the display.

---

Add these three items into the migration checklist and unit tests (safe substringing, batch limit with cursor, delayed legacy deletion + cleanup pass), and include verification steps to confirm no front-end code depends on parsing the HNS ids.
---

If you'd like, I can continue and append unit test stubs and exact test vectors for each of the changes above into this document (recommended). Which part shall I document next: tests, admin dry-run CLI, or add a grep checklist for PR reviewers?
**Settings Dual-Read (must be added to settings endpoint):**

- `src/routes/api/settings/+server.ts` currently reads `settings:${user.id}` only. Add fallback to check `settings:${user.name}` when `settings:${user.id}` is missing, and schedule a `migrateSingleKey()` for that user's settings if found.

```ts
let settings = await settingsKV.get(`settings:${user.id}`, 'json');
if (!settings && user.name) {
	settings = await settingsKV.get(`settings:${user.name}`, 'json');
	if (settings) scheduleSettingsMigration(user.id, user.name);
}
````

**WebAuthn / Passkey Credential Index Migration:**

- `src/lib/server/authenticatorService.ts` depends on `credential:{credentialId}` -> `userIdentifier`. Ensure migration script rewrites credential index entries to point to UUIDs (not usernames). Example:

```ts
async function migrateAuthenticators(kv: KVNamespace, userId: string, userName: string) {
	const oldKey = `authenticators:${userName}`;
	const newKey = `authenticators:${userId}`;
	const data = await kv.get(oldKey, 'json');
	if (!data) return 0;

	if (!(await kv.get(newKey))) await kv.put(newKey, JSON.stringify(data));

	for (const auth of data as any[]) {
		await kv.put(`credential:${auth.credentialID}`, userId);
	}
	return 1;
}
```

- Also update `getUserIdByCredentialID()` to handle missing mappings gracefully and to report credentials needing migration (do **not** return legacy usernames as session ids).

**migrateSingleKey helper (implement in script):**

- Add and use `migrateSingleKey(kv, oldKey, newKey)` for settings, authenticators, meta counters (trip_count), and other one-off key moves. This prevents omissions and centralizes dry-run/apply behavior.

---

Make sure these fixes are included in the atomic PR that changes `getStorageId()` or gate that change behind a feature flag. A partial deploy that only flips the helper will break users.

5. **Authenticators 'Split Brain' (Passkey / WebAuthn risk)** ⚠️
   - Problem: Two storage locations exist for WebAuthn authenticators: `user:{userId}` (field `authenticators`) and `authenticators:{userId}`. Some code writes to the user core (e.g., `saveAuthenticator` in `userService.ts`) while the WebAuthn endpoints read from `authenticatorService` (`authenticators:{userId}`). If legacy data uses `authenticators:{username}` the authenticator endpoints will return empty after switching to UUID keys.
   - Files confirmed: `src/lib/server/userService.ts` (stores `authenticators` inside user core), `src/lib/server/authenticatorService.ts` (uses `authenticators:{userId}` and `credential:{credentialId}` index), and `src/routes/api/auth/webauthn/+server.ts` (reads authenticators via `authenticatorService`).
   - Fix: Add `migrateAuthenticators(kv, userId, userName)` to `storage-key-migration.ts` that:
     - Copies `authenticators:${userName}` → `authenticators:${userId}` (if new key absent).
     - Ensures `credential:{credentialId}` indexes point to `userId` (create if missing).
     - Optionally consolidate on `authenticatorService` as canonical storage and remove redundant `authenticators` field inside `user:{userId}` or keep both but keep them synchronized.

   Example (TypeScript):

   ```ts
   async function migrateAuthenticators(kv: KVNamespace, userId: string, userName: string) {
   	const oldKey = `authenticators:${userName}`;
   	const newKey = `authenticators:${userId}`;

   	const data = await kv.get(oldKey, 'json');
   	if (!data) return;

   	// Only write if new key absent
   	const existing = await kv.get(newKey);
   	if (!existing) {
   		await kv.put(newKey, JSON.stringify(data));
   	}

   	// Ensure credential index exists for each authenticator
   	for (const auth of data) {
   		await kv.put(`credential:${auth.credentialID}`, userId);
   	}
   }
   ```

   - Verification: After migrating, `getUserAuthenticators(kv, userId)` returns the expected list and `kv.get('credential:{credentialId}')` returns `userId` for each credential.

6. **HughesNet Trip ID mismatch (duplicates risk)** ⚠️
   - Problem: HughesNet-generated trip IDs embed the username (`hns_{username}_{date}`). If migration copies records but does not rewrite the embedded username within the trip `id` (and key suffix), the running HughesNet sync code (which generates `hns_${userId}_${date}`) will look for a different ID and create duplicate trips.
   - Files confirmed: `src/lib/server/hughesnet/service.ts` (constructs `tripId = \`hns*${userId}*${date}\``) and `src/lib/server/hughesnet/tripBuilder.ts` (sets `id: \`hns_${userId}\_${date}\``). Migration current implementation (`migrateKeyspace`) preserves record IDs and will not update hns IDs.
   - Fix: Update `migrateKeyspace()` and/or add HNS-specific rewrite logic so that when migrating trip keys whose record IDs start with `hns_${userName}_`, the migration rewrites them to `hns_${userId}_` and updates the `id` field inside the JSON payload accordingly. Also add dual-read fallback in `hughesnet/service.ts` so that sync attempts will check for both `hns_${userId}_${date}` and legacy `hns_${userName}_${date}` IDs to avoid accidental duplicates during rollout.

   Example (TypeScript) — small rewrite snippet to insert in the migration loop:

   ```ts
   // Inside your migration loop for trips:
   const recordId = oldKey.split(':')[2];
   let newRecordId = recordId;

   // Detect and rewrite HughesNet IDs
   if (recordId.startsWith(`hns_${userName}_`)) {
   	newRecordId = recordId.replace(`hns_${userName}_`, `hns_${userId}_`);

   	// CRITICAL: Update the 'id' field inside the JSON blob too
   	if (data.id === recordId) {
   		data.id = newRecordId;
   	}
   }

   const newKey = `${newPrefix}${newRecordId}`;
   ```

   - Verification: After migrating a test user, attempt an HNS sync and assert no duplicate trip is created for the same date. Validate KV contains only `trip:{userId}:hns_{userId}_{date}` (or that dual-read finds existing legacy id and no duplicates were appended).

7. **Missing Data Source: `BETA_USER_SETTINGS_KV` (settings loss risk)** ⚠️
   - Problem: Some user settings may have been previously stored under `settings:{username}` instead of `settings:{userId}`. The current migration handles `hns:settings` but does not explicitly move `settings:{username}` → `settings:{userId}` in `BETA_USER_SETTINGS_KV`.
   - Files confirmed: `src/routes/api/settings/+server.ts` and various code points use `settings:{userId}`. Wrangler bindings include `BETA_USER_SETTINGS_KV`.
   - Fix: Add `migrateUserSettings(kv, userId, userName)` to `storage-key-migration.ts` that copies `settings:${userName}` to `settings:${userId}` (if new key absent) and optionally deletes the old key after verification.

---

## Simulated Runbook: Step-by-step (dry-run → apply) 🔬

Below I simulate the full migration exactly as it would be executed in staging and production. Each step includes:

- The **existing code** block (what's currently in the repo),
- The **new code** block (what we'd change to),
- A short **why** explaining the rationale,
- **Verification** commands and checks to run (dry-run first), and
- **Rollback** and monitoring suggestions.

Note: This document is a simulation and should be used as the canonical runbook for engineers and operators; no code is changed as part of this doc edit.

---

### Pre-flight: backup, discovery & quick checks ✅

1. Inventory & grep
   - Command: grep -R "user\?\.name ||| userSafe\?\.name" src | tee migration-grep.txt
   - Goal: produce exhaustive list of call-sites that derive storage from username or token.

2. Snapshot KVs (staging)
   - Use the worker dev-list tooling or a small script to export keys for target users.
   - Example: `node tools/export-kv-namespace.js --namespace BETA_USER_SETTINGS_KV --prefix settings: --out staging-settings.json`

3. Create migration audit KV (record dry-run traces)
   - Write to `BETA_MIGRATIONS_KV` with per-user dry-run result summaries:
     - `migration:{userId}:dryrun:{timestamp}` -> {counts, diff, warnings}

Verification (pre-flight):

- Ensure `npm run check` passes in local branch with no lint/TS errors related to the planned diffs.
- Create a small test user in staging with legacy username keys present (`settings:legacyname`, `trip:legacyname:...`).

Rollback: abort if any pre-flight exported snapshot fails or the grep finds additional untracked patterns.

---

### Step 1 (Phase 1): Implement Service Dual-Read + API call-site updates 🧭

Goal: Make reads resilient to the eventual getStorageId flip by enabling services to accept a legacy identifier and merge results.

A. Trip service (`src/lib/server/tripService.ts`)

Existing code (excerpt):

```ts
async function listFromKV(userId: string): Promise<TripRecord[]> {
  const prefix = prefixForUser(userId);
  let list = await kv.list({ prefix });
  // ... only reads `trip:{userId}:`
}

async get(userId: string, tripId: string) {
  const key = `trip:${userId}:${tripId}`;
  const raw = await kv.get(key);
  return raw ? JSON.parse(raw) : null;
}
```

Proposed new code (excerpt):

```ts
async function listFromKV(userId: string, legacyId?: string): Promise<TripRecord[]> {
  const prefixes = [`trip:${userId}:`];
  if (legacyId) prefixes.push(`trip:${legacyId}:`);
  // Read both prefixes, dedupe by id, prefer latest updatedAt
}

async get(userId: string, tripId: string, legacyId?: string) {
  // Try canonical first
  let raw = await kv.get(`trip:${userId}:${tripId}`);
  if (raw) return JSON.parse(raw);
  // Fallback to legacy
  if (legacyId) {
    const lraw = await kv.get(`trip:${legacyId}:${tripId}`);
    if (lraw) {
      // Schedule migrateSingleKey(kv, `trip:${legacyId}:${tripId}`, `trip:${userId}:${tripId}`) in background (dry-run)
      return JSON.parse(lraw);
    }
  }
  return null;
}
```

Why: Prevents empty dashboards if the canonical UUID keys are absent. Also sets up scheduling for targeted single-key migration when we find legacy data.

Verification (dev/staging):

- Unit tests: create KV entries under `trip:legacyname:foo` and assert `list(userId, legacyName)` returns trip data.
- Integration: in staging, call `GET /api/trips` with `user.id` set to UUID and `user.name` set to legacy name; expect non-empty result and no changes to KV in dry-run.
- Test idempotency: re-run list twice; verify no duplicate writes to KV or DO.

Rollback: Revert service changes if tests fail; keep `getStorageId()` unchanged.

B. Expense & Mileage services

- Mirror Trip service changes: add optional `legacyId` to list/get and implement same dedupe logic.

C. API call site changes (example: `src/routes/api/trips/+server.ts`)

Existing code (excerpt):

```ts
const storageId = userSafe?.name || userSafe?.token || '';
const allTrips = await svc.list(storageId, { since });
```

New code (excerpt):

```ts
import { getStorageId, getLegacyStorageId } from '$lib/server/user';
const storageId = getStorageId(user);
const legacyName = getLegacyStorageId(user);
const allTrips = await svc.list(storageId, { since }, legacyName);
```

Why: Keep existing behavior but pass both identifiers to service, so the service can perform dual-read.

Verification:

- Run unit/integration tests that exercise `GET /api/trips` and confirm legacy trips appear.
- Monitor logs for `[DualRead]` entries indicating legacy fallback hits.

---

### Step 2: Add Settings Dual-Read & Scheduling (CRITICAL) ⚠️

**This MUST be part of Phase 1** — settings are small and high-impact if missed.

Existing GET (current):

```ts
const raw = await kv.get(`settings:${user.id}`);
const settings = raw ? JSON.parse(raw) : {};
return json(settings);
```

New GET (dual-read + background scheduling):

```ts
const userId = user.id;
const legacyName = user.name;
const idKey = `settings:${userId}`;
const nameKey = legacyName ? `settings:${legacyName}` : undefined;
let raw = await kv.get(idKey);
let settings = raw ? JSON.parse(raw) : null;
if (!settings && nameKey) {
	const legacyRaw = await kv.get(nameKey);
	if (legacyRaw) {
		settings = JSON.parse(legacyRaw);
		// Schedule migrateSingleKey(kv, nameKey, idKey, { apply: false }) as a background task
	}
}
return json(settings || {});
```

Why: Settings control UX and preferences; failing to add dual-read causes instant resets to defaults for users.

Verification:

- Create a staging user with `settings:{username}` present only; call GET and verify non-default settings return.
- Confirm a dry-run migration scheduled record is written to `BETA_MIGRATIONS_KV` for the user.

Rollback: If fallback logic causes slowdowns, revert to safe early return but **do not** flip `getStorageId()` until fixed.

---

### Step 3: HughesNet endpoint hardcoded fix (immediate) 🛡️

Existing (vulnerable):

```ts
const userId = user?.name || user?.token || user?.id || 'default_user';
```

Fixed (safe):

```ts
const userId = user?.id || '';
const legacyName = user?.name;
if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });
// Pass legacyName to HughesNetService methods
```

Why: This endpoint bypasses `getStorageId()` and would persist vulnerability if left unchanged.

Verification:

- Unit test: ensure service gets both `userId` and `legacyName` and that `getSettings` checks both `hns:settings:${userId}` and `hns:settings:${legacyName}`.

---

### Step 4: Add missing helpers to migration script (dry-run first) 🧰

**Add**: `migrateSingleKey(kv, oldKey, newKey, {apply:false})` and `migrateAuthenticators(...)`.

Existing: migration script references `migrateSingleKey()` but does not define it.

New helper (exact snippet — already documented above):

```ts
async function migrateSingleKey(kv, oldKey, newKey, options = {apply:false}) { ... }
```

Why: Prevents `ReferenceError` and provides dry-run vs apply semantics.

Verification (dry-run):

- Run: `node tools/run-migration.js --user-id <uuid> --dry-run` which calls `migrateUserStorageKeys(..., apply=false)`.
- Expected output: counts of keys that would be moved, `BETA_MIGRATIONS_KV` entry with `dryRun: true`, and no `put` or `delete` operations performed.

Example dry-run expected log:

```
[MIGRATION] Dry-run: settings: 1, trips: 25, expenses: 3, hns-orders: 4
```

Rollback: Dry-run is non-destructive.

---

### Step 5: DO state migration & `deleteUser` hardening

Existing `deleteUser()` uses `tripIndexDO.idFromName(user.username)` only.

New behavior: call WIPE on both `idFromName(userId)` and `idFromName(user.username)`.

Why: Prevents 'zombie' DO state referencing legacy username from surviving a deletion.

Verification:

- After migration dry-run for a test user: ensure DO `/migrate` to new stub returns expected counts.
- After apply, confirm `tripIndexDO` `/list` on the old DO returns empty.

---

### Step 6: HNS ID rewrite logic (prevent duplicates)

When migrating a `trip` record whose `id` matches `^hns_${userName}_`, rewrite the record `id` to `hns_${userId}_...` and store at `trip:${userId}:hns_${userId}_...`.

Why: HughesNet sync generates new IDs using `userId`; failing to rewrite creates duplicates.

Verification:

- Dry-run: list impacted orders and show `oldId` → `newId` mappings.
- Apply: after migrating a test user, run an HNS sync and assert no duplicate trips are created.

---

### Step 7: Small-batch Apply (admin-controlled) 🚦

Process:

1. Pick a small cohort of 10 internal test users with known legacy keys.
2. In staging, run migration in `apply` mode for those users: `node tools/run-migration.js --users users.txt --apply`.
3. Verify:
   - `kv.get('settings:{userId}')` equals old `settings:{userName}` value,
   - `trip` counts in `trip:${userId}:` equal expected migrated counts,
   - DO `/list` counts match `meta:user:{userId}:trip_count`.
4. Monitor application logs and alerting for 24 hours.

Rollback: If an issue occurs, restore from KV snapshots made during pre-flight and mark migration roll back in `BETA_MIGRATIONS_KV`.

---

### Step 8: Full-batch Apply & cleanup ✅

After small-batch validation, run migration for remaining users in larger batches (throttled). Once complete and verified (no retention issues, no duplicates, passkeys valid), flip the `getStorageId()` change to return ID-only globally and remove dual-read fallback follow-up steps:

- Remove `getLegacyStorageId()` references or deprecate them.
- Remove legacy client read logic after a safe period and confirmation.

Post-migration verification:

- Run `npm run check`, `npm run lint`, `npx eslint .` and run integration/e2e tests.
- Manual check: log in as migrated users, verify settings, trips, passes.
- Remove feature-flag guards and delete legacy keys on a delayed schedule (e.g., 30 days) once confident.

---

### Emergency rollback plan 🛟

If severe issues arise (e.g., mass data loss or security regression):

1. Revert the release that enabled `getStorageId()` ID-only (feature flag off or code revert).
2. Rehydrate KVs from snapshots taken during Pre-flight.
3. Run targeted reconciliation script to detect missing migrations and either re-run apply for affected users or restore from snapshots.
4. Postmortem and corrective tests.

---

### Tests & Monitoring (summary) 📋

- Unit tests for each service dual-read merge logic & `migrateSingleKey()` dry-run semantics.
- Integration tests for settings GET fallback and scheduled migration queue entry.
- E2E tests: create user with legacy keys → sign in → verify dashboard shows expected data and no duplicates after migration.
- Monitoring: create Grafana panels for `migration:applied`, `migration:dryrun`, `migration:skipped` and alert on unexpected `error` rate increases in API endpoints.

---

If you'd like I can now append **concrete test stubs** and **CLI examples** used to run a dry-run+apply, or generate a PR checklist (grep entries + required tests) for reviewers to validate these changes before merging. Which would you prefer next?

Example (TypeScript):

```ts
// Add to migrateUserStorageKeys function
async function migrateUserSettings(kv: KVNamespace, userId: string, userName: string) {
	const oldKey = `settings:${userName}`;
	const newKey = `settings:${userId}`;

	const settings = await kv.get(oldKey);
	if (settings) {
		// Only migrate if new settings don't exist yet
		const existing = await kv.get(newKey);
		if (!existing) {
			await kv.put(newKey, settings);
		}
	}
}
```

- Verification: After migrating a test user, assert `kv.get('settings:{userId}')` exists and equals the pre-migration username-based settings value, and legacy `settings:{userName}` is deleted or marked migrated.

---

## I will also add related unit tests and dry-run checks to ensure these two risks are covered in the migration pipeline.

### Confirmed file audit (evidence)

- `src/lib/server/tripService.ts`: uses `meta:user:${userId}:trip_count` and `meta:user:${userId}:index_dirty`. (Confirmed via code scan.)
- `src/lib/server/TripIndexDO.ts`: supports `/list`, `/migrate`, `/put`; DO state keyed by `idFromName()` thus needs migration between `name` and `id` instances. (Confirmed.)
- `src/routes/api/hughesnet/+server.ts`: contains `user?.name || user?.token || user?.id || 'default_user'` pattern; will not be fixed by `getStorageId()` alone. (Confirmed via grep search.)

---

### Action items to add to the plan (required before Step 1)

1. Update migration utility (`src/lib/server/migration/storage-key-migration.ts`) to also migrate `meta:user:{username}:*` keys, including `trip_count`, `index_dirty`, `monthly_count:*`, and `storage_migrated` flags. Include dry-run behavior.
2. Add DO migration steps: fetch from old DO (`idFromName(oldName)`) `/list` and push summaries to new DO (`idFromName(userId)`) `/migrate`. Verify counts and mark DO `index_dirty` for re-sync on failure.
3. Change the rollout plan: mark Step 1 as an **atomic release** (getStorageId + dual-read + manual refactors) or gate via feature-flag to ensure no interim breakage.
4. Manually refactor all hardcoded patterns that derive storage IDs from `user.name`/`user.token` (especially `src/routes/api/hughesnet/*`). Add a grep-and-PR checklist for these files and require tests.
5. Add `migrateAuthenticators(kv, userId, userName)` to migrate `authenticators:{username}`→`authenticators:{userId}`, ensure credential indexes (`credential:{credentialID}`) point to `userId`, and consolidate storage of passkeys to a single canonical location (recommend `authenticatorService`). Add unit + integration tests for WebAuthn endpoints to verify behavior after migration.
6. Update `migrateUserStorageKeys` to also call the `BETA_USER_SETTINGS_KV` migration helper and assert settings move successfully in dry-run mode.
7. Update `migrateKeyspace()` to rewrite internal record fields (at minimum `userId` and HughesNet embedded `id`s) during the copy so migrated records cannot be re-written back to legacy keys by normal service saves (prevents the "Reversion Loop").
8. Implement `dual-read` / `legacy fallback` in `tripService` (and `expenseService`, `mileageService`) so that reads check legacy prefixes when ID-prefixed keys return empty. Example:

```ts
// In src/lib/server/tripService.ts
async function listFromKV(userId: string, legacyUsername?: string): Promise<TripRecord[]> {
	const prefix = `trip:${userId}:`;
	const keys = await fetchKeys(kv, prefix);

	// FAILSAFE: If no keys found, and legacy name is provided, check legacy bucket
	if (keys.length === 0 && legacyUsername) {
		const legacyPrefix = `trip:${legacyUsername}:`;
		const legacyKeys = await fetchKeys(kv, legacyPrefix);
		if (legacyKeys.length > 0) {
			log.info(`[DualRead] User ${userId} has data at ${legacyUsername}. Returning legacy data.`);
			return fetchAndParse(kv, legacyKeys);
		}
	}
	// ... existing logic
}
```

Add unit + integration tests for dual-read behavior and throttle/feature-flag gating for production rollouts.

9. **Fix Account Deletion DO wipe (Zombie Data bug)** — Update `deleteUser()` to wipe the **old username-based DO instance** _and_ the **new UUID-based DO instance** to prevent leaving user data orphaned after migration. Include dry-run tests and idempotency checks so wipe commands are safe to re-run and log the operation for audit.

```ts
// In src/lib/server/userService.ts — replace current DO wipe with both targets
if (resources?.tripIndexDO) {
	const doSecret = resources.env?.DO_INTERNAL_SECRET ?? '';
	const idOld = resources.tripIndexDO.idFromName(user.username);
	const idNew = resources.tripIndexDO.idFromName(user.id);

	await Promise.all([
		resources.tripIndexDO.get(idOld).fetch('http://internal/admin/wipe-user', {
			method: 'POST',
			headers: { 'x-do-internal-secret': doSecret }
		}),
		resources.tripIndexDO.get(idNew).fetch('http://internal/admin/wipe-user', {
			method: 'POST',
			headers: { 'x-do-internal-secret': doSecret }
		})
	]);
	log.debug(`[UserService] Sent WIPE command to DO for ${user.username} and ${user.id}`);
}
```

- Verification: after wipe, assert new DO returns empty `/list` and `meta:user:{userId}:trip_count` is cleared.

10. **Client-side Nuke / SW bump** — Add a concrete client-side mismatch detection and clearing flow and bump `src/service-worker.ts` version during rollout to force clients to update. Add a small helper in `syncManager` and call it from `src/routes/dashboard/+layout.svelte` on login: detect any local records where `rec.userId !== currentUser.id`, clear `trips` and `syncQueue` stores, and re-run `syncManager.initialize()`; show a one-time toast informing users of the forced re-sync.

11. **Purge Legacy Trash KV & Remove Trash Binding** — If `BETA_TRASH_KV` is deprecated, purge it (see Step 2 purge plan above), remove `trashKV` references from `deleteUser()` and other code paths, and delete the `BETA_TRASH_KV` binding from `wrangler.toml`/preview configs. Add a small admin audit endpoint `GET /admin/migration/legacy-trash-status` that reports counts and last-scan timestamp before purge.

12. **Tombstone Deep Update (Tombstone Time Bomb)** — During migration do a deep update of any tombstone records to prevent re-injection of legacy ownership:

- Update top-level `userId` to the UUID.
- If a `backup` object exists, update `backup.userId` and all `backup.id` fields (particularly HNS ids) to the UUID-based forms.
- Ensure `migrateKeyspace()` (and `migrateTrash()` where applicable) performs the deep update before writing the new key and before deleting the legacy key.

- Verification: add a unit/integration test that runs: create a tombstone under `trip:{username}:{id}` whose `backup.userId === username`, run the migration, call `restore()` and assert that the restored trip exists only at `trip:{userId}:{id}` and no `trip:{username}:{id}` is created during/after the restore.

---

### Six FINAL critical gaps (MUST FIX before running migration)

The following items have emerged from a final pass across `src/routes/api/*`, `src/lib/server/*`, and client code. These are critical — if skipped, they will break reads, settings, login (passkeys), Stripe downgrades, and create ghost data client-side.

1. Hardcoded logic in `api/trips` (and peers)

- Finding: `src/routes/api/trips/+server.ts` and its id route contain `const storageId = userSafe?.name || userSafe?.token || ''` and similar hardcoded patterns.
- Fix: Replace all occurrences in `src/routes/api/**` with `getStorageId(userSafe)` (or `userSafe?.id || ''`) and pass `legacyName` into service calls for dual-read. Add a grep-and-PR checklist: `grep -R "userSafe\?\.name" src/routes/api | sort`.

2. Settings & HNS split brain

- Finding: `api/settings` reads `settings:{uuid}` while HNS historically read/wrote `settings:{username}`.
- Fix: Ensure `BETA_USER_SETTINGS_KV` is included in `migrateUserStorageKeys()` and add `migrateUserSettings()` that copies `settings:{username}` → `settings:{userId}` when destination absent.

3. Reversion Loop (JSON content must be normalized)

- Finding: Services rely on `record.userId` to compute keys. Migrated records with `userId === username` will revert on update. Tombstones are a special case: their `backup` field may still reference legacy `userId` and legacy `id`s, causing a `restore()` to write records back to username-based keys (the _Tombstone Time Bomb_).
- Fix: During `migrateKeyspace()` and `migrateTrash()` parse JSON and perform a **deep update**:
  - Set `record.userId = userId`.
  - Update `record.backup.userId` to the UUID and rewrite `record.backup.id` values (e.g., HNS ids) as described above.
  - If the record or backup had `hns_{username}_` IDs, rewrite them to `hns_{userId}_` and adjust the key suffix accordingly.
  - Use the rewritten payload when writing the new key and delete the legacy key only after verifying the new key is present.

  Add unit tests that simulate migrating a tombstone and then restoring it; assert the restore writes to the UUID prefix and does not re-create the legacy username key.

4. Stripe webhook timeout/backfill mapping

- Finding: `src/routes/api/stripe/webhook/+server.ts` falls back to scanning the `user:` keyspace when `stripe:customer:{cid}` mapping is missing — this can time out on Workers.
- Fix: Add `migrateStripeMappings()` to the migration script and an admin bulk backfill to ensure `stripe:customer:{cid}` → `{userId}` mappings exist for all customers before enabling webhook-based downgrades.

5. WebAuthn authenticator migration (Lockout risk)

- Finding: Authenticator data may exist at `authenticators:{username}` while the auth endpoints read `authenticators:{userId}`.
- Fix: Add `migrateAuthenticators()` to copy `authenticators:{username}` → `authenticators:{userId}`, create `credential:{credentialId}` → `userId` entries, and delete legacy keys when safe.

6. Client-side Ghost Data / Nuke Switch

- Finding: Local IndexedDB files with `userId: username` will not match server UUIDs and can result in duplicates or ghost records.
- Fix: Implement a client full-re-sync: (a) bump `src/service-worker.ts` version to force update, and (b) in `syncManager.initialize()` or `src/routes/dashboard/+layout.svelte` detect mismatch (`localRec.userId !== currentUser.id`), clear IndexedDB stores (`trips`, `syncQueue`) and trigger `syncManager.initialize()` to `syncDownAll()`.

7. Zombie Data Deletion Bug (Durable Object wipe target) — CRITICAL

- Finding: `deleteUser()` currently targets the DO instance derived from `user.username` only. After switching to UUID-based storage the user's active data will reside in a DO instance keyed by `idFromName(user.id)`, leaving that data untouched while the username-based DO is wiped (zombie data remains).
- Fix: Update `deleteUser()` to target **both** DO instances (username and UUID) or switch to UUID-only (only after dual-read is deployed and verified). Add idempotency and verification: after the wipe confirm the new DO `/list` is empty and clear `meta:user:{userId}:trip_count`.

- Quick verification checklist:
  - Call `/list` on both DO instances and assert 0 rows returned.
  - `kv.get('meta:user:{userId}:trip_count')` is null or zero.
  - Audit log records both wipe commands and their results.

8. Zombie Trash (Legacy Trash KV purge) — CRITICAL

- Finding: `BETA_TRASH_KV` contains legacy deleted items which, if left in place, allow `Restore` endpoints or admin utilities to re-inject username-keyed records into the active system and re-open the ATO vector.
- Fix: **Purge** `BETA_TRASH_KV` in a controlled, auditable way (snapshot -> dry-run listing & sampling -> apply delete in batches -> post-purge verification) and then remove any runtime references and the `BETA_TRASH_KV` binding. Do **not** migrate trash items to new keys; purge them when they are known to be deprecated.

- Verification checklist:
  - Snapshot of `BETA_TRASH_KV` stored securely before purge.
  - Dry-run counts per-user and sample items reviewed/redacted for audit.
  - Post-purge `kv.list({ prefix: 'trash:' })` returns 0 keys.
  - `RESTORE` endpoints cannot find legacy items and return 404 for purged items.
  - Audit log records purge counts, who ran it, and when.

---

### Final Implementation Plan (concise)

Step 1 — Code-first (atomic deploy)

- Refactor `src/lib/server/user.ts` (`getStorageId()` → UUID-only + `getLegacyStorageId()`).
- Replace hardcoded `userSafe?.name` usages in `src/routes/api/*` (search/replace + tests); specifically fix `src/routes/api/trips/*` and `src/routes/api/hughesnet/*`.
- Add dual-read prototypes into `tripService` (and peers) and unit tests.
- Add client-side full-re-sync logic and bump `service-worker` version.

Step 2 — Migration script (deploy, then run)

- Extend `storage-key-migration.ts` to:
  - **Deep Update Tombstones (prevent the _Tombstone Time Bomb_)** — Parse tombstone JSON and perform a deep update:
    1. Update top-level `record.userId` to the UUID.
    2. If `record.backup` exists, update `backup.userId` to the UUID.
    3. If `backup.id` or `record.id` contains a HughesNet ID `hns_{username}_...`, rewrite it to `hns_{uuid}_...` and update all references inside the backup and metadata.

    Example (TypeScript):

    ```ts
    const record = JSON.parse(data);

    // Top-level
    if (record.userId === userName) record.userId = userId;

    // Backup (deep update)
    if (record.backup) {
    	if (record.backup.userId === userName) record.backup.userId = userId;
    	if (typeof record.backup.id === 'string' && record.backup.id.startsWith(`hns_${userName}_`)) {
    		record.backup.id = record.backup.id.replace(`hns_${userName}_`, `hns_${userId}_`);
    	}
    }

    // Also rewrite top-level id if necessary
    if (typeof record.id === 'string' && record.id.startsWith(`hns_${userName}_`)) {
    	record.id = record.id.replace(`hns_${userName}_`, `hns_${userId}_`);
    }

    // Write the modified JSON to the new key
    await kv.put(newKey, JSON.stringify(record), { metadata: oldMetadata });
    ```

  - Rewrite other JSON payloads (`record.userId = uuid` and HNS id rewrites) consistently across all namespaces.
  - Migrate `settings:{username}` → `settings:{uuid}` (BETA_USER_SETTINGS_KV).
  - Migrate `authenticators:{username}` → `authenticators:{uuid}` and credential indexes.
  - Migrate meta keys: `meta:user:{username}:trip_count` → `meta:user:{uuid}:trip_count` and `index_dirty`.
  - Backfill `stripe:customer:{customerId}` → `{userId}` mappings.
  - Call DO `/migrate` to populate new DO instance and verify counts; set `meta:user:{uuid}:index_dirty` on failure.
  - **Purge Legacy Trash KV (BETA_TRASH_KV)** — If this namespace is no longer used for active trash, perform a controlled purge instead of migrating items to avoid re-introducing username-keyed records. Steps:
    1. **Snapshot** `BETA_TRASH_KV` (export or snapshot) and store audit logs; never proceed without a snapshot.
    2. **Dry-run**: list keys with `prefix: 'trash:'`, count items per user, redact PII in logs, and confirm no necessary data remains.
    3. **Purge**: in apply mode, iterate keys in small batches (BATCH_SIZE=100) and `delete()` each key, recording counts and any errors to `BETA_MIGRATIONS_KV`.
    4. **Verification**: run a post-purge dry-run that confirms zero keys remain and sample application flows (restore endpoints) no longer find legacy artifacts.
    5. **Remove bindings & code**: remove `BETA_TRASH_KV` binding from `wrangler.toml`, delete cleanup code that references `trashKV` (see `deleteUser()`), and remove migration logic for `migrateTrash()` once purge is confirmed.

Step 3 — Execution

- Put system into maintenance mode (prevent client writes, or at least disable background sync).
- Deploy code changes (atomic PR) to staging → run tests, smoke test migration for a small cohort.
- Deploy to production.
- Run migration (dry-run first, then apply) for batches.
- After migration: clear client IndexedDB via SW update + client re-sync; run DO index repairs if necessary.

Step 4 — Post-migration

- Monitor metrics, audit logs, and support tickets. Roll back if >1% migrations fail or if dashboard-empty reports spike.

---

These additions complete the final critical checklist. If you agree, I can now draft the exact code changes for `storage-key-migration.ts` (including unit & integration tests) and a grep/PR script to find and refactor remaining hardcoded `userSafe?.name` usages. Which would you prefer me to prepare next?

---

I agree with your three points — they are correct and critical. I've updated the plan with explicit steps, verification checks, and the code pseudocode required to address each one. Would you like me to:

- Draft the exact changes to `storage-key-migration.ts` (including `migrateMetaKeys()` and DO migration pseudocode) and the unit tests (dry-run + apply), or
- Draft a single atomic PR that contains `getStorageId()` change, `getLegacyStorageId()`, dual-read implementations in `tripService` (prototype), and automatic checks for meta key/DO migration to ensure safe deployment?

Which path should I prepare next?

---

_Document generated as planning artifact; no production code was modified in this step._
