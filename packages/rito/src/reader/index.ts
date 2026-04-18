import type { LayoutConfig, Page, PaginationPolicy, Spread } from '../layout/core/types';
import type { ChapterTextIndex } from '../interaction/anchors/chapter-text-index';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { PackageMetadata, TocEntry } from '../parser/epub/types';
import { disposeAssets } from '../render/assets';
import { getSpreadDimensions } from '../render/spread';
import { buildHrefResolver } from '../utils/resolve-href';
import type { FootnoteEntry } from '../runtime/footnote-extractor';
import type { ChapterRange, EpubDocument } from '../runtime/types';
// FootnoteEntry is a stable public type (text + html, no parser AST).
import { loadEpub } from '../runtime/load-epub';
import {
  createReaderLayoutControls,
  createReaderNavigation,
  defineReaderAccessors,
  initReaderState,
  renderSpreadToCanvas,
  renderSpreadToContext,
  type ReaderState,
} from './helpers';
import type { LogLevel } from '../utils/logger';

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
  /** Log verbosity level. Defaults to 'warn'. */
  readonly logLevel?: LogLevel;
  /** Pagination policy for widow/orphan control. */
  readonly paginationPolicy?: PaginationPolicy;
}

/** A Rito reader instance. Created by {@link createReader}. */
export interface Reader {
  /** EPUB metadata (title, creator, language, identifier). */
  readonly metadata: PackageMetadata;
  /** Total number of spreads (pages in single mode, page-pairs in double mode). */
  readonly totalSpreads: number;
  /** Table of contents entries. */
  readonly toc: readonly TocEntry[];
  /** Chapter-to-page mapping for navigation. Key is spine idref. */
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  /** Mapping from spine idref to manifest href (for footnote key resolution). */
  readonly manifestHrefMap: ReadonlyMap<string, string>;
  /** All computed pages. */
  readonly pages: readonly Page[];
  /** All computed spreads. */
  readonly spreads: readonly Spread[];

  /** Render a spread by index onto the canvas. Pass scale for font-zoom rendering (DPR is handled internally). */
  renderSpread(index: number, scale?: number): void;

  /**
   * Render a spread into an arbitrary 2D context without resizing the canvas
   * or firing onSpreadRendered listeners.
   *
   * The caller must size `ctx.canvas` to the desired backing store dimensions.
   * The pixel ratio is derived from `ctx.canvas.width / viewportWidth`.
   */
  renderSpreadTo(
    index: number,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): void;

  /**
   * Fire onSpreadRendered listeners without painting.
   * Use when a separate renderer has already produced the pixels and consumers
   * only need the "active spread changed" signal.
   */
  notifyActiveSpread(index: number): void;

  /** Resize the reader viewport. Re-paginates the document synchronously. */
  resize(width: number, height: number): void;

  /** Change spread mode. Re-paginates the document synchronously. */
  setSpreadMode(mode: 'single' | 'double'): void;

  /** Update viewport size, spread mode, and/or margin in a single re-pagination pass. Returns `true` when layout changed. */
  updateLayout(
    width: number,
    height: number,
    spreadMode?: 'single' | 'double',
    margin?: number,
  ): boolean;

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

  /** Get the current layout configuration (read-only). */
  getLayoutGeometry(): Readonly<LayoutConfig>;

  /** Device pixel ratio used for rendering (from ReaderOptions or default). */
  readonly dpr: number;

  /** Get source-based chapter text indices (built from parsed XHTML, not layout output). */
  getChapterTextIndices(): ReadonlyMap<string, ChapterTextIndex>;

  /** Get footnote entries extracted from aside elements, keyed by `manifestHref#fragment`. */
  getFootnotes(): ReadonlyMap<string, FootnoteEntry>;

  /** Create a blob URL for an EPUB image by its internal src path. Caller must revoke when done. */
  getImageBlobUrl(src: string): string | undefined;

