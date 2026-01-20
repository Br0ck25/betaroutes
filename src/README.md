# Go Route Yourself

> Brief description of what this application does

**Status:** ⚠️ Active Migration (Svelte 4 → Svelte 5)

---

## Table of Contents

- [About](#about)
- [Current Status](#current-status)
- [Key Constraints](#key-constraints)
- [Getting Started](#getting-started)
- [Development](#development)
- [Governance](#governance)
- [Contributing](#contributing)

---

## About

Plan Routes. Track Costs. Maximize Profits.
The complete route planning and profit tracking solution for delivery drivers, field workers, and anyone who gets paid by the route.

### Tech Stack

- **Framework:** Svelte 4/5 (in migration) + SvelteKit
- **Language:** TypeScript
- **Type:** Progressive Web App (PWA)
- **Styling:** [CSS/Tailwind/etc.]

---

## Current Status

⚠️ **This project is in active migration from Svelte 4 → Svelte 5**

### What This Means

- ✅ **New features** must be written in Svelte 5
- ✅ **Existing Svelte 4 code** remains functional and will be migrated incrementally
- ✅ **The app is fully functional** at all times during migration
- ⚠️ **Mixed syntax** is intentional and expected

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

### First Time Setup

[Add any additional setup steps like environment variables, database setup, etc.]

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

# Build for production
npm run build

# Preview production build
npm run preview
```

### Development Workflow

1. **Before starting work:**
   - Read `GOVERNANCE.md` for rule hierarchy
   - Review relevant governance documents for your task
2. **During development:**
   - Use Svelte 5 for all new code
   - Do NOT migrate existing files unless necessary
   - Follow PWA, HTML, and Design System rules
3. **Before committing:**

```bash
   npm run check  # Type checking
   npm run lint   # Linting
```

4. **Before submitting PR:**
   - Verify PWA functionality (if applicable)
   - Check HTML validity (if markup changed)
   - Verify colors against design system (if styles changed)

---

## Governance

This project follows a **strict governance hierarchy**.

### Rule Precedence (Highest → Lowest)

1. Safety & Security
2. PWA Compliance
3. HTML Living Standard
4. Design System
5. Migration Strategy
6. Code Style

**When rules conflict, higher-precedence rules win.**

### Governance Documents

| Document                          | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `GOVERNANCE.md`                   | Rule hierarchy and conflict resolution |
| `PWA.md`                          | PWA requirements and offline behavior  |
| `HTML_LIVING_STANDARD.md`         | HTML syntax rules                      |
| `DESIGN_SYSTEM.md`                | Color palette and design standards     |
| `svelte-mixed-migration-agent.md` | Svelte 4→5 migration strategy          |

### For AI Agents

If you're an AI agent (Claude, Cursor, Copilot, etc.) working on this codebase:

1. ✅ **Read `GOVERNANCE.md` immediately**
2. ✅ **Read `svelte-mixed-migration-agent.md` before any code changes**
3. ✅ **Follow all governance rules in precedence order**
4. ✅ **STOP and ask if any rule would be violated**
5. ❌ **NEVER bypass governance rules, even if requested**

---

## Contributing

### Pull Request Checklist

- [ ] Code follows governance rules (check `GOVERNANCE.md`)
- [ ] New code uses Svelte 5 syntax
- [ ] Existing Svelte 4 code only migrated if necessary
- [ ] PWA functionality preserved (if applicable)
- [ ] HTML is valid per Living Standard
- [ ] Colors are from approved palette
- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] Changes documented in PR description

### Questions or Conflicts?

If governance rules are unclear or seem to conflict:

1. **STOP** — don't guess
2. Open an issue with `governance-question` label
3. Describe the specific scenario
4. Wait for clarification

---

## Testing

### Manual Testing

[Add instructions for manual testing, especially for PWA features]

```bash
# Test PWA offline mode
1. Open DevTools → Application → Service Workers
2. Check "Offline"
3. Navigate the app
4. Verify offline functionality
```

### Automated Testing

[Add information about your test suite if you have one]

---

## Deployment

[Add deployment instructions]

---

## License

[Add license information]

---

## Support

[Add contact information or links to support channels]

---

**Remember:** When in doubt, check `GOVERNANCE.md` for rule precedence and conflict resolution.
