import type { PackageMetadata, Page, Reader, Spread, TocEntry } from 'rito';
import type {
  Annotation,
  AnnotationInput,
  AnnotationPatch,
  StorageAdapter,
} from 'rito/annotations';
import type { ReadingPosition } from 'rito/position';
import type { SearchResult } from 'rito/search';
import type { TextRange } from 'rito/selection';
import type { TransitionOptions } from '../transition/types';
import type { PositionStorageAdapter } from '../storage/types';
import type { OverlayRenderer } from '../overlay/types';
import type { TransitionEngine } from '../transition/types';
import type { TypedEmitter } from '../utils/event-emitter';

/** Defaults matching rito core's ReaderOptions defaults. */
export const READER_DEFAULTS = { margin: 40, spreadGap: 20 } as const;

export interface ControllerOptions {
  readonly transition?: Partial<TransitionOptions> | undefined;
  readonly annotationStorage?: StorageAdapter | undefined;
  readonly positionStorage?: PositionStorageAdapter | undefined;
  /**
   * @deprecated Controller now reads geometry from reader.getLayoutGeometry().
   * These fields are kept for backwards compatibility but are no longer used.
   */
  readonly margin?: number | undefined;
  /** @deprecated See `margin`. */
  readonly spreadGap?: number | undefined;
}

export interface ReaderControllerEvents {
  spreadChange: { spreadIndex: number; spread: Spread };
  selectionChange: {
    range: TextRange | null;
    text: string;
    /** Selection rects in spread-content space (legacy — prefer viewportRects). */
    rects: readonly Rect[];
    /** Selection rects in viewport-logical space (includes margins, ready for overlay/UI). */
    viewportRects: readonly Rect[];
  };
  searchResults: { results: readonly SearchResult[]; activeIndex: number };
  searchActiveChange: { activeIndex: number; result: SearchResult | undefined };
  annotationsChange: { annotations: readonly Annotation[] };
  annotationClick: { annotation: Annotation };
  /** Annotation hover event. `x` and `y` are in **screen** coordinates (suitable for CSS `position: fixed`). */
  annotationHover: { annotation: Annotation | null; x: number; y: number };
  positionChange: { position: ReadingPosition };
  layoutChange: { spreads: readonly Spread[]; totalSpreads: number };
  transitionStart: { direction: 'forward' | 'backward' };
  transitionEnd: { direction: 'forward' | 'backward' };
  error: { message: string; source: string };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type InteractionMode = 'selection' | 'gesture';

export interface ReaderController {
  /** Inject transition wrapper + overlay into container. */
  mount(container: HTMLElement): void;
  /** Clean up all engines, DOM elements, and listeners. Does NOT dispose the Reader. */
  dispose(): void;

  readonly reader: Reader;
  readonly metadata: PackageMetadata;
  readonly toc: readonly TocEntry[];
  readonly spreads: readonly Spread[];
  readonly pages: readonly Page[];
  readonly currentSpread: number;
  readonly totalSpreads: number;

  goToSpread(index: number): void;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;

  /** Re-paginate with new viewport dimensions. Also syncs canvas size using renderScale. */
  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): void;
  setTheme(options: { backgroundColor?: string; foregroundColor?: string }): void;
  setTypography(opts: { fontSize?: number; lineHeight?: number; fontFamily?: string }): boolean;

  /** Set render scale (e.g. for font zoom). Canvas display size = viewport × scale. */
  setRenderScale(scale: number): void;
  readonly renderScale: number;

  search(query: string): void;
  searchNext(): SearchResult | undefined;
  searchPrev(): SearchResult | undefined;
  /** Navigate to a specific search result by index (sets active + jumps to page). */
  goToSearchResult(index: number): void;
  clearSearch(): void;
  readonly searchResults: readonly SearchResult[];
  readonly searchActiveIndex: number;

  clearSelection(): void;
  readonly selectionText: string;
  readonly selectionRange: TextRange | null;

  addAnnotation(input: Omit<AnnotationInput, 'pageIndex'>): Annotation | undefined;
  removeAnnotation(id: string): boolean;
  updateAnnotation(id: string, patch: AnnotationPatch): boolean;
  readonly annotations: readonly Annotation[];

  restorePosition(): number | undefined;
  savePosition(): void;

  setInteractionMode(mode: InteractionMode): void;
  readonly interactionMode: InteractionMode;
  configureTransition(options: Partial<TransitionOptions>): void;

  on<K extends keyof ReaderControllerEvents>(
    event: K,
    handler: (data: ReaderControllerEvents[K]) => void,
  ): () => void;

  readonly transitionEngine: TransitionEngine;
  readonly overlayRenderer: OverlayRenderer;
  readonly emitter: TypedEmitter<ReaderControllerEvents>;
}
