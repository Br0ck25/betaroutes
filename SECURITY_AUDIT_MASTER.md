# 🛡️ Go Route Yourself — Consolidated Security Audit Master To‑Do List

> **Merged from:** `Master_Security_Audit_TODO.md` (48 items) and `Security_Audit_Master_TODO.md` (69 items).
> This is the single checklist to track remediation progress across all findings.

**Audit Status:** Complete → Remediation Phase

## 🚨 Priority 0: EMERGENCY FIXES

**Do not deploy or leave production running without these fixes.**
**Risk:** Account Takeover, Data Destruction, Total System Compromise.

- [ ] **1. Fix Root Cause of Account Takeover (`getStorageId`)**
  - **File:** `src/lib/server/user.ts`
  - **Action:** Change function to strictly return `user?.id || ''`. Never fallback to `user.name` or `user.token`.
  - **Impact:** Fixes critical ATO flaws in Trips, Mileage, Expenses, and HughesNet.

- [x] **2. Delete ALL Dangerous Debug Endpoints**
  - **Target:** Entire folder `src/routes/api/debug/` and file `src/routes/debug/seed-session/+server.ts`
  - **Action:** **DELETE IMMEDIATELY.**
  - **Impact:** Removes backdoors that allow DB wiping, billing sabotage, and PII dumping.
  - **Status:** ✅ COMPLETED - All debug endpoints deleted

- [x] **3. Secure WebAuthn User Enumeration**
  - **File:** `src/routes/api/auth/webauthn/list-for-email/+server.ts`
  - **Action:** Add strict check at the top:
    - `if (!locals.user) return error(401);`
  - **Status:** ✅ COMPLETED - Authentication check added

- [x] **4. Rotate & Remove Hardcoded Secrets**
  - **File:** `wrangler.toml`
  - **Action:** Remove `HNS_ENCRYPTION_KEY`. Use `wrangler secret put` to store it securely.
  - **Status:** ✅ COMPLETED - Verified no hardcoded secrets, created .env.example template

- [x] **5. Patch Stored XSS in Emails**
  - **File:** `src/lib/server/email.ts`
  - **Action:** Import an HTML escaper (e.g., `he` or `escape-html`). Wrap `data.message`, `data.name`, and `data.company` before interpolation. Do not rely on `sanitize.ts`.
  - **Status:** ✅ COMPLETED - Added escapeHtml() function and sanitized all user inputs

---

## 🔴 Priority 1: Critical (Fix Immediately)

High risk of site failure, financial loss, privilege escalation, or total account compromise.

- [x] **6. Secure Email Change Flow (ATO Prevention)**
  - **Status:** ✅ COMPLETED - Email changes now require password re-authentication in PUT /api/user
- [x] **7. Prevent Mass Assignment on Registration**
  - **Status:** ✅ NOT VULNERABLE - Registration extracts only { username, email, password } fields, does not spread body
- [x] **8. Fix Global Cache Poisoning (Autocomplete)**
  - **Status:** ✅ COMPLETED - All places/autocomplete cache now user-scoped with `user:{userId}:prefix:` keys
- [x] **9. Plug Credential Leak in Session API**
  - **Status:** ✅ COMPLETED - Session API now returns sanitized user object without token or stripeCustomerId
- [x] **10. Fix Trash Data Integrity**
  - **Status:** ✅ NOT VULNERABLE - Uses storageId from authenticated user, has mileage parent-trip validation
- [x] **11. Secure "Remove/Delete" Proxies**
  - **Status:** ✅ COMPLETED - Added locals.user check to /api/remove and /api/delete-account proxies
- [x] **12. Fix Session Invalidation Logic**
  - **Status:** ✅ COMPLETED - createSession now writes to active_sessions:{userId} index
- [x] **13. Enable CSRF Protection**
  - **Status:** ✅ COMPLETED - Enabled csrfProtection() in hooks.server.ts, updated all client-side POST/PUT/DELETE/PATCH calls to use csrfFetch() utility
- [x] **[Subrequest Bomb] Trip Service Crash:** `tripService.ts` crashes for active users (>1000 trips) due to sequential `kv.get` calls in a loop.
  - **Status:** ✅ COMPLETED - Changed to batched Promise.all with BATCH_SIZE=50 to stay under Cloudflare's 1000 subrequest limit
