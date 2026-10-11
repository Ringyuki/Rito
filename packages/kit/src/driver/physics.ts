import type { TransitionTouch } from './effects';

/** The viewport a turn crosses, CSS px: its width and where the pages are bound. */
export interface TransitionBounds {
  readonly width: number;
  readonly spine: number;
}

/**
 * A turn at the moment its finger lets go: where the turn is (`dx`, CSS px,
 * negative toward the next spread), how fast the finger was carrying it
 * (`velocity`, CSS px per second), the viewport width, which way it turns
 * and the finger itself. `from` is where the turn was when the finger took
 * it: 0 unless it began from what a turn in flight had left, so `dx - from`
 * is how far the finger carried it.
 */
export interface TransitionRelease {
  readonly dx: number;
  readonly from: number;
  readonly velocity: number;
  readonly width: number;
  readonly direction: 'forward' | 'backward';
  readonly touch: TransitionTouch | null;
}

/**
 * What a turn that cuts into another finds: where the picture is (`dx`, CSS
 * px, in the coordinates the turn cut into left: its page was this far short
 * of rest), how fast it moves (CSS px per second), the viewport width, which
 * way the turn beginning goes, and whether it is between the same two
 * spreads as the turn cut into: the same page, turned again.
 */
export interface TransitionLeftover {
  readonly dx: number;
  readonly velocity: number;
  readonly width: number;
  readonly direction: 'forward' | 'backward';
  readonly sameSpreads: boolean;
}

/**
 * The motion of a turn nothing holds: where it is `seconds` after it was
 * let go, how fast, and whether it has come to rest. A turn left alone
 * stays on screen until it is done.
 */
export type TransitionSettle = (seconds: number) => {
  readonly x: number;
  readonly velocity: number;
  readonly done: boolean;
};

/**
 * How a turn moves. Every part is optional and falls back to the built-in
 * rule. Lengths are CSS px, points are from the display canvas's top-left
 * corner, velocities per second.
 */
export interface TransitionPhysics {
  /**
   * How far a finger has carried the turn since it took hold: negative
   * toward the next spread, one viewport width for a whole turn. The way a
   * drag first moves is the way it turns.
   */
  travel?(touch: TransitionTouch, bounds: TransitionBounds): number;
  /** Where a pull of `travel` leaves the page when no neighbour lies that way. */
  resist?(travel: number, width: number): number;
  /** Whether a turn let go turns the page; otherwise it goes back. */
  lands?(release: TransitionRelease): boolean;
  /** The motion from `from` at `velocity` to `to`: a viewport width away, or 0. */
  settle?(from: number, velocity: number, to: number): TransitionSettle;
  /**
   * Where a turn that cuts into another begins, and how fast. Left out, it
   * begins where the picture is and as fast, so nothing jumps. Physics that
   * answer otherwise leave what was left of the other turn to their effect:
   * the frames that follow are of the new turn alone.
   */
  begins?(leftover: TransitionLeftover): { readonly dx: number; readonly velocity: number };
}

/** The built-in travel: a finger carries the turn as far as it has moved sideways. */
export function travelOf(
  physics: TransitionPhysics | undefined,
  touch: TransitionTouch,
  bounds: TransitionBounds,
): number {
  return physics?.travel?.(touch, bounds) ?? touch.position.x - touch.origin.x;
}
