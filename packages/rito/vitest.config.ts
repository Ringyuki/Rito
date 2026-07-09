import { configDefaults, defineConfig } from 'vitest/config';

const coverageEnabled = process.argv.includes('--coverage');
if (coverageEnabled) process.env['RITO_COVERAGE'] = '1';

export default defineConfig({
  test: {
    testTimeout: 15_000,
    include: ['tests/**/*.test.ts'],
    exclude: [
      ...configDefaults.exclude,
      'tests/golden-pixel/**',
      ...(coverageEnabled ? ['tests/unit/kp-real-epub-performance.test.ts'] : []),
    ],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 82,
        branches: 74,
        functions: 88,
        lines: 85,
      },
    },
  },
});
