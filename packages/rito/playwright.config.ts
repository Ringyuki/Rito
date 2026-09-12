import { defineConfig } from '@playwright/test';

const browserChannel = process.env['PLAYWRIGHT_BROWSER_CHANNEL'];
const DEFAULT_PIXEL_WORKERS = 2;

export default defineConfig({
  testDir: './tests/golden-pixel',
  outputDir: './test-results/playwright',
  timeout: 120_000,
  // Tests are independent (each opens its own page).
  fullyParallel: true,
  workers: pixelWorkerCount(),
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    ...(browserChannel ? { channel: browserChannel } : {}),
    headless: true,
    viewport: { width: 1400, height: 1800 },
    deviceScaleFactor: 1,
  },
});

function pixelWorkerCount(): number {
  const configured = process.env['RITO_PIXEL_WORKERS'];
  if (!configured) return DEFAULT_PIXEL_WORKERS;

  const workers = Number.parseInt(configured, 10);
  if (!Number.isInteger(workers) || workers < 1) return DEFAULT_PIXEL_WORKERS;
  return workers;
}
