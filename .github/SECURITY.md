markdown# Security Policy

**CRITICAL:** This application handles sensitive user data including credentials, financial information, and location data.

All security requirements in this document are **NON-NEGOTIABLE** and have **HIGHEST PRECEDENCE** in the governance hierarchy.

---

## Sensitive Data Handled

This application processes and stores:

- ✅ **Authentication Credentials** (usernames, passwords)
- ✅ **Financial Data** (dollar amounts, payment information)
- ✅ **Location Data** (trip addresses, routes)
- ✅ **Personal Information** (vehicle types, trip history)
- ✅ **Temporal Data** (dates, timestamps, patterns)

**Every change must be evaluated for security impact on this data.**

---

## Security Precedence

Security rules have **ABSOLUTE HIGHEST PRIORITY** in the governance hierarchy:

SECURITY (THIS DOCUMENT) ← Highest priority
PWA Compliance
HTML Living Standard
Design System
Migration Agent Rules
Code Style

**If any other rule conflicts with security: SECURITY WINS.**

---

## Password Security (CRITICAL)

### Storage Rules

❌ **NEVER store passwords in plaintext**  
❌ **NEVER log passwords** (not even hashed)  
❌ **NEVER transmit passwords** without encryption  
❌ **NEVER store passwords in localStorage/sessionStorage**  
❌ **NEVER include passwords in URLs or query parameters**  
❌ **NEVER commit passwords to version control**

✅ **ALWAYS hash passwords** using bcrypt, Argon2, or PBKDF2  
✅ **ALWAYS use HTTPS** for password transmission  
✅ **ALWAYS validate password strength** (minimum 8 characters, complexity rules)  
✅ **ALWAYS use secure password reset flows**

### Implementation Requirements

```javascript
// ❌ NEVER DO THIS
const password = 'user123'; // Plaintext
localStorage.setItem('password', password); // Insecure storage
console.log('Password:', password); // Logged

// ✅ CORRECT APPROACH
// Passwords should never be handled in frontend
// Send to backend API over HTTPS
// Backend hashes with bcrypt/Argon2
// Never store password anywhere in frontend
```

---

## Data Storage Security

### Cloudflare KV Storage (Trip Data)

**Current Architecture:**
This application uses **Cloudflare Workers + KV** for trip data storage.

- **Storage Location:** Server-side (Cloudflare KV)
- **Access Control:** API authentication required
- **Data Sensitivity:** Contains addresses, financial data, user information

#### API Authentication (MANDATORY)

All KV data access MUST go through authenticated API endpoints:

```javascript
// ✅ CORRECT - API validates user owns data
export default {
	async fetch(request, env, ctx) {
		// 1. Authenticate user
		const user = await authenticateUser(request);
		if (!user) {
			return new Response('Unauthorized', { status: 401 });
		}

		// 2. Get requested trip
		const tripId = new URL(request.url).searchParams.get('id');
		const trip = await env.TRIPS_KV.get(tripId, { type: 'json' });

		// 3. CRITICAL: Verify user owns this trip
		if (trip.userId !== user.id) {
			return new Response('Forbidden', { status: 403 });
		}

		// 4. Return data
		return new Response(JSON.stringify(trip));
	}
};
```

#### KV Key Structure (MANDATORY)

Keys MUST include user identification to prevent cross-user access:

```javascript
// ✅ CORRECT - User-specific keys
const key = `trip:${userId}:${tripId}`;
// Example: "trip:James:hns_James_2025-10-30"

// ❌ WRONG - Global keys anyone could guess
const key = `trip:${tripId}`;
// Example: "trip:hns_James_2025-10-30" (no user isolation)
```

#### Data Access Rules

**MUST enforce:**

- ✅ Users CAN ONLY access their own trips via authenticated API
- ✅ API validates user identity matches trip.userId
- ✅ KV keys include userId prefix for isolation
- ❌ Users CANNOT list all trips (no unfiltered `env.TRIPS_KV.list()`)
- ❌ Users CANNOT access other users' trips
- ❌ Users CANNOT guess trip IDs to access others' data

**MUST NOT:**