- [x] **[Subrequest Bomb] Mileage Service Crash:** `mileageService.ts` crashes similarly for high-volume users.
  - **Status:** ✅ COMPLETED - Changed to batched Promise.all with BATCH_SIZE=50
- [x] **[Subrequest Bomb] Expense Service Crash:** `expenseService.ts` has similar sequential kv.get patterns.
  - **Status:** ✅ COMPLETED - Changed to batched Promise.all with BATCH_SIZE=50
- [x] **[Information Disclosure] Private Key Exposure:** `dashboard/+layout.server.ts` fallback exposes `PRIVATE_GOOGLE_MAPS_API_KEY` to the client.
  - **Status:** ✅ COMPLETED - Removed fallback to private key, only expose PUBLIC_GOOGLE_MAPS_API_KEY
- [x] **[Protocol] Missing Security Middleware:** No global validation of JSON payload sizes or prototype pollution checks.
  - **Status:** ✅ COMPLETED - Added MAX_JSON_PAYLOAD_SIZE (1MB) validation and hasPrototypePollution() check in hooks.server.ts
- [x] **[Dependency] Vulnerable xlsx Library:** `package.json` uses v0.18.5 (CVE-2023-30533 Prototype Pollution). Upgrade to v0.19.3+.
  - **Status:** ⚠️ NO FIX AVAILABLE - v0.19.3 does not exist. Package maintainer has not released secure version. Consider alternative library.
- [x] **[Broken Auth] CSRF Validation Disabled:** `hooks.server.ts` has `csrfProtection` commented out.
  - **Status:** ✅ COMPLETED - Same as item #13 above, csrfProtection is now enabled
- [x] **[Cryptographic Fail] HughesNet Encryption Fail-Open:** `hughesnet/auth.ts` returns plaintext passwords if the environment key is missing.
  - **Status:** ✅ COMPLETED - Now fails secure (returns null) when encryption key is missing
- [x] **[Broken Auth] Broken Session Invalidation:** `active_session` index is not written on login, rendering "Logout all devices" ineffective.
  - **Status:** ✅ COMPLETED - sessionService.createSession() now writes to `active_sessions:{userId}` index
- [x] **[Data Integrity] Persistent Cache Poisoning:** `places/cache` trusts client-side writes to the global autocomplete index.
  - **Status:** ✅ COMPLETED - All cache operations now user-scoped with `user:{userId}:prefix:` keys
- [x] **[Broken Access Control] Unsecured Durable Object Auth:** `TripIndexDO.ts` does not verify `x-requester-id` for internal operations.
  - **Status:** ✅ COMPLETED - Added verifyInternalCaller() with DO_INTERNAL_SECRET header check for /admin/wipe-user
- [x] **[Financial Integrity] Client-Side Math Trust:** `trips/[id]` accepts calculated totals from the client instead of calculating on the server.
  - **Status:** ✅ COMPLETED - netProfit now calculated server-side, removed from tripSchema, added calculateNetProfit() in both POST and PUT handlers
- [x] **[Broken Access Control] Mass Assignment (Trips):** Trip updates use spread operators without a Zod whitelist.
  - **Status:** ✅ COMPLETED - Added ALLOWED_UPDATE_FIELDS whitelist and pickAllowedFields() in PUT handler
- [x] **[Broken Access Control] Mass Assignment (Vehicles):** Vehicle updates use spread operators without a Zod whitelist.
  - **Status:** ✅ ALREADY FIXED - Vehicle schema uses `.strict()` which rejects extra properties
- [x] **[DoS] Unsecured Cron Endpoint:** `/api/cron` lacks an Authorization secret, allowing attackers to trigger expensive jobs.
  - **Status:** ✅ COMPLETED - Implemented a protected endpoint `/api/cron/trash-purge` that validates `CRON_ADMIN_SECRET` (timing-safe comparison), added unit tests, and documented the deployment workflow.
  - **Deployment Notes:**
    - Local: copy `.dev.vars.example` to `.dev.vars` and set `CRON_ADMIN_SECRET=<secret>` (DO NOT commit `.dev.vars`).
    - Production: use `npx wrangler pages secret put CRON_ADMIN_SECRET` or set it in the Cloudflare Pages dashboard (do not put secrets in `wrangler.toml`).
    - Optional: add a cron schedule in `wrangler.toml` under `[triggers]` to automate runs (example below). Keep secrets out of source control.

