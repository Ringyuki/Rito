// Acceptance probe for scrolled reading on the standalone scroll page
// (apps/reader/scroll.html): scrolls across three chapter boundaries
// watching frame gaps and long tasks, selects across a window seam with the
// mouse, follows a link into the book, and reads the screen readers'
// mirror — all through the page's public view (`window.__ritoScroll`) and
// what is on screen.
//
// Usage: BOOK=<epub> node tools/reader-accept/scroll-accept.mjs
//   env URL (default http://127.0.0.1:5173/scroll.html), VIEW (phone|desktop)
import { launchOracleChromium } from '../oracle-chromium.mjs';

const URL = process.env.URL ?? 'http://127.0.0.1:5173/scroll.html';
const BOOK = process.env.BOOK;
if (!BOOK) {
  console.error('usage: BOOK=<epub> node scroll-accept.mjs');
  process.exit(1);
}
const VIEW = process.env.VIEW ?? 'desktop';
const viewport =
  VIEW === 'phone' ? { width: 393, height: 760, dsf: 3 } : { width: 1280, height: 860, dsf: 2 };

const browser = await launchOracleChromium();
const page = await browser.newPage({
  viewport: { width: viewport.width, height: viewport.height },
  deviceScaleFactor: viewport.dsf,
});
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
await page.goto(URL);
await page.setInputFiles('#open', BOOK);
await page.waitForSelector('#view[data-loaded="true"]', { timeout: 60000 });
await page.waitForTimeout(1500);

const result = { book: BOOK, view: VIEW };

// Chapter boundaries along the axis, in CSS pixels from the book's start.
result.boundaries = await page.evaluate(() => {
  const layout = window.__ritoScroll.reader.getScrollLayout();
  let at = 0;
  return layout.chapters.map((chapter) => (at += chapter.extent)).slice(0, -1);
});

// Glide across the first three boundaries a frame at a time, as a wheel
// would, recording each frame's gap and every long task.
result.scrolling = await page.evaluate(async (boundaries) => {
  const { controller } = window.__ritoScroll;
  const long = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) long.push(Math.round(entry.duration));
  });
  observer.observe({ type: 'longtask', buffered: false });
  const gaps = [];
  const crossed = [];
  for (const boundary of boundaries.slice(0, 3)) {
    controller.scrollTo(Math.max(0, boundary - 600));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    let last = performance.now();
    while (controller.offset < boundary + 600) {
      controller.scrollBy(24);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (controller.offset >= controller.extent - 1) break;
    }
    crossed.push(controller.currentSpread);
  }
  observer.disconnect();
  gaps.sort((a, b) => a - b);
  return {
    crossed,
    frames: gaps.length,
    p50: Math.round(gaps[Math.floor(gaps.length / 2)] ?? 0),
    p99: Math.round(gaps[Math.floor(gaps.length * 0.99)] ?? 0),
    max: Math.round(gaps.at(-1) ?? 0),
    longTasks: long,
  };
}, result.boundaries);

// A mouse drag from above a window seam to below it: the seam between the
// first two windows of the book's longest chapter, text on either side,
// at the view's middle.
result.selection = await page.evaluate(async () => {
  const { controller, reader } = window.__ritoScroll;
  const layout = reader.getScrollLayout();
  let start = 0;
  let longest = { start: 0, extent: 0 };
  for (const chapter of layout.chapters) {
    if (chapter.extent > longest.extent) longest = { start, extent: chapter.extent };
    start += chapter.extent;
  }
  const seam = longest.start + layout.windowLength;
  controller.scrollTo(seam - window.innerHeight / 2);
  await new Promise((resolve) => setTimeout(resolve, 600));
  return { seamAt: seam - controller.offset };
});
const mid = { x: viewport.width / 2, y: result.selection.seamAt };
await page.mouse.move(mid.x - 120, mid.y - 60);
await page.mouse.down();
await page.mouse.move(mid.x, mid.y, { steps: 6 });
await page.mouse.move(mid.x + 120, mid.y + 60, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(600);
Object.assign(
  result.selection,
  await page.evaluate(() => {
    const { controller } = window.__ritoScroll;
    const rects = controller.selectionRects();
    return {
      text: controller.selection?.selectedText.slice(0, 60) ?? null,
      rects: rects.length,
      above: rects.some((rect) => rect.y < window.innerHeight / 2),
      below: rects.some((rect) => rect.y + rect.height > window.innerHeight / 2),
    };
  }),
);

// The screen readers' mirror holds the text on screen once it rests.
result.mirror = await page.evaluate(
  () => document.querySelector('[aria-live]')?.textContent?.trim().length ?? 0,
);

// The book's first link into itself, shown at the reading line and clicked
// at its centre, moves the strip to its target.
result.link = await page.evaluate(async () => {
  const { controller, reader } = window.__ritoScroll;
  for (let spread = 0; spread < reader.spreads.length; spread += 1) {
    const pageIndex = reader.spreads[spread]?.leftPageIndex;
    if (pageIndex === undefined) continue;
    const targets = await reader.interactions.getPageTargets(pageIndex);
    const link = targets?.targets.find((target) => target.targetLocator);
    if (!link) continue;
    controller.scrollToSpread(spread, Math.max(0, link.bounds.y - 100));
    await new Promise((resolve) => setTimeout(resolve, 600));
    const [rect] = controller.viewRects([{ pageIndex, ...link.bounds }]);
    if (!rect) return { spread, shown: false };
    const box = controller.canvas.getBoundingClientRect();
    return {
      spread,
      x: box.left + rect.x + rect.width / 2,
      y: box.top + rect.y + rect.height / 2,
      href: link.targetLocator.href,
    };
  }
  return null;
});
if (result.link?.x !== undefined) {
  const before = await page.evaluate(() => window.__ritoScroll.controller.offset);
  await page.mouse.click(result.link.x, result.link.y);
  await page.waitForTimeout(1200);
  result.link.moved = (await page.evaluate(() => window.__ritoScroll.controller.offset)) !== before;
}

result.errors = errors;
console.log(JSON.stringify(result, null, 2));
await browser.close();
