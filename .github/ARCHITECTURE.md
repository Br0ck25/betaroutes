# Architecture Decision Records

This document records key architectural decisions and the rationale behind them.

**DO NOT question or change these decisions unless explicitly requested.**

---

## ADR-000: Security-First Architecture

**Status:** Active

**Context:**

- Application handles sensitive data (passwords, financial info, location data)
- Users trust us with their personal and financial information
- Security breaches could cause significant harm
- Regulatory compliance may be required (GDPR, CCPA, etc.)

**Decision:**

- Security is the absolute highest priority in all decisions
- SECURITY.md has precedence over all other governance documents
- No feature or "improvement" can compromise security
- All user data must be protected according to SECURITY.md
- All API endpoints must verify user owns data before returning it

**Rationale:**

- User trust is paramount
- Data breaches are catastrophic
- Legal liability for security failures
- Ethical responsibility to protect user data

**Consequences:**

- Some "convenient" patterns are forbidden (e.g., localStorage for passwords)
- Development may be slower due to security reviews
- More documentation and governance overhead
- Absolutely zero tolerance for security violations

**See:** `SECURITY.md`

---

## ADR-001: Cloudflare Workers + KV Architecture

**Status:** Active

**Context:**

- Need server-side storage for trip data
- Trip data contains sensitive information (addresses, financial data)
- Users must only access their own data
- Need scalable, cost-effective solution

**Decision:**

- Use Cloudflare Workers for API
- Use Cloudflare KV for trip data storage
- All KV access goes through authenticated API endpoints
- API verifies user owns data before returning it
- KV keys include userId for data isolation: `trip:{userId}:{tripId}`

**Rationale:**

- Server-side storage keeps sensitive data secure
- Cloudflare encrypts data at rest and in transit
- Workers provide authentication layer
- KV is fast, scalable, and cost-effective
- User-prefixed keys prevent cross-user access

**Consequences:**

- Full addresses allowed in KV (server-side with access control)
- API must authenticate all requests
- API must verify user ownership
- Cannot trust client-provided userId
- Must implement proper session management

**See:** `SECURITY.md` (Cloudflare KV Storage section)

---

## ADR-002: Gradual Migration to Svelte 5

**Status:** Active

**Context:**

- Project built with Svelte 4
- Svelte 5 offers better reactivity and performance
- Full rewrite is too risky and time-consuming
- Security must be maintained during migration

**Decision:**

- Migrate incrementally from Svelte 4 to Svelte 5
- Allow both versions to coexist during transition
- All new code must be Svelte 5
- Existing code migrates only when necessary or requested
- **Security measures must be preserved during migration**
- **Editing a file does NOT require migrating it**

**Rationale:**

- Maintains working application at all times
- Reduces risk of regressions
- Allows learning Svelte 5 patterns gradually
- Prevents "big bang" migration failures
- Ensures security isn't compromised during migration

**Consequences:**

- Mixed codebase during transition period
- Need clear rules for when to migrate
- Potential for confusion about which syntax to use
- Requires discipline to not migrate opportunistically
- Security review required for all migrations

**See:** `svelte-mixed-migration-agent.md`

---

## ADR-003: PWA-First Architecture

**Status:** Active

**Context:**

- Users need offline functionality for trip tracking
- App should work on mobile devices
- Installation provides better UX
- Offline access must not compromise security

**Decision:**

- Build as Progressive Web App
- Maintain strict PWA compliance
- Never break offline functionality
- Service worker is critical infrastructure
- **Sensitive data must never be cached**
- **Only cache app shell and public assets**

**Rationale:**

- Offline-first provides better UX for field workers
- Installation increases engagement
- Works across platforms without app stores
- Future-proof for mobile usage

**Consequences:**

- Service worker must always work
- Offline behavior must be tested
- Manifest.json is sacrosanct
- Migration cannot break PWA features
- Must carefully manage what's cached (never cache sensitive data)

**See:** `PWA.md`, `SECURITY.md` (PWA Security section)

---

## ADR-004: HTML Living Standard Only

**Status:** Active

**Context:**

- Multiple HTML standards exist
- XHTML syntax is common but deprecated
- Svelte syntax can look like JSX
- XSS vulnerabilities from invalid HTML

**Decision:**

- Follow WHATWG HTML Living Standard exclusively
- No XHTML syntax
- No self-closing non-void elements
- Boolean attributes without values
- **Proper HTML helps prevent XSS**

**Rationale:**

- Living Standard is actively maintained
- Eliminates confusion about which standard
- Ensures browser compatibility
- Prevents invalid HTML
- Reduces XSS attack surface

**Consequences:**

- No `<div />` syntax (even though Svelte allows it)
- Must use `disabled` not `disabled="true"`
- Requires vigilance during code generation
- AI agents must be specifically instructed

