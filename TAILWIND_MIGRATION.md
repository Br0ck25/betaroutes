# Tailwind Color Palette Migration Guide

This guide helps you migrate from the old color palette to the DESIGN_SYSTEM.md approved palette.

---

## Quick Reference: Color Mapping

### Old → New Mapping

| Old Class | New Class | Hex | Usage |
|-----------|-----------|-----|-------|
| `primary-green` | `brand-orange` | #F68A2E | Primary CTAs |
| `primary-green-dark` | `brand-orange` | #F68A2E | Same as above |
| `primary-purple` | `brand-accent-purple` | #8F3D91 | Secondary actions |
| `primary-purple-dark` | `brand-accent-purple` | #8F3D91 | Same as above |
| `semantic-success` | `semantic-success` | #8BC12D | ✅ No change |
| `semantic-error` | `semantic-error` | #F68A2E | ✅ No change |
| `semantic-warning` | `semantic-warning` | #F68A2E | ✅ No change |
| `semantic-info` | `semantic-info` | #1FA8DB | ✅ No change |

---

## Step 1: Global Find & Replace

Run these commands in your project root:

### Background Colors

```bash
# Primary green → Brand orange
find src -type f -name "*.svelte" -exec sed -i 's/bg-primary-green\b/bg-brand-orange/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/bg-primary-green-dark\b/bg-brand-orange/g' {} +

# Primary purple → Brand accent-purple
find src -type f -name "*.svelte" -exec sed -i 's/bg-primary-purple\b/bg-brand-accent-purple/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/bg-primary-purple-dark\b/bg-brand-accent-purple/g' {} +
```

### Text Colors

```bash
# Primary green → Brand orange
find src -type f -name "*.svelte" -exec sed -i 's/text-primary-green\b/text-brand-orange/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/text-primary-green-dark\b/text-brand-orange/g' {} +

# Primary purple → Brand accent-purple
find src -type f -name "*.svelte" -exec sed -i 's/text-primary-purple\b/text-brand-accent-purple/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/text-primary-purple-dark\b/text-brand-accent-purple/g' {} +
```

### Border Colors

```bash
# Primary green → Brand orange
find src -type f -name "*.svelte" -exec sed -i 's/border-primary-green\b/border-brand-orange/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/border-primary-green-dark\b/border-brand-orange/g' {} +

# Primary purple → Brand accent-purple
find src -type f -name "*.svelte" -exec sed -i 's/border-primary-purple\b/border-brand-accent-purple/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/border-primary-purple-dark\b/border-brand-accent-purple/g' {} +
```

### Hover States

```bash
# Hover backgrounds
find src -type f -name "*.svelte" -exec sed -i 's/hover:bg-primary-green\b/hover:bg-brand-orange/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/hover:bg-primary-purple\b/hover:bg-brand-accent-purple/g' {} +

# Hover text
find src -type f -name "*.svelte" -exec sed -i 's/hover:text-primary-green\b/hover:text-brand-orange/g' {} +
find src -type f -name "*.svelte" -exec sed -i 's/hover:text-primary-purple\b/hover:text-brand-accent-purple/g' {} +
```

---

## Step 2: Manual Review

Some color choices may need human judgment:

### Consider These Alternatives

**If the old color was used for:**
- ✅ Success states → Use `semantic-success` (green)
- ⚠️ Primary CTAs → Use `brand-orange`
- 🔵 Links/Info → Use `brand-accent-blue`
- 💜 Highlights → Use `brand-accent-purple`

### Example Conversions

```svelte
<!-- BEFORE -->
<button class="bg-primary-green text-white hover:bg-primary-green-dark">
  Save
</button>

<!-- AFTER (Primary CTA) -->
<button class="bg-brand-orange text-neutral-white hover:opacity-90">
  Save
</button>

<!-- AFTER (Success action) -->
<button class="bg-semantic-success text-neutral-white hover:opacity-90">
  Save
</button>
```

---

## Step 3: Search for Stragglers

```bash
# Find any remaining old color references
grep -r "primary-green" src/
grep -r "primary-purple" src/

# Check for direct hex values (should be rare)
grep -r "#4caf50" src/
grep -r "#667eea" src/
```

---

## Step 4: Update Custom CSS (if any)

If you have any `<style>` blocks with old colors:

```css
/* BEFORE */
.custom-button {
  background-color: #4caf50;
}

/* AFTER - Use Tailwind classes instead */
<button class="bg-brand-orange">
```

**Better:** Remove custom CSS and use Tailwind utilities.

---

## Step 5: Rebuild & Test

```bash
# 1. Clear Tailwind cache
rm -rf .svelte-kit
rm -rf node_modules/.vite

# 2. Rebuild
npm run build

# 3. Preview
npm run preview

# 4. Visual regression test
# Check all pages for color accuracy
```

---

## Step 6: Verify Compliance

```bash
# No old colors should remain
! grep -r "primary-green\|primary-purple" src/ --include="*.svelte" || echo "Found old colors!"

# Run gate
npm run gate
```

---

## Common Pitfalls

### ❌ Don't Do This

```svelte
<!-- Arbitrary values violate DESIGN_SYSTEM.md -->
<div class="bg-[#4caf50]">

<!-- Creating color variations violates DESIGN_SYSTEM.md -->
<div class="bg-brand-orange/50">
```

### ✅ Do This Instead

```svelte
<!-- Use approved colors only -->
<div class="bg-brand-orange">

<!-- For lighter versions, use separate elements or opacity classes -->
<div class="bg-brand-orange opacity-75">
```

---

## New Color Palette Reference

### Brand Colors
- `brand-orange` - #F68A2E (Primary CTA)
- `brand-blue` - #2C507B (Headers)
- `brand-accent-blue` - #1FA8DB (Links)
- `brand-accent-green` - #8BC12D (Success)
- `brand-accent-purple` - #8F3D91 (Highlights)

### Neutral Colors
- `neutral-white` - #FFFFFF
- `neutral-black` - #000000
- `neutral-gray-light` - #F5F5F5
- `neutral-gray-medium` - #E0E0E0
- `neutral-gray-dark` - #333333

### Semantic Colors
- `semantic-success` - #8BC12D
- `semantic-error` - #F68A2E
- `semantic-warning` - #F68A2E
- `semantic-info` - #1FA8DB

---

## Rollback Plan (Emergency)

If the new colors cause critical issues:

```bash
# 1. Revert tailwind.config.js
git checkout HEAD~1 tailwind.config.js

# 2. Rebuild
npm run build

# 3. Deploy old version
```

**But:** This is a governance violation. Fix forward instead!

---

## Questions?

- **Q: Can I add a new shade of orange?**
  **A:** No. See DESIGN_SYSTEM.md - no color variations allowed.

- **Q: What if I need a lighter version?**
  **A:** Use opacity utilities: `bg-brand-orange opacity-75`

- **Q: Can I use gradients?**
  **A:** Only if explicitly defined in DESIGN_SYSTEM.md (currently: no).

---

## Completion Checklist

- [ ] Replaced all `primary-green` references
- [ ] Replaced all `primary-purple` references
- [ ] Removed any custom CSS with old hex values
- [ ] Rebuilt application
- [ ] Visually tested all pages
- [ ] Verified no old colors remain (`grep`)
- [ ] Ran `npm run gate` successfully
- [ ] Updated any documentation/screenshots
