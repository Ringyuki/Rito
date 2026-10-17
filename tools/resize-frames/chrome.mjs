// The browser's own cost of a window being resized over one chapter: the
// chapter's body in the reader's page box (double pages, 50 px margins, a
// 20 px spread gap), paginated by CSS columns in the reader's pinned faces,
// laid out and painted at a new size every frame with no frame-rate limit.
//
// CHAPTER=<path to the chapter's XHTML in an unpacked book> node chrome.mjs
// Optional: WIDTH (the viewport width the spread is sized for, 1190),
// HEIGHT (900), FRAMES (400).
import { fileURLToPath } from 'node:url';
import { describe, launchUnthrottled, stats } from './shared.mjs';

const CHAPTER = process.env.CHAPTER;
if (!CHAPTER) throw new Error('CHAPTER is required');
const WIDTH = Number(process.env.WIDTH ?? 1190);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
const FRAMES = Number(process.env.FRAMES ?? 400);
const FONTS = fileURLToPath(new URL('../../apps/reader/src/assets/fonts', import.meta.url));

const browser = await launchUnthrottled();
const page = await browser.newPage({ viewport: { width: WIDTH + 10, height: HEIGHT } });
await page.goto(`file://${CHAPTER}`);
const result = await page.evaluate(
  async ({ FRAMES, FONTS, WIDTH, HEIGHT }) => {
    const style = document.createElement('style');
    style.textContent = `
      @font-face { font-family: PinSerif; src: url(file://${FONTS}/Tinos-Regular.ttf); }
      @font-face { font-family: PinSerifCJK; src: url(file://${FONTS}/SourceHanSerifCN-Regular.otf); }
      * { font-family: PinSerif, PinSerifCJK !important; }`;
    document.head.appendChild(style);
    await document.fonts.load('16px PinSerif');
    await document.fonts.load('16px PinSerifCJK', '漢');
    const loaded = [...document.fonts].filter((face) => face.status === 'loaded').length;
    const margin = 50;
    const spreadGap = 20;
    // Between two pages' content: the right margin, the gap, the left margin.
    const gap = margin * 2 + spreadGap;
    const contentWidth = (viewport) => Math.floor((viewport - spreadGap) / 2) - margin * 2;
    const box = document.createElement('div');
    while (document.body.firstChild) box.appendChild(document.body.firstChild);
    document.body.appendChild(box);
    document.body.style.margin = `${margin}px`;
    const size = (viewport) => {
      const content = contentWidth(viewport);
      box.style.cssText = `width:${content * 2 + gap}px;height:${HEIGHT - margin * 2}px;column-width:${content}px;column-gap:${gap}px;column-fill:auto;overflow:hidden`;
      return content;
    };
    const first = size(WIDTH);
    void box.scrollWidth;
    const pages = Math.round(box.scrollWidth / (first + gap));
    const frames = [];
    const layouts = [];
    await new Promise((done) => {
      let previous;
      const step = (now) => {
        if (previous !== undefined) frames.push(now - previous);
        previous = now;
        // A new size every frame, 400 px down and back.
        const k = frames.length % 800;
        size(WIDTH - (k < 400 ? k : 800 - k));
        const started = performance.now();
        void box.scrollWidth;
        layouts.push(performance.now() - started);
        if (frames.length < FRAMES) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return { loaded, pages, frames: frames.slice(5), layouts: layouts.slice(5) };
  },
  { FRAMES, FONTS, WIDTH, HEIGHT },
);
await browser.close();
if (result.loaded < 2) throw new Error(`the pinned faces did not load (${result.loaded} loaded)`);
const frame = stats(result.frames);
console.log(`${result.pages} pages`);
console.log(
  `resize frame: ${describe(frame)} (${(1000 / frame.median).toFixed(0)} frames a second)`,
);
console.log(`  of which layout: ${describe(stats(result.layouts))}`);