  /** Text measurer for use with interaction APIs (hit testing, selection). */
  readonly measurer: TextMeasurer;

  /**
   * Update typography settings. Triggers re-pagination.
   *
   * For each value field (`fontSize`, `lineHeight`, `fontFamily`):
   * - `undefined` (or omitted) — no change
   * - `null` — clear the override, fall back to the book's natural value
   * - explicit value — set as override
   *
   * For each force flag (`lineHeightForce`, `fontFamilyForce`):
   * - `undefined` (or omitted) — no change
   * - `false` — coarse mode: override only cascades from body; element-level CSS rules win
   * - `true` — strong mode: override is forced on every element, bypassing element-level CSS
   *
   * `fontSize` overrides rootFontSize (affects rem units and base size).
   * `lineHeight` overrides the body line-height multiplier (e.g. 1.5, 2.0).
   * `fontFamily` overrides the body font-family.
   */
  setTypography(opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }): boolean;

  /** Subscribe to spread render events. Returns unsubscribe function. */
  onSpreadRendered(cb: (spreadIndex: number, spread: Spread) => void): () => void;

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
 * import { createReader } from '@ritojs/core';
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
    defineReaderAccessors(state, doc, manifestHrefs),
    buildReaderMethods(state, doc, canvas, ctx, layoutControls),
    layoutControls,
    navigation,
  ) as Reader;
}

function buildReaderMethods(
  state: ReaderState,
  doc: EpubDocument,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  layoutControls: ReturnType<typeof createReaderLayoutControls>,
) {
  return {
    renderSpread: (index: number, scale = 1): void => {
      renderSpreadToCanvas(state, canvas, ctx, index, scale);
    },
    renderSpreadTo: (
      index: number,
      targetCtx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    ): void => {
      renderSpreadToContext(state, targetCtx, index);
    },
    notifyActiveSpread: (index: number): void => {
      const spread = state.spreads[index];
      if (!spread) return;
      for (const cb of state.spreadRenderedListeners) cb(index, spread);
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
    getLayoutGeometry: (): Readonly<LayoutConfig> => state.config,
    getChapterTextIndices: () => state.resources.chapterTextIndices,
    getFootnotes: () => state.resources.footnoteMap,
    getImageBlobUrl: (() => {
      const resolve = buildHrefResolver(doc.images);
      return (src: string): string | undefined => {
        const bytes = resolve(src);
        if (!bytes) return undefined;
        const blob = new Blob([bytes.buffer as ArrayBuffer]);
        return URL.createObjectURL(blob);
      };
    })(),
    measurer: state.assets.measurer as TextMeasurer,
    setTypography(opts: {
      fontSize?: number | null;
      lineHeight?: number | null;
      lineHeightForce?: boolean;
      fontFamily?: string | null;
      fontFamilyForce?: boolean;
    }): boolean {
      if (opts.fontSize !== undefined) state.fontSizeOverride = opts.fontSize ?? undefined;
      if (opts.lineHeight !== undefined) state.lineHeightOverride = opts.lineHeight ?? undefined;
      if (opts.lineHeightForce !== undefined) state.lineHeightForce = opts.lineHeightForce;
      if (opts.fontFamily !== undefined) state.fontFamilyOverride = opts.fontFamily ?? undefined;
      if (opts.fontFamilyForce !== undefined) state.fontFamilyForce = opts.fontFamilyForce;
      return layoutControls.updateLayout(
        state.config.viewportWidth,
        state.config.viewportHeight,
        state.spreadMode,
      );
    },
    onSpreadRendered(cb: (spreadIndex: number, spread: Spread) => void): () => void {
      state.spreadRenderedListeners.add(cb);
      return () => state.spreadRenderedListeners.delete(cb);
    },
    dispose(): void {
      state.spreadRenderedListeners.clear();
      disposeAssets(state.assets);
      doc.close();
    },
  };
}
