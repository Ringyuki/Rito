/** A point of the frame a turn is drawn in, from its top-left corner. */
export interface PaperTurnPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The finger that moved a turn: where it took hold, where it is (or let
 * go), and where it was when it had carried the turn farthest (where it is,
 * left out).
 */
export interface PaperTurnTouch {
  readonly origin: PaperTurnPoint;
  readonly position: PaperTurnPoint;
  readonly farthest?: PaperTurnPoint;
}

/**
 * A page a turn may show: the spread printed on it, and the host's number
 * for the buffer it is painted in, the same while that buffer is repainted.
 */
export interface PaperTurnPage {
  readonly spread: number;
  readonly buffer: number;
}

/**
 * One frame of a turn: the frame's size in the units it is drawn in, where
 * the pages are bound (0 with one page a spread) and how many units a CSS
 * px is; how far the turn has gone (`dx`, negative turning forward), which
 * neighbour comes in, what moves it and the finger that moved it; the page
 * shown and the incoming one; the time in ms and the host's GPU context.
 */
export interface PaperTurnFrame {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  readonly cssPixel: number;
  readonly dx: number;
  readonly incoming: 'next' | 'prev' | null;
  readonly phase: 'held' | 'landing' | 'returning';
  readonly touch: PaperTurnTouch | null;
  readonly current: PaperTurnPage | null;
  readonly incomingPage: PaperTurnPage | null;
  readonly now: number;
  readonly epoch: number;
}

/** Leaves forgotten: the host lets their pages go when `release` says they are still its own. */
export interface PaperTurnForgotten {
  readonly leaves: readonly number[];
  readonly release: boolean;
}

/**
 * A frame read: no leaf turns (`shown`, the page shown drawn where the turn
 * has it), or the turn of the leaf printed with `spread`, `anew` when what
 * was remembered was of another moment.
 */
export type PaperTurnBegun =
  | { readonly kind: 'shown'; readonly forgotten: PaperTurnForgotten }
  | {
      readonly kind: 'turn';
      readonly spread: number;
      readonly anew: boolean;
      readonly forgotten: PaperTurnForgotten;
    };

/**
 * A frame laid out: the led leaf and the pages it shows now (which the host
 * takes anew), the leaves that left the book (whose pages it lets go), and
 * the grid and number of its sheets.
 */
export interface PaperTurnLaid {
  readonly led: number;
  readonly front: PaperTurnPage | null;
  readonly after: PaperTurnPage | null;
  readonly leftBook: readonly number[];
  readonly columns: number;
  readonly rows: number;
  readonly sheets: number;
}

/** The page a face of a sheet shows: a leaf's front or the page after it. */
export interface PaperTurnFace {
  readonly leaf: number;
  readonly page: 'front' | 'after';
}

/** A page curled over: the direction it rolls back from, the line it leaves the page at, its radius. */
export interface PaperTurnCurl {
  readonly dx: number;
  readonly dy: number;
  readonly at: number;
  readonly radius: number;
}

/**
 * A sheet of a frame: what its faces show, how far over it is (0 lying
 * right, 1 lying left), and its curl. A sheet lying still has the same
 * points every frame until they are laid out anew: `still` names them then,
 * and is null for a sheet that moves.
 */
export interface PaperTurnSheet {
  readonly front: PaperTurnFace | null;
  readonly back: PaperTurnFace | null;
  readonly shown: number;
  readonly still: number | null;
  readonly curl: PaperTurnCurl | null;
}

/** A turn at the moment its finger lets go, as the kit's `TransitionRelease` has it. */
export interface PaperTurnRelease {
  readonly dx: number;
  readonly from: number;
  readonly velocity: number;
  readonly width: number;
  readonly direction: 'forward' | 'backward';
  readonly touch: PaperTurnTouch | null;
  readonly spine?: number;
}

/** Where a settling turn is, how fast it moves, and whether it is done. */
export interface PaperTurnAt {
  readonly x: number;
  readonly velocity: number;
  readonly done: boolean;
}

/**
 * The paper page turn's motion and geometry, the engine's: frames in,
 * sheets out, the pages they show named by leaf. A host takes a frame in
 * two steps, deciding between them whether it draws paper at all: `begin`,
 * then `lay` and `sheet` for each sheet. Make one per reader.
 */
export interface PaperTurnModel {
  begin(frame: PaperTurnFrame): PaperTurnBegun;
  /** Moves the leaves of the frame `begin` read on and lays them out; null when none waits. */
  lay(epoch: number): PaperTurnLaid | null;
  /** A sheet of the frame laid out, from the front of the book to the back. */
  sheet(index: number): PaperTurnSheet;
  /** Copies a sheet's points into `positions` and `normals`, `columns·rows·3` each. */
  points(index: number, positions: Float32Array, normals: Float32Array): void;
  /** Nothing is in the air any more. */
  forget(epoch: number): PaperTurnForgotten;
  /** How many frames have been painted. */
  readonly painted: number;
  /** Whether the page the turn is of is where its turn takes it, the turn still on its way. */
  readonly there: boolean;
  /** Whether that page has left the frame for good. */
  readonly gone: boolean;
  /** Whether a leaf left to come down still counts at `now` (ms). */
  aloft(now: number): boolean;
  /** How far a finger has carried a turn, CSS px, in a frame `width` wide bound at `spine`. */
  travel(touch: PaperTurnTouch, width: number, spine: number): number;
  /** Whether a turn let go turns the page. */
  lands(release: PaperTurnRelease): boolean;
  /** Where a turn that cuts into another begins, and how fast. */
  begins(
    dx: number,
    velocity: number,
    sameSpreads: boolean,
  ): { readonly dx: number; readonly velocity: number };
  /** How a turn nothing holds goes from `from` at `velocity` to `to`: stepped once a frame. */
  settle(from: number, velocity: number, to: number): (seconds: number, now: number) => PaperTurnAt;
  /** How high the eye is over a frame of this size. */
  eyeHeight(width: number, height: number): number;
}

/** The engine's paper turn model, once the engine is loaded. */
export async function loadPaperTurnModel(): Promise<PaperTurnModel> {
  const binding = await import('../bindings/browser/paper-turn/model');
  return binding.loadPaperTurnModel();
}
