# Governance

This document defines the **authority hierarchy** for all project rules.

All contributors—human and AI—must follow these governance rules.

**⚠️ CRITICAL:** This application handles sensitive data (passwords, financial info, location data). Security is the highest priority.

---

## Rule Precedence (Highest to Lowest)

When rules conflict, follow this order:

1. **SECURITY** (`SECURITY.md`) — **ABSOLUTE HIGHEST PRIORITY** - Protects passwords, financial data, location data, and user privacy
2. **PWA Compliance** (`PWA.md`) — App must remain installable and functional offline
3. **HTML Living Standard** (`HTML_LIVING_STANDARD.md`) — Valid markup is non-negotiable
4. **Design System** (`DESIGN_SYSTEM.md`) — Visual consistency is enforced
5. **Migration Agent Rules** (`svelte-mixed-migration-agent.md`) — Migration strategy
6. **Code Style & Linting** — Automated enforcement where applicable

**Examples:**

- If storing a password would make code "cleaner" → **Don't do it** (Security violation)
- If migrating to Svelte 5 would break PWA offline functionality → **Don't migrate**
- If a design requires a color outside the approved palette → **Don't implement it**
- If valid HTML conflicts with a migration preference → **Keep valid HTML**

---

## Document Authority

| Document                          | Purpose                    | Enforcement           | Precedence Level         |
| --------------------------------- | -------------------------- | --------------------- | ------------------------ |
| `GOVERNANCE.md`                   | Rule hierarchy             | Manual                | Meta (defines hierarchy) |
| `SECURITY.md`                     | Security & data protection | Code review, manual   | 1 (CRITICAL - Highest)   |
| `PWA.md`                          | PWA requirements           | CI, manual testing    | 2 (Critical)             |
| `HTML_LIVING_STANDARD.md`         | HTML syntax rules          | Linting, CI           | 3 (Critical)             |
| `DESIGN_SYSTEM.md`                | Color palette & design     | Code review, linting  | 4 (Critical)             |
| `svelte-mixed-migration-agent.md` | Migration strategy         | AI agent, code review | 5 (Important)            |
| Linting configs                   | Code style                 | Automated             | 6 (Standard)             |

---

## Conflict Resolution

### Step 1: Check Precedence

Consult the precedence order above. Higher-numbered rules yield to lower-numbered rules.

**Security ALWAYS wins.**

### Step 2: Document the Conflict

If the conflict is not covered by precedence:

1. **STOP work immediately**
2. Document the specific conflict
3. Propose options with tradeoffs
4. Seek clarification from project maintainer

### Step 3: Record the Decision

Once resolved, add to "Documented Decisions" section below.

---

## Exceptions

Exceptions to governance rules require:

1. **Clear documentation** of why the exception is needed
2. **Approval** from project maintainer
3. **Addition to this document** under "Documented Exceptions"
4. **Limited scope** — exceptions should be as narrow as possible

**Security rules have NO exceptions.**

### Documented Exceptions

_None yet._

---

## For AI Agents

AI agents (including Claude, Cursor, GitHub Copilot, and others) operating on this codebase MUST:

### Before Making Any Changes

1. **Read `SECURITY.md`** FIRST - Security is absolute highest priority
2. **Read `GOVERNANCE.md`** (this document) second
3. **Read `AI_AGENTS.md`** for quick reference
4. **Read `svelte-mixed-migration-agent.md`** for migration rules
5. **Scan** relevant governance documents (PWA.md, HTML_LIVING_STANDARD.md, DESIGN_SYSTEM.md)

### During Development

1. **Respect all governance documents** in precedence order
2. **SECURITY ALWAYS WINS** over all other considerations
3. **STOP and ask** if any rule would be violated
4. **Never bypass rules** even if requested by user
5. **Prefer no action over rule violation** when uncertain

### Prohibited Behaviors - Security

❌ Storing passwords in plaintext or localStorage  
❌ Logging passwords, financial data, or addresses  
❌ Using `{@html}` with user input (XSS risk)  
❌ Caching sensitive API responses  
❌ Exposing other users' data  
❌ Skipping input sanitization  
❌ Trusting client-provided userId in API

