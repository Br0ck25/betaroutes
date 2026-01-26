import prettier from 'eslint-config-prettier';
import { fileURLToPath } from 'node:url';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

export default defineConfig(
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node }
		},
		rules: {
			// 🔧 TS: Handled by compiler, disable to reduce noise
			'no-undef': 'off',

			// 🛡️ PATTERN #18: Cloudflare Type Conflicts
			// Prevents "Type 'KVNamespace' is not assignable to..."
			'no-restricted-imports': [
				'error',
				{
					paths: [
						{
							name: '@cloudflare/workers-types',
							message:
								'Do not import from @cloudflare/workers-types. Use global ambient types (e.g. KVNamespace) instead. See AI_AGENTS.md Pattern #18.'
						}
					]
				}
			],

			// 🧹 PATTERN #6 & #32: Clean Code Hygiene
			// Allows _vars but errors on unused vars without underscore
			'@typescript-eslint/no-unused-vars': [
				'error',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_'
				}
			],

			// 🧹 PATTERN #28: Prefer Const
			// Stops lazy "let" usage
			'prefer-const': 'error',

			// 🛡️ SECURITY: XSS Prevention
			'no-eval': 'error',
			'no-implied-eval': 'error'
		}
	},
	// 🔒 SERVER-SIDE SAFEGUARDS (Strict Security)
	{
		files: ['**/+server.*', '**/+page.server.*', '**/+layout.server.*', 'src/lib/server/**'],
		rules: {
			// 🛡️ PATTERN #34: No Console Logs in Production Code
			'no-console': 'error',

			// 🛡️ PATTERN #10 & #16: Identity Fallback Prevention
			// Mechanically prevents using .name, .email, or .token for auth checks
			'no-restricted-syntax': [
				'error',
				{
					selector: "MemberExpression[property.name=/^(name|email|token)$/][object.name='user']",
					message:
						"SECURITY: Do not use user.name/email/token for ownership checks. Use 'user.id' only. (See SECURITY.md)"
				},
				{
					selector:
						"MemberExpression[property.name=/^(name|email|token)$/][object.type='MemberExpression'][object.property.name='user']",
					message:
						"SECURITY: Do not use locals.user.name/email/token for ownership checks. Use 'locals.user.id' only. (See SECURITY.md)"
				},
				// 🛡️ PATTERN #11: Mass Assignment Warning
				// Warns if you try to spread a variable named 'body' into an object
				{
					selector: "ObjectExpression > SpreadElement[argument.name='body']",
					message:
						"SECURITY WARNING: Potential Mass Assignment. Do not spread 'body' directly into objects. Destructure specific fields instead. (See SECURITY.md)"
				}
			]
		}
	},
	// ⚡ SVELTE SPECIFIC
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		},
		rules: {
			// Performance: Required for Svelte 5 list optimization
			'svelte/require-each-key': 'error',

			// Security: Prevent {@html} usage (Pattern #23 / XSS)
			'svelte/no-at-html-tags': 'error',
			// Allow standard root deployments; warn instead of error to reduce noise
			'svelte/no-navigation-without-resolve': 'warn',

			// Migration: Turn off strict typing for UI files to allow rapid dev
			// (Server files remain strict)
			'@typescript-eslint/no-explicit-any': 'off'
		}
	}
);
