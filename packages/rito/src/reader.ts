import type { TocEntry } from './parser/epub/types';
import type { LayoutConfig, Page, Spread } from './layout/types';
import type { ChapterRange } from './runtime/types';
import { loadEpub } from './runtime/load-epub';
import { createLayoutConfig, type LayoutConfigInput } from './layout/config';
import { buildSpreads } from './layout/spread-builder';
import { getSpreadDimensions, render } from './render/spread-renderer';
import { prepare, disposeResources, type Resources } from './render/resources';
import { findPageForTocEntry } from './runtime/navigation';

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
}

/** A Rito reader instance. Created by {@link createReader}. */
export interface Reader {
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

  /** Render a spread by index onto the canvas. Pass pixelRatio for HiDPI or font-scale rendering. */
  renderSpread(index: number, pixelRatio?: number): void;

  /** Resize the reader viewport. Re-paginates the document. */
  resize(width: number, height: number): Promise<void>;

  /** Change spread mode. Re-paginates the document. */
  setSpreadMode(mode: 'single' | 'double'): Promise<void>;

  /** Update theme colors. Takes effect on the next renderSpread() call without re-pagination. */
  setTheme(options: { backgroundColor?: string; foregroundColor?: string }): void;

  /** Find the page index for a TOC entry. */
  findPage(entry: TocEntry): number | undefined;

  /** Find the spread index containing a given page index. */
  findSpread(pageIndex: number): number | undefined;

  /** Get the canvas dimensions needed for the current config. */
  getCanvasSize(pixelRatio?: number): { width: number; height: number };

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
  config: LayoutConfig;
  resources: Resources;
  spreads: readonly Spread[];
}

async function initReaderState(
  doc: ReturnType<typeof loadEpub>,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<ReaderState> {
  const spreadMode = options.spread ?? 'single';
  const config = makeLayoutConfig(options, spreadMode);
  const resources = await prepare(doc, config, canvas);
  const chapterStarts = getChapterStartPages(resources.chapterMap);
  return {
    spreadMode,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor,
    config,
    resources,
    spreads: buildSpreads(resources.pages, config, chapterStarts),
  };
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
  pixelRatio: number,
): void {
  const spread = state.spreads[index];
  if (!spread) return;
  const dims = getSpreadDimensions(state.config, pixelRatio);
  canvas.width = dims.width;
  canvas.height = dims.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const opts: Record<string, unknown> = { backgroundColor: state.bgColor, pixelRatio };
  if (state.fgColor) opts['foregroundColor'] = state.fgColor;
  opts['images'] = state.resources.images;
  render(spread, ctx, state.config, opts as Parameters<typeof render>[3]);
}

async function repaginate(
  state: ReaderState,
  doc: ReturnType<typeof loadEpub>,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  width: number,
  height: number,
): Promise<void> {
  state.config = makeLayoutConfig({ ...options, width, height }, state.spreadMode);
  disposeResources(state.resources);
  state.resources = await prepare(doc, state.config, canvas);
  state.spreads = buildSpreads(state.resources.pages, state.config, getChapterStartPages(state.resources.chapterMap));
}

function buildReader(
  doc: ReturnType<typeof loadEpub>,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  state: ReaderState,
): Reader {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const manifestHrefs = new Map(doc.packageDocument.manifest.map((m) => [m.id, m.href] as const));

  return {
    get totalSpreads() { return state.spreads.length; },
    get toc() { return doc.toc; },
    get chapterMap() { return state.resources.chapterMap; },
    get pages() { return state.resources.pages; },
    get spreads() { return state.spreads; },
    renderSpread: (index: number, pixelRatio = 1): void => { renderSpreadToCanvas(state, canvas, ctx, index, pixelRatio); },
    resize: (w: number, h: number) => repaginate(state, doc, canvas, options, w, h),
    async setSpreadMode(mode: 'single' | 'double'): Promise<void> {
      state.spreadMode = mode;
      await repaginate(state, doc, canvas, options, state.config.viewportWidth, state.config.viewportHeight);
    },
    setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
      if (opts.backgroundColor !== undefined) state.bgColor = opts.backgroundColor;
      if (opts.foregroundColor !== undefined) state.fgColor = opts.foregroundColor;
    },
    findPage: (entry: TocEntry) =>
      findPageForTocEntry(entry, state.resources.chapterMap, doc.packageDocument.spine, manifestHrefs),
    findSpread(pageIndex: number): number | undefined {
      for (let i = 0; i < state.spreads.length; i++) {
        const s = state.spreads[i];
        if (s?.left?.index === pageIndex || s?.right?.index === pageIndex) return i;
      }
      return undefined;
    },
    getCanvasSize: (pixelRatio = 1) => getSpreadDimensions(state.config, pixelRatio),
    dispose(): void { disposeResources(state.resources); doc.close(); },
  };
}

function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}
