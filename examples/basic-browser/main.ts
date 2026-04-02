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

let spreadMode: 'single' | 'double' = 'double';
let config: LayoutConfig = buildConfig();
let pages: readonly Page[] = [];
let spreads: readonly Spread[] = [];
let currentSpread = 0;
const demoEpubUrl = new URL('./assets/demo.epub', import.meta.url);

function buildConfig(): LayoutConfig {
  return createLayoutConfig({
    width: 1280,
    height: 720,
    margin: 60,
    spread: spreadMode,
    spreadGap: 20,
  });
}

// Set initial canvas size
const initDims = getSpreadDimensions(config);
canvas.width = initDims.width;
canvas.height = initDims.height;

// ── Rendering ───────────────────────────────────────────────────────

function rebuild(): void {
  config = buildConfig();
  spreads = buildSpreads(pages, config);
  currentSpread = 0;
  const dims = getSpreadDimensions(config);
  canvas.width = dims.width;
  canvas.height = dims.height;
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

  // Debug: dump current page structure to console
  const page = spread.left;
  if (page) {
    console.group(`Page ${String(page.index)}`);
    for (let bi = 0; bi < page.content.length; bi++) {
      const block = page.content[bi];
      if (!block) continue;
      console.group(
        `Block ${String(bi)}: y=${String(Math.round(block.bounds.y))}, h=${String(Math.round(block.bounds.height))}, lines=${String(block.children.length)}`,
      );
      for (let li = 0; li < block.children.length; li++) {
        const child = block.children[li];
        if (child?.type === 'line-box') {
          const text = child.runs.map((r) => r.text).join('');
          console.log(
            `  Line ${String(li)}: y=${String(Math.round(child.bounds.y))}, h=${String(Math.round(child.bounds.height))}, text="${text.slice(0, 40)}${text.length > 40 ? '...' : ''}"`,
          );
        }
      }
      console.groupEnd();
    }
    console.groupEnd();
  }
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
  spreadMode = spreadMode === 'single' ? 'double' : 'single';
  spreadToggle.textContent = `Spread: ${spreadMode === 'single' ? 'Single' : 'Double'}`;
  rebuild();
  draw();
});
