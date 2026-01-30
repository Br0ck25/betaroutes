---
description: 'Testing rules for spec/test files'
applyTo: '**/*.{test,spec}.{ts,js}'
---

## Tests must be meaningful

- Test behavior, not implementation details.
- Include at least: happy path + one failure/edge case.
- Avoid flaky tests: no timers unless necessary; deterministic data.

## Output

- If you add a feature or bug fix, add/adjust tests accordingly.
