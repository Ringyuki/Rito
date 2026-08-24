import { defineConfig } from '@playwright/test';

const browserChannel = process.env['PLAYWRIGHT_BROWSER_CHANNEL'];
const isPixelReview =
  process.env['RITO_PIXEL_REVIEW'] === '1' || process.env['RITO_READER_PARITY_REVIEW'] === '1';
const DEFAULT_PIXEL_WORKERS = 2;

export default defineConfig({
  testDir: './tests/golden-pixel',
  outputDir: './test-results/playwright',
  timeout: 120_000,
  // Snapshot tests are independent (each opens its own page); review and
  // update runs stay serial through the describe-level mode instead.
  fullyParallel: !isPixelReview,
  workers: isPixelReview ? 1 : pixelWorkerCount(),
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