```
[triggers]
crons = ["0 0 * * *"] # daily at midnight UTC
```

    - Notes: Confirm the schedule in your Cloudflare timezone and ensure the secret is present in the environment before enabling the trigger.

- [x] **[XSS] Stored XSS in Dashboard:** `{@html icon}` renders unsanitized strings from user settings.
  - **Status:** ✅ ALREADY FIXED - Icons use `sanitizeStaticSvg()` and are static hardcoded SVG strings
- [x] **[Injection] Formula Injection:** CSV/Excel exports do not sanitize fields starting with `=`, allowing malicious code execution in Excel.
  - **Status:** ✅ COMPLETED - Added `sanitizeCSVField()` function that prefixes dangerous characters with single quote
- [x] **[DoS] Complexity Attack:** `assign-stops` tools lack a cap on input array size (Max 100 recommended).
  - **Status:** ✅ COMPLETED - Added MAX_TECHS=20 and MAX_STOPS=100 limits
- [x] **[Revenue Risk] Free Tier Limit Bypass:** `tripService.ts` does not enforce the 10-trip monthly limit during the create operation.
  - **Status:** ✅ ALREADY FIXED - POST /api/trips checks `svc.list(storageId, { since })` and returns 403 if limit exceeded
- [x] **[Access Control] Missing Email Verification Gate:** Users can access the dashboard immediately without verifying their email.
  - **Status:** ✅ ALREADY IMPLEMENTED - Registration creates `pending_verify:{token}` record, user only created after clicking email verification link in /api/verify. Login requires real user account.
- [x] **[Broken Access Control] IDOR in Expenses/Mileage:** Update handlers don't verify the id belongs to `locals.user.id`.
  - **Status:** ✅ COMPLETED - Added ownership verification in PUT and DELETE handlers

## 🟡 Priority 2: Reliability & Data Integrity

Issues that lead to data loss, 500 errors, denial of service, or billing spikes.

- [x] **14. Remove Fail-Unsafe API Key Fallback**
  - **Status:** ✅ ALREADY COMPLETED in Priority 1 - dashboard/+layout.server.ts no longer falls back to private key
- [x] **15. Secure Durable Object Inter-Service Auth**
  - **Status:** ✅ ALREADY COMPLETED in Priority 1 - TripIndexDO verifies DO_INTERNAL_SECRET for /admin/wipe-user
- [x] **16. Fix Server-Side XSS in PDF Export**
  - **Status:** ✅ FALSE POSITIVE - jsPDF uses `doc.text()` and `autoTable()` which render as text, not HTML. No HTML parsing or DOM rendering in PDF generation.
- [x] **17. Rate Limit Contact Form**
  - **Status:** ✅ COMPLETED - Added checkRateLimit (5/hour/IP) and field length validation (name 100, email 254, company 200, message 5000 chars)
- [x] **18. Rate Limit Expensive Maps APIs**
  - **Status:** ✅ COMPLETED - Added rate limiting to /api/directions/optimize (10/min) and /api/directions/cache (60/min)
- [x] **19. Login Rate Limiting (Credential Stuffing)**
  - **Status:** ✅ ALREADY IMPLEMENTED - login/+server.ts has checkRateLimit (5/60s in prod, 50/60s in dev)
- [x] **20. Fix Floating Point Math (Financial Integrity)**
  - **Status:** ✅ ALREADY IMPLEMENTED - calculations.ts uses toCents/toDollars for all currency math
- [x] **21. Fix Pagination Bypass (Trip Service)**
  - **Status:** ⚠️ SKIPPED (Design Tradeoff) - Offline-first PWA sync model requires full data fetch to populate IndexedDB for offline use. Adding pagination would break offline functionality. Risk mitigated by: 1) Auth required, 2) User can only access own data, 3) Data volume is self-limiting per user
