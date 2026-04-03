import type { PackageMetadata, TocEntry } from './parser/epub/types';
import type { LayoutConfig, Page, Spread } from './layout/types';
import type { ChapterRange } from './runtime/types';
import { loadEpub } from './runtime/load-epub';
import { createLayoutConfig, type LayoutConfigInput } from './layout/config';
import { buildSpreads } from './layout/spread-builder';
import { getSpreadDimensions, render } from './render/spread-renderer';
import {
  loadAssets,
  paginateWithAssets,
  disposeAssets,
  type LoadedAssets,
  type Resources,
} from './render/resources';
import { findPageForTocEntry } from './runtime/navigation';
import { paginateInWorker } from './workers/worker-paginator';

/** Options for creating a Reader. */
export interface ReaderOptions {
  /** Viewport width in logical pixels. */
  readonly width: number;
  /** Viewport height in logical pixels. */
  readonly height: number;
  /** Page margin in logical pixels. Defaults to 40. */
  readonly margin?: number;
  /** Spread mode. Defaults to 'single'. */
  readonly spread?: 'single' | 'double';
  /** Gap between pages in double mode. Defaults to 20. */
  readonly spreadGap?: number;
  /** Page background color. Defaults to '#ffffff'. */
  readonly backgroundColor?: string;
  /** Text color override for dark mode. Replaces low-contrast text colors automatically. */
  readonly foregroundColor?: string;
  /** Device pixel ratio for HiDPI rendering. Defaults to `window.devicePixelRatio` (or 1 in non-browser environments). */
  readonly devicePixelRatio?: number;
  /** Line-breaking algorithm. 'greedy' is fast, 'optimal' uses Knuth-Plass for more even line lengths. Defaults to 'greedy'. */
  readonly lineBreaking?: 'greedy' | 'optimal';
  /** Run pagination in a Web Worker to avoid blocking the main thread. Defaults to false. */
  readonly useWorker?: boolean;
}

/** A Rito reader instance. Created by {@link createReader}. */
export interface Reader {
  /** EPUB metadata (title, creator, language, identifier). */
  readonly metadata: PackageMetadata;
  /** Total number of spreads (pages in single mode, page-pairs in double mode). */
  readonly totalSpreads: number;
  /** Table of contents entries. */
  readonly toc: readonly TocEntry[];
  /** Chapter-to-page mapping for navigation. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** All computed pages. */
  readonly pages: readonly Page[];
  /** All computed spreads. */
  readonly spreads: readonly Spread[];

  /** Render a spread by index onto the canvas. Pass scale for font-zoom rendering (DPR is handled internally). */
  renderSpread(index: number, scale?: number): void;

  /** Resize the reader viewport. Re-paginates the document synchronously. */
  resize(width: number, height: number): void;

  /** Change spread mode. Re-paginates the document synchronously. */
  setSpreadMode(mode: 'single' | 'double'): void;

  /** Update theme colors. Takes effect on the next renderSpread() call without re-pagination. */
  setTheme(options: { backgroundColor?: string; foregroundColor?: string }): void;

  /** Find the page index for a TOC entry. */
  findPage(entry: TocEntry): number | undefined;

  /** Find the spread index containing a given page index. */
  findSpread(pageIndex: number): number | undefined;

  /** Get the CSS dimensions for the canvas at the given scale. DPR is accounted for internally. */
  getCanvasSize(scale?: number): { width: number; height: number };

  /** Release all resources (image bitmaps, etc.). */
  dispose(): void;
}

/**
 * Load an EPUB and return a ready-to-render {@link Reader}.
 *
 * Parses the EPUB, registers fonts, decodes images, paginates, and builds spreads.
 *
 * @example
 * ```ts
 * import { createReader } from 'rito';
 *
 * const reader = await createReader(epubData, canvas, {
 *   width: 800, height: 600, margin: 40, spread: 'double',
 * });
 *
 * reader.renderSpread(0);
 * console.log(`${reader.totalSpreads} spreads, ${reader.toc.length} TOC entries`);
 *
 * reader.dispose();
 * ```
 */
