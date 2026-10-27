import type { ReaderInteractionTarget, ReaderLocator } from '@ritojs/core';
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
}

/** Offsets are CSS pixels along the scroll axis from the book's block start. */
export interface ScrollControllerEvents {
  /** The strip moved. */
  scroll: { readonly offset: number; readonly extent: number };
  /** The window under the reading line changed: the reader moved on to it. */
  window: { readonly spreadIndex: number };
  /** The strip came to rest. */
  rest: { readonly offset: number };
  /** Where the reader reads once the strip rests: the line at the reading line. */
  position: { readonly locator: ReaderLocator };
  /** The built-in input's tap: the point, and the link, note or image under it. */
  tap: { readonly point: ScrollPoint; readonly target: ReaderInteractionTarget | undefined };
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