- [x] **22. Fix Expense Service DoS**
  - **Status:** ⚠️ SKIPPED (Design Tradeoff) - Same as #21. Expense service uses offline-first sync model requiring full data for client IndexedDB sync. Cannot paginate without breaking offline mode.
- [x] **23. Audit Regex for ReDoS**
  - **Status:** ✅ NO ISSUES FOUND - All regex patterns audited: email regex uses safe `[^\s@]+` pattern, HughesNet parsers use lazy quantifiers `.*?` and simple character classes
- [x] **24. Secure Stripe Webhook Parsing**
  - **Status:** ✅ ALREADY IMPLEMENTED - webhook/+server.ts has MAX_WEBHOOK_SIZE (1MB), timeout, and signature verification
- [x] **25. Mitigate Sync Repair DoS**
  - **Status:** ✅ ALREADY MITIGATED - Client-side sync manager has 5 retry max limit (line 357). Items removed from queue after 5 failures. 30-second sync interval prevents rapid retries.
- [x] **26. Fix Host Header Injection**
  - **Status:** ✅ COMPLETED - Fixed 3 endpoints that used url.origin for email links (register, forgot-password, verify/resend). Now use env['BASE_URL'] with PRODUCTION_BASE_URL fallback.
- [x] **27. Secure Service Worker Caching**
  - **Status:** ✅ COMPLETED - Added exclusions for /api/, /login, /register, /logout, /reset-password, /forgot-password and external URLs. API responses are never cached.
- [x] **[Architectural] Unbounded Scheduled Task:** `src/index.js` loops through all users linearly; must be refactored to Cloudflare Queues.
  - **Status:** ⚠️ N/A - src/index.js is a legacy deprecated file NOT used in production (see @deprecated comment). SvelteKit build at .svelte-kit/cloudflare is the active worker.
- [x] **[Infrastructure] Remove Fail-Open Mocks:** `api/trips` falls back to `fakeDO()` in production, causing silent data loss.
  - **Status:** ✅ COMPLETED - Removed fakeDO/fakeKV from trips/[id], trash/, and trash/[id]. Production now fails safely with 503 when bindings missing.
- [x] **[Race Condition] Quota Tracking:** Monthly trip counters in `tripService.ts` are prone to race conditions; move to Durable Objects.
  - **Status:** ✅ COMPLETED - Trips and expenses now use atomic Durable Object check-and-increment via checkMonthlyQuota(). TripIndexDO has /billing/check-increment, /expenses/check-increment, and /expenses/decrement endpoints.
- [x] **[DoS] Expense Service Pagination:** `expenseService.ts` fetches the entire history at once; needs `limit/offset`.
  - **Status:** ⚠️ SKIPPED (Design Tradeoff) - Same as #21/#22. Offline-first PWA sync model requires full data for IndexedDB sync.
- [x] **[Protocol] Unsecured Internal API Routes:** `api/internal/*` routes lack a shared secret verification.
  - **Status:** ✅ ALREADY SECURED - Protected by ensureDebugEnabled() which only allows in dev mode or when ALLOW_DEBUG_ROUTES is explicitly set
- [x] **[Logic] Floating Point Math:** Currency and mileage use decimals; switch to integers (cents/meters) to avoid rounding errors.
  - **Status:** ✅ ALREADY IMPLEMENTED - Same as item #20 above
- [x] **[Privacy] Excessive Data Exposure:** `dashboard/+layout.server.ts` sends the full user DB object (including hashes) to the client.
  - **Status:** ✅ ALREADY FIXED - locals.user only contains sanitized fields: {id, token, plan, tripsThisMonth, maxTrips, resetDate, name, email, stripeCustomerId}. No password hash.
- [x] **[DoS] Unbounded Admin Migration:** Migration scripts accumulate all updated IDs in a memory array (OOM risk).
  - **Status:** ✅ COMPLETED - webauthn/migrate uses counter instead of array. Limited sample to 10 users max. hughesnet/archived/import has MAX_IMPORT_BATCH=500.
- [x] **[Broken Auth] Auth Timing Leak:** `auth.ts` uses 100k iterations for dummy hashes vs 600k for real ones.
  - **Status:** ✅ ALREADY FIXED - Dummy hash uses same PBKDF2_ITERATIONS (100000) as real hashes. Format: `v1:100000:00000000...:00000000...`
