import { playwright } from '@vitest/browser-playwright';
import { configDefaults, defineConfig } from 'vitest/config';

const coverageEnabled = process.argv.includes('--coverage');
if (coverageEnabled) process.env['RITO_COVERAGE'] = '1';

export default defineConfig({
  test: {
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
    projects: [
      {
        test: {
          name: 'node',
          testTimeout: 30_000,
          include: ['tests/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/golden-pixel/**', 'tests/browser/**'],
        },
      },
      {
        // What only a browser runs — WebGL2, OffscreenCanvas text — runs
        // in headless Chromium, its coverage counted with the rest. The full
        // build, not the headless shell: the shell rasterizes canvas and
        // page text on the CPU, blending glyphs otherwise than a GPU, while
        // the full build rasterizes them on the GPU as Chrome does. No smart
        // minimum font size: Chromium lifts em- and %-sized text to a minimum
        // its UI language and platform choose, which CSS does not define.
        test: {
          name: 'browser',
          testTimeout: 30_000,
          include: ['tests/browser/**/*.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({
              launchOptions: {
                channel: 'chromium',
                args: ['--blink-settings=minimumLogicalFontSize=0'],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