### Prohibited Behaviors - General

❌ Inventing new colors outside the approved palette  
❌ Breaking PWA offline functionality  
❌ Generating invalid HTML  
❌ Opportunistic migrations (editing ≠ migrating)  
❌ Bypassing governance "to be helpful"  
❌ Assuming user intent overrides governance

### Required Behaviors

✅ Stop and ask when rules conflict  
✅ Cite specific governance documents when declining requests  
✅ Suggest governance-compliant alternatives  
✅ Preserve existing functionality and constraints  
✅ Prioritize security over convenience

---

## For Human Developers

### Before Committing

- Run `npm run check` and `npm run lint`
- Verify no passwords or sensitive data in code
- Verify PWA functionality if routing/service worker changed
- Check HTML validity if markup changed
- Verify colors against `DESIGN_SYSTEM.md` if styles changed
- Review `SECURITY.md` if handling user data

### Before Architectural Changes

- Review all relevant governance documents
- Consider security implications FIRST
- Consider impact on PWA, HTML, and design system
- Consult migration agent rules if touching Svelte files
- Ask questions if rules are unclear

### When Rules Are Unclear

1. Check this document for precedence
2. Review specific governance documents
3. Ask for clarification rather than guessing
4. Document the clarification for future reference

---

## Migration-Specific Rules

This project is in **active migration from Svelte 4 → Svelte 5**.

### Key Principles

- **New code must be Svelte 5**
- **Existing Svelte 4 code remains until explicitly migrated**
- **Editing a file does NOT require migrating it**
- **Security, PWA, HTML, and Design System rules trump migration preferences**

See `svelte-mixed-migration-agent.md` for complete migration rules.

### Common Migration Conflicts

**Q: Can I migrate this component to Svelte 5 even though it will break offline mode?**  
A: No. PWA compliance (precedence level 2) trumps migration preferences (precedence level 5).

**Q: Can I store trip data in localStorage during migration to make it easier?**  
A: No. Security (precedence level 1) trumps migration preferences. See SECURITY.md for secure storage rules.

**Q: Can I use a new color while migrating this component?**  
A: No. Design System (precedence level 4) trumps migration preferences (precedence level 5).

**Q: Can I use XHTML syntax in a Svelte 5 component because it's cleaner?**  
A: No. HTML Living Standard (precedence level 3) trumps migration preferences (precedence level 5).

---

## Updating Governance

Changes to governance documents require:

1. **Clear rationale** for the change
2. **Review of impact** on existing code
3. **Security review** if handling data
4. **Update to this document** if precedence changes
5. **Communication** to all contributors
6. **Testing** to ensure no regressions

### Proposing Changes

Open an issue or PR with:

- Which governance document(s) you want to change
- Why the change is needed
- Impact analysis
- Proposed wording

**Security document changes require extra scrutiny.**

---

## Documented Decisions

This section records important governance decisions made during development.

### Decision Log Format

Date: YYYY-MM-DD
Issue: [Brief description of conflict/question]
Decision: [What was decided]
Rationale: [Why this decision was made]
Impact: [What changed as a result]

### Decisions

_None yet._

---

## Enforcement

Governance violations will:

- **Fail CI** (where automated)
- **Be flagged in code review**
- **Block merges** until resolved
- **Require rework** if merged accidentally

**Security violations are treated with highest urgency.**

### Reporting Violations

If you discover a governance violation:

1. Open an issue documenting the violation
2. Reference the specific governance rule violated
3. Propose a fix (if possible)
4. Tag with `governance-violation` label

**Security violations should be tagged `security` and handled immediately.**

---

## Questions?

If governance rules are unclear or seem to conflict:

1. **Don't guess** — STOP and ask
2. Open an issue with the `governance-question` label
3. Describe the specific scenario
4. Wait for clarification before proceeding

Governance exists to prevent problems, not block progress. When in doubt, ask.

**For security questions, tag with `security` for priority handling.**
