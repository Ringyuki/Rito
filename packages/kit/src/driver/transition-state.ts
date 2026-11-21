import {
  loadedTurnController,
  type TurnAction,
  type TurnController,
  type TurnMotionPhysics,
  type TurnPages,
} from '@ritojs/core';

import { resolveTransitionEffect, transitionEffects, type TransitionEffect } from './effects';
import type { TransitionPhysics, TransitionSettle } from './physics';
import type { TransitionDriverOptions } from './types';

/** How long a release's velocity is projected over, seconds. */
const PROJECTION_SECONDS = 0.15;
/** A finger pulling a turn back faster than this (px/s) leaves the page. */
const PULL_BACK = 50;

/** Nothing beside the page: what is known before the host has said. */
const NO_PAGES: TurnPages = {
  canTurn: { next: false, previous: false },
  there: { next: false, previous: false },
  drawable: { next: false, previous: false },
  beyond: { next: false, previous: false },
};

export interface TransitionDriverState {
  opts: TransitionDriverOptions;
  viewportWidth: number;
  /** Where the pages are bound, as an x in the viewport. */
  spine: number;
  /** The system asks for reduced motion (set by the host environment). */
  reducedMotion: boolean;
  /** The display's context an effect is prepared with; null where nothing is displayed. */
  readonly gl: WebGL2RenderingContext | null;
  /** The engine's page turns, made at the first one. */
  controller: TurnController | null;
  /** What the host knows of the pages beside the one shown, asked at every call. */
  pages: () => TurnPages;
  /** The physics' own motion carrying what is on screen, while they bring one. */
  settle: { readonly generation: number; readonly at: TransitionSettle } | null;
  readonly actionListeners: Set<(action: TurnAction) => void>;
  readonly restListeners: Set<() => void>;
  /** Actions are being taken: a call a listener makes adds to them, and they are taken in order. */
  draining: boolean;
}

export function createTransitionState(
  opts: TransitionDriverOptions,
  gl: WebGL2RenderingContext | null,
): TransitionDriverState {
  return {
    opts,
    viewportWidth: 0,
    spine: 0,
    reducedMotion: false,
    gl,
    controller: null,
    pages: () => NO_PAGES,
    settle: null,
    actionListeners: new Set(),
    restListeners: new Set(),
    draining: false,
  };
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
 * The engine's page turns, told the options' numbers, the width and whether
 * turns land at once: what they go by from now on.
 */
export function controllerOf(state: TransitionDriverState): TurnController {
  if (state.controller === null) {
    const make = loadedTurnController();
    if (make === undefined) {
      throw new Error('Page turns are the engine’s: open a reader, or await loadTurnMotion()');
    }
    state.controller = make(physicsNumbers(state.opts));
  }
  state.controller.configure(
    physicsNumbers(state.opts),
    state.viewportWidth,
    activeEffect(state).instant === true,
  );
  return state.controller;
}
