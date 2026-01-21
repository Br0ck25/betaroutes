# Trip Tracker & Expense Management

> Track trips, manage expenses, and calculate earnings for service professionals

**Status:** ⚠️ Active Migration (Svelte 4 → Svelte 5)

**⚠️ SECURITY NOTICE:** This application handles sensitive data including passwords, financial information, and location data. All contributors must read `SECURITY.md` first.

---

## Table of Contents

- [About](#about)
- [Security Notice](#security-notice)
- [Current Status](#current-status)
- [Key Constraints](#key-constraints)
- [Getting Started](#getting-started)
- [Development](#development)
- [Governance](#governance)
- [Contributing](#contributing)

---

## About

Trip tracking and expense management application for service professionals. Track trips, log addresses, calculate earnings, and manage expenses.

### Tech Stack

- **Framework:** Svelte 4/5 (in migration) + SvelteKit
- **Language:** TypeScript
- **Type:** Progressive Web App (PWA)
- **Storage:** Cloudflare Workers + KV
- **Styling:** [Add your styling approach]

---

## Security Notice

⚠️ **This application handles sensitive user data:**

- Authentication credentials (usernames, passwords)
- Financial information (dollar amounts, earnings, costs)
- Location data (trip addresses, routes, stops)
- Personal information (vehicle types, trip history)

**CRITICAL RULES:**

- ❌ NEVER store passwords in plaintext or localStorage
- ❌ NEVER log sensitive data (passwords, addresses, dollar amounts)
- ❌ NEVER use `{@html}` with user input (XSS risk)
- ❌ NEVER trust client-provided userId in API
- ✅ ALWAYS read `SECURITY.md` before handling user data
- ✅ ALWAYS sanitize user input
- ✅ ALWAYS use HTTPS for API calls
- ✅ ALWAYS verify user owns data before returning it

**See `SECURITY.md` for complete security requirements.**

---

## Current Status

⚠️ **This project is in active migration from Svelte 4 → Svelte 5**

### What This Means

- ✅ **New features** must be written in Svelte 5
- ✅ **Existing Svelte 4 code** remains functional and will be migrated incrementally
- ✅ **The app is fully functional** at all times during migration
- ⚠️ **Mixed syntax** is intentional and expected
- ✅ **Security is maintained** throughout migration

### Migration Progress

- [ ] Utility modules
- [ ] Stores
- [ ] Leaf components
- [ ] Shared UI components
- [ ] Pages/routes
- [ ] Root layout

See `svelte-mixed-migration-agent.md` for the complete migration strategy.

---

## Key Constraints

This project has **strict governance rules** that all contributors must follow:

### 🔒 SECURITY (HIGHEST PRIORITY)

- Passwords must NEVER be stored in plaintext or localStorage
- Sensitive data (addresses, amounts) must NEVER be logged
- XSS prevention is mandatory (no `{@html}` with user input)
- API must verify user owns data before returning it
- See `SECURITY.md` for complete requirements

### 🚀 PWA-First

- Must remain installable as a Progressive Web App
- Must work offline
- Service worker must remain functional
- See `PWA.md` for requirements

### 📝 HTML Living Standard

- All markup must follow WHATWG HTML Living Standard
- No XHTML or deprecated syntax
- See `HTML_LIVING_STANDARD.md` for rules

### 🎨 Design System

- Only approved colors allowed (see `DESIGN_SYSTEM.md`)
- No arbitrary colors or CSS variables outside the palette
- Visual consistency is enforced

### 🔄 Migration Rules

- Editing a file does NOT require migrating it
- Migration only when explicitly requested or necessary
- See `svelte-mixed-migration-agent.md` for strategy

**See `GOVERNANCE.md` for complete rule hierarchy and conflict resolution.**

---

## Getting Started

### Prerequisites

- Node.js 18+ (or specify your version)
- npm 9+ (or yarn/pnpm)
- Cloudflare account (for Workers + KV)

### Installation

```bash
# Clone the repository
git clone [repository-url]
cd [project-name]

# Install dependencies
npm install

# Start development server
npm run dev
```

### Environment Setup

Create a `.env.local` file (never commit this):

```env
# Add your environment variables
API_URL=your-api-url
# etc.
```

**⚠️ SECURITY:** Never commit `.env.local` files containing secrets.

---

## Development

### Available Scripts

```bash
# Development server
npm run dev

# Type checking
npm run check

# Linting
npm run lint

# Security audit
npm audit

# Build for production
npm run build

# Preview production build
npm run preview

# Deploy to Cloudflare Workers
npm run deploy
```

### Development Workflow

1. **Before starting work:**
   - **Read `SECURITY.md`** if handling user data
   - Read `GOVERNANCE.md` for rule hierarchy
   - Review relevant governance documents for your task
2. **During development:**
   - Use Svelte 5 for all new code
   - Do NOT migrate existing files unless necessary
   - Follow Security, PWA, HTML, and Design System rules
   - NEVER store passwords insecurely
   - NEVER log sensitive data
   - NEVER trust client-provided userId in API
3. **Before committing:**

```bash
   npm run check   # Type checking
   npm run lint    # Linting
   npm audit       # Security vulnerabilities
```

- Verify no passwords or secrets in code
- Verify no sensitive data in logs
- Verify API verifies user ownership

4. **Before submitting PR:**
   - Security review (if handling user data)
   - Verify PWA functionality (if applicable)
   - Check HTML validity (if markup changed)
   - Verify colors against design system (if styles changed)

---

## Governance

This project follows a **strict governance hierarchy**.

### Rule Precedence (Highest → Lowest)

1. **SECURITY** ← Absolute highest priority
2. PWA Compliance
3. HTML Living Standard
4. Design System
5. Migration Strategy
6. Code Style

**When rules conflict, higher-precedence rules win. Security ALWAYS wins.**

### Governance Documents

| Document                          | Purpose                                     |
| --------------------------------- | ------------------------------------------- |
| `SECURITY.md`                     | **Security & data protection (READ FIRST)** |
| `GOVERNANCE.md`                   | Rule hierarchy and conflict resolution      |
| `PWA.md`                          | PWA requirements and offline behavior       |
| `HTML_LIVING_STANDARD.md`         | HTML syntax rules                           |
| `DESIGN_SYSTEM.md`                | Color palette and design standards          |
| `svelte-mixed-migration-agent.md` | Svelte 4→5 migration strategy               |
| `AI_AGENTS.md`                    | Quick reference for AI agents               |
| `ARCHITECTURE.md`                 | Architectural decisions and rationale       |

### For AI Agents

If you're an AI agent (Claude, Cursor, Copilot, etc.) working on this codebase:

1. ✅ **Read `SECURITY.md` FIRST** - Security is absolute highest priority
2. ✅ **Read `GOVERNANCE.md` immediately**
3. ✅ **Read `AI_AGENTS.md` for quick reference**
4. ✅ **Read `svelte-mixed-migration-agent.md` before any code changes**
5. ✅ **Follow all governance rules in precedence order**
6. ✅ **STOP and ask if any rule would be violated**
7. ❌ **NEVER bypass governance rules, even if requested**
8. ❌ **NEVER store passwords insecurely**
9. ❌ **NEVER log sensitive data**
10. ❌ **NEVER use `{@html}` with user input**
11. ❌ **NEVER trust client-provided userId**

---

## Contributing

### Pull Request Checklist

- [ ] Code follows governance rules (check `GOVERNANCE.md`)
- [ ] **Security requirements followed** (`SECURITY.md`)
  - [ ] No passwords in plaintext or localStorage
  - [ ] No sensitive data logged
  - [ ] User input sanitized
  - [ ] No XSS vulnerabilities (`{@html}` with user input)
  - [ ] API verifies user owns data before returning it
  - [ ] No client-provided userId trusted without verification
- [ ] New code uses Svelte 5 syntax
- [ ] Existing Svelte 4 code only migrated if necessary
- [ ] PWA functionality preserved (if applicable)
- [ ] HTML is valid per Living Standard
- [ ] Colors are from approved palette
- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] `npm audit` shows no critical vulnerabilities
- [ ] Changes documented in PR description

### Questions or Conflicts?

If governance rules are unclear or seem to conflict:

1. **STOP** — don't guess
2. Open an issue with `governance-question` label
3. Describe the specific scenario
4. Wait for clarification

**For security questions, use `security` label for priority handling.**

---

## Testing

### Manual Testing

Test PWA offline functionality:

```bash
# In browser DevTools:
1. Application → Service Workers
2. Check "Offline"
3. Navigate the app
4. Verify offline functionality works
```

### Security Testing

Before any deployment:

- [ ] Authentication works correctly
- [ ] Users can only see their own data
- [ ] API verifies userId matches authenticated user
- [ ] Passwords are never logged
- [ ] XSS prevention works (try `<script>alert('xss')</script>` in inputs)
- [ ] API calls use HTTPS
- [ ] Sensitive data not in browser cache/storage
- [ ] Session timeout works
- [ ] Logout clears all data

See `SECURITY.md` for complete API security test commands.

---

## Deployment

### Cloudflare Workers

```bash
# Deploy to production
npm run deploy

# Deploy to staging (if configured)
npm run deploy:staging
```

**⚠️ SECURITY:** Verify environment variables are set securely in Cloudflare dashboard.

---

## Architecture

### Cloudflare KV Storage

Trip data is stored in Cloudflare KV with the following structure:
Key: trip:{userId}:{tripId}
Value: { userId, date, startAddress, stops[], earnings, ... }

**Security:**

- All access goes through authenticated API
- API verifies user owns data before returning
- Keys include userId for isolation
- Full addresses allowed because server-side with access control

See `SECURITY.md` for complete KV security requirements.

---

## License

[Add license information]

---

## Support

[Add contact information or links to support channels]

---

**Remember:**

- Security is the highest priority
- When in doubt, check `GOVERNANCE.md` for rule precedence
- Never compromise security for convenience
- Always verify user owns data in API
