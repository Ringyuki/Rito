import type {
  TurnMotionAt,
  TurnMotionBegin,
  TurnMotionPhysics,
  TurnMotionState,
} from './turn-motion';

/** The way a turn goes. */
export type TurnDirection = 'next' | 'previous';

/** One thing for each way. */
export interface TurnSides {
  readonly next: boolean;
  readonly previous: boolean;
}

/**
 * What the host knows of the pages beside the one shown, as it tells the
 * controller anything: whether a page lies that way, whether it is in its
 * slot, whether the effect can draw a turn that way now, and whether a page
 * lies beyond the one the turn on screen brings in.
 */
export interface TurnPages {
  readonly canTurn: TurnSides;
  readonly there: TurnSides;
  readonly drawable: TurnSides;
  readonly beyond: TurnSides;
}

/**
 * What the host is to do: say a turn began or ended (`carries`: its picture
 * goes on moving, the page it left beside the page it landed on), land a
 * turn on the reader and tell `landed`, bring a page into its slot and tell
 * `pages`, wait for the effect and tell `overdue`, or let go of the page
 * what was left of a turn left in the frame (`rested`).
 */
export type TurnAction =
  | { readonly kind: 'started'; readonly direction: TurnDirection }
  | {
      readonly kind: 'ended';
      readonly direction: TurnDirection;
      readonly outcome: 'committed' | 'cancelled' | 'interrupted';
      readonly carries: boolean;
    }
  | { readonly kind: 'land'; readonly direction: TurnDirection }
  | { readonly kind: 'fetch'; readonly direction: TurnDirection }
  | { readonly kind: 'wait-for-effect'; readonly seconds: number }
  | { readonly kind: 'rested' };

/**
 * What the controller asks of physics of the host's own, waiting for the
 * answer before it does anything else: where a turn that cuts in begins
 * (`answerBegin`), or whether a release turns the page (`answerLands`).
 */
export type TurnRequest =
  | {
      readonly kind: 'begin';
      readonly leftover: {
        readonly offset: number;
        readonly velocity: number;
        readonly leaving: 'next' | 'prev' | 'none';
      };
      readonly forward: boolean;
      readonly hasIncoming: boolean;
    }
  | {
      readonly kind: 'lands';
      readonly release: {
        readonly offset: number;
        readonly from: number;
        readonly velocity: number;
        readonly width: number;
        readonly forward: boolean;
      };
    };

/** A point of the frame a turn is drawn in. */
export interface TurnPoint {
  readonly x: number;
  readonly y: number;
}

/** What a frame of what is on screen shows. */
export interface TurnFrameState {
  readonly offset: number;
  readonly incoming: 'next' | 'prev' | null;
  readonly phase: 'held' | 'landing' | 'returning';
  readonly velocity: number;
  readonly touch: {
    readonly origin: TurnPoint;
    readonly position: TurnPoint;
    readonly farthest: TurnPoint;
  } | null;
}

export interface TurnControllerState {
  /** The turn on screen; null when none is. */
  readonly turning: TurnDirection | null;
  /** Whether anything is on screen: a turn, a pull, or what is left of one. */
  readonly moving: boolean;
  /** Whether a finger holds the page. */
  readonly held: boolean;
  readonly request: TurnRequest | null;
  /** The frame to paint; null with nothing on screen. */
  readonly frame: TurnFrameState | null;
  readonly motion: TurnMotionState;
}

/**
 * The engine's page turns of a reader, the same on every host: when a turn
 * begins, lands and ends, what a finger, a key or a jump does to one on
 * screen, and a turn waiting for its page. The host tells it what happens,
 * each time with what it knows of the pages, takes its actions
 * (`takeAction`, until null) and answers its `request` before anything else.
 * A finger's times are ms, a step's seconds.
 */
export interface TurnController {
  readonly state: TurnControllerState;
  configure(physics: TurnMotionPhysics, width: number, instant: boolean): void;
  fingerDown(pages: TurnPages, x: number, y: number, at: number): void;
  /** `resisted`: what physics of the host's own make of `travel` against the end of the book. */
  fingerMove(
    pages: TurnPages,
    x: number,
    y: number,
    travel: number,
    resisted: number | undefined,
    at: number,
  ): void;
  fingerUp(pages: TurnPages, x: number, y: number, travel: number, at: number): void;
  fingerCancel(pages: TurnPages): void;
  /** Turns to the neighbour; false at the end of the book or while a finger holds the page. */
  command(pages: TurnPages, direction: TurnDirection): boolean;
  /** A jump the reader has made, played as a turn from the page it left. */
  playJump(pages: TurnPages, direction: TurnDirection): void;
  landed(pages: TurnPages, ok: boolean): void;
  pages(pages: TurnPages): void;
  overdue(pages: TurnPages): void;
  /** Something else moved the reader: what is on screen ends interrupted. */
  interrupt(): void;
  /** Something asked of the reader directly: what is on screen ends at once where it was going. */
  settleNow(): void;
  /** `host`: where the host's physics' motion is, while it carries one, from its first step. */
  step(pages: TurnPages, seconds: number, host?: TurnMotionAt): void;
  answerBegin(begin?: TurnMotionBegin): void;
  answerLands(lands?: boolean): void;
  takeAction(): TurnAction | null;
  dispose(): void;
}

export type TurnControllerFactory = (physics: TurnMotionPhysics) => TurnController;

let loaded: TurnControllerFactory | undefined;

/**
 * Makes the page turns of a reader on the engine, once the engine is
 * loaded: a reader has opened, or `loadTurnMotion` has resolved.
 */
export function loadedTurnController(): TurnControllerFactory | undefined {
  return loaded;
}

/** Called by the binding once the engine can make controllers. */
export function registerTurnController(factory: TurnControllerFactory): void {
  loaded = factory;
}
