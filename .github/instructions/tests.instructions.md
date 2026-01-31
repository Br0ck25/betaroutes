---
description: 'Testing rules for spec/test files'
applyTo: '**/*.{test,spec}.{ts,js}'
---

# Testing Rules

## Tests must be meaningful

- Test behavior, not implementation details
- Include at least: happy path + one failure/edge case
- Avoid flaky tests: no timers unless necessary; deterministic data
- Use descriptive test names that explain what's being tested

## Coverage requirements

- New features MUST have tests
- Bug fixes MUST have regression tests
- Security-critical code MUST have edge case tests

## Test structure

```typescript
describe('Feature name', () => {
  it('should handle happy path', () => {
    // Arrange
    const input = 'valid data';
    
    // Act
    const result = functionUnderTest(input);
    
    // Assert
    expect(result).toBe('expected output');
  });
  
  it('should handle error case', () => {
    const invalidInput = null;
    
    expect(() => functionUnderTest(invalidInput))
      .toThrow('expected error message');
  });
});
```

## What to test

### Components (Svelte)
- Rendering with different props
- User interactions (clicks, inputs)
- State changes
- Accessibility (ARIA attributes, keyboard navigation)

### Server routes
- Authentication/authorization
- Input validation
- Error handling
- Rate limiting (if applicable)

### Utility functions
- Edge cases (empty arrays, null, undefined)
- Boundary conditions
- Error handling
- Type conversions

## What NOT to test

- Implementation details (internal state, private methods)
- Third-party library functionality
- Framework internals
- Trivial getters/setters

## Security testing

For security-critical code, test:
- Input validation (SQL injection, XSS attempts)
- Authorization (can user A access user B's data?)
- Rate limiting
- CSRF protection

## Output

- If you add a feature or bug fix, add/adjust tests accordingly
- If removing code, remove corresponding tests
- Keep test code clean and maintainable
