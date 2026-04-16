// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const tsconfigRootDir = import.meta.dirname;

export default defineConfig([
  {
    ignores: ['**/dist/', '**/node_modules/', '**/coverage/', 'apps/reader/src/components/ui/'],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['eslint.config.mjs'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['eslint.config.mjs', 'scripts/*.mjs'],
        },
        tsconfigRootDir,
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
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
    files: ['packages/rito/src/render/**/*.ts'],
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
