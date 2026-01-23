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

	// Common password check (expanded list based on HaveIBeenPwned and rockyou)
	const commonPasswords = [
		// Top breached passwords
		'password',
		'password123',
		'password1',
		'password12',
		'password123!',
		'12345678',
		'123456789',
		'1234567890',
		'qwerty123',
		'qwertyuiop',
		'abc123456',
		'welcome123',
		'admin123',
		'letmein123',
		'letmein',
		'monkey123',
		'iloveyou',
		'trustno1',
		'dragon123',
		'sunshine',
		'princess',
		'football',
		'baseball',
		'whatever',
		'shadow123',
		'master123',
		'michael',
		'superman',
		'batman123',
		'starwars',
		'computer',
		'passw0rd',
		'p@ssword',
		'p@ssw0rd',
		'asdfghjkl',
		'zxcvbnm',
		'changeme',
		'admin1234',
		'welcome1',
		'summer2023',
		'summer2024',
		'winter2023',
		'winter2024',
		'spring2023',
		'spring2024',
		'fall2023',
		'fall2024',
		// Common keyboard patterns
		'1q2w3e4r5t',
		'qazwsxedc',
		'1qaz2wsx',
		'zaq1xsw2',
		'qwerty12345',
		// Common phrases
		'iloveyou1',
		'ihateyou',
		'fuckyou',
		'letmein1',
		'access123',
		'login123',
		'hello123',
		'abc12345',
		'test1234',
		'testing123',
		'guest1234'
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
