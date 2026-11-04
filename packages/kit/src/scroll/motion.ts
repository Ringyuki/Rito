import type { ScrollPhysics, ScrollSimulation } from './physics';

/**
 * The strip's offset over time, in device pixels: still, dragged (its raw
 * offset, before the physics resists it past an end), or following a
 * simulation from the time it started.
 */
export interface ScrollMotion {
  /** Where the strip is shown. */
  readonly offset: number;
  /** Whether it moves on its own. */
  readonly moving: boolean;
  /** Puts the strip at `offset`, still. */
  place(offset: number): void;
  grab(): void;
  follow(delta: number): void;
  release(velocity: number, now: number): void;
  /** Glides to `offset` from where the strip is. */
  glide(simulation: ScrollSimulation, now: number): void;
  /** Advances what moves the strip to `now`; false once it rests. */
  step(now: number): boolean;
  /** The book is now `max` long along a viewport `viewport` long. */
  bound(max: number, viewport: number): void;
}

export function createScrollMotion(physics: ScrollPhysics): ScrollMotion {
  let shown = 0;
  let raw: number | undefined;
  let simulation: { readonly run: ScrollSimulation; readonly from: number } | undefined;
  let max = 0;
  let viewport = 1;
  return {
    get offset() {
      return shown;
    },
    get moving() {
      return simulation !== undefined;
    },
    place(offset) {
      simulation = undefined;
      raw = undefined;
      shown = Math.min(Math.max(offset, 0), max);
    },
    grab() {
      simulation = undefined;
      raw = shown;
    },
    follow(delta) {
      raw = (raw ?? shown) + delta;
      shown = physics.drag(raw, max, viewport);
    },
    release(velocity, now) {
      raw = undefined;
      simulation = { run: physics.release(shown, velocity, max), from: now };
    },
    glide(run, now) {
      raw = undefined;
      simulation = { run, from: now };
    },
    step(now) {
      if (simulation === undefined) return false;
      const at = simulation.run((now - simulation.from) / 1000);
      shown = at.offset;
      if (at.done) simulation = undefined;
      return simulation !== undefined;
    },
    bound(nextMax, nextViewport) {
      max = Math.max(0, nextMax);
      viewport = Math.max(1, nextViewport);
      if (simulation === undefined && raw === undefined) shown = Math.min(Math.max(shown, 0), max);
    },
  };
}
