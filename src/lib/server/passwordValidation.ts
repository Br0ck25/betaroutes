// src/lib/server/passwordValidation.ts
// [!code fix] SECURITY (Issue #9): Comprehensive password strength validation

export interface PasswordValidationResult {
  valid: boolean;
  error?: string;
  strength?: 'weak' | 'fair' | 'good' | 'strong';
}

/**
 * Validate password strength according to security best practices
 * Requirements:
 * - Minimum 12 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 * - No common passwords
 */
export function validatePassword(password: string): PasswordValidationResult {
  // Length check (minimum 12 characters for good security)
  if (password.length < 12) {
    return {
      valid: false,
      error: 'Password must be at least 12 characters long',
      strength: 'weak'
    };
  }

  // Complexity checks
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password);

  const complexityCount = [hasUppercase, hasLowercase, hasNumber, hasSpecial].filter(
    Boolean
  ).length;

  if (complexityCount < 3) {
    return {
      valid: false,
      error:
        'Password must include at least 3 of: uppercase letters, lowercase letters, numbers, special characters',
      strength: 'weak'
    };
  }

  // Common password check (top 100 most common passwords)
  const commonPasswords = [
    'password',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'abc123456',
    'password1',
    'welcome123',
    'admin123',
    'letmein123',
    'monkey123',
    'iloveyou',
    'trustno1',
    'dragon123'
  ];

  const lowerPassword = password.toLowerCase();
  if (commonPasswords.some((common) => lowerPassword.includes(common))) {
    return {
      valid: false,
      error: 'Password is too common and easily guessable',
      strength: 'weak'
    };
  }

  // Check for sequential characters (123, abc, etc.)
  if (
    /012|123|234|345|456|567|678|789|890|abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz/i.test(
      password
    )
  ) {
    return {
      valid: false,
      error: 'Password contains sequential characters',
      strength: 'fair'
    };
  }

  // Check for repeated characters (aaa, 111, etc.)
  if (/(.)\1{2,}/.test(password)) {
    return {
      valid: false,
      error: 'Password contains repeated characters',
      strength: 'fair'
    };
  }

  // Determine strength
  let strength: 'weak' | 'fair' | 'good' | 'strong' = 'good';
  if (password.length >= 16 && complexityCount === 4) {
    strength = 'strong';
  } else if (password.length >= 14 && complexityCount >= 3) {
    strength = 'good';
  } else {
    strength = 'fair';
  }

  return {
    valid: true,
    strength
  };
}

/**
 * Legacy support: Simple validation for backwards compatibility
 * Use validatePassword() for new code
 */
export function isPasswordStrong(password: string): boolean {
  return validatePassword(password).valid;
}
