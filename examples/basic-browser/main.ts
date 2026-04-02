import {
  loadEpub,
  loadFonts,
  paginate,
  render,
  getSpreadDimensions,
  buildSpreads,
  createTextMeasurer,
  createLayoutConfig,
} from '../../src/index';
import type { LayoutConfig, Page, Spread } from '../../src/index';

// ── DOM Elements ────────────────────────────────────────────────────

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
const statusEl = document.getElementById('status') as HTMLSpanElement;
const prevBtn = document.getElementById('prev') as HTMLButtonElement;
const nextBtn = document.getElementById('next') as HTMLButtonElement;
const loadDemoBtn = document.getElementById('load-demo') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const spreadToggle = document.getElementById('spread-toggle') as HTMLButtonElement;

if (!ctx) throw new Error('Canvas 2d context not available');

// ── State ───────────────────────────────────────────────────────────

let config: LayoutConfig = createLayoutConfig({
  width: 800,
  height: 1200,
  margin: 60,
  spreadGap: 20,
});
let pages: readonly Page[] = [];
let spreads: readonly Spread[] = [];
let currentSpread = 0;
const demoEpubUrl = new URL('./assets/demo.epub', import.meta.url);

// Set initial canvas size
canvas.width = config.pageWidth;
canvas.height = config.pageHeight;
canvas.style.maxWidth = `${String(config.pageWidth / 2)}px`;

// ── Rendering ───────────────────────────────────────────────────────

function rebuild(): void {
  spreads = buildSpreads(pages, config);
  currentSpread = 0;
  const dims = getSpreadDimensions(config);
  canvas.width = dims.width;
  canvas.height = dims.height;
  canvas.style.maxWidth = `${String(dims.width / 2)}px`;
}

function draw(): void {
  if (spreads.length === 0 || !ctx) return;
  const spread = spreads[currentSpread];
  if (!spread) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  render(spread, ctx, config, { backgroundColor: '#ffffff' });

  const label = config.spreadMode === 'single' ? 'Page' : 'Spread';
  statusEl.textContent = `${label} ${String(currentSpread + 1)} / ${String(spreads.length)}`;
  prevBtn.disabled = currentSpread === 0;
  nextBtn.disabled = currentSpread >= spreads.length - 1;
}

// ── EPUB Loading ────────────────────────────────────────────────────

async function loadFromArrayBuffer(data: ArrayBuffer, name: string): Promise<void> {
  try {
    const doc = loadEpub(data);
    await loadFonts(doc);
    const measurer = createTextMeasurer(canvas);
    pages = paginate(doc, config, measurer);

    if (pages.length === 0) {
      statusEl.textContent = `"${name}" produced no pages`;
      return;
    }

    rebuild();
    statusEl.textContent = `Loaded "${name}" — ${String(pages.length)} pages`;
    draw();
  } catch (err) {
    statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ── Event Handlers ──────────────────────────────────────────────────

loadDemoBtn.addEventListener('click', async () => {
  statusEl.textContent = 'Loading demo…';
  try {
    const response = await fetch(demoEpubUrl);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
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
  if (currentSpread > 0) {
    currentSpread--;
    draw();
  }
});

nextBtn.addEventListener('click', () => {
  if (currentSpread < spreads.length - 1) {
    currentSpread++;
    draw();
  }
});

spreadToggle.addEventListener('click', () => {
  const newMode = config.spreadMode === 'single' ? 'double' : 'single';
  config = { ...config, spreadMode: newMode };
  spreadToggle.textContent = `Spread: ${newMode === 'single' ? 'Single' : 'Double'}`;
  rebuild();
  draw();
});
