import {
  loadedTurnMotion,
  type TurnMotion,
  type TurnMotionPhysics,
  type TurnMotionState,
} from '@ritojs/core';

import { resolveTransitionEffect, transitionEffects, type TransitionEffect } from './effects';
import type { TransitionPhysics, TransitionSettle } from './physics';
import type { SettledEvent, TransitionDriverOptions } from './types';
import type { TransitionTouch } from './effects';

/** How long a release's velocity is projected over, seconds. */
const PROJECTION_SECONDS = 0.15;
/** A finger pulling a turn back faster than this (px/s) leaves the page. */
const PULL_BACK = 50;

/** What a turn is between: the host's side of it, which the engine's motion does not know. */
export interface TurnIdentity {
  readonly direction: 'forward' | 'backward';
  readonly outgoingSpread: number;
  readonly incomingSpread: number | null;
  touch: TransitionTouch | null;
  lastSampleAt: number;
}

export interface TransitionDriverState {
  opts: TransitionDriverOptions;
  viewportWidth: number;
  /** Where the pages are bound, as an x in the viewport. */
  spine: number;
  /** The system asks for reduced motion (set by the host environment). */
  reducedMotion: boolean;
  /** The display's context an effect is prepared with; null where nothing is displayed. */
  readonly gl: WebGL2RenderingContext | null;
  /** The engine's motion of the turn, made at the first turn. */
  motion: TurnMotion | null;
  /** The turn on screen, or the last one, whose leftover may still be moving. */
  turn: TurnIdentity | null;
  /** The physics' own motion carrying the turn, while they bring one. */
  settle: { readonly generation: number; readonly at: TransitionSettle } | null;
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

/** The numbers the engine's built-in rules go by: the options'. */
function physicsNumbers(opts: TransitionDriverOptions): TurnMotionPhysics {
  return {
    stiffness: opts.stiffness,
    damping: opts.damping,
    swipeThreshold: opts.swipeThreshold,
    // The options say px/ms, as a finger's samples are timed.
    velocityCommit: opts.velocityCommit * 1000,
    projection: PROJECTION_SECONDS,
    pullBack: PULL_BACK,
    elasticFactor: opts.elasticFactor,
  };
}

/**
 * The engine's motion, told the options' numbers, the width and whether
 * the physics carry turns to rest themselves: what it goes by from now on.
 */
export function motionOf(state: TransitionDriverState): TurnMotion {
  if (state.motion === null) {
    const make = loadedTurnMotion();
    if (make === undefined) {
      throw new Error('Page turns move by the engine: open a reader, or await loadTurnMotion()');
    }
    state.motion = make(physicsNumbers(state.opts));
  }
  state.motion.configure(
    physicsNumbers(state.opts),
    state.viewportWidth,
    activePhysics(state)?.settle !== undefined,
  );
  return state.motion;
}

/** Where the turn is now; at rest before the first turn. */
export function motionState(state: TransitionDriverState): TurnMotionState | null {
  return state.motion?.state ?? null;
}

/**
 * Starts the physics' own motion when the engine has started one for them
 * to carry: from where, how fast and to where it says.
 */
export function followSettle(state: TransitionDriverState): void {
  const now = state.motion?.state;
  const physics = activePhysics(state);
  if (!now || (now.phase !== 'settling' && now.phase !== 'finishing')) return;
  if (state.settle?.generation === now.settle.generation) return;
  if (!physics?.settle) {
    state.settle = null;
    return;
  }
  const { from, velocity, to } = now.settle;
  state.settle = { generation: now.settle.generation, at: physics.settle(from, velocity, to) };
}
