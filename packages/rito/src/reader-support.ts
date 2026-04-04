import type { LayoutConfig, Spread } from './layout/types';
import type { TocEntry } from './parser/epub/types';
import type { ChapterRange, EpubDocument } from './runtime/types';
import type { ReaderOptions } from './reader';
import type { LogLevel, Logger } from './utils/logger';
import { createLayoutConfig, type LayoutConfigInput } from './layout/config';
import { buildSpreads } from './layout/spread-builder';
import { getSpreadDimensions, render } from './render/spread-renderer';
import {
  loadAssets,
  paginateWithAssets,
  type LoadedAssets,
  type Resources,
} from './render/resources';
import {
  findActiveTocEntryForPage,
  findPageForTocEntry,
  findSpreadForPage,
  resolveTocEntryLocation,
} from './runtime/navigation';
import { paginateInWorker } from './workers/worker-paginator';
import { createLogger } from './utils/logger';

export interface ReaderState {
  readonly logger: Logger;
  spreadMode: 'single' | 'double';
  bgColor: string;
  fgColor: string | undefined;
  dpr: number;
  config: LayoutConfig;
  assets: LoadedAssets;
  resources: Resources;
  spreads: readonly Spread[];
}

interface ReaderLayoutControls {
  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): void;
  updateLayout(width: number, height: number, mode?: 'single' | 'double'): boolean;
}

interface ReaderNavigation {
  findPage(entry: TocEntry): number | undefined;
  findSpread(pageIndex: number): number | undefined;
  resolveTocEntry(entry: TocEntry): { pageIndex: number; spreadIndex: number } | undefined;
  findActiveTocEntry(pageIndex: number): TocEntry | undefined;
}

export async function initReaderState(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
): Promise<ReaderState> {
  const logger = createLogger(options.logLevel ?? 'warn');
  const spreadMode = options.spread ?? 'single';
  const dpr =
    options.devicePixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1);
  const config = makeLayoutConfig(options, spreadMode);
  const assets = await loadAssets(doc, canvas, logger);
  const paginationResult = options.useWorker
    ? await paginateViaWorker(doc, config, assets, options.lineBreaking, options.logLevel)
    : paginateWithAssets(doc, config, assets, options.lineBreaking, logger);
  const resources: Resources = { ...paginationResult, images: assets.images };
  logger.info('Reader created: %dx%d, spread=%s', options.width, options.height, spreadMode);
  return {
    logger,
    spreadMode,
    bgColor: options.backgroundColor ?? '#ffffff',
    fgColor: options.foregroundColor,
    dpr,
    config,
    assets,
    resources,
    spreads: buildSpreads(resources.pages, config, getChapterStartPages(resources.chapterMap)),
  };
}

export function renderSpreadToCanvas(
  state: ReaderState,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  index: number,
  scale: number,
): void {
  if (index < 0 || index >= state.spreads.length) {
    state.logger.warn(
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

export function defineReaderAccessors(state: ReaderState, doc: EpubDocument): object {
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

export function createReaderLayoutControls(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
): ReaderLayoutControls {
  return {
    resize: (width: number, height: number): void => {
      repaginate(state, doc, options, width, height);
    },
    setSpreadMode: (mode: 'single' | 'double'): void => {
      repaginate(
        state,
        doc,
        options,
        state.config.viewportWidth,
        state.config.viewportHeight,
        mode,
      );
    },
    updateLayout: (width: number, height: number, mode = state.spreadMode): boolean =>
      repaginate(state, doc, options, width, height, mode),
  };
}

export function createReaderNavigation(
  doc: EpubDocument,
  state: ReaderState,
  manifestHrefs: ReadonlyMap<string, string>,
): ReaderNavigation {
  return {
    findPage: (entry: TocEntry) =>
      findPageForTocEntry(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
      ),
    findSpread: (pageIndex: number) => findSpreadForPage(pageIndex, state.spreads),
    resolveTocEntry: (entry: TocEntry) =>
      resolveTocEntryLocation(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
        state.spreads,
      ),
    findActiveTocEntry: (pageIndex: number) =>
      findActiveTocEntryForPage(
        doc.toc,
        pageIndex,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
      ),
  };
}

async function paginateViaWorker(
  doc: EpubDocument,
  config: LayoutConfig,
  assets: LoadedAssets,
  lineBreaking?: 'greedy' | 'optimal',
  logLevel?: LogLevel,
): Promise<Omit<Resources, 'images'>> {
  const workerUrl = new URL('./worker', import.meta.url);
  const worker = new Worker(workerUrl, { type: 'module' });
  try {
    return await paginateInWorker(worker, doc, config, assets, lineBreaking, logLevel);
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

function repaginate(
  state: ReaderState,
  doc: EpubDocument,
  options: ReaderOptions,
  width: number,
  height: number,
  spreadMode = state.spreadMode,
): boolean {
  const newConfig = makeLayoutConfig({ ...options, width, height }, spreadMode);
  state.spreadMode = spreadMode;
  if (layoutConfigEqual(state.config, newConfig)) return false;
  state.config = newConfig;
  state.assets.measurer.clearCache();
  state.logger.info('Repagination triggered: %dx%d, spread=%s', width, height, spreadMode);
  const paginationResult = paginateWithAssets(
    doc,
    state.config,
    state.assets,
    options.lineBreaking,
    state.logger,
  );
  state.resources = { ...paginationResult, images: state.assets.images };
  state.spreads = buildSpreads(
    state.resources.pages,
    state.config,
    getChapterStartPages(state.resources.chapterMap),
  );
  return true;
}

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

function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}
