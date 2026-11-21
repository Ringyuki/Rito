/**
 * The engine's page turns of a reader (`crates/rito-turn`, bound as
 * `RitoTurnController`), in the layouts `rito_turn::turn_controller_pack`
 * gives every host: what the host knows of the pages in, each action and
 * the controller's state out.
 */
export interface RitoRawTurnController {
  configure(physics: Float64Array, width: number, instant: boolean): void;
  fingerDown(pages: Float64Array, x: number, y: number, at: number): void;
  /** `resisted`: the host's physics' stretch of `travel`, NaN for the built-in. */
  fingerMove(
    pages: Float64Array,
    x: number,
    y: number,
    travel: number,
    resisted: number,
    at: number,
  ): void;
  fingerUp(pages: Float64Array, x: number, y: number, travel: number, at: number): void;
  fingerCancel(pages: Float64Array): void;
  command(pages: Float64Array, direction: number): boolean;
  playJump(pages: Float64Array, direction: number): void;
  landed(pages: Float64Array, ok: boolean): void;
  pages(pages: Float64Array): void;
  overdue(pages: Float64Array): void;
  interrupt(): void;
  settleNow(): void;
  step(pages: Float64Array, seconds: number, hostAt: Float64Array): void;
  answerBegin(begin: Float64Array): void;
  answerLands(lands: number): void;
  takeAction(out: Float64Array): void;
  state(out: Float64Array): void;
  free(): void;
}

export type RitoTurnControllerClass = (new (physics: Float64Array) => RitoRawTurnController) & {
  /** How many numbers each layout is: pages, action, state. */
  layouts(): Uint32Array;
};
