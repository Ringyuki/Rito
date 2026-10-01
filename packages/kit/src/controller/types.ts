import type {
  FootnoteEntry,
  PackageMetadata,
  ReaderDocumentSourceSpan,
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
import type { TransitionDriverOptions } from '../driver/types';
import type { PositionStorageAdapter } from '../storage/types';
import type { KeyboardManager } from '../keyboard/types';
import type { TypedEmitter } from '../utils/event-emitter';

type ReaderThemeOptions = Parameters<Reader['setTheme']>[0];

export type SelectionHandleEdge = 'start' | 'end';

/** A pointer position in viewport-logical (client) coordinates. */
export interface ReaderClientPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export type SelectionClientPoint = ReaderClientPoint;

/**
 * What kind of interactive content sits under a point.
 *
 * These are exactly the four things a click there would act on, in the
 * priority the dispatcher uses. A pending footnote reports `'link'`
 * because that is the event it raises: until its definition is indexed
 * it behaves as an ordinary link.
 */
export type ContentHitKind = 'link' | 'footnote' | 'image' | 'annotation';

/** Exact selection endpoints in viewport-logical coordinates. */
export interface SelectionHandleState {
  readonly start: Rect | null;
  readonly end: Rect | null;
  readonly focusEdge: SelectionHandleEdge | null;
}

/** An epoch-bound drag of one existing selection endpoint. */
export interface SelectionHandleDrag {
  update(point: SelectionClientPoint): void;
  finish(point: SelectionClientPoint): void;
  cancel(): void;
}

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
    /** Durable source locator of the selection, when both endpoints share a resource. */
    sourceLocator: ReaderLocator | null;
    /** Resource-qualified durable endpoints of the selection. */
    sourceSpan: ReaderDocumentSourceSpan | null;
    hasSelection: boolean;
    text: string;
    /** Selection rects in spread-content space (content areas only, no margins). */
    rects: readonly Rect[];
    /** Selection rects in viewport-logical space (includes margins, ready for overlay/UI). */
    viewportRects: readonly Rect[];
    /** Rect of the active endpoint (focus / drag end) in viewport-logical space. Follows the user's pointer. */
    focusRect: Rect | null;
    /** Exact range endpoints in viewport-logical space. */
    handles: SelectionHandleState | null;
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
  /** Navigation records of the committed layout, indexed by spread. */
  readonly spreads: readonly Spread[];
  readonly currentSpread: number;
  /** Final spread count of the committed layout; every revision is laid out complete. */
  readonly totalSpreads: number;

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
  /** Durable source locator of the selection, when both endpoints share a resource. */
  readonly selectionSourceLocator: ReaderLocator | null;
  /** Resource-qualified durable endpoints of the selection. */
  readonly selectionSourceSpan: ReaderDocumentSourceSpan | null;
  /**
   * Begin dragging a selection endpoint from a client-space pointer.
   * Returns null when there is no selection or the endpoint's page is not visible.
   */
  beginSelectionHandleDrag(
    edge: SelectionHandleEdge,
    origin: SelectionClientPoint,
  ): SelectionHandleDrag | null;

  /**
   * Whether interactive content sits under a client point, and which
   * kind — synchronously, with no side effect.
   *
   * A host that must decide on `pointerup` whether a gesture belongs to
   * the content or to the page turn cannot wait for the content events:
   * only `linkClick` is raised synchronously, `footnoteClick` waits for
   * the footnote read and `imageClick` for the image blob. Turning the
   * page first and undoing it later does not work either, because the
   * turn advances the content-interaction generation and the in-flight
   * image request is then disowned and revoked, so `imageClick` never
   * arrives at all.
   *
   * Answers from the same resolution the click dispatcher runs, so it
   * predicts which event a click would raise, and returns null when the
   * reader's interactions are disabled — no event would be raised then
   * either.
   */
  hitTestContent(point: ReaderClientPoint): ContentHitKind | null;

  /** Resolves once the engine has built the target; the selection is read at call time. */
  addAnnotation(input: AddAnnotationInput): Promise<AnnotationRecord | undefined>;
  removeAnnotation(id: string): boolean;
  updateAnnotation(id: string, patch: AnnotationRecordPatch): boolean;
  readonly annotations: readonly AnnotationRecord[];

  /** Restore a preloaded serialized position, or load it from positionStorage when omitted. */
  restorePosition(serialized?: string | null): Promise<number | undefined>;
  /** Rejects during action setup, an owned restore load, or an active adapter write. */
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
