import type {
  PackageMetadata,
  ReaderFontCatalog,
  ReaderHostFontFace,
  ReaderDocumentSourceSpan,
  ReaderExactSourceRangeRequest,
  ReaderLocator,
  Spread,
  TocEntry,
} from '@ritojs/core';
import type { Reader } from '@ritojs/core';
import type {
  AnnotationRecord,
  AnnotationRecordPatch,
  Rect,
  RecordStorageAdapter,
} from '../interaction/index';
import type { ReadingPosition } from '../interaction/index';
import type { SearchOptions, SearchResult } from '../interaction/index';
import type { TransitionDriverOptions } from '../driver/types';
import type { PositionStorageAdapter } from '../storage/types';
import type { KeyboardManager } from '../keyboard/types';
import type { TypedEmitter } from '../utils/event-emitter';
import type { ReaderControllerEvents } from './events';
import type { PagePainter } from './page-paint';
import type { HighlightColors } from './overlay/colors';

export type { ReaderControllerEvents };

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

export interface ControllerOptions {
  readonly transition?: Partial<TransitionDriverOptions> | undefined;
  /** Initial display scale applied before the first canvas mount/render. */
  readonly renderScale?: number | undefined;
  /** Storage adapter for source-anchored annotation records. */
  readonly annotationStorage?: RecordStorageAdapter | undefined;
  readonly positionStorage?: PositionStorageAdapter | undefined;
  /** Accessibility mirror configuration (opt-in). */
  readonly a11y?: { readonly enabled?: boolean; readonly container?: HTMLElement } | undefined;
  /** Draws over each page as part of it (a page number, say): it moves with the page in turns. */
  readonly paintPage?: PagePainter | undefined;
  /** Colours for selection, search and annotations; the rest keep kit's own. */
  readonly highlightColors?: Partial<HighlightColors> | undefined;
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
  /** Book-wide navigation records, indexed by spread; empty until the whole book first commits. */
  readonly spreads: readonly Spread[];
  readonly currentSpread: number;
  /** Book-wide spread count; 0 until the whole book's layout first commits. */
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
  /** Paints every page again, `paintPage` included, for when what it draws has changed. */
  repaintPages(): void;
  /** Paints selection, search and annotations in the colours given; the others are kept. */
  setHighlightColors(colors: Partial<HighlightColors>): void;
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

  /**
   * Every family a `font-family` choice can name in the open book: the
   * host's faces by their family, then the book's own. Build font choices
   * from it; `setTypography({ fontFamily })` reports names no face answers
   * to as an `error` event with source `font-family`.
   */
  fonts(): Promise<ReaderFontCatalog>;
  /** The names in a CSS `font-family` list no family answers to. */
  unresolvedFontFamilies(familyList: string): Promise<readonly string[]>;
  /**
   * Adds host faces (a system font, one the reader imported) and lays the
   * book out again; a face is then named by its family in `setTypography`.
   */
  addFontFaces(faces: readonly ReaderHostFontFace[]): Promise<void>;
  /** Removes host faces by SHA-256 and lays the book out again. */
  removeFontFaces(sha256s: readonly string[]): Promise<void>;

  /** Set render scale (e.g. for font zoom). Canvas display size = viewport × scale. */
  setRenderScale(scale: number): void;
  readonly renderScale: number;

  /** Searches the whole book; `options` matches case or whole words only, as the engine does. */
  search(query: string, options?: SearchOptions): void;
  searchNext(): SearchResult | undefined;
  searchPrev(): SearchResult | undefined;
  /** Navigate to a specific search result by index (sets active + jumps to page). */
  goToSearchResult(index: number): void;
  clearSearch(): void;
  readonly searchResults: readonly SearchResult[];
  readonly searchActiveIndex: number;

  clearSelection(): void;
  /**
   * Selects a source range as a reader's drag would, raising
   * `selectionChange`. Resolves `true` once it is the selection; `false`
   * when none of it is on the spread shown, the engine cannot place it, or
   * a turn, a relayout, a later call or the reader's own selecting came
   * first.
   */
  selectRange(range: ReaderExactSourceRangeRequest): Promise<boolean>;
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
   * only `linkClick` and `annotationClick` are raised synchronously,
   * `footnoteClick` waits for the footnote read and `imageClick` for its
   * blob. Turning the page first and undoing it later does not work
   * either, because the turn advances the content-interaction generation
   * and the in-flight image request is then disowned and revoked, so
   * `imageClick` never arrives at all.
   *
   * Answers from the same resolution the click dispatcher runs, so it
   * predicts which event a click would raise, and returns null when the
   * reader's interactions are disabled — no event would be raised then
   * either.
   */
  hitTestContent(point: ReaderClientPoint): ContentHitKind | null;

  /**
   * Where a source range is on screen: its rects on the pages shown, in
   * screen coordinates like `annotationClick.screenBounds`. Empty when none
   * of it is shown or the engine cannot place it.
   */
  rangeRects(range: ReaderExactSourceRangeRequest): Promise<readonly Rect[]>;

  /** Resolves once the engine has built the target; the selection is read at call time. */
  addAnnotation(input: AddAnnotationInput): Promise<AnnotationRecord | undefined>;
  /**
   * Stores a whole record as given (its id, colour, note and timestamps), as
   * when undoing a removal or an edit: over the stored record with its id, in
   * that one's place, or else in creation order, which is paint order. Persisted
   * like any change; false once the controller is disposed.
   */
  insertAnnotation(record: AnnotationRecord): boolean;
  removeAnnotation(id: string): boolean;
  updateAnnotation(id: string, patch: AnnotationRecordPatch): boolean;
  readonly annotations: readonly AnnotationRecord[];

  /** The position last published by `positionChange` (a beat after its spread); null before. */
  readonly position: ReadingPosition | null;
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
