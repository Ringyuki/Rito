import { defineConfig } from '@playwright/test';

const browserChannel = process.env['PLAYWRIGHT_BROWSER_CHANNEL'];

export default defineConfig({
  testDir: './tests/golden-pixel',
  outputDir: './test-results/playwright',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    ...(browserChannel ? { channel: browserChannel } : {}),
    headless: true,
    viewport: { width: 1400, height: 1800 },
    deviceScaleFactor: 1,
  },
});
