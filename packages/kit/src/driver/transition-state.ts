import { resolveTransitionEffect, transitionEffects, type TransitionEffect } from './effects';
import type { TransitionPhysics } from './physics';
import type { SettledEvent, TransitionDriverOptions, TransitionMode } from './types';
import type { VelocitySample } from './transition-velocity';

export interface TransitionDriverState {
  opts: TransitionDriverOptions;
  mode: TransitionMode;
  viewportWidth: number;
  /** Where the pages are bound, as an x in the viewport. */
  spine: number;
  /** The system asks for reduced motion (set by the host environment). */
  reducedMotion: boolean;
  velocitySamples: VelocitySample[];
  readonly settledListeners: Set<(event: SettledEvent) => void>;
}

/** How turns look now: the configured effect, or a cross-fade under reduced motion. */
export function activeEffect(state: TransitionDriverState): TransitionEffect {
  if (state.reducedMotion && state.opts.respectReducedMotion) return transitionEffects.fade;
  return resolveTransitionEffect(state.opts.effect);
}

/** How turns move now: the options' physics, else the ones the effect brings. */
export function activePhysics(state: TransitionDriverState): TransitionPhysics | undefined {
  return state.opts.physics ?? activeEffect(state).physics;
}
