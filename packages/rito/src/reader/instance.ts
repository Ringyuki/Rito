import type {
  ChapterRange,
  ChapterTextIndex,
  FootnoteEntry,
  LayoutConfig,
  LogLevel,
  PackageMetadata,
  Page,
  PaginationPolicy,
  ReaderInteractions,
  SearchOptions,
  SearchResult,
  Spread,
  TextMeasurer,
  TocEntry,
} from './model';

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
