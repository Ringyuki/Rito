import { configDefaults, defineConfig } from 'vitest/config';

const coverageEnabled = process.argv.includes('--coverage');
if (coverageEnabled) process.env['RITO_COVERAGE'] = '1';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/golden-pixel/**'],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 82,
        branches: 73.5,
        functions: 87.5,
        lines: 85,
      },
    },
  },
});
