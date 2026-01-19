# Migration Notes

This file tracks issues, learnings, and decisions made during the Svelte 4 → Svelte 5 migration.

---

## Migration Issues

Document any issues encountered during migration that required rollback or special handling.

### Template

```markdown
### [Component Name] - [Date]

**Issue:** Brief description of what went wrong

**Root Cause:** Why it happened

**Resolution:** How it was fixed

**Prevention:** How to avoid in future migrations
```

---

## Learnings

Document patterns or insights discovered during migration.

### Template

```markdown
### [Pattern Name] - [Date]

**Discovery:** What was learned

**Impact:** How this affects future migrations

**Recommendation:** Suggested approach
```

---

## Decisions

Document architectural or technical decisions made during migration.

### Template

```markdown
### [Decision Name] - [Date]

**Context:** What required a decision

**Options Considered:** Alternatives evaluated

**Decision:** What was chosen

**Rationale:** Why this option was selected
```

---

## Examples

### Button Component - 2025-01-19

**Issue:** Migration broke event handling in Button component

**Root Cause:** Forgot to convert `on:click` to `onclick`

**Resolution:** Updated all event handlers to use standard DOM attributes

**Prevention:** Added step to migration checklist to verify all event handlers
