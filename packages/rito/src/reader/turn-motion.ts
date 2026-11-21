/**
 * The numbers the built-in rules of a page turn's motion go by: the spring
 * that carries a turn to rest (stiffness 1/s², damping 1/s), how far a
 * release must go (px, after its velocity is projected over `projection`
 * seconds) or how fast (px/s) to turn the page, how fast a finger pulling
 * the turn back (px/s) leaves the page, and how hard a pull against the
 * first or last page resists (0 to 1).
 */
export interface TurnMotionPhysics {
  readonly stiffness: number;
  readonly damping: number;
  readonly swipeThreshold: number;
  readonly velocityCommit: number;
  readonly projection: number;
  readonly pullBack: number;
  readonly elasticFactor: number;
}

/**
 * `dragging` while a finger holds the turn, `settling` while it goes to
 * the neighbour or back by itself, `finishing` for what is left of a turn
 * another cut into, which goes the rest of the way to rest.
 */
export type TurnMotionPhase = 'idle' | 'dragging' | 'settling' | 'finishing';

/**
 * Where a turn is and what moves it. Offsets are px, negative toward the
 * next page; velocities px/s (`velocity` is 0 while a finger holds the
 * turn). `leaving` is what the turn it began from left in the frame (`none`
 * for a pull against the end of the book; null when it began at rest).
 * `settle` names the latest motion started, which a host carrying it with
 * physics of its own starts its own from.
 */
export interface TurnMotionState {
  readonly phase: TurnMotionPhase;
  readonly forward: boolean;
  readonly hasIncoming: boolean;
  readonly offset: number;
  readonly velocity: number;
  readonly target: number;
  readonly from: number;
  readonly fingerVelocity: number;
  readonly elapsed: number;
  readonly showing: 'next' | 'prev' | null;
  readonly onFarSide: boolean;
  readonly committing: boolean;
  readonly landing: boolean;
  readonly leaving: 'next' | 'prev' | 'none' | null;
  readonly settle: {
    readonly generation: number;
    readonly from: number;
    readonly velocity: number;
    readonly to: number;
  };
  /** What is added to the motion carrying what is left of a turn that was cut into. */
  readonly shift: number;
}

/**
 * What a step did: nothing moves (`still`), it moves on, the turn came to
 * rest on the neighbour (`committed`) or back where it began (`cancelled`),
 * or what was left of a turn that was cut into came to rest (`rested`).
 */
export type TurnMotionStep = 'still' | 'moving' | 'committed' | 'cancelled' | 'rested';

/** Where physics of the host's own begin a turn that cuts into another, px and px/s. */
export interface TurnMotionBegin {
  readonly offset: number;
  readonly velocity: number;
}

/** Where a motion the host carries on is, how fast it goes, and whether it is at rest. */
export interface TurnMotionAt {
  readonly x: number;
  readonly velocity: number;
  readonly done: boolean;
}

/**
 * The engine's motion of one page turn, the same on every host to the bit:
 * the finger while it holds the turn, the release that decides it, the
 * spring that carries it to rest, a pull against the end of the book, and
 * a turn cut into by another, whose picture carries on (`carryOn`) for the
 * turn that cuts in to begin from. Wherever the built-in rules decide, the
 * host may answer with physics of its own instead: `dragCarried`, the
 * `lands` of `release`, a `begin`, and a motion it carries itself (`step`'s
 * `host`, at every step of it from the first; without it the spring carries
 * the motion). Times of a finger are ms, a step's seconds.
 */
export interface TurnMotion {
  readonly state: TurnMotionState;
  configure(physics: TurnMotionPhysics, width: number): void;
  startDrag(forward: boolean, hasIncoming: boolean, at: number, begin?: TurnMotionBegin): void;
  /** Follows a finger that has carried the turn `travel` px; a pull with no neighbour stretches. */
  drag(travel: number, at: number): void;
  /** Follows a finger whose travel the host's physics made `carried` px of turn. */
  dragCarried(carried: number, at: number): void;
  /** Lets go; true when the page turns. `lands` is the host's physics' answer. */
  release(lands?: boolean): boolean;
  cancel(): boolean;
  turn(forward: boolean, begin?: TurnMotionBegin): void;
  interrupt(at: number): boolean;
  carryOn(committed: boolean): void;
  /** Moves the turn on; `host` is where the host's motion is then, while it carries one. */
  step(seconds: number, host?: TurnMotionAt, instant?: boolean): TurnMotionStep;
  finish(): void;
  reset(): void;
  /** Lets the engine's memory for the motion go. */
  dispose(): void;
}

export type TurnMotionFactory = (physics: TurnMotionPhysics) => TurnMotion;

let loaded: TurnMotionFactory | undefined;

/**
 * Makes turn motions on the engine, once the engine is loaded: a reader
 * has opened, or `loadTurnMotion` has resolved. Undefined before.
 */
export function loadedTurnMotion(): TurnMotionFactory | undefined {
  return loaded;
}

/** Called by the binding once the engine can make motions. */
export function registerTurnMotion(factory: TurnMotionFactory): void {
  loaded = factory;
}

/** Makes turn motions on the engine, loading it first. */
export async function loadTurnMotion(): Promise<TurnMotionFactory> {
  const binding = await import('../bindings/browser/turn-motion');
  return binding.loadTurnMotion();
}