**See:** `HTML_LIVING_STANDARD.md`, `SECURITY.md` (XSS Prevention)

---

## ADR-005: Strict Color Palette

**Status:** Active

**Context:**

- Visual consistency is important
- Ad-hoc color choices lead to design drift
- Brand colors must be enforced

**Decision:**

- Define approved color palette
- No colors outside the palette
- No opacity tricks to create new colors
- Enforce through code review

**Rationale:**

- Maintains brand consistency
- Prevents visual chaos
- Simplifies design decisions
- Makes refactoring easier

**Consequences:**

- Limited color choices
- May need palette updates for new features
- Requires discipline to not "just use" a color
- AI agents must check palette before suggesting colors

**See:** `DESIGN_SYSTEM.md`

---

## ADR-006: Governance-First Development

**Status:** Active

**Context:**

- Multiple conflicting rules can exist
- AI agents need clear precedence
- Humans need conflict resolution process
- Security must be protected from "helpful" shortcuts

**Decision:**

- Create explicit rule hierarchy
- Document all governance rules
- **Security trumps all other concerns**
- PWA/HTML/Design trump migration preferences
- STOP and ask when rules conflict

**Rationale:**

- Prevents "best practice" drift
- Gives AI agents clear decision framework
- Reduces rework from rule violations
- Makes expectations explicit
- Protects security from well-intentioned violations

**Consequences:**

- More documentation to maintain
- Rules must be kept consistent
- May slow initial development
- Requires discipline to follow process
- Zero tolerance for security violations

**See:** `GOVERNANCE.md`

---

## Data Architecture

### Storage Strategy

**Cloudflare KV (Server-Side):**

- Trip data with full addresses, financial info
- Key structure: `trip:{userId}:{tripId}`
- Access via authenticated API only
- API verifies user owns data

**Browser Storage:**

- localStorage: Non-sensitive preferences only, trip IDs for quick access
- sessionStorage: Temporary non-sensitive state only
- IndexedDB: Not currently used
- Cookies: httpOnly auth cookies set by backend

**Backend Storage:**

- Passwords: Hashed with bcrypt/Argon2 (if implementing auth)
- Financial data: In KV with access control
- Location data: In KV with access control

**See:** `SECURITY.md` (Data Storage Security)

---

## API Architecture

### Authentication Flow

User Login
↓
Backend verifies credentials
↓
Set httpOnly cookie with session token
↓
All API requests include cookie
↓
API verifies session + user ownership
↓
Return data

### Authorization Pattern

Every API endpoint follows this pattern:

```javascript
1. Authenticate user (verify session)
2. Get requested resource ID
3. Fetch resource from KV
4. VERIFY user owns resource (userId matches)
5. Return data OR 403 Forbidden
```

**Never skip step 4.**

---

## Folder Structure

project/
├── src/
│ ├── lib/
│ │ ├── components/ # Reusable components (mixed Svelte 4/5)
│ │ ├── stores/ # State management (mixed Svelte 4/5)
│ │ └── utils/ # Utility functions
│ ├── routes/ # SvelteKit routes (mixed Svelte 4/5)
│ └── service-worker.js # PWA service worker (NO sensitive data caching)
├── workers/ # Cloudflare Workers (API)
│ └── api.js # Main API with authentication
├── static/ # Static assets
│ └── manifest.json # PWA manifest
└── [governance docs] # All .md files

**Rules:**

- Do NOT restructure without explicit approval
- Migration does not require restructuring
- Keep related files together
- Never commit sensitive data

---

## State Management

**Current approach:**

- Svelte stores (writable, derived, readable)
- Some components use local reactive statements
- **No passwords or sensitive data in stores**
- Trip data fetched from API as needed

**During migration:**

- New code can use `$state`, `$derived`, `$effect`
- Existing stores remain unchanged
- New stores can be Svelte 5 runes or traditional stores
- **Security requirements apply to both Svelte 4 and 5**

**Do NOT:**

- Replace working stores unnecessarily
- Introduce new state management libraries
- Change store APIs during migration
- **Store passwords or auth tokens in any stores**
- **Store trip data with full addresses in stores (fetch from API)**

---

## Styling Approach

**Current approach:**
[Document your styling approach: Tailwind/vanilla CSS/CSS modules/etc.]

**Rules:**

- Only approved colors from DESIGN_SYSTEM.md
- Migration should not change styling unnecessarily
- Keep existing styling approach unless explicitly changed

---

## Questions About Architecture?

If an architectural decision seems wrong or outdated:

1. **Don't change it immediately**
2. Open an issue with `architecture-question` label
3. Propose alternative with rationale
4. Wait for discussion and approval

**For security-related architecture questions, use `security` label.**

Architecture exists for a reason. Understand it before changing it.
