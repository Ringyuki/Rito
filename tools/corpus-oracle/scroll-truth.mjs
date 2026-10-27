// The scrolled lane's truth (`RITO_WALK_SCROLLED=1` in pixel-walk.mjs): a
// chapter laid out by Chromium as one continuous document as wide as the
// engine's content box, read window by window. Window k of a chapter
// covers its rows [k·H, (k+1)·H) — H the page height, the chapter being
// its top margin, the document and its bottom margin — the last window
// ending with the chapter, as the engine's windows do.
//
// The truth viewport stays as tall as the content box, so `vh` resolves
// exactly as it does for the engine (against the content height), and a
// window taller than it is captured in viewport-tall bands. Each band is
// brought to the viewport by a negative top margin on the root, never by
// scrolling: a scroll leaves glyph origins at layout coordinates, which a
// float32 display list quantizes far down a long chapter (the paged
// lane's measurement for far columns).
import { createRequire } from 'node:module';

const REPO = new URL('../..', import.meta.url).pathname;
const { PNG } = createRequire(`${REPO}package.json`)('pngjs');

/**
 * Every window of the chapter loaded in `page`, captured: per window its
 * length in CSS pixels and its viewport-tall bands, each a capture of the
 * content box and the right margin band with the CSS row of the window it
 * starts on.
 */
export async function captureScrolledWindows(page, { contentW, contentH, pageH, margin }) {
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const extent = margin + documentHeight + margin;
  const count = Math.max(1, Math.ceil(extent / pageH));
  const windows = [];
  for (let k = 0; k < count; k += 1) {
    const length = Math.min(pageH, extent - k * pageH);
    const bands = [];
    for (let offset = 0; offset < length; offset += contentH) {
      // The window's row `offset` is the document's row `k·H − margin + offset`.
      const shift = k * pageH - margin + offset;
      await page.evaluate((y) => {
        document.documentElement.style.marginTop = `${-y}px`;
      }, shift);
      const height = Math.min(contentH, length - offset);
      const shot = await page.screenshot({
        clip: { x: 0, y: 0, width: contentW + margin, height },
      });
      bands.push({ offset, png: PNG.sync.read(shot) });
    }
    windows.push({ length, bands });
  }
  await page.evaluate(() => {
    document.documentElement.style.marginTop = '';
  });
  return windows;
}

/**
 * A window composed onto a page-sized canvas of `ground`: each band at the
 * content box's left edge and its row, in device pixels at `dsf`.
 */
export function composeScrolledWindow(window, { pageWd, pageHd, marginD, dsf, ground }) {
  const out = new PNG({ width: pageWd, height: pageHd });
  for (let p = 0; p < pageWd * pageHd; p += 1) {
    const i = p * 4;
    out.data[i] = ground[0];
    out.data[i + 1] = ground[1];
    out.data[i + 2] = ground[2];
    out.data[i + 3] = 255;
  }
  for (const { offset, png } of window.bands) {
    const top = Math.round(offset * dsf);
    for (let y = 0; y < png.height && top + y < pageHd; y += 1) {
      for (let x = 0; x < png.width && marginD + x < pageWd; x += 1) {
        const si = (y * png.width + x) * 4;
        const di = ((top + y) * pageWd + (marginD + x)) * 4;
        for (let j = 0; j < 4; j += 1) out.data[di + j] = png.data[si + j];
      }
    }
  }
  return out;
}
