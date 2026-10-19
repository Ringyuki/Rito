// What both resize measurements share: a Chromium with no frame-rate limit
// on the machine's own GPU, and order statistics.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../apps/reader/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

/**
 * Chromium paces frames at 60 Hz unless the GPU's vsync and the frame-rate
 * limit are off, and headless runs on a software GL unless told to take
 * the machine's GPU (Metal on macOS). A frame that changes nothing on
 * screen is still paced at 60 Hz: each measured frame must damage a pixel.
 */
export function launchUnthrottled() {
  return chromium.launch({
    args: [
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
    ],
  });
}

export function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return { median: at(0.5), p90: at(0.9), max: sorted.at(-1), count: sorted.length };
}

export function describe(s) {
  return `median ${s.median.toFixed(2)} ms, p90 ${s.p90.toFixed(2)}, max ${s.max.toFixed(2)}`;
}
