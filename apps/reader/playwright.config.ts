import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READER_TEST_SERVER_BASE_URL as BASE_URL,
  READER_TEST_SERVER_PORT as PORT,
} from './tests/e2e/reader-test-server';

const READER_APP_DIR = dirname(fileURLToPath(import.meta.url));
const STRICT_SERVER = process.env['RITO_READER_STRICT_SERVER'] === '1';

process.env['NO_PROXY'] = appendNoProxy(process.env['NO_PROXY']);
process.env['no_proxy'] = appendNoProxy(process.env['no_proxy']);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
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
    command: `RITO_READER_BASE=/ pnpm run build:e2e && RITO_READER_BASE=/ pnpm exec vite preview --host 127.0.0.1 --port ${String(PORT)}`,
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