- ❌ Expose KV directly to frontend (no direct KV access from browser)
- ❌ Return trips without verifying ownership
- ❌ Trust client-provided userId (always use authenticated user's ID)
- ❌ Allow enumeration of other users' data

#### Allowed Data in KV

Since KV storage is server-side with access control, the following IS allowed:

✅ Full street addresses (startAddress, endAddress, stop addresses)  
✅ Real user names/IDs (userId field)  
✅ Financial data (earnings, costs, profit)  
✅ Complete trip details and metadata

**Why this is acceptable:**

- Data is server-side (not in browser localStorage)
- Access requires authentication
- Users can only access their own data via API
- Cloudflare encrypts data at rest and in transit
- API enforces ownership verification

#### Example: Secure Trip Retrieval

```javascript
// GET /api/trips?userId=James
export default {
	async fetch(request, env) {
		const url = new URL(request.url);

		// 1. Authenticate
		const authenticatedUser = await authenticateUser(request);
		if (!authenticatedUser) {
			return new Response('Unauthorized', { status: 401 });
		}

		// 2. Get requested userId
		const requestedUserId = url.searchParams.get('userId');

		// 3. CRITICAL: Verify user is requesting their own data
		if (requestedUserId !== authenticatedUser.id) {
			return new Response('Forbidden: Can only access your own trips', {
				status: 403
			});
		}

		// 4. List trips for this user only
		const prefix = `trip:${requestedUserId}:`;
		const trips = await env.TRIPS_KV.list({ prefix });

		// 5. Fetch trip data
		const tripData = await Promise.all(
			trips.keys.map((key) => env.TRIPS_KV.get(key.name, { type: 'json' }))
		);

		return new Response(JSON.stringify(tripData));
	}
};
```

#### Example: Secure Trip Creation

```javascript
// POST /api/trips
export default {
	async fetch(request, env) {
		// 1. Authenticate
		const user = await authenticateUser(request);
		if (!user) {
			return new Response('Unauthorized', { status: 401 });
		}

		// 2. Parse trip data
		const tripData = await request.json();

		// 3. CRITICAL: Override userId with authenticated user
		// NEVER trust client-provided userId
		tripData.userId = user.id;

		// 4. Generate key with user prefix
		const key = `trip:${user.id}:${tripData.id}`;

		// 5. Save to KV
		await env.TRIPS_KV.put(key, JSON.stringify(tripData));

		return new Response(JSON.stringify({ success: true }));
	}
};
```

#### INSECURE Examples (NEVER DO THIS)

```javascript
// ❌ DANGEROUS - No authentication
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const tripId = url.searchParams.get('id');

    // NO AUTH CHECK!
    const trip = await env.TRIPS_KV.get(tripId, { type: 'json' });

    // Returns ANY trip to ANY user!
    return new Response(JSON.stringify(trip));
  }
};

// ❌ DANGEROUS - Trusting client userId
export default {
  async fetch(request, env) {
    const { userId } = await request.json();

    // Client could send userId: "someone_else"
    const prefix = `trip:${userId}:`;
    const trips = await env.TRIPS_KV.list({ prefix });

    // Returns OTHER users' trips!
    return new Response(JSON.stringify(trips));
  }
};
```

#### Data Retention

- ✅ **SHOULD allow users to delete old trips**
- ✅ **SHOULD implement data export** (if legally required)
- ⚠️ **CONSIDER automatic deletion** of trips older than reasonable period (e.g., 2-3 years)
- ✅ **MUST honor user deletion requests**

---

### Browser Storage Rules

**localStorage/sessionStorage:**

- ❌ **NEVER store passwords**
- ❌ **NEVER store authentication tokens** (use httpOnly cookies instead)
- ❌ **NEVER store trip data with full addresses** (fetch from API as needed)
- ❌ **NEVER store financial data**
- ⚠️ **MAY store non-sensitive data** (user preferences, UI state)
- ⚠️ **MAY store trip IDs** for quick access (fetch details from API)

**IndexedDB:**

- ❌ **NEVER store passwords or auth tokens**
- ❌ **NEVER store trip data with addresses**
- ⚠️ **MAY cache trip data temporarily** (must be cleared on logout)
- ✅ **MUST clear on logout**

**Cookies:**

- ✅ **SHOULD use httpOnly cookies** for authentication
- ✅ **MUST use Secure flag** (HTTPS only)
- ✅ **MUST use SameSite** attribute
- ✅ **SHOULD set appropriate expiration**

### Service Worker Cache

**PWA Cache Rules:**

- ❌ **NEVER cache API responses** with sensitive data
- ❌ **NEVER cache authentication headers**
- ❌ **NEVER cache user-specific financial data**
- ✅ **MAY cache app shell** (HTML, CSS, JS)
- ✅ **MAY cache public assets** (icons, fonts)

```javascript
// ❌ NEVER cache these
'/api/user/profile';
'/api/trips/history';
'/api/payments';

// ✅ OK to cache these
'/app-shell.html';
'/assets/logo.png';
'/fonts/...';
```

---

## Location Data Security

### Address Handling

- ❌ **NEVER log full addresses** to console
- ⚠️ **MAY store full addresses** in server-side KV with proper access control
- ❌ **NEVER include addresses** in error reports or analytics
- ⚠️ **MINIMIZE address retention** (delete old trip addresses)
- ✅ **MAY store address IDs** and fetch details as needed
- ✅ **MUST sanitize addresses** before displaying in UI

### Geolocation

- ✅ **MUST request user permission** before accessing location
- ✅ **MUST explain why** location is needed
- ❌ **NEVER track location** in background without explicit consent
- ❌ **NEVER share location data** with third parties
- ✅ **SHOULD allow users to delete** location history

---

## Financial Data Security

### Dollar Amount Handling

- ❌ **NEVER log dollar amounts** to console in production
- ❌ **NEVER include amounts** in URLs or query parameters
- ⚠️ **MINIMIZE storage duration** (delete old financial data)
- ✅ **MUST validate** all financial inputs server-side
- ✅ **SHOULD display amounts** using secure formatting

### Payment Information

- ❌ **NEVER store credit card numbers**
- ❌ **NEVER store CVV codes**
- ❌ **NEVER handle PCI data** in frontend (use payment processor)
- ✅ **MUST use PCI-compliant** payment processors
- ✅ **SHOULD use tokenization** for recurring payments

---

## Authentication & Authorization

### Authentication Rules

- ✅ **MUST use HTTPS** for all authentication
- ✅ **MUST implement session timeout** (30 minutes recommended)
- ✅ **MUST implement logout** functionality
- ✅ **SHOULD implement "Remember Me"** securely (if needed)
- ❌ **NEVER trust client-side** authentication state alone
- ❌ **NEVER use weak session tokens**

### Session Management

```javascript
// ✅ CORRECT - httpOnly cookie set by backend
// Frontend just makes authenticated requests

// ❌ WRONG - storing tokens in localStorage
localStorage.setItem('authToken', token); // Vulnerable to XSS
```

### Authorization

- ✅ **MUST validate permissions** server-side
- ✅ **MUST verify user owns data** before displaying
- ❌ **NEVER rely on frontend** authorization checks alone
- ❌ **NEVER expose other users' data** in API responses

---

## API Security

### Request Security

- ✅ **MUST use HTTPS** for all API calls
- ✅ **MUST validate all inputs** server-side
- ✅ **MUST sanitize all outputs** to prevent XSS
- ✅ **SHOULD implement rate limiting** to prevent abuse
- ❌ **NEVER trust client data** without validation
- ❌ **NEVER expose sensitive data** in error messages

### Response Security

- ✅ **MUST filter sensitive fields** from responses
- ✅ **MUST implement proper CORS** headers
- ❌ **NEVER return other users' data**
- ❌ **NEVER return passwords** (even hashed)
- ❌ **NEVER expose stack traces** in production

---

## XSS Prevention (Cross-Site Scripting)

### Input Sanitization

- ✅ **MUST sanitize all user input** before display
- ✅ **MUST escape HTML** in user-generated content
- ✅ **MUST use Svelte's default escaping** (`{variable}` not `{@html variable}`)
- ❌ **NEVER use `{@html}` with user input**
- ❌ **NEVER use `innerHTML`** with user data
- ❌ **NEVER use `eval()`** with user data

```svelte
<!-- ✅ SAFE - Svelte automatically escapes -->
<p>{username}</p>
<p>{tripAddress}</p>

<!-- ❌ DANGEROUS - Could allow script injection -->
<p>{@html username}</p>
<p>{@html tripAddress}</p>
```

### Content Security Policy

- ✅ **SHOULD implement CSP** headers
- ✅ **SHOULD restrict script sources**
- ✅ **SHOULD disable inline scripts** where possible

---

## Data Retention & Privacy

### Data Minimization

- ✅ **ONLY collect data** that is necessary
- ✅ **DELETE old trip data** after reasonable period
- ✅ **ALLOW users to delete** their data
- ❌ **NEVER keep data** indefinitely without reason

### User Privacy Rights

- ✅ **MUST provide data export** (if required by law)
- ✅ **MUST provide data deletion** (if required by law)
- ✅ **SHOULD inform users** what data is collected
- ✅ **SHOULD get consent** for data collection

### Logging & Monitoring

**What to LOG:**

- ✅ Authentication attempts (success/failure)
- ✅ Authorization failures
- ✅ API errors (without sensitive data)
- ✅ Security events

**What NOT to log:**

- ❌ Passwords (plaintext or hashed)
- ❌ Full addresses
- ❌ Dollar amounts (in production)
- ❌ Credit card numbers
- ❌ Session tokens
- ❌ Any PII unnecessarily

---

## Environment & Configuration

### Environment Variables

- ✅ **MUST use environment variables** for secrets
- ✅ **MUST use `.env.local`** for local secrets (gitignored)
- ❌ **NEVER commit secrets** to version control
- ❌ **NEVER hardcode API keys**
- ❌ **NEVER expose secrets** in frontend code

```javascript
// ❌ NEVER DO THIS
const apiKey = 'sk_live_abc123'; // Hardcoded secret

// ✅ CORRECT (backend only)
const apiKey = process.env.API_KEY;
```

### Public vs Private Keys

- ✅ **PUBLIC keys** can be in frontend (e.g., Stripe publishable key)
- ❌ **PRIVATE keys** must ONLY be in backend
- ❌ **NEVER expose private keys** in frontend bundle

---

## Third-Party Dependencies

### Dependency Security

- ✅ **MUST review dependencies** for known vulnerabilities
- ✅ **SHOULD run `npm audit`** regularly
- ✅ **SHOULD update dependencies** with security patches
- ✅ **SHOULD minimize dependencies** to reduce attack surface
- ❌ **NEVER use dependencies** from untrusted sources

### Supply Chain Security

- ✅ **SHOULD use `package-lock.json`** or `pnpm-lock.yaml`
- ✅ **SHOULD verify package integrity**
- ⚠️ **REVIEW changes** when updating packages

---

## Migration Security Rules

### During Svelte 4 → 5 Migration

- ✅ **MUST preserve all security measures**
- ✅ **MUST review changes** for security impact
- ✅ **MUST test authentication** after migration
- ❌ **NEVER remove security checks** "temporarily"
- ❌ **NEVER skip security review** because "it's just a migration"

### Security Review Checklist

Before migrating any component that handles sensitive data:

- [ ] Passwords remain secure (if applicable)
- [ ] User data remains protected
- [ ] XSS prevention still works
- [ ] Authorization checks preserved
- [ ] Data storage remains secure
- [ ] API calls remain over HTTPS
- [ ] Input validation still works
- [ ] No sensitive data in logs

---

## PWA Security Considerations

### Service Worker Security

- ✅ **MUST serve service worker** over HTTPS
- ✅ **MUST validate cache entries** before serving
- ❌ **NEVER cache sensitive API responses**
- ❌ **NEVER cache authentication data**

### Offline Security

- ✅ **MUST require re-authentication** after offline period
- ✅ **SHOULD limit offline functionality** for sensitive operations
- ⚠️ **CONSIDER clearing sensitive data** when going offline

---

## Incident Response

### If Security Issue Discovered

1. **STOP** - Immediately cease work on other tasks
2. **ASSESS** - Determine scope of vulnerability
3. **CONTAIN** - Prevent further exposure
4. **FIX** - Implement fix in secure branch
5. **VERIFY** - Test fix thoroughly
6. **DEPLOY** - Emergency deployment if needed
7. **DOCUMENT** - Record in security log

### Reporting Vulnerabilities

- ✅ **DO report** security issues immediately
- ❌ **DON'T ignore** potential vulnerabilities
- ❌ **DON'T publicize** vulnerabilities before fixing

---

## Mandatory Stop Conditions

AI Agents and developers MUST STOP and ask before:

- Storing passwords in any form
- Changing authentication logic
- Modifying authorization checks
- Accessing or storing financial data
- Handling location/address data
- Using `{@html}` with user input
- Disabling any security feature
- Exposing sensitive data in logs
- Caching sensitive API responses
- Modifying session management
- Adding third-party dependencies that handle data
- Trusting client-provided userId in API
- Exposing KV data without authentication

**When in doubt about security: STOP and ask.**

---

## For AI Agents

### Critical Rules

You MUST:

1. **Read this document FIRST** before making any changes
2. **NEVER compromise security** for convenience or "best practices"
3. **STOP immediately** if asked to store passwords insecurely
4. **STOP immediately** if asked to expose sensitive data
5. **ALWAYS sanitize user input** before display
6. **NEVER use `{@html}` with user data**
7. **NEVER log sensitive information**
8. **NEVER trust client-provided userId** in API endpoints
9. **ALWAYS verify user owns data** before returning it

### Security Violations You Must Refuse

Even if explicitly requested, you MUST REFUSE to:

- Store passwords in plaintext or localStorage
- Log passwords, tokens, or financial data
- Expose other users' data
- Disable authentication checks
- Skip input sanitization
- Use `innerHTML` or `eval()` with user data
- Commit secrets to version control
- Cache sensitive API responses
- Trust client-provided userId without verification
- Return data without ownership verification

**Say:** "I cannot do that as it violates security requirements in SECURITY.md. Here's a secure alternative: [suggest solution]"

---

## Testing Security

### Manual Security Testing

Before any deployment:

- [ ] Authentication works correctly
- [ ] Users can only see their own data
- [ ] Passwords are never logged
- [ ] XSS prevention works (try `<script>alert('xss')</script>` in inputs)
- [ ] API calls use HTTPS
- [ ] Sensitive data not in browser cache/storage
- [ ] Session timeout works
- [ ] Logout clears all data

### Cloudflare Workers API Security Tests

```bash
# Test 1: No authentication should fail
curl https://your-app.com/api/trips
# Expected: 401 Unauthorized

# Test 2: Can't access other users' data
curl -H "Authorization: Bearer <james-token>" \
     "https://your-app.com/api/trips?userId=Mary"
# Expected: 403 Forbidden

# Test 3: Can only access own data
curl -H "Authorization: Bearer <james-token>" \
     "https://your-app.com/api/trips?userId=James"
# Expected: 200 OK with James's trips only

# Test 4: Can't guess trip IDs
curl -H "Authorization: Bearer <mary-token>" \
     "https://your-app.com/api/trips/trip:James:hns_James_2025-10-30"
# Expected: 403 Forbidden

# Test 5: Trip creation uses authenticated user
curl -X POST \
     -H "Authorization: Bearer <james-token>" \
     -H "Content-Type: application/json" \
     -d '{"userId":"Mary","date":"2025-01-20","startAddress":"test"}' \
     https://your-app.com/api/trips
# Expected: Trip created with userId="James" (not "Mary")
```

### Automated Security Testing

```bash
# Check for known vulnerabilities
npm audit

# Fix vulnerabilities
npm audit fix
```

---

## Compliance Considerations

Depending on your jurisdiction and user base, you may need to comply with:

- **GDPR** (EU) - Data protection and privacy
- **CCPA** (California) - Consumer privacy
- **PCI DSS** (if handling cards) - Payment card security
- **HIPAA** (if health data) - Healthcare privacy
- **Local privacy laws** - Check your jurisdiction

**Consult legal counsel for compliance requirements.**

---

## Security Updates

This document should be reviewed and updated:

- ✅ After any security incident
- ✅ When adding new sensitive data types
- ✅ When adding new third-party services
- ✅ At least annually

**Last Updated:** 2026-01-20

---

## Questions?

If security requirements are unclear or seem to conflict with other requirements:

1. **STOP immediately**
2. **Security ALWAYS wins** in conflicts
3. Open an issue with `security-question` label
4. Wait for clarification before proceeding

**Never compromise security to meet deadlines or other requirements.**
