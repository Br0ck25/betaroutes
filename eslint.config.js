import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));
const tsconfigRootDir = dirname(fileURLToPath(import.meta.url));

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
                'Do not import from @cloudflare/workers-types. Use global ambient types (e.g. KVNamespace) instead. See ERROR_PATTERNS_AND_STOP_CONDITIONS.md Pattern #18.'
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
      'no-implied-eval': 'error',

      // 🛡️ CRITICAL: No 'any' type (strict TypeScript enforcement)
      // Per AGENTS.md & SECURITY.md: "No any. Use unknown + safe narrowing."
      '@typescript-eslint/no-explicit-any': 'error',

      // ⚠️ Typed rule: MUST be enabled only for typed TS/Svelte configs
      '@typescript-eslint/no-floating-promises': 'off',

      // 🚫 SECURITY: Ban Node.js built-ins (Cloudflare edge incompatible)
      'no-restricted-globals': [
        'error',
        {
          name: 'require',
          message: 'Use ESM imports instead of require(). This is a Cloudflare edge runtime.'
        },
        {
          name: 'process',
          message:
            'Do not use process.env. Use platform.env instead. See ARCHITECTURE.md & SECURITY.md.'
        }
      ]
    }
  },

  // ✅ TYPED LINTING ENABLEMENT (required for no-floating-promises)
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: ts.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir
      }
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error'
    }
  },

  // ✅ Declaration files: promise rules do not apply
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off'
    }
  },

  // 🔒 SERVER-SIDE SAFEGUARDS (Strict Security)
  {
    files: ['**/+server.*', '**/+page.server.*', '**/+layout.server.*', 'src/lib/server/**'],
    rules: {
      // 🛡️ PRODUCTION: No Console Logs in Server Code
      // Use structured logging instead
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

  // ⚡ SVELTE SPECIFIC (STRICT SVELTE 5 ENFORCEMENT)
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig
      }
    },
    rules: {
      // Typed promise safety for Svelte too
      '@typescript-eslint/no-floating-promises': 'error',

      // Performance: Required for Svelte 5 list optimization
      'svelte/require-each-key': 'error',

      // Security: Prevent {@html} usage (Pattern #23 / XSS)
      'svelte/no-at-html-tags': 'error',

      // Navigation: Warn about missing resolve() for base path support
      'svelte/no-navigation-without-resolve': 'warn',

      // 🚫 CRITICAL: BAN SVELTE 4 IMPORTS
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'svelte',
              importNames: ['onMount', 'beforeUpdate', 'afterUpdate', 'tick'],
              message:
                'FORBIDDEN: onMount/beforeUpdate/afterUpdate are Svelte 4 patterns. Use $effect() instead. See SVELTE5_STANDARDS.md'
            },
            {
              name: 'svelte',
              importNames: ['createEventDispatcher'],
              message:
                'FORBIDDEN: createEventDispatcher is Svelte 4. Use callback props instead. See SVELTE5_STANDARDS.md'
            },
            {
              name: 'svelte/store',
              importNames: ['writable', 'readable', 'derived', 'get'],
              message:
                'FORBIDDEN: Svelte stores are legacy. Use $state() in .svelte.ts files instead. See SVELTE5_STANDARDS.md'
            },
            {
              name: 'svelte/transition',
              importNames: ['fade', 'blur', 'fly', 'slide', 'scale', 'draw', 'crossfade'],
              message:
                'Consider using Svelte 5 transition syntax. Import from svelte/transition is still valid but check SVELTE5_STANDARDS.md for new patterns.'
            }
          ]
        }
      ],

      // 🚫 CRITICAL: BAN SVELTE 4 SYNTAX PATTERNS
      'no-restricted-syntax': [
        'error',
        {
          // Ban: export let prop
          selector:
            'ExportNamedDeclaration[declaration.type="VariableDeclaration"][declaration.kind="let"]',
          message:
            'FORBIDDEN: "export let" is Svelte 4 syntax. Use $props() instead.\n\nExample:\n  ❌ export let title;\n  ✅ let { title } = $props();\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          // Ban: $: reactive statements (labels starting with $)
          selector: 'LabeledStatement[label.name=/^\\$/]',
          message:
            'FORBIDDEN: "$:" reactive statements are Svelte 4 syntax. Use $derived() or $effect() instead.\n\nExample:\n  ❌ $: doubled = count * 2;\n  ✅ let doubled = $derived(count * 2);\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          // Ban: $$props usage
          selector: 'Identifier[name="$$props"]',
          message:
            'FORBIDDEN: "$$props" is Svelte 4 syntax. Use $props() destructuring instead.\n\nExample:\n  ❌ const props = $$props;\n  ✅ let { ...props } = $props();\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          // Ban: $$restProps usage
          selector: 'Identifier[name="$$restProps"]',
          message:
            'FORBIDDEN: "$$restProps" is Svelte 4 syntax. Use $props() destructuring instead.\n\nExample:\n  ❌ const rest = $$restProps;\n  ✅ let { ...rest } = $props();\n\nSee SVELTE5_STANDARDS.md'
        }
      ]
    }
  }
);
