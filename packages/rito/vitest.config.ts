import { configDefaults, defineConfig } from 'vitest/config';

const coverageEnabled = process.argv.includes('--coverage');
if (coverageEnabled) process.env['RITO_COVERAGE'] = '1';

export default defineConfig({
  test: {
    testTimeout: 30_000,
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
        // Rebased 2026-08-24: retiring the compatibility layer, the
        // legacy-pagination e2e and their well-covered tests shrank the
        // covered numerator faster than the code they exercised.
        branches: 73.5,
        functions: 87.5,
        lines: 85,
      },
    },
  },
});
