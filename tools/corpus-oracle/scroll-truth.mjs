// The scrolled lane's truth (`RITO_WALK_SCROLLED=1` in pixel-walk.mjs): a
// chapter laid out by Chromium as one continuous document as wide as the
// engine's content box, read window by window (a vertical-rl chapter: as
// tall as the content box, read leftwards; see captureLeftwardWindows). Window k of a chapter
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

import { shootContentWithBand } from './truth-shot.mjs';

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
      const height = Math.min(contentH, length - offset);
      const png = await shootContentWithBand(page, { contentW, height, margin, y: shift });
      bands.push({ offset, png });
    }
    windows.push({ length, bands });
  }
  await page.evaluate(() => {
    document.documentElement.style.marginTop = '';
  });
  return windows;
}

/**
 * Every window of the vertical-rl chapter loaded in `page`, captured: the
 * chapter is its root's native flow, as tall as the content box and growing
 * leftwards column by column, and window k covers its block range
 * [k·W, (k+1)·W) from its right edge — W the page width, the chapter being
 * its right margin, the document and its left margin — the last window
 * ending with the chapter, as the engine's leftward windows do.
 *
 * The flow is shot once whole and the windows are cut from the decoded
 * image, as the paged lane's vertical stripes are: a scroll leaves a
 * sideways document at a stale compositor offset, and document clips came
 * back blank on the truth page. Each window is its CSS pixels long, a crop
 * as tall as the content box, whose column x is the window's x.
 */
export async function captureLeftwardWindows(page, { contentH, pageW, margin, dsf }) {
  const { documentWidth, rightEdge } = await page.evaluate(() => {
    const root = document.documentElement;
    const box = root.getBoundingClientRect();
    return {
      // The chapter's block extent is the root's own width; the scroll
      // width never drops below the viewport's, so a chapter narrower
      // than the viewport would read as a viewport-wide one.
      documentWidth: root.scrollWidth > root.clientWidth ? root.scrollWidth : box.width,
      // The root's right edge in the full shot's coordinates, whose origin
      // is the far left of the sideways document or of the viewport,
      // whichever is further left.
      rightEdge: box.right - Math.min(0, box.left),
    };
  });
  const extent = margin + documentWidth + margin;
  const count = Math.max(1, Math.ceil(extent / pageW));
  const full = PNG.sync.read(await page.screenshot({ fullPage: true }));
  const windows = [];
  for (let k = 0; k < count; k += 1) {
    const length = Math.min(pageW, extent - k * pageW);
    // Window x is chapter block k·W + (length − x) from the right, the
    // root's block (k·W + length − x − margin), at shot x = edge − that.
    const left = Math.round((rightEdge - (k * pageW + length - margin)) * dsf);
    const width = Math.round(length * dsf);
    const height = Math.round(contentH * dsf);
    const crop = new PNG({ width, height });
    for (let y = 0; y < height && y < full.height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = left + x;
        if (sx < 0 || sx >= full.width) continue;
        const si = (y * full.width + sx) * 4;
        const di = (y * width + x) * 4;
        for (let j = 0; j < 4; j += 1) crop.data[di + j] = full.data[si + j];
      }
    }
    windows.push({ length, crop });
  }
  return windows;
}

/**
 * A window composed onto a page-sized canvas of `ground`: each band at the
 * content box's left edge and its row, or a leftward window's crop at the
 * page's left edge below the top margin, in device pixels at `dsf`.
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
  if (window.crop) {
    const { crop } = window;
    for (let y = 0; y < crop.height && marginD + y < pageHd; y += 1) {
      for (let x = 0; x < crop.width && x < pageWd; x += 1) {
        const si = (y * crop.width + x) * 4;
        // The margin past the shot's right edge was never captured: it
        // stays the page ground.
        if (crop.data[si + 3] === 0) continue;
        const di = ((marginD + y) * pageWd + x) * 4;
        for (let j = 0; j < 4; j += 1) out.data[di + j] = crop.data[si + j];
      }
    }
    return out;
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
