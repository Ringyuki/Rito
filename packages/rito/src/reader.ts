import type { PackageMetadata, TocEntry } from './parser/epub/types';
import type { Page, Spread } from './layout/types';
import type { ChapterRange, EpubDocument } from './runtime/types';
import { loadEpub } from './runtime/load-epub';
import { getSpreadDimensions } from './render/spread-renderer';
import { disposeAssets } from './render/resources';
import {
  createReaderLayoutControls,
  createReaderNavigation,
  defineReaderAccessors,
  initReaderState,
  renderSpreadToCanvas,
  type ReaderState,
} from './reader-support';
import type { LogLevel } from './utils/logger';

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
  /** Log verbosity level. Defaults to 'warn'. */
  readonly logLevel?: LogLevel;
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

  /** Update viewport size and spread mode in a single re-pagination pass. Returns `true` when layout changed. */
  updateLayout(width: number, height: number, spreadMode?: 'single' | 'double'): boolean;

  /** Update theme colors. Takes effect on the next renderSpread() call without re-pagination. */
  setTheme(options: { backgroundColor?: string; foregroundColor?: string }): void;

  /** Find the page index for a TOC entry. */
  findPage(entry: TocEntry): number | undefined;

  /** Find the spread index containing a given page index. */
  findSpread(pageIndex: number): number | undefined;

  /** Resolve a TOC entry to both page and spread indices. */
  resolveTocEntry(entry: TocEntry): { pageIndex: number; spreadIndex: number } | undefined;

  /** Find the last active TOC entry for a given page index. */
  findActiveTocEntry(pageIndex: number): TocEntry | undefined;

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
  const doc: EpubDocument = loadEpub(data);
  const state = await initReaderState(doc, canvas, options);
  return buildReader(doc, canvas, options, state);
}

function buildReader(
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: ReaderOptions,
  state: ReaderState,
): Reader {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const manifestHrefs = new Map(doc.packageDocument.manifest.map((m) => [m.id, m.href] as const));
  const layoutControls = createReaderLayoutControls(state, doc, options);
  const navigation = createReaderNavigation(doc, state, manifestHrefs);

  return Object.assign(
    defineReaderAccessors(state, doc),
    {
      renderSpread: (index: number, scale = 1): void => {
        renderSpreadToCanvas(state, canvas, ctx, index, scale);
      },
      setTheme(opts: { backgroundColor?: string; foregroundColor?: string }): void {
        if (opts.backgroundColor !== undefined) state.bgColor = opts.backgroundColor;
        if (opts.foregroundColor !== undefined) state.fgColor = opts.foregroundColor;
      },
      getCanvasSize: (scale = 1) => {
        const effectiveRatio = scale * state.dpr;
        const dims = getSpreadDimensions(state.config, effectiveRatio);
        return { width: dims.width / state.dpr, height: dims.height / state.dpr };
      },
      dispose(): void {
        disposeAssets(state.assets);
        doc.close();
      },
    },
    layoutControls,
    navigation,
  ) as Reader;
}
