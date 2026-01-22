# Master Security Audit To-Do List

**Total Issues:** 48  
**Status:** Audit Complete (Remediation Phase)

---

## 🚨 Priority 0: EMERGENCY FIXES

**Do not deploy or leave production running without these fixes.**  
**Risk:** Account Takeover, Data Destruction, Total System Compromise.

- [x] **1. Fix Root Cause of Account Takeover (`getStorageId`)**
  - **File:** `src/lib/server/user.ts`
  - **Action:** Change function to strictly return `user?.id || ''`. Never fallback to `user.name` or `user.token`.
  - **Impact:** Fixes critical ATO flaws in Trips, Mileage, Expenses, and HughesNet.

- [x] **2. Delete ALL Dangerous Debug Endpoints**
  - **Target:** Entire folder `src/routes/api/debug/` and file `src/routes/debug/seed-session/+server.ts`
  - **Action:** **DELETE IMMEDIATELY.**
  - **Impact:** Removes backdoors that allow DB wiping, billing sabotage, and PII dumping.

- [x] **3. Secure WebAuthn User Enumeration**
  - **File:** `src/routes/api/auth/webauthn/list-for-email/+server.ts`
  - **Action:** Add strict check at the top:
    - `if (!locals.user) return error(401);`

- [x] **4. Rotate & Remove Hardcoded Secrets**
  - **File:** `wrangler.toml`
  - **Action:** Remove `HNS_ENCRYPTION_KEY`. Use `wrangler secret put` to store it securely.

- [x] **5. Patch Stored XSS in Emails**
  - **File:** `src/lib/server/email.ts`
  - **Action:** Import an HTML escaper (e.g., `he` or `escape-html`). Wrap `data.message`, `data.name`, and `data.company` before interpolation. Do not rely on `sanitize.ts`.

---

## 🔥 Priority 1: CRITICAL FIXES

**Address immediately to prevent privilege escalation and corruption.**  
**Risk:** Privilege Escalation, Cache Poisoning, Data Integrity.

- [x] **6. Secure Email Change Flow (ATO Prevention)**
  - **File:** `src/routes/api/user/+server.ts`
  - **Action:** Stop updating email immediately in `PUT`. Generate a token → email the new address → update DB only on verification.

- [x] **7. Prevent Mass Assignment on Registration**
  - **File:** `src/routes/register/+server.ts`
  - **Action:** Explicitly destructure allowed fields. Do not use `...body`.
    - Example: `const user = { email: body.email, password: hash, name: body.name }`

- [x] **8. Fix Global Cache Poisoning (Autocomplete)**
  - **Files:** `src/routes/api/autocomplete/+server.ts`, `src/lib/server/tripService.ts`
  - **Action:** Stop writing user inputs to the global `BETA_PLACES_KV`. Write only to user-specific lists.

- [x] **9. Plug Credential Leak in Session API**
  - **File:** `src/routes/api/auth/session/+server.ts`
  - **Action:** Return only safe fields (`id`, `email`, `name`). Explicitly exclude `password_hash`, `salt`, `iterations`.

- [x] **10. Fix Trash Data Integrity**
  - **File:** `src/lib/server/tripService.ts`
  - **Action:** Clone the trip object before setting `totalMiles = 0` so the backup (`tombstone.backup`) is not corrupted.

- [x] **11. Secure "Remove/Delete" Proxies**
  - **Files:** `src/routes/api/delete-account/+server.ts`, `src/routes/api/remove/+server.ts`
  - **Action:** Add `if (!locals.user)` checks to prevent unauthorized calls.

- [x] **12. Fix Session Invalidation Logic**
  - **File:** `src/routes/api/change-password/+server.ts`
  - **Action:** Implement `sessionVersion` logic. Increment on password change; check version in `hooks.server.ts`.

- [x] **13. Enable CSRF Protection**
  - **File:** `src/hooks.server.ts`
  - **Action:** Uncomment CSRF protection and token generation logic.

---

## ⚠️ Priority 2: HIGH PRIORITY

**Fix to ensure reliability, prevent DoS, and stop billing abuse.**  
**Risk:** Denial of Service, Financial Loss, Internal Auth Bypass.

