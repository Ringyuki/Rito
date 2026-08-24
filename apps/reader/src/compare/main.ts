// A/B comparison page: rito's fragment engine beside epub.js (the
// browser's own layout in paginated form), pinned to the same metrics —
// viewport 600×750, content box 500×650 (50px margins / column gap),
// root font 16px, the book's own CSS and embedded fonts on both sides.
import ePub, { type Book, type Rendition } from 'epubjs';
import type Section from 'epubjs/types/section';
import { createReader, type Reader } from '@ritojs/core';
import { loadProductionPinnedFontPolicy } from '@/lib/production-pinned-font-policy';

const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 750;
const MARGIN = 50;

const fileInput = document.getElementById('file') as HTMLInputElement;
const prevButton = document.getElementById('prev') as HTMLButtonElement;
const nextButton = document.getElementById('next') as HTMLButtonElement;
const pageInput = document.getElementById('page') as HTMLInputElement;
const totalLabel = document.getElementById('total') as HTMLSpanElement;
const rightPrev = document.getElementById('right-prev') as HTMLButtonElement;
const rightNext = document.getElementById('right-next') as HTMLButtonElement;
const syncToggle = document.getElementById('sync') as HTMLInputElement;
const status = document.getElementById('status') as HTMLSpanElement;
const stage = document.getElementById('stage') as HTMLElement;
const drop = document.getElementById('drop') as HTMLElement;
const canvas = document.getElementById('left-canvas') as HTMLCanvasElement;
const rightView = document.getElementById('right-view') as HTMLElement;

let reader: Reader | undefined;
let epubBook: Book | undefined;
let rendition: Rendition | undefined;
let spreadIndex = 0;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void openBook(file);
});
document.body.addEventListener('dragover', (event) => {
  event.preventDefault();
});
document.body.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file?.name.endsWith('.epub')) void openBook(file);
});
prevButton.addEventListener('click', () => void showSpread(spreadIndex - 1));
nextButton.addEventListener('click', () => void showSpread(spreadIndex + 1));
pageInput.addEventListener('change', () => void showSpread(Number(pageInput.value)));
rightPrev.addEventListener('click', () => void rendition?.prev());
rightNext.addEventListener('click', () => void rendition?.next());
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') void showSpread(spreadIndex + 1);
  if (event.key === 'ArrowLeft') void showSpread(spreadIndex - 1);
});

async function openBook(file: File): Promise<void> {
  status.textContent = '排版中…';
  const data = await file.arrayBuffer();

  // Right: epub.js — browser layout, paginated, pinned metrics. epub.js
  // splits the column gap into half-gap side paddings, so a 100px gap
  // yields the same 500px content column as rito's 50px margins; the
  // height drops the vertical margins to match rito's 650px content box.
  try {
    epubBook = ePub(data.slice(0));
    // `gap` is honoured by epub.js's layout but missing from its typings.
    rendition = epubBook.renderTo(rightView, {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT - MARGIN * 2,
      flow: 'paginated',
      spread: 'none',
      allowScriptedContent: false,
      ...({ gap: MARGIN * 2 } as object),
    });
    // epub.js can hang on books whose internal resources fail to resolve;
    // the A side must not wait on it.
    await Promise.race([
      rendition.display(),
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('epub.js display timed out'));
        }, 15000);
      }),
    ]);
  } catch (error) {
    // The A side must render even when epub.js cannot open the book.
    epubBook = undefined;
    rendition = undefined;
    rightView.textContent = `epub.js 打开失败：${String(error)}`;
  }

  // Left: rito, same book, same metrics.
  const pinnedFontPolicy = await loadProductionPinnedFontPolicy();
  reader = await createReader(data, canvas, {
    width: VIEW_WIDTH,
    height: VIEW_HEIGHT,
    margin: MARGIN,
    spread: 'single',
    pinnedFontPolicy,
  });
  if (reader.pagination && !reader.pagination.complete) {
    await reader.pagination.ensureSpread(Number.MAX_SAFE_INTEGER).catch(() => undefined);
  }
  // Pixel-oracle hook: tooling reads chapter starts and drives spreads.
  (globalThis as { __ritoReader?: unknown }).__ritoReader = reader;
  drop.hidden = true;
  stage.hidden = false;
  totalLabel.textContent = `/ ${String(reader.totalSpreads - 1)}`;
  await showSpread(0);
  status.textContent = `${file.name} — rito ${String(reader.totalSpreads)} 页`;
}

async function showSpread(index: number): Promise<void> {
  if (!reader) return;
  spreadIndex = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  pageInput.value = String(spreadIndex);
  // A frame miss loads asynchronously; retry until this spread painted.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    reader.renderSpread(spreadIndex, 1);
    const painted = (globalThis as { __ritoLastFrame?: { spreadIndex?: number } }).__ritoLastFrame
      ?.spreadIndex;
    if (painted === spreadIndex) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  if (syncToggle.checked) await alignEpubJs();
}

/** The first substantial text run on the page rito just painted. */
function pageAnchorText(): string | undefined {
  const frameDiag = (globalThis as { __ritoLastFrame?: { textRuns?: { t: string }[] } })
    .__ritoLastFrame;
  const runs = frameDiag?.textRuns ?? [];
  return runs.find((run) => run.t.trim().length >= 6)?.t.trim();
}

/** Jumps epub.js to the page containing rito's current first line, via CFI. */
async function alignEpubJs(): Promise<void> {
  if (!epubBook || !rendition) return;
  const anchor = pageAnchorText();
  if (!anchor) return;
  const needle = anchor.slice(0, 12);
  const spine = (epubBook.spine as unknown as { spineItems: Section[] }).spineItems;
  for (const section of spine) {
    try {
      // section.load's typings hide that it resolves to the parsed
      // section document.
      const loaded: unknown = await Promise.resolve(
        section.load(epubBook.load.bind(epubBook) as (url: string) => Promise<unknown>),
      );
      const doc = loaded as Element;
      const walker = document.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
      let found: { node: Node; offset: number } | undefined;
      while (walker.nextNode()) {
        const offset = walker.currentNode.textContent?.indexOf(needle) ?? -1;
        if (offset !== -1) {
          found = { node: walker.currentNode, offset };
          break;
        }
      }
      if (!found) continue;
      const owner = found.node.ownerDocument;
      if (!owner) continue;
      const range = owner.createRange();
      range.setStart(found.node, found.offset);
      range.setEnd(
        found.node,
        Math.min(found.offset + needle.length, found.node.textContent?.length ?? found.offset),
      );
      const cfi = section.cfiFromRange(range);
      await rendition.display(cfi);
      return;
    } catch {
      // Section failed to load or search; try the next one.
    }
  }
}