export async function createReader(
  data: ArrayBuffer,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<Reader> {
  const doc = loadEpub(data);
  const state = await initReaderState(doc, canvas, options);
  return buildReader(doc, canvas, options, state);
}

interface ReaderState {
  spreadMode: 'single' | 'double';
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  config: LayoutConfig;
  assets: LoadedAssets;
  resources: Resources;
  spreads: readonly Spread[];
}

async function initReaderState(
  doc: ReturnType<typeof loadEpub>,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<ReaderState> {
  const spreadMode = options.spread ?? 'single';
  const dpr =
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  const config = makeLayoutConfig(options, spreadMode);
  const assets = await loadAssets(doc, canvas);
  const paginationResult = options.useWorker
    ? await paginateViaWorker(doc, config, assets, options.lineBreaking)
    : paginateWithAssets(doc, config, assets, options.lineBreaking);
  const resources: Resources = { ...paginationResult, images: assets.images };
  const chapterStarts = getChapterStartPages(resources.chapterMap);
  return {
    spreadMode,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor,
    dpr,
    config,
    assets,
    resources,
    spreads: buildSpreads(resources.pages, config, chapterStarts),
  };
}

async function paginateViaWorker(
  doc: ReturnType<typeof loadEpub>,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
): Promise<Omit<Resources, 'images'>> {
  const workerUrl = new URL('./worker', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  try {
    return await paginateInWorker(worker, doc, config, assets, lineBreaking);
  } finally {
    worker.terminate();
  }
}

function makeLayoutConfig(options: ReaderOptions, spreadMode: 'single' | 'double'): LayoutConfig {
  return createLayoutConfig({
    width: options.width,
    height: options.height,
    margin: options.margin ?? 40,
    spread: spreadMode,
    spreadGap: options.spreadGap ?? 20,
  } satisfies LayoutConfigInput);
}

function renderSpreadToCanvas(
  state: ReaderState,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  index: number,
  scale: number,
): void {
  if (index < 0 || index >= state.spreads.length) {
    console.warn(
      `renderSpread: index ${String(index)} out of range [0, ${String(state.spreads.length)})`,
    );
    return;
  }
  const spread = state.spreads[index];
  if (!spread) return;
  const effectiveRatio = scale * state.dpr;
  const dims = getSpreadDimensions(state.config, effectiveRatio);
  canvas.width = dims.width;
  canvas.height = dims.height;
  // Correct for rounding: actual buffer size may differ from effectiveRatio
  const correctedRatio = canvas.width / state.config.viewportWidth;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const opts: Record<string, unknown> = {
    backgroundColor: state.bgColor,
    pixelRatio: correctedRatio,
  };
  if (state.fgColor) opts['foregroundColor'] = state.fgColor;
  opts['images'] = state.resources.images;
  render(spread, ctx, state.config, opts as Parameters<typeof render>[3]);
}

/**
 * Re-paginate with new dimensions. Reuses cached assets (fonts, images,
 * text measurer) — only layout and spread building are re-run.
 * Returns `true` if pagination was actually performed.
 */
function repaginate(
  state: ReaderState,
  doc: ReturnType<typeof loadEpub>,
  options: ReaderOptions,
  width: number,
  height: number,
): boolean {
  const newConfig = makeLayoutConfig({ ...options, width, height }, state.spreadMode);
  if (layoutConfigEqual(state.config, newConfig)) return false;
  state.config = newConfig;
  state.assets.measurer.clearCache();
  const paginationResult = paginateWithAssets(
    doc,
    state.config,
    state.assets,
    options.lineBreaking,
  );
  state.resources = { ...paginationResult, images: state.assets.images };
  state.spreads = buildSpreads(
    state.resources.pages,
    state.config,
    getChapterStartPages(state.resources.chapterMap),
  );
  return true;
}

/** Shallow equality check for layout configs to skip redundant repagination. */
function layoutConfigEqual(a: LayoutConfig, b: LayoutConfig): boolean {
  return (
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.pageWidth === b.pageWidth &&
    a.pageHeight === b.pageHeight &&
    a.marginTop === b.marginTop &&
    a.marginRight === b.marginRight &&
    a.marginBottom === b.marginBottom &&
    a.marginLeft === b.marginLeft &&
    a.spreadMode === b.spreadMode &&
    a.firstPageAlone === b.firstPageAlone &&
    a.spreadGap === b.spreadGap
  );
}

function defineReaderAccessors(state: ReaderState, doc: ReturnType<typeof loadEpub>): object {
  return Object.defineProperties(
    {},
    {
      metadata: { get: () => doc.packageDocument.metadata, enumerable: true },
      totalSpreads: { get: () => state.spreads.length, enumerable: true },
      toc: { get: () => doc.toc, enumerable: true },
      chapterMap: { get: () => state.resources.chapterMap, enumerable: true },
      pages: { get: () => state.resources.pages, enumerable: true },
      spreads: { get: () => state.spreads, enumerable: true },
    },
  );
}

function buildReader(
  doc: ReturnType<typeof loadEpub>,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  state: ReaderState,
): Reader {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const manifestHrefs = new Map(doc.packageDocument.manifest.map((m) => [m.id, m.href] as const));

  return Object.assign(defineReaderAccessors(state, doc), {
    renderSpread: (index: number, scale = 1): void => {
      renderSpreadToCanvas(state, canvas, ctx, index, scale);
    },
    resize: (w: number, h: number): void => {
      repaginate(state, doc, options, w, h);
    },
    setSpreadMode(mode: 'single' | 'double'): void {
      if (state.spreadMode === mode) return;
      state.spreadMode = mode;
      const { viewportWidth, viewportHeight } = state.config;
      repaginate(state, doc, options, viewportWidth, viewportHeight);
    },
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
      if (opts.backgroundColor !== undefined) state.bgColor = opts.backgroundColor;
      if (opts.foregroundColor !== undefined) state.fgColor = opts.foregroundColor;
    },
    findPage: (entry: TocEntry) =>
      findPageForTocEntry(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
      ),
    findSpread: (pageIndex: number) => findSpreadIndex(state.spreads, pageIndex),
    getCanvasSize: (scale = 1) => {
      const effectiveRatio = scale * state.dpr;
      const dims = getSpreadDimensions(state.config, effectiveRatio);
      return { width: dims.width / state.dpr, height: dims.height / state.dpr };
    },
    dispose(): void {
      disposeAssets(state.assets);
      doc.close();
    },
  }) as Reader;
}

function findSpreadIndex(spreads: readonly Spread[], pageIndex: number): number | undefined {
  for (let i = 0; i < spreads.length; i++) {
    const s = spreads[i];
    if (s?.left?.index === pageIndex || s?.right?.index === pageIndex) return i;
  }
  return undefined;
}

function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}