- [x] **14. Remove Fail-Unsafe API Key Fallback**
  - **File:** `src/routes/dashboard/+layout.server.ts`
  - **Action:** Delete the `if (privateKey)` block. Never send server keys to the frontend.

- [x] **15. Secure Durable Object Inter-Service Auth**
  - **File:** `src/lib/server/TripIndexDO.ts`
  - **Action:** Pass `requesterId` in all DO calls. Validate `requesterId === ownerId` inside the DO before processing.
  - **Note:** DO is already isolated by userId via `idFromName(userId)` - each user gets their own instance.

- [x] **16. Fix Server-Side XSS in PDF Export**
  - **File:** `src/routes/dashboard/data-management/lib/pdf-export.ts`
  - **Action:** Strictly sanitize inputs or use a library that draws text programmatically (not via HTML rendering).
  - **Note:** Verified - uses jsPDF text() and autoTable (text-based rendering, no HTML).

- [x] **17. Rate Limit Contact Form**
  - **File:** `src/routes/contact/+page.server.ts`
  - **Action:** Strict limit (e.g., 3 requests/hour) to prevent email quota exhaustion.

- [x] **18. Rate Limit Expensive Maps APIs**
  - **Files:** `api/directions/cache`, `api/directions/optimize`, `tools/assign-stops`
  - **Action:** Apply `checkRateLimit` to prevent billing spikes.

- [x] **19. Login Rate Limiting (Credential Stuffing)**
  - **File:** `src/routes/login/+server.ts`
  - **Action:** Add secondary rate limit keyed by email (not just IP).

- [x] **20. Fix Floating Point Math (Financial Integrity)**
  - **File:** `src/lib/server/tripService.ts`
  - **Action:** Refactor math to use integers (cents/millis) or a Decimal library.
  - **Note:** calculations.ts already uses integer cents. Fixed hughesnet/tripBuilder.ts to use calculateFuelCost().

- [x] **21. Fix Pagination Bypass (Trip Service)**
  - **File:** `src/lib/server/tripService.ts`
  - **Action:** Ensure fallback logic respects `limit` and `offset`. Do not return 5,000 trips in one request.

- [x] **22. Fix Expense Service DoS**
  - **File:** `src/lib/server/expenseService.ts`
  - **Action:** Fix “self-healing” loop to respect pagination.

- [x] **23. Audit Regex for ReDoS**
  - **File:** `src/lib/server/requestValidation.ts`
  - **Action:** Replace custom regex with `validator.isEmail()` and `validator.isURL()`.
  - **Note:** Verified - no vulnerable regex patterns found. All regex have bounded quantifiers.

- [x] **24. Secure Stripe Webhook Parsing**
  - **File:** `src/routes/api/stripe/webhook/+server.ts`
  - **Action:** Verify signature (`constructEvent`) using the raw body before parsing JSON.
  - **Note:** Already implemented correctly - uses constructEvent before processing.

- [x] **25. Mitigate Sync Repair DoS**
  - **File:** `src/lib/server/tripService.ts`
  - **Action:** Debounce self-healing logic or move to a background queue.

- [x] **26. Fix Host Header Injection**
  - **Files:** `src/routes/api/stripe/checkout`, `src/routes/api/stripe/portal`
  - **Action:** Use `env.BASE_URL` instead of `url.origin`.

- [x] **27. Secure Service Worker Caching**
  - **File:** `src/service-worker.ts`
  - **Action:** Exclude `/api/` routes from cache or wipe cache on logout.

---

## 🛡️ Priority 3: MEDIUM (Hardening)

**Best practices for defense-in-depth and long-term maintenance.**

- [x] **28. Enforce Cryptographically Secure Tokens**
  - **Action:** Replace `Math.random()` with `crypto.randomUUID()` globally.
  - **Note:** Fixed in fetcher.ts and CollapsibleCard.svelte

- [x] **29. Redact PII from Server Logs**
  - **File:** `src/hooks.server.ts`
  - **Action:** Filter sensitive keys (`password`, `token`) from `console.log` output.
  - **Note:** Already implemented in log.ts with SENSITIVE_KEYS set

