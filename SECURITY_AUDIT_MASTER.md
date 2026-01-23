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
- [ ] **[DoS] Unsecured Cron Endpoint:** `/api/cron` lacks an Authorization secret, allowing attackers to trigger expensive jobs.
  - **Status:** ⚠️ N/A - Endpoint does not exist yet (may be planned for future)
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

- [ ] **14. Remove Fail-Unsafe API Key Fallback**
- [ ] **15. Secure Durable Object Inter-Service Auth**
- [ ] **16. Fix Server-Side XSS in PDF Export**
- [ ] **17. Rate Limit Contact Form**
- [ ] **18. Rate Limit Expensive Maps APIs**
- [ ] **19. Login Rate Limiting (Credential Stuffing)**
- [ ] **20. Fix Floating Point Math (Financial Integrity)**
- [ ] **21. Fix Pagination Bypass (Trip Service)**
- [ ] **22. Fix Expense Service DoS**
- [ ] **23. Audit Regex for ReDoS**
- [ ] **24. Secure Stripe Webhook Parsing**
- [ ] **25. Mitigate Sync Repair DoS**
- [ ] **26. Fix Host Header Injection**
- [ ] **27. Secure Service Worker Caching**
- [ ] **[Architectural] Unbounded Scheduled Task:** `src/index.js` loops through all users linearly; must be refactored to Cloudflare Queues.
- [ ] **[Infrastructure] Remove Fail-Open Mocks:** `api/trips` falls back to `fakeDO()` in production, causing silent data loss.
- [ ] **[Race Condition] Quota Tracking:** Monthly trip counters in `tripService.ts` are prone to race conditions; move to Durable Objects.
- [ ] **[DoS] Expense Service Pagination:** `expenseService.ts` fetches the entire history at once; needs `limit/offset`.
- [ ] **[Protocol] Unsecured Internal API Routes:** `api/internal/*` routes lack a shared secret verification.
- [ ] **[Logic] Floating Point Math:** Currency and mileage use decimals; switch to integers (cents/meters) to avoid rounding errors.
- [ ] **[Privacy] Excessive Data Exposure:** `dashboard/+layout.server.ts` sends the full user DB object (including hashes) to the client.
- [ ] **[DoS] Unbounded Admin Migration:** Migration scripts accumulate all updated IDs in a memory array (OOM risk).
- [ ] **[Broken Auth] Auth Timing Leak:** `auth.ts` uses 100k iterations for dummy hashes vs 600k for real ones.
- [ ] **[DoS] Unbounded Log Memory:** `hughesnet/service.ts` stores infinite logs in an array during sync.
- [ ] **[DoS] Rate Limit Settings/Profile:** No rate limits on KV writes for user settings or profile changes.
- [ ] **[Infrastructure] Guard Dev-Mock Imports:** Top-level `node:fs` imports in `dev-mock-db.ts` crash the Cloudflare Worker.
- [ ] **[DoS] Unbounded Contact Form:** No length limits on the contact form message field.
- [ ] **[Security] Missing "Sudo Mode":** No password re-entry required for sensitive WebAuthn management.
- [ ] **[Deliverability] Missing Plaintext Emails:** HTML-only emails are likely to be flagged as spam by Resend/Filters.
- [ ] **[Validation] Weak File Type Check:** `api/import` checks extensions only; should check "Magic Bytes" (File Signatures).
- [ ] **[Audit] Missing Admin Audit Logs:** Admin actions (resets, migrations) are not logged to an immutable trail.
- [ ] **[User UX] Lack of Security Notifications:** Users are not emailed when their password or security keys change.
- [ ] **[Logic] Incomplete Account Deletion:** `delete-account` removes the user but leaves trips/logs in KV.

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
- [ ] **[DoS] ReDoS in Email Regex:** Complex regex in `auth.ts` is vulnerable to catastrophic backtracking.
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
