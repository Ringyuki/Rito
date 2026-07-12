import type {
  ChapterRange,
  ChapterTextIndex,
  FootnoteEntry,
  LayoutConfig,
  LogLevel,
  PackageMetadata,
  Page,
  PaginationPolicy,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageTargets,
  Rect,
  SearchOptions,
  SearchResult,
  Spread,
  TextMeasurer,
  TocEntry,
} from './model';

export interface ReaderTextPoint {
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface ReaderTextCaretGeometry {
  readonly x: number;
  readonly y: number;
  readonly height: number;
}

export type ReaderTextInteractionUnavailableReason =
  | 'shapeUnavailable'
  | 'sourceUnavailable'
  | 'unsupportedTransform'
  | 'visualGeometryUnavailable'
  | 'invalidCaret'
  | 'differentLogicalFlow';

declare const readerTextCaretBrand: unique symbol;

/**
 * Exact point-to-caret result owned by one Reader and one committed revision.
 * Pass this object itself, not a copy, to same-flow range resolution.
 */
export interface ReaderTextCaret {
  readonly [readerTextCaretBrand]: true;
  readonly geometry: ReaderTextCaretGeometry;
  readonly sourceLocator: ReaderLocator;
}

export type ReaderTextCaretResolution =
  | {
      readonly status: 'resolved';
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly caret: ReaderTextCaret;
    }
  | {
      readonly status: 'unavailable';
      readonly pageIndex: number;
      readonly spreadIndex: number;
      readonly reason: ReaderTextInteractionUnavailableReason;
    }
  | {
      readonly status: 'miss';
      readonly pageIndex: number;
      readonly spreadIndex: number;
    };

/** Exact selection rectangle in page-content coordinates. */
export interface ReaderExactTextRangeRect extends Rect {
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

export interface ReaderSameFlowTextRange {
  readonly anchor: ReaderTextCaret;
  readonly focus: ReaderTextCaret;
  readonly start: ReaderTextCaret;
  readonly end: ReaderTextCaret;
  readonly selectedText: string;
  readonly sourceLocator: ReaderLocator;
  readonly rects: readonly ReaderExactTextRangeRect[];
}

export type ReaderSameFlowTextRangeResolution =
  | { readonly status: 'resolved'; readonly range: ReaderSameFlowTextRange }
  | {
      readonly status: 'unavailable';
      readonly reason: ReaderTextInteractionUnavailableReason;
    };

export interface ReaderTextSelectionInteractions {
  resolveCaret(point: ReaderTextPoint): Promise<ReaderTextCaretResolution | undefined>;
  resolveSameFlowRange(
    anchor: ReaderTextCaret,
    focus: ReaderTextCaret,
  ): Promise<ReaderSameFlowTextRangeResolution | undefined>;
}

/** Optional atomic capability for revision-safe semantic interaction reads. */
export interface ReaderInteractions {
  /** False while no canonical revision is active or a visual-only preview is displayed. */
  readonly enabled: boolean;
  /** Exact native text selection, when supported by the backing reader. */
  readonly textSelection?: ReaderTextSelectionInteractions;
  getPageTargets(pageIndex: number): Promise<ReaderPageTargets | undefined>;
  getFootnote(key: string): Promise<FootnoteEntry | undefined>;
  resolveLocator(locator: ReaderLocator): Promise<ReaderLocatorResolution | undefined>;
}

export interface ReaderPinnedFontPolicy {
  readonly schemaVersion: 1;
  readonly faces: readonly {
    /** Copied on open; the caller's buffer remains owned and attached. */
    readonly bytes: ArrayBuffer;
    readonly expectedSha256: string;
    readonly genericRole: 'serif' | 'sansSerif' | 'monospace';
    readonly language?: string | undefined;
  }[];
}

export interface ReaderOptions {
  readonly width: number;
  readonly height: number;
  readonly margin?: number;
  readonly spread?: 'single' | 'double';
  readonly spreadGap?: number;
  readonly backgroundColor?: string | null;
  readonly foregroundColor?: string | null;
  readonly devicePixelRatio?: number;
  readonly lineBreaking?: 'greedy' | 'optimal';
  readonly logLevel?: LogLevel;
  readonly paginationPolicy?: PaginationPolicy;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly lineHeightForce?: boolean;
  readonly fontFamily?: string;
  readonly fontFamilyForce?: boolean;
  /** Required, immutable fallback faces shared by native shaping and Canvas paint. */
  readonly pinnedFontPolicy?: ReaderPinnedFontPolicy;
}
export interface ReaderThemeOptions {
  readonly backgroundColor?: string | null;
  readonly foregroundColor?: string | null;
}
export interface Reader {
  readonly metadata: PackageMetadata;
  readonly totalSpreads: number;
  readonly toc: readonly TocEntry[];
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  readonly manifestHrefMap: ReadonlyMap<string, string>;
  readonly pages: readonly Page[];
  readonly spreads: readonly Spread[];
  readonly dpr: number;
  readonly measurer: TextMeasurer;
  readonly interactions?: ReaderInteractions;
  renderSpread(index: number, scale?: number): void;
  renderSpreadTo(
    index: number,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): boolean;
  notifyActiveSpread(index: number): void;
  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): boolean;
  setLineBreaking(lineBreaking: 'greedy' | 'optimal'): boolean;
  updateLayout(
    width: number,
    height: number,
    spreadMode?: 'single' | 'double',
    margin?: number,
  ): boolean;
  setTheme(options: ReaderThemeOptions): void;
  findPage(entry: TocEntry): number | undefined;
  findSpread(pageIndex: number): number | undefined;
  resolveTocEntry(entry: TocEntry): { pageIndex: number; spreadIndex: number } | undefined;
  search?(
    query: string,
    options?: SearchOptions,
  ): readonly SearchResult[] | Promise<readonly SearchResult[]>;
  findActiveTocEntry(pageIndex: number): TocEntry | undefined;
  getCanvasSize(scale?: number): { width: number; height: number };
  getLayoutGeometry(): Readonly<LayoutConfig>;
  getChapterTextIndices(): ReadonlyMap<string, ChapterTextIndex>;
  getFootnotes(): ReadonlyMap<string, FootnoteEntry>;
  getImageBlobUrl(src: string): string | undefined;
  setTypography(opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }): boolean;
  onSpreadRendered(cb: (spreadIndex: number, spread: Spread) => void): () => void;
  onSpreadContentInvalidated(cb: (spreadIndex: number) => void): () => void;
  onLayoutCommitted(cb: () => void): () => void;
  dispose(): void;
}
