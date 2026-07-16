import type {
  FootnoteEntry,
  PackageMetadata,
  Page,
  ReaderLocator,
  Spread,
  TocEntry,
} from '@ritojs/core';
import type { Reader } from '@ritojs/core';
import type {
  AnnotationRecord,
  AnnotationRecordPatch,
  RecordStorageAdapter,
  ResolvedAnnotation,
} from '../interaction/index';
import type { ReadingPosition } from '../interaction/index';
import type { SearchResult } from '../interaction/index';
import type { TextRange } from '../interaction/index';
import type { TransitionDriverOptions } from '../driver/types';
import type { PositionStorageAdapter } from '../storage/types';
import type { KeyboardManager } from '../keyboard/types';
import type { TypedEmitter } from '../utils/event-emitter';

type ReaderThemeOptions = Parameters<Reader['setTheme']>[0];

/** Defaults matching `@ritojs/core` ReaderOptions defaults. */
export const READER_DEFAULTS = { margin: 40, spreadGap: 20 } as const;

export interface ControllerOptions {
  readonly transition?: Partial<TransitionDriverOptions> | undefined;
  /** Initial display scale applied before the first canvas mount/render. */
  readonly renderScale?: number | undefined;
  /** Storage adapter for source-anchored annotation records. */
  readonly annotationStorage?: RecordStorageAdapter | undefined;
  readonly positionStorage?: PositionStorageAdapter | undefined;
  /** Accessibility mirror configuration (opt-in). */
  readonly a11y?: { readonly enabled?: boolean; readonly container?: HTMLElement } | undefined;
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
    /** Legacy layout-local range. Null for an exact native selection. */
    range: TextRange | null;
    /** Durable source locator for an exact native selection. */
    sourceLocator: ReaderLocator | null;
    /** Explicit because a native selection intentionally has no legacy TextRange. */
    hasSelection: boolean;
    text: string;
    /** Selection rects in spread-content space (legacy — prefer viewportRects). */
    rects: readonly Rect[];
    /** Selection rects in viewport-logical space (includes margins, ready for overlay/UI). */
    viewportRects: readonly Rect[];
    /** Rect of the active endpoint (focus / drag end) in viewport-logical space. Follows the user's pointer. */
    focusRect: Rect | null;
  };
  searchResults: { results: readonly SearchResult[]; activeIndex: number };
  searchActiveChange: { activeIndex: number; result: SearchResult | undefined };
  annotationsChange: { annotations: readonly AnnotationRecord[] };
  /** Annotation click event. `x` and `y` are in **screen** coordinates (suitable for CSS `position: fixed`). */
  annotationClick: { annotation: ResolvedAnnotation; x: number; y: number };
  /** Annotation hover event. `x` and `y` are in **screen** coordinates (suitable for CSS `position: fixed`). */
  annotationHover: { annotation: ResolvedAnnotation | null; x: number; y: number };
  positionChange: { position: ReadingPosition };
  layoutChange: { spreads: readonly Spread[]; totalSpreads: number };
  transitionStart: { direction: 'forward' | 'backward' };
  transitionEnd: { direction: 'forward' | 'backward' };
  /** Link clicked. Call `navigate()` to execute internal navigation. */
  linkClick: {
    href: string;
    text: string;
    type: 'internal' | 'external';
    /** Resolved chapter/section label from TOC (internal links only). */
    resolvedLabel?: string | undefined;
    /** For internal links: call to navigate to the target spread. */
    navigate: () => void;
  };
  /** Footnote reference clicked. `content` has the footnote entry. */
  footnoteClick: {
    id: string;
    href: string;
    content: FootnoteEntry;
  };
  /** Image clicked. `screenBounds` is in screen coordinates for lightbox positioning. */
  imageClick: {
    src: string;
    alt: string;
    /** Controller-owned object URL, valid until the next image click or controller disposal. */
    blobUrl: string;
    screenBounds: Rect;
  };
  /** Emitted when the search keyboard shortcut is pressed. UI layer should open the search bar. */
  searchOpen: undefined;
  error: { message: string; source: string };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Input for creating an annotation from the current selection. */
export interface AddAnnotationInput {
  readonly kind: 'highlight' | 'underline' | 'note';
  readonly color?: string;
  readonly note?: string;
}

export type InteractionMode = 'selection' | 'gesture';

export interface ReaderController {
  /** Inject into a container. Repeating the same mount is a no-op; throws after disposal. */
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
  /** Whether `totalSpreads` is the final publication extent. */
  readonly paginationComplete: boolean;

  goToSpread(index: number): void;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
  /**
   * Snap to a spread without playing a transition animation. Use for cold-start
   * restore, deep-linking, search jumps, and other programmatic navigation
   * where the user did not initiate a turn.
   */
  jumpToSpread(index: number): void;

  /** Re-paginate with new viewport dimensions (and optional margin). Also syncs canvas size using renderScale. */
  resize(width: number, height: number, margin?: number): void;
  setSpreadMode(mode: 'single' | 'double'): void;
  setLineBreaking(lineBreaking: 'greedy' | 'optimal'): boolean;
  setTheme(options: ReaderThemeOptions): void;
  /**
   * Update typography overrides. For each value field:
   * `undefined` leaves it untouched, `null` clears the override (falls back to the
   * book's natural value), an explicit value sets the override.
   *
   * Force flags (`lineHeightForce`, `fontFamilyForce`) gate the override's reach:
   * `false` (coarse) lets element-level CSS like `p { line-height: 1.3em }` win;
   * `true` (strong) rewrites the value on every element. `undefined` leaves it untouched.
   */
  setTypography(opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }): boolean;

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
  readonly hasSelection: boolean;
  readonly selectionText: string;
  /** Legacy layout-local range. Null when the native exact selector is authoritative. */
  readonly selectionRange: TextRange | null;
  /** Durable source locator for a native exact selection. */
  readonly selectionSourceLocator: ReaderLocator | null;

  addAnnotation(input: AddAnnotationInput): AnnotationRecord | undefined;
  removeAnnotation(id: string): boolean;
  updateAnnotation(id: string, patch: AnnotationRecordPatch): boolean;
  readonly annotations: readonly AnnotationRecord[];

  restorePosition(): Promise<number | undefined>;
  savePosition(): Promise<void>;
  /** Resolve and navigate to a serialized source-anchored ReadingPosition. */
  goToPosition(position: ReadingPosition): Promise<number | undefined>;

  setInteractionMode(mode: InteractionMode): void;
  readonly interactionMode: InteractionMode;
  configureTransition(options: Partial<TransitionDriverOptions>): void;

  on<K extends keyof ReaderControllerEvents>(
    event: K,
    handler: (data: ReaderControllerEvents[K]) => void,
  ): () => void;

  readonly emitter: TypedEmitter<ReaderControllerEvents>;
  readonly keyboard: KeyboardManager;
}
