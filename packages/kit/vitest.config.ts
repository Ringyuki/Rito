import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    testTimeout: 15_000,
    include: ['tests/**/*.test.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 40,
        branches: 24,
        functions: 47,
        lines: 44,
      },
    },
  },
});
