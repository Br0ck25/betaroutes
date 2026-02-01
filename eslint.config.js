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
      'no-undef': 'off',
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
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],
      'prefer-const': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'off',
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
        // Include service-worker-specific tsconfig so ESLint's TS parser
        // can find files like `src/service-worker.ts` and project d.ts files.
        project: ['./tsconfig.eslint.svelte.json', './tsconfig.service-worker.json'],
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
      'no-console': 'error',
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
        {
          selector: "ObjectExpression > SpreadElement[argument.name='body']",
          message:
            "SECURITY WARNING: Potential Mass Assignment. Do not spread 'body' directly into objects. Destructure specific fields instead. (See SECURITY.md)"
        }
      ]
    }
  },

  // Node/tooling files (tests, e2e, playwright, tools) are allowed Node globals and require()
  {
    files: [
      'e2e/**',
      'test/**',
      'tools/**',
      'tmp/**',
      'playwright.config.*',
      'tailwind.config.*',
      'vite.config.*'
    ],
    languageOptions: {
      globals: { ...globals.node },
      parser: ts.parser
    },
    rules: {
      'no-restricted-globals': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },

  // Forbid importing `svelte/store` in the rest of the codebase (enforced during migration)
  {
    files: ['src/**/*.ts', 'src/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'svelte/store',
              message:
                'FORBIDDEN: Legacy Svelte stores are deprecated. Migrate shared state to `.svelte.ts` modules and use $state(). See SVELTE5_STANDARDS.md'
            }
          ]
        }
      ]
    }
  },

  // Allow legacy svelte/store imports only inside src/lib/stores during transition
  {
    files: [
      'src/lib/stores/**',
      'src/lib/services/googleMaps.ts',
      'src/routes/dashboard/settings/lib/save-settings.ts'
    ],
    rules: {
      // Allow imports from svelte/store in store implementation and transitional files
      'no-restricted-imports': 'off'
    }
  },

  // ⚡ SVELTE SPECIFIC (STRICT SVELTE 5 ENFORCEMENT)
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: {
        // Do NOT enable project-based type-checking for .svelte files here—
        // svelte-check provides type analysis for Svelte components and
        // including project mode for .svelte files causes parserErrors in
        // some environments. Keep parser options minimal and non-type-aware.
        tsconfigRootDir,
        extraFileExtensions: ['.svelte'],
        parser: ts.parser,
        svelteConfig
      }
    },
    rules: {
      // Type-aware rules are provided by the TypeScript-only override above.
      '@typescript-eslint/no-floating-promises': 'off',
      'svelte/require-each-key': 'error',
      'svelte/no-at-html-tags': 'error',
      'svelte/no-navigation-without-resolve': 'warn',
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
      'no-restricted-syntax': [
        'error',
        {
          selector: 'LabeledStatement[label.name="$"]',
          message:
            'Svelte 4 reactive statements ($:) are forbidden. Use $derived or $effect instead.'
        },
        {
          selector:
            'ExportNamedDeclaration[declaration.type="VariableDeclaration"][declaration.kind="let"]',
          message:
            'FORBIDDEN: "export let" is Svelte 4 syntax. Use $props() instead.\n\nExample:\n  ❌ export let title;\n  ✅ let { title } = $props();\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          selector: 'LabeledStatement[label.name=/^\\$/]',
          message:
            'FORBIDDEN: "$:" reactive statements are Svelte 4 syntax. Use $derived() or $effect() instead.\n\nExample:\n  ❌ $: doubled = count * 2;\n  ✅ let doubled = $derived(count * 2);\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          selector: 'Identifier[name="$$props"]',
          message:
            'FORBIDDEN: "$$props" is Svelte 4 syntax. Use $props() destructuring instead.\n\nExample:\n  ❌ const props = $$props;\n  ✅ let { ...props } = $props();\n\nSee SVELTE5_STANDARDS.md'
        },
        {
          selector: 'Identifier[name="$$restProps"]',
          message:
            'FORBIDDEN: "$$restProps" is Svelte 4 syntax. Use $props() destructuring instead.\n\nExample:\n  ❌ const rest = $$restProps;\n  ✅ let { ...rest } = $props();\n\nSee SVELTE5_STANDARDS.md'
        }
      ]
    }
  }
);
