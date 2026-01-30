# Design System

This document defines the approved design system for this project.

---

## Color Palette (Approved Colors Only)

The following colors are the **only colors allowed** in this project:

### Brand Colors

- `#F68A2E` — primary orange
- `#2C507B` — primary blue
- `#1FA8DB` — accent blue
- `#8BC12D` — accent green
- `#8F3D91` — accent purple

### Neutral Colors

- `#FFFFFF` — white
- `#000000` — black
- `#F5F5F5` — light gray (backgrounds)
- `#E0E0E0` — medium gray (borders)
- `#333333` — dark gray (text)

### Rules

- Do not introduce new colors, shades, or CSS variables outside this palette
- Do not use color names, `rgb()`, or `hsl()` values that don't match these hex codes exactly
- Do not create color variations using opacity, filters, or blend modes
- Exceptions require explicit approval and documentation

---

## Usage Guidelines

### Primary Colors

- Use `#F68A2E` (orange) for primary CTAs and brand elements
- Use `#2C507B` (blue) for headers and key UI elements

### Accent Colors

- Use `#1FA8DB` (accent blue) for links and interactive elements
- Use `#8BC12D` (green) for success states and positive actions
- Use `#8F3D91` (purple) for special highlights or secondary actions

### Neutral Colors

- Use `#FFFFFF` (white) for backgrounds and light surfaces
- Use `#000000` (black) for primary text (sparingly, prefer `#333333`)
- Use `#F5F5F5` (light gray) for subtle backgrounds and surfaces
- Use `#E0E0E0` (medium gray) for borders and dividers
- Use `#333333` (dark gray) for body text and secondary content

---

## Forbidden Patterns

❌ No `currentColor` unless explicitly approved  
❌ No opacity variations to create "new" colors  
❌ No filters or blend modes to modify palette colors  
❌ No arbitrary Tailwind color utilities outside this palette  
❌ No gradient combinations not explicitly defined  
❌ No color picker or dynamic color generation

---

## Implementation

### CSS

```css
:root {
  --color-primary-orange: #f68a2e;
  --color-primary-blue: #2c507b;
  --color-accent-blue: #1fa8db;
  --color-accent-green: #8bc12d;
  --color-accent-purple: #8f3d91;

  --color-white: #ffffff;
  --color-black: #000000;
  --color-gray-light: #f5f5f5;
  --color-gray-medium: #e0e0e0;
  --color-gray-dark: #333333;
}
```

### Svelte

```svelte
<style>
  .button-primary {
    background-color: #f68a2e; /* primary orange */
  }

  .text-body {
    color: #333333; /* dark gray */
  }
</style>
```

---

## Enforcement

Color usage is enforced through:

- Code review
- Linting (if configured)
- Design audits
- CI checks

Violations should be caught before merge.

---

## Migration Note

When migrating Svelte 4 → Svelte 5:

- Verify all colors remain within approved palette
- Do NOT introduce new colors during migration
- Replace any non-compliant colors with approved alternatives
- Document any color inconsistencies for review
