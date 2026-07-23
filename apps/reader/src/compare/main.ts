// A/B comparison page: rito's fragment engine beside the browser's own
// rendering of the same chapter, aligned by the visible page's first line.
import { unzipSync } from 'fflate';
import { createReader, type Reader } from '@ritojs/core';
import { loadProductionPinnedFontPolicy } from '@/lib/production-pinned-font-policy';

const fileInput = document.getElementById('file') as HTMLInputElement;
const prevButton = document.getElementById('prev') as HTMLButtonElement;
const nextButton = document.getElementById('next') as HTMLButtonElement;
const pageInput = document.getElementById('page') as HTMLInputElement;
const totalLabel = document.getElementById('total') as HTMLSpanElement;
const chapterSelect = document.getElementById('chapter') as HTMLSelectElement;
const syncToggle = document.getElementById('sync') as HTMLInputElement;
const status = document.getElementById('status') as HTMLSpanElement;
const stage = document.getElementById('stage') as HTMLElement;
const drop = document.getElementById('drop') as HTMLElement;
const canvas = document.getElementById('left-canvas') as HTMLCanvasElement;
const frame = document.getElementById('right-frame') as HTMLIFrameElement;

interface UnpackedBook {
  readonly files: Record<string, Uint8Array>;
  readonly chapters: { href: string; label: string }[];
  /** Chapter href -> plain text content, for locating a page's text. */
  readonly texts: Map<string, string>;
}

let reader: Reader | undefined;
let book: UnpackedBook | undefined;
let spreadIndex = 0;
let loadedChapterHref: string | undefined;

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
chapterSelect.addEventListener('change', () => void loadChapter(chapterSelect.value));
document.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowRight') void showSpread(spreadIndex + 1);
  if (event.key === 'ArrowLeft') void showSpread(spreadIndex - 1);
});

async function openBook(file: File): Promise<void> {
  status.textContent = '解析中…';
  const data = await file.arrayBuffer();
  book = unpack(new Uint8Array(data.slice(0)));
  chapterSelect.replaceChildren(
    ...book.chapters.map((chapter) => {
      const option = document.createElement('option');
      option.value = chapter.href;
      option.textContent = chapter.label;
      return option;
    }),
  );
  status.textContent = 'rito 排版中…';
  const pinnedFontPolicy = await loadProductionPinnedFontPolicy();
  reader = await createReader(data, canvas, {
    width: 600,
    height: 750,
    margin: 50,
    spread: 'single',
    pinnedFontPolicy,
    experimentalFragmentPagination: true,
  });
  if (reader.pagination && !reader.pagination.complete) {
    await reader.pagination.ensureSpread(Number.MAX_SAFE_INTEGER).catch(() => undefined);
  }
  drop.hidden = true;
  stage.hidden = false;
  totalLabel.textContent = `/ ${String(reader.totalSpreads - 1)}`;
  const firstText = book.chapters.find(
    (chapter) => (book?.texts.get(chapter.href)?.trim().length ?? 0) > 200,
  );
  if (firstText) {
    chapterSelect.value = firstText.href;
    await loadChapter(firstText.href);
  }
  await showSpread(0);
  status.textContent = `${file.name} — ${String(reader.totalSpreads)} 页`;
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
  if (syncToggle.checked) alignBrowserSide();
}

/** The first substantial text run on the page just painted. */
function pageAnchorText(): string | undefined {
  const frameDiag = (globalThis as { __ritoLastFrame?: { textRuns?: { t: string }[] } })
    .__ritoLastFrame;
  const runs = frameDiag?.textRuns ?? [];
  return runs.find((run) => run.t.trim().length >= 6)?.t.trim();
}

function alignBrowserSide(): void {
  if (!book) return;
  const anchor = pageAnchorText();
  if (!anchor) return;
  const needle = anchor.slice(0, 12);
  const holder = book.chapters.find((chapter) => book?.texts.get(chapter.href)?.includes(needle));
  if (!holder) return;
  const scroll = () => {
    scrollFrameTo(needle);
  };
  if (holder.href !== loadedChapterHref) {
    chapterSelect.value = holder.href;
    void loadChapter(holder.href).then(scroll);
  } else {
    scroll();
  }
}