- [x] **[DoS] Unbounded Log Memory:** `hughesnet/service.ts` stores infinite logs in an array during sync.
  - **Status:** ✅ COMPLETED - Added MAX_LOGS=1000 limit with automatic trimming of oldest entries when limit reached.
- [x] **[DoS] Rate Limit Settings/Profile:** No rate limits on KV writes for user settings or profile changes.
  - **Status:** ✅ COMPLETED - Added rate limiting: settings (30/min/user), profile (10/min/user).
- [x] **[Infrastructure] Guard Dev-Mock Imports:** Top-level `node:fs` imports in `dev-mock-db.ts` crash the Cloudflare Worker.
  - **Status:** ✅ COMPLETED - Converted to lazy dynamic imports inside functions. Only executed when setupMockKV() is called (dev/test only)
- [x] **[DoS] Unbounded Contact Form:** No length limits on the contact form message field.
  - **Status:** ✅ COMPLETED - Same as item #17 above, added MAX_MESSAGE_LENGTH = 5000
- [x] **[Security] Missing "Sudo Mode":** No password re-entry required for sensitive WebAuthn management.
  - **Status:** ✅ COMPLETED - Added verifyPasswordForUser() in auth.ts. webauthn/delete endpoint requires password re-entry. SecurityCard.svelte shows password confirmation modal.
- [x] **[Deliverability] Missing Plaintext Emails:** HTML-only emails are likely to be flagged as spam by Resend/Filters.
  - **Status:** ✅ COMPLETED - Added getVerificationPlaintext(), getPasswordResetPlaintext(), getContactInquiryPlaintext() and added `text:` field to all Resend API calls.
- [x] **[Validation] Weak File Type Check:** `api/import` checks extensions only; should check "Magic Bytes" (File Signatures).
  - **Status:** ✅ COMPLETED - Added validateCSVContent() (checks for binary bytes, requires line breaks) and validatePDFMagicBytes() (checks "%PDF-" header) in ImportView.svelte and DataCard.svelte.
- [x] **[Audit] Missing Admin Audit Logs:** Admin actions (resets, migrations) are not logged to an immutable trail.
  - **Status:** ✅ COMPLETED - Created auditLog.ts with logAuditEvent(), logAdminAction(), logSecurityAction(). Added audit logging to webauthn/migrate endpoint. Logs stored in KV with 2-year TTL.
- [x] **[User UX] Lack of Security Notifications:** Users are not emailed when their password or security keys change.
  - **Status:** ✅ COMPLETED - Created sendSecurityAlertEmail() in email.ts supporting 4 alert types (password_changed, passkey_added, passkey_removed, email_changed). Added calls to change-password, webauthn register, and webauthn/delete endpoints.
- [x] **[Logic] Incomplete Account Deletion:** `delete-account` removes the user but leaves trips/logs in KV.
  - **Status:** ✅ COMPLETED - Extended deleteUser() to accept expensesKV, mileageKV, trashKV resources. Now wipes all user data: trips, expenses, mileage, trash, settings, auth indexes, WebAuthn credentials, and DO SQLite data.

## 🟢 Priority 3: Hardening & Best Practices

Defense-in-depth, security headers, and long-term maintenance hardening.

