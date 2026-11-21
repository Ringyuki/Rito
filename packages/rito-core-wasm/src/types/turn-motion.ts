/**
 * The engine's motion of a page turn (`crates/rito-turn`, bound as
 * `RitoTurnMotion`): the finger while it holds the turn, the release, the
 * spring and a turn cut into by another, in the layouts
 * `rito_turn::turn_pack` gives every host. Where the host's own physics
 * decide, it passes their answer; otherwise the built-in rules do.
 */
export interface RitoRawTurnMotion {
  configure(physics: Float64Array, width: number, hostSettles: boolean): void;
  /** `begin`: offset and velocity where the host's physics begin a cut-in turn; empty for the built-in rule. */
  startDrag(forward: boolean, hasIncoming: boolean, at: number, begin: Float64Array): void;
  /** `carried`: `travel` is the turn the host's physics made of the finger's travel. */
  drag(travel: number, at: number, carried: boolean): void;
  /** `lands`: 1 or 0 the host's physics' answer, -1 the built-in rule's. */
  release(lands: number): boolean;
  cancel(): boolean;
  turn(forward: boolean, begin: Float64Array): void;
  interrupt(at: number): boolean;
  carryOn(committed: boolean): void;
  /** `hostAt`: x, velocity, done (1/0) while the host carries the motion, else empty. */
  step(seconds: number, hostAt: Float64Array, instant: boolean): number;
  finish(): void;
  reset(): void;
  state(out: Float64Array): void;
  free(): void;
}

export type RitoTurnMotionClass = (new (physics: Float64Array) => RitoRawTurnMotion) & {
  /** How many numbers each layout is: physics, state, a place. */
  layouts(): Uint32Array;
};