function scrollFrameTo(needle: string): void {
  const jump = () => {
    const doc = frame.contentDocument;
    if (!doc) return;
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const offset = node.textContent?.indexOf(needle) ?? -1;
      if (offset === -1) continue;
      const range = doc.createRange();
      range.setStart(node, offset);
      range.setEnd(node, Math.min(offset + needle.length, node.textContent.length));
      const rect = range.getBoundingClientRect();
      frame.contentWindow?.scrollTo({ top: rect.top + (frame.contentWindow.scrollY || 0) - 50 });
      return;
    }
  };
  jump();
  // Font loading reflows the document after the first measurement; a
  // second pass lands on the settled position.
  setTimeout(jump, 350);
}

async function loadChapter(href: string): Promise<void> {
  if (!book) return;
  loadedChapterHref = href;
  const bytes = book.files[href];
  if (!bytes) return;
  let html = new TextDecoder().decode(bytes);
  // Inline stylesheets with rewritten font/image URLs so the browser
  // renders with the book's own resources.
  const dir = href.includes('/') ? href.slice(0, href.lastIndexOf('/') + 1) : '';
  const resolve = (relative: string): string => {
    const parts = (dir + relative).split('/');
    const out: string[] = [];
    for (const part of parts) {
      if (part === '..') out.pop();
      else if (part !== '.' && part !== '') out.push(part);
    }
    return out.join('/');
  };
  const blobUrl = (path: string, type: string): string | undefined => {
    const data = book?.files[path];
    return data ? URL.createObjectURL(new Blob([data.slice()], { type })) : undefined;
  };
  html = html.replace(
    /<link[^>]*href="([^"]+\.css)"[^>]*\/?>(?:<\/link>)?/gi,
    (_tag, cssHref: string) => {
      const cssPath = resolve(cssHref);
      const cssBytes = book?.files[cssPath];
      if (!cssBytes) return '';
      const cssDir = cssPath.includes('/') ? cssPath.slice(0, cssPath.lastIndexOf('/') + 1) : '';
      const css = new TextDecoder()
        .decode(cssBytes)
        .replace(/url\(["']?([^)"']+)["']?\)/gi, (whole, target: string) => {
          const parts = (cssDir + target).split('/');
          const out: string[] = [];
          for (const part of parts) {
            if (part === '..') out.pop();
            else if (part !== '.' && part !== '') out.push(part);
          }
          const url = blobUrl(out.join('/'), 'font/ttf');
          return url ? `url("${url}")` : whole;
        });
      return `<style>${css}</style>`;
    },
  );
  html = html.replace(
    /(<img[^>]*src=")([^"]+)(")/gi,
    (whole, before: string, src: string, after: string) => {
      const url = blobUrl(resolve(src), 'image/png');
      return url ? `${before}${url}${after}` : whole;
    },
  );
  html = html.replace(
    /(<image[^>]*(?:xlink:href|href)=")([^"]+)(")/gi,
    (whole, before: string, src: string, after: string) => {
      const url = blobUrl(resolve(src), 'image/png');
      return url ? `${before}${url}${after}` : whole;
    },
  );
  // Match rito's page box: 500px content behind 50px padding.
  html = html.replace(
    /<head([^>]*)>/i,
    '<head$1><style>html{padding:50px;background:#fff;} body{margin:0;}</style>',
  );
  frame.srcdoc = html;
  await new Promise<void>((resolveLoad) => {
    frame.addEventListener(
      'load',
      () => {
        resolveLoad();
      },
      { once: true },
    );
  });
  await frame.contentDocument?.fonts.ready;
}

function unpack(data: Uint8Array): UnpackedBook {
  const files = unzipSync(data);
  const container = new TextDecoder().decode(files['META-INF/container.xml']);
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1];
  if (!opfPath) throw new Error('no OPF');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = new TextDecoder().decode(files[opfPath]);
  const items = new Map<string, string>();
  for (const tag of opf.match(/<item\b[^>]*>/g) ?? []) {
    const id = /id="([^"]+)"/.exec(tag)?.[1];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (id && href) items.set(id, opfDir + href);
  }
  const chapters: { href: string; label: string }[] = [];
  const texts = new Map<string, string>();
  for (const idref of opf.match(/<itemref[^>]*idref="([^"]+)"/g) ?? []) {
    const id = /idref="([^"]+)"/.exec(idref)?.[1];
    const href = id ? items.get(id) : undefined;
    if (!href || !/\.x?html?$/i.test(href) || !files[href]) continue;
    chapters.push({ href, label: href.split('/').pop() ?? href });
    const html = new TextDecoder().decode(files[href]);
    texts.set(href, html.replace(/<[^>]+>/g, ''));
  }
  return { files, chapters, texts };
}
