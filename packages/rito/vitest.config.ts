import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/golden-pixel/**'],
    coverage: {
      include: ['src/**/*.ts'],
    },
  },
});
