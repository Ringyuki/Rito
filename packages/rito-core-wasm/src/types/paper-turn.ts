/**
 * The engine's model of the paper page turn (`crates/rito-turn`, bound as
 * `RitoPaperTurn`): a frame's numbers in, each sheet's numbers and points
 * out, in the layouts `rito_turn::pack` gives every host.
 */
export interface RitoRawPaperTurn {
  /** Reads a frame's numbers: 0 when no leaf turns, 1 for a leaf's turn. */
  begin(input: Float64Array): number;
  readonly spread: number;
  readonly anew: boolean;
  forgottenLeaves(): Uint32Array;
  forgottenRelease(): boolean;
  lay(epoch: number): boolean;
  readonly led: number;
  ledPages(out: Float64Array): void;
  leftBook(): Uint32Array;
  readonly columns: number;
  readonly rows: number;
  sheetCount(): number;
  sheet(index: number, out: Float64Array): void;
  points(index: number, positions: Float32Array, normals: Float32Array): void;
  forget(epoch: number): void;
  readonly painted: number;
  readonly there: boolean;
  readonly gone: boolean;
  aloft(now: number): boolean;
  begins(dx: number, velocity: number, sameSpreads: boolean, out: Float64Array): void;
  settle(from: number, velocity: number, to: number, out: Float64Array): void;
  settleStep(state: Float64Array, seconds: number, now: number, out: Float64Array): void;
  /** The numbers the model's turns move by from now on (`rito_turn::pack::read_paper_motion`). */
  configure(motion: Float64Array): void;
  /** Whether a turn let go turns the page, by the model's numbers. */
  lands(release: Float64Array): boolean;
  free(): void;
}

export type RitoPaperTurnClass = (new () => RitoRawPaperTurn) & {
  travel(touch: Float64Array, width: number, spine: number): number;
  eyeHeight(width: number, height: number): number;
  /** Writes the numbers paper turns with by default. */
  defaultMotion(out: Float64Array): void;
  /** How many numbers each layout is: frame, sheet, release, settle, motion. */
  layouts(): Uint32Array;
};
