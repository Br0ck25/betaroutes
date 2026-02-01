---
description: 'Design system and styling rules'
applyTo: '**/*.svelte,**/*.css,**/*.ts'
---

# Design System Rules

## Tailwind Only (No Arbitrary Values)

### Forbidden patterns

- ❌ Arbitrary values: `w-[13px]`, `bg-[#123]`, `p-[2.5rem]`
- ❌ Raw CSS in `<style>` blocks (unless absolutely necessary)
- ❌ Inline `style` attributes: `<div style="color: red">`
- ❌ Color names: `bg-red`, `text-blue` (use approved hex codes)

### Use approved utilities only

- ✅ Standard Tailwind classes: `w-full`, `bg-blue-500`, `p-4`
- ✅ Custom utilities from `tailwind.config.js`
- ✅ Approved color palette (see below)

## Approved Color Palette (Strict)

### Brand Colors

```
Primary Orange: #F68A2E
Primary Blue:   #2C507B
Accent Blue:    #1FA8DB
Accent Green:   #8BC12D
Accent Purple:  #8F3D91
```

### Neutral Colors

```
White:       #FFFFFF
Black:       #000000
Light Gray:  #F5F5F5  (backgrounds)
Medium Gray: #E0E0E0  (borders)
Dark Gray:   #333333  (text)
```

### Usage in Tailwind

Configure these in `tailwind.config.js`:

```javascript
module.exports = {
  theme: {
    extend: {
      colors: {
        'primary-orange': '#F68A2E',
        'primary-blue': '#2C507B',
        'accent-blue': '#1FA8DB',
        'accent-green': '#8BC12D',
        'accent-purple': '#8F3D91',
        'light-gray': '#F5F5F5',
        'medium-gray': '#E0E0E0',
        'dark-gray': '#333333'
      }
    }
  }
};
```

Then use:

```svelte
<button class="bg-primary-orange text-white">Click me</button>
<div class="bg-light-gray border border-medium-gray">Content</div>
```

## Component Styling Guidelines

### Button styles

```svelte
<!-- Primary button -->
<button class="bg-primary-orange hover:opacity-90 text-white px-4 py-2 rounded">
  Primary Action
</button>

<!-- Secondary button -->
<button class="bg-primary-blue hover:opacity-90 text-white px-4 py-2 rounded">
  Secondary Action
</button>

<!-- Outline button -->
<button
  class="border-2 border-primary-orange text-primary-orange hover:bg-primary-orange hover:text-white px-4 py-2 rounded"
>
  Outline Action
</button>
```

### Typography

```svelte
<!-- Headings -->
<h1 class="text-3xl font-bold text-dark-gray">Page Title</h1>
<h2 class="text-2xl font-semibold text-dark-gray">Section Title</h2>
<h3 class="text-xl font-medium text-dark-gray">Subsection</h3>

<!-- Body text -->
<p class="text-base text-dark-gray">Body text content</p>
<p class="text-sm text-dark-gray">Small text</p>

<!-- Links -->
<a href="..." class="text-accent-blue hover:underline">Link text</a>
```

### Layout

```svelte
<!-- Container -->
<div class="container mx-auto px-4">Content</div>

<!-- Card -->
<div class="bg-white rounded-lg shadow-md p-6 border border-medium-gray">Card content</div>

<!-- Grid -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  <!-- Items -->
</div>
```

## Spacing System

Use Tailwind's default spacing scale:

- `p-1` = 0.25rem (4px)
- `p-2` = 0.5rem (8px)
- `p-4` = 1rem (16px)
- `p-6` = 1.5rem (24px)
- `p-8` = 2rem (32px)

Same for margin (`m-*`), padding (`p-*`), gap (`gap-*`).

## Responsive Design

### Mobile-first approach

```svelte
<!-- Base styles = mobile -->
<div class="text-sm md:text-base lg:text-lg">
  <!-- Small on mobile, larger on tablet/desktop -->
</div>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
  <!-- 1 column mobile, 2 tablet, 3 desktop -->
</div>
```

### Breakpoints (Tailwind defaults)

- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

## Dark Mode (If Applicable)

```svelte
<!-- Light/dark variants -->
<div class="bg-white dark:bg-gray-800 text-dark-gray dark:text-white">Content adapts to theme</div>
```

## Accessibility

### Color contrast

- Text on background must meet WCAG AA (4.5:1 ratio)
- Primary orange #F68A2E on white = 4.6:1 ✅
- Primary blue #2C507B on white = 7.4:1 ✅
- Dark gray #333333 on white = 12.6:1 ✅

### Focus states

```svelte
<button class="focus:outline-none focus:ring-2 focus:ring-primary-orange focus:ring-offset-2">
  Accessible button
</button>

<input class="focus:outline-none focus:ring-2 focus:ring-accent-blue" />
```

## When Raw CSS Is Allowed

### Exceptions (rare)

- Complex animations not achievable with Tailwind
- Third-party library overrides (when no other option)
- Print stylesheets

### If you must use raw CSS

```svelte
<style>
  /* Scoped styles only */
  .custom-animation {
    animation: slide-in 0.3s ease-out;
  }

  @keyframes slide-in {
    from {
      transform: translateY(-10px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
</style>
```

## Icons

### Use consistent icon library

- Lucide icons (preferred)
- Heroicons (alternative)
- Font Awesome (if needed)

```svelte
<script>
  import { User, Settings, LogOut } from 'lucide-svelte';
</script>

<User class="w-5 h-5 text-primary-blue" />
<Settings class="w-5 h-5 text-dark-gray" />
```

## Forms

### Input styles

```svelte
<input
  type="text"
  class="w-full px-4 py-2 border border-medium-gray rounded focus:outline-none focus:ring-2 focus:ring-accent-blue"
  placeholder="Enter text..."
/>

<select
  class="w-full px-4 py-2 border border-medium-gray rounded focus:outline-none focus:ring-2 focus:ring-accent-blue"
>
  <option>Option 1</option>
</select>
```

### Error states

```svelte
<input
  type="email"
  class="w-full px-4 py-2 border border-red-500 rounded focus:ring-2 focus:ring-red-500"
  aria-invalid="true"
/>
<p class="text-sm text-red-500 mt-1">Invalid email address</p>
```

## Loading States

### Spinners

```svelte
<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-orange"></div>
```

### Skeleton loaders

```svelte
<div class="animate-pulse bg-light-gray h-20 rounded"></div>
```

## Enforcement

### ESLint rule (if available)

Configure to warn on:

- Arbitrary Tailwind values
- Inline `style` attributes
- Colors not in approved palette

### Code review checklist

- [ ] No arbitrary Tailwind values
- [ ] Only approved colors used
- [ ] Mobile-responsive
- [ ] Accessible (contrast, focus states)
- [ ] Consistent with design system
