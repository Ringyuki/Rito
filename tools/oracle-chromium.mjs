// The Chromium every instrument measures against, the same on every machine.
import { createRequire } from 'node:module';

const { chromium } = createRequire(new URL('../package.json', import.meta.url))('@playwright/test');

/**
 * The full build, not the headless shell: it rasterizes page and canvas
 * text on the GPU as Chrome does, where the shell uses the CPU. No smart
 * minimum font size: Chromium lifts em- and %-sized text to a minimum its
 * UI language and platform choose (6px on Linux, 9px on macOS in English,
 * 12px in Chinese), which CSS does not define and the engine never applies.
 */
export const ORACLE_CHROMIUM_ARGS = ['--blink-settings=minimumLogicalFontSize=0'];

/**
 * Launches the oracle Chromium with `args` added to its own (another build
 * at `executablePath`, for an A/B run only). Its UI language
 * sets the generic font families, accept-languages and the renderer's
 * default locale; on macOS it follows the system unless the test browser
 * has its own language, so a non-English one fails here instead of
 * measuring a different truth.
 */
export async function launchOracleChromium(args = [], { executablePath } = {}) {
  const browser = await chromium.launch({
    ...(executablePath ? { executablePath } : { channel: 'chromium' }),
    args: [...ORACLE_CHROMIUM_ARGS, ...args],
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  const language = await page.evaluate(() => navigator.language);
  await context.close();
  if (language !== 'en-US') {
    await browser.close();
    throw new Error(
      `The oracle Chromium runs as ${language}, not en-US. On macOS give the test browser ` +
        'its own language: defaults write com.google.chrome.for.testing AppleLanguages -array en-US',
    );
  }
  return browser;
}
