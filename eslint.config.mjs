// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const tsconfigRootDir = import.meta.dirname;

export default defineConfig([
  {
    ignores: [
      '**/dist/',
      '**/.output/',
      '**/node_modules/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      '**/target/',
      'benchmarks/**/artifact-snapshot/',
      'apps/reader/src/components/ui/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mjs',
            'benchmarks/*/*.mjs',
            'scripts/*.mjs',
            'packages/*/scripts/*.mjs',
            'packages/rito-core-wasm/src/*.js',
            'tools/*/*.mjs',
          ],
        },
        tsconfigRootDir,
      },
    },
  },
  {
    files: [
      'packages/rito-core-wasm/src/**/*.js',
      'packages/rito/src/bindings/browser/reader/worker-entry.mjs',
      'packages/rito/src/bindings/browser/reader-v1-worker-entry.mjs',
    ],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
    },
  },
  {
    files: [
      'apps/reader/tests/e2e/reader-preview-ab-model.mjs',
      'apps/reader/tests/e2e/reader-preview-ab-model.node.mjs',
      'apps/reader/tests/e2e/run-reader-preview-ab.mjs',
      'benchmarks/**/*.mjs',
      'scripts/**/*.mjs',
      'packages/*/scripts/**/*.mjs',
      'packages/*/tests/**/*.mjs',
      'tools/**/*.mjs',
    ],
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: false,
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['packages/rito/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      complexity: ['warn', 24],
      'max-lines': ['warn', 300],
      'max-lines-per-function': ['warn', 50],
    },
  },
  {
    // Layout / render boundary enforcement (see AGENTS.md "Layout / Render
    // boundary"). render/ must consume paint-ready layout types instead of
    // the raw CSS-level ComputedStyle.
    files: ['packages/rito/src/reference/ts-core/render/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: 'style/core/types$',
              importNames: ['ComputedStyle'],
              message:
                'render/ must not consume ComputedStyle. Use paint-ready types from layout/core (RunPaint / BlockPaint / HrPaint / PagePaint) and shared structured paint primitives from style/core/paint-types instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/rito/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'max-lines': ['warn', 800],
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['packages/kit/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      complexity: ['warn', 24],
      'max-lines': ['warn', 300],
      'max-lines-per-function': ['warn', 50],
    },
  },
  {
    files: [
      'packages/kit/src/**/*.ts',
      'packages/react/src/**/*.{ts,tsx}',
      'apps/reader/src/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@ritojs/core/*'],
              message:
                'Application and integration code must use the root @ritojs/core reader facade; legacy core subpaths are not public.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/kit/tests/**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'max-lines': ['warn', 800],
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['packages/react/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'max-lines': ['warn', 300],
      'max-lines-per-function': ['warn', 50],
    },
  },
  {
    files: ['packages/react/tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'max-lines': ['warn', 800],
      'max-lines-per-function': 'off',
    },
  },
  {
    files: ['apps/reader/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  prettier,
]);
