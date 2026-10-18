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
  /** The display's context an effect is prepared with; null where nothing is displayed. */
  readonly gl: WebGL2RenderingContext | null;
  velocitySamples: VelocitySample[];
  readonly settledListeners: Set<(event: SettledEvent) => void>;
  readonly restListeners: Set<() => void>;
}

/** How turns look now: the configured effect, or a cross-fade under reduced motion. */
export function activeEffect(state: TransitionDriverState): TransitionEffect {
  if (state.reducedMotion && state.opts.respectReducedMotion) return transitionEffects.fade;
  return resolveTransitionEffect(state.opts.effect);
}

/** Tells the configured effect it has been set, for whatever it does ahead of its first turn. */
export function prepareEffect(state: TransitionDriverState): void {
  if (state.gl) resolveTransitionEffect(state.opts.effect).prepare?.(state.gl);
}

/** How turns move now: the options' physics, else the ones the effect brings. */
export function activePhysics(state: TransitionDriverState): TransitionPhysics | undefined {
  return state.opts.physics ?? activeEffect(state).physics;
}
