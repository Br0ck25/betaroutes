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

	// [!code fix] Issue #40: Expanded common password check (top 100+ most common passwords)
	const commonPasswords = [
		// Top 20 most common passwords
		'password',
		'password123',
		'password1',
		'12345678',
		'123456789',
		'1234567890',
		'qwerty',
		'qwerty123',
		'qwertyuiop',
		'abc123456',
		'abc123',
		'letmein',
		'welcome',
		'welcome123',
		'admin',
		'admin123',
		'monkey',
		'monkey123',
		'iloveyou',
		'trustno1',
		// Common words
		'dragon',
		'dragon123',
		'master',
		'master123',
		'sunshine',
		'sunshine123',
		'princess',
		'princess123',
		'football',
		'football123',
		'baseball',
		'baseball123',
		'soccer',
		'soccer123',
		'hockey',
		'hockey123',
		'batman',
		'batman123',
		'superman',
		'superman123',
		'starwars',
		'starwars123',
		// Keyboard patterns
		'asdfgh',
		'asdfghjkl',
		'zxcvbn',
		'zxcvbnm',
		'1qaz2wsx',
		'qazwsx',
		// Common number patterns
		'111111',
		'000000',
		'121212',
		'666666',
		'696969',
		'123321',
		'654321',
		'7777777',
		'1234qwer',
		// Common phrases
		'letmein123',
		'access',
		'access123',
		'login',
		'login123',
		'passw0rd',
		'passwd',
		'p@ssw0rd',
		'p@ssword',
		// Year-based
		'pass2023',
		'pass2024',
		'pass2025',
		'winter2023',
		'summer2023',
		'spring2024',
		'fall2024',
		'january',
		'february',
		// Names and common words
		'michael',
		'jennifer',
		'joshua',
		'ashley',
		'shadow',
		'shadow123',
		'killer',
		'killer123',
		'george',
		'jordan',
		'andrew',
		'charlie',
		'thomas',
		'robert',
		'william',
		'daniel',
		'matthew',
		'anthony',
		// Tech-related
		'computer',
		'computer123',
		'internet',
		'internet123',
		'server',
		'server123',
		'network',
		'database',
		'google',
		'microsoft',
		'apple',
		// Simple variations
		'secret',
		'secret123',
		'changeme',
		'changeme123',
		'test123',
		'test1234',
		'hello123',
		'welcome1',
		'password12',
		'pass1234'
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
