import type {
  ChapterRange,
  ChapterTextIndex,
  FootnoteEntry,
  LayoutConfig,
  LogLevel,
  PackageMetadata,
  Page,
  PaginationPolicy,
  ReaderDocumentSourceSpan,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageReadingAnchor,
  ReaderPageSemantics,
  ReaderPageTargets,
  ReaderTextSelectionMovement,
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
  | 'differentChapter';
declare const readerTextCaretBrand: unique symbol;
/** Exact caret for one Reader revision; pass this branded object itself to range resolution. */
export interface ReaderTextCaret {
  readonly [readerTextCaretBrand]: true;
  /** Page owning this caret's page-local geometry. */
  readonly pageIndex: number;
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

export interface ReaderExactTextRangeRect extends Rect {
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

export type ReaderExactSourceRangeRequest = Required<Pick<ReaderLocator, 'href' | 'sourceRange'>>;
export interface ReaderExactSourceRange {
  readonly selectedText: string;
  readonly sourceLocator: ReaderLocator;
  readonly rects: readonly ReaderExactTextRangeRect[];
}
export type ReaderExactSourceRangeResolution =
  | { readonly status: 'resolved'; readonly range: ReaderExactSourceRange }
  | {
      readonly status: 'pending';
      readonly reason: 'notPaginated' | 'noPageProjection';
    }
  | {
      readonly status: 'unavailable';
      readonly reason: ReaderTextInteractionUnavailableReason;
    };

export interface ReaderTextRange {
  readonly anchor: ReaderTextCaret;
  readonly focus: ReaderTextCaret;
  readonly start: ReaderTextCaret;
  readonly end: ReaderTextCaret;
  readonly selectedText: string;
  readonly sourceSpan: ReaderDocumentSourceSpan;
  /** Backward-compatible exact locator for a range contained in one source resource. */
  readonly sourceLocator?: ReaderLocator | undefined;
  readonly rects: readonly ReaderExactTextRangeRect[];
}

export type ReaderTextRangeResolution =
  | { readonly status: 'resolved'; readonly range: ReaderTextRange }
  | {
      readonly status: 'unavailable';
      readonly reason: ReaderTextInteractionUnavailableReason;
    };

export type ReaderTextSelectionGranularity = 'word' | 'paragraph';

export interface ReaderTextSelectionMovementRequest {
  readonly anchor: ReaderTextCaret;
  readonly focus: ReaderTextCaret;
  readonly movement: ReaderTextSelectionMovement;
  readonly preferredInlinePosition?: number | undefined;
  readonly preferredBlockPosition?: number | undefined;
}

export type ReaderTextSelectionMovementResolution =
  | {
      readonly status: 'resolved';
      readonly range: ReaderTextRange;
      readonly preferredInlinePosition?: number | undefined;
      readonly preferredBlockPosition?: number | undefined;
    }
  | { readonly status: 'boundary'; readonly boundary: 'start' | 'end' }
  | { readonly status: 'pending'; readonly boundary: 'start' | 'end' }
  | {
      readonly status: 'unavailable';
      readonly reason: ReaderTextInteractionUnavailableReason;
    };

export interface ReaderTextRangeFromPointsRequest {
  readonly anchor: ReaderTextPoint;
  readonly focus: ReaderTextPoint;
  readonly granularity: ReaderTextSelectionGranularity;
}

export type ReaderTextRangeFromPointsResolution =
  | { readonly status: 'resolved'; readonly range: ReaderTextRange }
  | {
      readonly status: 'unavailable';
      readonly reason: ReaderTextInteractionUnavailableReason;
    }
  | { readonly status: 'miss' };

export interface ReaderTextSelectionInteractions {
  resolveCaret(point: ReaderTextPoint): Promise<ReaderTextCaretResolution | undefined>;
  resolveTextRange(
    anchor: ReaderTextCaret,
    focus: ReaderTextCaret,
  ): Promise<ReaderTextRangeResolution | undefined>;
  /** Atomically rebind a stable-prefix caret and resolve a point in the current revision. */
  resolveTextRangeToPoint(
    anchor: ReaderTextCaret,
    focus: ReaderTextPoint,
  ): Promise<ReaderTextRangeFromPointsResolution | undefined>;
  resolveTextRangeFromPoints(
    request: ReaderTextRangeFromPointsRequest,
  ): Promise<ReaderTextRangeFromPointsResolution | undefined>;
  /** Atomically advances the focus caret and resolves the exact range in one revision. */
  resolveTextSelectionMovement?(
    request: ReaderTextSelectionMovementRequest,
  ): Promise<ReaderTextSelectionMovementResolution | undefined>;
}

/** Optional atomic capability for revision-safe semantic interaction reads. */
export interface ReaderInteractions {
  /** Gates visual/geometry reads; durable source reads may continue on the canonical revision. */
  readonly enabled: boolean;
  /** Exact native text selection, when supported by the backing reader. */
  readonly textSelection?: ReaderTextSelectionInteractions;
  /** Projects a durable source range through the active committed native revision. */
  resolveExactSourceRange?(
    request: ReaderExactSourceRangeRequest,
  ): Promise<ReaderExactSourceRangeResolution | undefined>;
  /** Native document-order accessibility content for one committed page. */
  getPageSemantics?(pageIndex: number): Promise<ReaderPageSemantics | undefined>;
  /** Durable source identity for the first readable content on one committed page. */
  getPageReadingAnchor?(pageIndex: number): Promise<ReaderPageReadingAnchor | undefined>;
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
export interface ReaderIncrementalPagination {
  /** Whether `Reader.totalSpreads` is final. */
  readonly complete: boolean;
  /** `false` requires `complete === true` before resolution; `undefined` means cancelled. */
  ensureSpread(spreadIndex: number, signal?: AbortSignal): Promise<boolean | undefined>;
}

export interface Reader {
  readonly metadata: PackageMetadata;
  readonly totalSpreads: number;
  readonly pagination?: ReaderIncrementalPagination;
  readonly toc: readonly TocEntry[];
  readonly chapterMap: ReadonlyMap<string, ChapterRange>;
  readonly manifestHrefMap: ReadonlyMap<string, string>;
  readonly pages: readonly Page[];
  readonly spreads: readonly Spread[];
  readonly dpr: number;
  readonly measurer: TextMeasurer;
  readonly interactions?: ReaderInteractions;
  /** Atomically project a durable locator; cancellation or supersession resolves `undefined`. */
  navigateToLocator?(
    locator: ReaderLocator,
    signal?: AbortSignal,
  ): Promise<ReaderLocatorResolution | undefined>;
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
  getImageBlobUrl(src: string): string | undefined | Promise<string | undefined>;
  setTypography(opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }): boolean;
  onSpreadRendered(cb: (spreadIndex: number, spread: Spread) => void): () => void;
  onSpreadContentInvalidated(cb: (spreadIndex: number) => void): () => void;
  onLayoutCommitted(cb: (activeSpreadIndex: number) => void): () => void;
  dispose(): void | Promise<void>;
}
