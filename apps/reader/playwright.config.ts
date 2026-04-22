import { defineConfig, devices } from '@playwright/test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const READER_APP_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${String(PORT)}/`;

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
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
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
    command:
      'RITO_READER_BASE=/ pnpm run build:e2e && RITO_READER_BASE=/ pnpm exec vite preview --host 127.0.0.1 --port 4173',
    cwd: READER_APP_DIR,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
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
