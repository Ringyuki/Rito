import { loadEpub, loadFonts, paginate, renderPage, createTextMeasurer } from '../../src/index';
import type { LayoutConfig, Page } from '../../src/index';

// ── Configuration ───────────────────────────────────────────────────

const PAGE_CONFIG: LayoutConfig = {
  pageWidth: 800,
  pageHeight: 1200,
  marginTop: 60,
  marginRight: 60,
  marginBottom: 60,
  marginLeft: 60,
};

// ── DOM Elements ────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status') as HTMLSpanElement;
const prevBtn = document.getElementById('prev') as HTMLButtonElement;
const nextBtn = document.getElementById('next') as HTMLButtonElement;
const loadDemoBtn = document.getElementById('load-demo') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;

if (!ctx) throw new Error('Canvas 2d context not available');

// ── State ───────────────────────────────────────────────────────────

let pages: readonly Page[] = [];
let currentPage = 0;
const demoEpubUrl = new URL('./assets/demo.epub', import.meta.url);

// ── Rendering ───────────────────────────────────────────────────────

function render(): void {
  if (pages.length === 0 || !ctx) return;

  const page = pages[currentPage];
  if (!page) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderPage(page, ctx, PAGE_CONFIG, { backgroundColor: '#ffffff' });

  statusEl.textContent = `Page ${String(currentPage + 1)} / ${String(pages.length)}`;
  prevBtn.disabled = currentPage === 0;
  nextBtn.disabled = currentPage >= pages.length - 1;
}

// ── EPUB Loading ────────────────────────────────────────────────────

async function loadFromArrayBuffer(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const doc = loadEpub(data);
    await loadFonts(doc);
    const measurer = createTextMeasurer(canvas);
    pages = paginate(doc, PAGE_CONFIG, measurer);
    currentPage = 0;

    if (pages.length === 0) {
      statusEl.textContent = `"${name}" produced no pages`;
      return;
    }

    statusEl.textContent = `Loaded "${name}" — ${String(pages.length)} pages`;
    render();
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Event Handlers ──────────────────────────────────────────────────

loadDemoBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Loading demo…';
  try {
    const response = await fetch(demoEpubUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${String(response.status)}`);
    }

    const data = await response.arrayBuffer();
    loadFromArrayBuffer(data, 'demo.epub');
  } catch (err) {
    statusEl.textContent = `Fetch error: ${err instanceof Error ? err.message : String(err)}`;
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  statusEl.textContent = `Loading "${file.name}"…`;
  const reader = new FileReader();
  reader.onload = () => {
    if (reader.result instanceof ArrayBuffer) {
      loadFromArrayBuffer(reader.result, file.name);
    }
  };
  reader.readAsArrayBuffer(file);
});

prevBtn.addEventListener('click', () => {
  if (currentPage > 0) {
    currentPage--;
    render();
  }
});

nextBtn.addEventListener('click', () => {
  if (currentPage < pages.length - 1) {
    currentPage++;
    render();
  }
});
