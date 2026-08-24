import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READER_TEST_SERVER_BASE_URL as BASE_URL,
  READER_TEST_SERVER_PORT as PORT,
  readerTestServerCommand,
} from './tests/e2e/reader-test-server';

const READER_APP_DIR = dirname(fileURLToPath(import.meta.url));
const STRICT_SERVER = process.env['RITO_READER_STRICT_SERVER'] === '1';

process.env['NO_PROXY'] = appendNoProxy(process.env['NO_PROXY']);
process.env['no_proxy'] = appendNoProxy(process.env['no_proxy']);

// Suites that assert on canvas pixels (selection highlight bands, pinned
// font paint geometry) are calibrated against macOS glyph rasterization;
// CI runs them on a macOS runner and excludes them from the Linux shards.
const PIXEL_SUITES = [
  '**/reader-selection.e2e.test.ts',
  '**/reader-selection-touch.e2e.test.ts',
  '**/reader-production-pinned-font.e2e.test.ts',
];

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  ...(process.env['RITO_E2E_SKIP_PIXEL_SUITES'] === '1' ? { testIgnore: PIXEL_SUITES } : {}),
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter:
    process.env['RITO_READER_HTML_REPORT'] === '1'
      ? [['list'], ['html', { open: 'never' }]]
      : process.env['CI']
        ? [['github'], ['html', { open: 'never' }]]
        : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env['PLAYWRIGHT_BROWSER_CHANNEL'],
      },
    },
  ],
  webServer: {
    command: readerTestServerCommand(process.env, PORT),
    cwd: READER_APP_DIR,
    url: BASE_URL,
    reuseExistingServer: STRICT_SERVER ? false : !process.env['CI'],
    timeout: 180_000,
  },
});

function appendNoProxy(value: string | undefined): string {
  const entries = new Set(
    (value ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  entries.add('127.0.0.1');
  entries.add('localhost');
  return [...entries].join(',');
}
