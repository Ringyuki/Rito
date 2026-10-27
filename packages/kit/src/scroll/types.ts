import type { ReaderInteractionTarget, ReaderLocator, ReaderTextRange } from '@ritojs/core';
import type { HighlightColors } from '../controller/overlay/colors';
import type { Rect } from '../interaction/layout-types';
import type { ScrollHighlight } from './highlights';
import type { ScrollPoint } from './hit';
import type { ScrollPhysics } from './physics';

export interface ScrollControllerOptions {
  /** How the strip moves under a finger and after it: the built-in browser-like physics by default. */
  readonly physics?: ScrollPhysics | undefined;
  /**
   * Whether the built-in wheel, touch and key input drives the strip
   * (default true). An app that drives it itself, through `grab`, `follow`,
   * `release`, `scrollTo` and `scrollBy`, turns it off.
   */
  readonly input?: boolean | undefined;
  /**
   * Whether the view selects text (default true): the built-in input's
   * mouse drag selects, and what is selected is drawn over the windows.
   */
  readonly selection?: boolean | undefined;
  /** The colours the selection is drawn in, the kit's own by default. */
  readonly colors?: Partial<HighlightColors> | undefined;
  /**
   * A hidden mirror of the text on screen for screen readers, put in
   * `container` (beside the view by default) once the strip rests; a link
   * activated in it taps its target.
   */
  readonly a11y?: { readonly enabled?: boolean; readonly container?: HTMLElement } | undefined;
}

/** Offsets are CSS pixels along the scroll axis from the book's block start. */
export interface ScrollControllerEvents {
  /**
   * The strip moved: where it is, the book's length and the view's along
   * the axis, and how far through the book it is, from 0 at the start to 1
   * with the book's end at the view's.
   */
  scroll: {
    readonly offset: number;
    readonly extent: number;
    readonly viewport: number;
    readonly progress: number;
  };
  /** The window under the reading line changed: the reader moved on to it. */
  window: { readonly spreadIndex: number };
  /** The strip came to rest. */
  rest: { readonly offset: number };
  /** Where the reader reads once the strip rests: the line at the reading line. */
  position: { readonly locator: ReaderLocator };
  /** The built-in input's tap: the point, and the link, note or image under it. */
  tap: { readonly point: ScrollPoint; readonly target: ReaderInteractionTarget | undefined };
  /**
   * What is selected changed, as a gesture selects it and once it has:
   * the range and its text, and its rects where the view shows them (CSS
   * pixels from the view's top-left corner; see `selectionRects` once the
   * strip moves).
   */
  selection: {
    readonly range: ReaderTextRange | null;
    readonly text: string;
    readonly selecting: boolean;
    readonly rects: readonly Rect[];
  };
}

/**
 * A scrolled reader's view: the book's windows end to end, down the screen
 * or leftwards, moved by its own physics on one canvas. It keeps each
 * window's picture while it is near and tells the reader which window is
 * under the reading line; how the strip moves is the app's to replace.
 */
export interface ScrollController {
  /** Puts the canvas in `container`. */
  mount(container: HTMLElement): void;
  /** The book's axis; undefined until a scrolled layout is committed. */
  readonly axis: 'down' | 'left' | undefined;
  /** Where the strip is, in CSS pixels from the book's block start. */
  readonly offset: number;
  /** The whole book's length along the axis, in CSS pixels. */
  readonly extent: number;
  /** The window under the reading line. */
  readonly currentSpread: number;
  /** Moves the strip to `offset`, gliding there when `animate`. */
  scrollTo(offset: number, options?: { readonly animate?: boolean }): void;
  scrollBy(delta: number, options?: { readonly animate?: boolean }): void;
  /** Shows window `spreadIndex` from `blockOffset` into it at the reading line. */
  scrollToSpread(spreadIndex: number, blockOffset?: number): void;
  /**
   * Puts the line `locator` lands on at the reading line, its window's top
   * when it names no line; false when the locator lands nowhere.
   */
  scrollToLocator(locator: ReaderLocator): Promise<boolean>;
  /** The point under view coordinates `x`, `y` (CSS pixels from the view's top-left corner). */
  pointAt(x: number, y: number): ScrollPoint | undefined;
  /** The link, note or image at a point, if any. */
  targetAt(point: ScrollPoint): Promise<ReaderInteractionTarget | undefined>;
  /** What is selected, if anything. */
  readonly selection: ReaderTextRange | null;
  /** The selection's rects where the view shows them now, in CSS pixels from its top-left corner. */
  selectionRects(): readonly Rect[];
  clearSelection(): void;
  /**
   * What the app highlights over the text, in place of what it highlighted
   * before: a search's matches, a book's annotations. Each is drawn over
   * the windows that show its pages, above the selection.
   */
  setHighlights(highlights: readonly ScrollHighlight[]): void;
  /** A finger takes the strip: what it was gliding through stops. */
  grab(): void;
  /** The finger moved the strip on by `delta`. */
  follow(delta: number): void;
  /** The finger let go at `velocity` (CSS pixels a second, forward positive). */
  release(velocity: number): void;
  on<K extends keyof ScrollControllerEvents>(
    event: K,
    listener: (data: ScrollControllerEvents[K]) => void,
  ): () => void;
  dispose(): void;
}