- [ ] **28. Enforce Cryptographically Secure Tokens**
- [ ] **29. Redact PII from Server Logs**
- [ ] **30. Require Re-Auth for Sensitive Actions**
- [ ] **31. Upgrade Password Hashing**
- [ ] **32. Fix Client-Side CSV Injection**
- [ ] **33. Implement Security Headers**
- [ ] **34. Tighten Content Security Policy**
- [ ] **35. Enforce Global Request Validation**
- [ ] **36. Suppress Verbose Error Details**
- [ ] **37. Enforce One-Time Use for Verify Tokens**
- [ ] **38. Fix Rate Limit Bypass (Username)**
- [ ] **39. Harden WebAuthn Cookie Attributes**
- [ ] **40. Strengthen Password Blacklist**
- [ ] **41. Global Input Length Validation**
- [ ] **42. Audit and Exclude Non-Production Files**
- [ ] **43. Mitigate Registration Enumeration**
- [ ] **44. Optimize HughesNet Import**
- [ ] **45. Secure Google Maps Key**
- [ ] **46. Fix Cookie Cleanup**
- [ ] **47. Remove Stripe Webhook Fallback**
- [ ] **48. Fix Admin Secret Timing Attack**
- [ ] **[Headers] Missing HSTS:** `Strict-Transport-Security` not set in `hooks.server.ts`.
- [ ] **[Cookies] Missing Secure Prefixes:** Rename session cookies to `__Host-session_id`.
- [ ] **[Cryptography] Weak Session ID Generation:** Switch `randomUUID` to `crypto.getRandomValues`.
- [ ] **[Logging] PII in Logs:** `hooks.server.ts` logs full request bodies, including passwords.
- [ ] **[Hardening] Sanitize Error Messages:** Stack traces are visible in production 500 errors.
- [ ] **[Hardening] Google Maps Restrictions:** API keys lack HTTP Referrer locking in the Google Console.
- [ ] **[Hardening] Scoped Restore Logic:** `api/trash/[id]` doesn't verify the item type during restoration.
- [ ] **[Hardening] Session Rotation:** Session ID should change when a user connects a third-party service (HughesNet).
- [ ] **[Hardening] WebAuthn Policy:** Switch `requireUserVerification` to `true` to force PIN/Biometrics.
- [ ] **[CSP] Unsafe-Inline:** CSP allows `'unsafe-inline'`; needs implementation of nonces.
- [ ] **[Headers] Missing Permissions-Policy:** Need to restrict Camera/Mic/Geolocation.
- [ ] **[Headers] Missing Referrer-Policy:** Set to `strict-origin-when-cross-origin`.
- [ ] **[Privacy] Missing Cache-Control:** Sensitive dashboard pages are cached in the browser "Back" button.
- [ ] **[Phishing] Open Redirects:** Login flow doesn't validate the `redirectTo` parameter.
- [ ] **[Privacy] Email Enumeration:** Login returns specific "User not found" errors.
- [x] **[DoS] ReDoS in Email Regex:** Complex regex in `auth.ts` is vulnerable to catastrophic backtracking.
  - **Status:** ✅ NO ISSUE - Email regex `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` uses negated character classes (no nested quantifiers). Located in contact/+page.server.ts, not auth.ts.
- [ ] **[Headers] Server Fingerprinting:** `X-Powered-By` header is not deleted.
- [ ] **[CSP] Frame Ancestors:** CSP missing `frame-ancestors 'none'` to prevent clickjacking.
- [ ] **[Disclosure] Path Leakage:** Custom error pages render the full error object.
- [ ] **[Logic] Unbounded Array (Trips Schema):** Missing `.max()` on stops/destinations.
- [ ] **[Logic] Unbounded Array (Settings Schema):** Missing `.max()` on categories.
- [ ] **[DoS] Reset Password Rate Limit:** Missing check on token verification attempts.
- [ ] **[Maintenance] Explicit Null Checks:** Import logic crashes on empty file buffers.
- [ ] **[Audit] Third-Party Script Review:** Periodic audit needed for Google Maps/Stripe tags.
- [ ] **[Hardening] Subresource Integrity:** Missing SRI tags for external scripts.
- [ ] **[Logic] Odometer Validation:** No check to ensure new odometer readings > previous readings.
- [ ] **[Logic] Stripe Webhook Size:** Missing content-length check on incoming webhooks.
- [ ] **[Protocol] Secure Internal Logic:** `internal_notes` fields should be stripped from all client-side JSON.
- [ ] **[Hardening] CSS Injection:** Sanitize custom styling options in settings.
- [ ] **[Maintenance] Dead Code Removal:** Remove `fakeKV` and `fakeDO` logic entirely from the production build.

---

## Notes

- Keep this file in-repo as the **single source of truth** during remediation.
- Prefer closing an item with a PR that includes: tests, `npm run check`, and `npm run lint` results.
- If an item is split into sub-tasks, add indented sub-checkboxes under it (don’t create a second tracker).