- [x] **30. Require Re-Auth for Sensitive Actions**
  - **File:** `src/routes/api/user/+server.ts`
  - **Action:** Require `currentPassword` for `DELETE` / `PUT` actions.

- [x] **31. Upgrade Password Hashing**
  - **File:** `src/lib/server/auth.ts`
  - **Action:** Increase `PBKDF2_ITERATIONS` to **600,000**.

- [x] **32. Fix Client-Side CSV Injection**
  - **File:** `mileage-export.ts`
  - **Action:** Escape fields starting with `=`, `+`, `-`, `@`.
  - **Note:** Added escapeCSVField() to mileage-export.ts and export-utils.ts

- [x] **33. Implement Security Headers**
  - **File:** `src/hooks.server.ts`
  - **Action:** Add `X-Frame-Options`, `X-Content-Type-Options`, `Content-Security-Policy`.
  - **Note:** Already implemented

- [x] **34. Tighten Content Security Policy**
  - **File:** `src/hooks.server.ts`
  - **Action:** Remove `'unsafe-eval'`.

- [ ] **35. Enforce Global Request Validation**
  - **Files:** All API routes
  - **Action:** Use `validateJsonRequest(request)` instead of `request.json()`.
  - **Note:** Utility exists in `requestValidation.ts`. Requires refactor across 20+ files.

- [x] **36. Suppress Verbose Error Details**
  - **Action:** Stop returning `error.message` or stack traces to the client in JSON responses.
  - **Note:** Fixed in webauthn/+server.ts and admin/webauthn/migrate/+server.ts

- [x] **37. Enforce One-Time Use for Verify Tokens**
  - **File:** `src/routes/api/verify/+server.ts`
  - **Action:** Delete token immediately upon use.

- [x] **38. Fix Rate Limit Bypass (Username)**
  - **File:** `src/lib/server/rateLimit.ts`
  - **Action:** Remove `locals.user.name` fallback. Use ID or IP only.

- [x] **39. Harden WebAuthn Cookie Attributes**
  - **Action:** Change `sameSite: 'none'` to `sameSite: 'lax'`.

- [x] **40. Strengthen Password Blacklist**
  - **File:** `src/lib/server/passwordValidation.ts`
  - **Action:** Expand dictionary beyond the current ~15 words.
  - **Note:** Expanded to 80+ common passwords

- [x] **41. Global Input Length Validation**
  - **Action:** Enforce max character limits on all inputs (e.g., Address < 500 chars).
  - **Note:** Added `INPUT_LIMITS` constants to `constants.ts`. Applied to login/register. Trips/addresses already sanitized via `sanitize.ts`.

- [x] **42. Audit and Exclude Non-Production Files**
  - **Action:** Delete `*.DEBUG` files and exclude mock files from build.
  - **Note:** Deleted `login-page.server.ts.DEBUG`. Mock files are in `$lib/server/` (server-only) with proper dev guards.

- [x] **43. Mitigate Registration Enumeration**
  - **Action:** Return generic messages during registration failures.

- [x] **44. Optimize HughesNet Import**
  - **Action:** Remove the `all` option from the import endpoint.

- [x] **45. Secure Google Maps Key**
  - **Action:** Verify HTTP Referrer restrictions in Google Cloud Console.
  - **Note:** MANUAL ACTION REQUIRED - Go to Google Cloud Console > APIs & Services > Credentials and verify `PUBLIC_GOOGLE_MAPS_API_KEY` has HTTP Referrer restrictions set to your production domains.

- [x] **46. Fix Cookie Cleanup**
  - **Action:** Use `{ path: '/', secure: true }` when deleting cookies.

- [x] **47. Remove Stripe Webhook Fallback**
  - **Action:** Remove full DB scan logic on missing customer mapping.

- [x] **48. Fix Admin Secret Timing Attack**
  - **File:** `src/routes/api/admin/webauthn/migrate/+server.ts`
  - **Action:** Use `crypto.timingSafeEqual`.

---

## Notes

- Keep this file in-repo as the **source of truth** during remediation.
- Consider adding a per-item status field (e.g., **Not started / In progress / Done**) if you want richer tracking.
