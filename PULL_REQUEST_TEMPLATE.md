## Description

<!-- Briefly describe what this PR does -->

## Type of Change

- [ ] Bug fix (Svelte 4)
- [ ] Bug fix (Svelte 5)
- [ ] New feature (Svelte 5)
- [ ] Migration (Svelte 4 → Svelte 5)
- [ ] Security fix
- [ ] API endpoint (Cloudflare Workers)
- [ ] Documentation update
- [ ] Other (please describe)

## Governance Checklist

### Security (HIGHEST PRIORITY)

- [ ] No passwords stored in plaintext or localStorage
- [ ] No sensitive data logged (passwords, addresses, amounts)
- [ ] User input sanitized (no XSS vulnerabilities)
- [ ] No `{@html}` used with user input
- [ ] API calls use HTTPS only
- [ ] No secrets committed to version control
- [ ] Authentication/authorization preserved
- [ ] **API endpoints verify user owns data before returning it**
- [ ] **Client-provided userId not trusted without verification**
- [ ] Read `SECURITY.md` if handling user data

### General

- [ ] Code follows governance rules (`GOVERNANCE.md`)
- [ ] `npm run check` passes
- [ ] `npm run lint` passes
- [ ] `npm audit` shows no critical vulnerabilities

### Svelte Version

- [ ] New code uses Svelte 5 syntax
- [ ] Existing Svelte 4 code only migrated if necessary
- [ ] Migration annotation added (if applicable)
- [ ] **Editing did NOT trigger unnecessary migration**

### PWA Compliance

- [ ] PWA functionality preserved
- [ ] Offline mode tested (if applicable)
- [ ] Service worker not modified (or approved if modified)
- [ ] `manifest.json` not modified (or approved if modified)
- [ ] No sensitive data cached in service worker

### HTML Standard

- [ ] HTML is valid per Living Standard
- [ ] No self-closing non-void elements
- [ ] Boolean attributes used correctly

### Design System

- [ ] Colors are from approved palette
- [ ] No new colors introduced
- [ ] Design system followed

## Security Review

<!-- If this PR handles user data, describe security measures taken -->

**Does this PR handle sensitive data?** Yes / No

If yes:

- [ ] Reviewed SECURITY.md requirements
- [ ] Implemented proper input sanitization
- [ ] No sensitive data in logs or cache
- [ ] Authentication/authorization verified
- [ ] **User ownership verification implemented (if API endpoint)**

## API Security (if applicable)

<!-- If this PR adds/modifies API endpoints -->

**Does this PR add/modify API endpoints?** Yes / No

If yes:

- [ ] Endpoint requires authentication
- [ ] Endpoint verifies user owns requested data
- [ ] Client-provided userId not trusted
- [ ] Tested with security test commands from SECURITY.md
- [ ] KV keys use user-prefixed structure: `trip:{userId}:{tripId}`

## Testing

<!-- Describe how you tested these changes -->

- [ ] Manual testing completed
- [ ] PWA offline mode verified (if applicable)
- [ ] Security testing completed (if handling user data)
- [ ] API security tests passed (if API endpoint)

## Migration Details (if applicable)

<!-- If this PR migrates files from Svelte 4 to Svelte 5 -->

**Files migrated:**

- `path/to/file.svelte` - [Date]

**API compatibility:**

- [ ] Fully backward compatible (no API changes)
- [ ] Breaking changes (describe below)

**Reason for migration:**

<!-- Explain why migration was necessary -->

## Screenshots (if applicable)

<!-- Add screenshots for UI changes -->

## Additional Notes

<!-- Any other context about this PR -->
