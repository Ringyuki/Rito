import type { TurnAction, TurnDirection, TurnPages } from '@ritojs/core';

import { drain } from './transition-drain';
import {
  activeEffect,
  activePhysics,
  controllerOf,
  createTransitionState,
  prepareEffect,
  type TransitionDriverState,
} from './transition-state';
import { instructionOf, modeOf } from './transition-steps';
import type { DrawInstruction, TransitionDriverOptions, TransitionMode } from './types';
import { DEFAULT_TRANSITION_OPTIONS } from './types';
import type { TransitionEffect, TransitionPoint } from './effects';
import type { TransitionPhysics } from './physics';

/**
 * The page turns of a reader as the kit shows them: the engine decides when
 * a turn begins, lands and ends and what a finger, a key or a jump does to
 * one on screen (`@ritojs/core`'s `TurnController`, the same on every host);
 * this driver tells it what happens, with what the host knows of the pages,
 * answers its questions with the physics of the effect or the app, and hands
 * its actions to the controller (`onAction`). No DOM types.
 */
export interface TransitionDriver {
  /** What is on screen, as modes. */
  readonly mode: TransitionMode;
  /** Whether anything is moving: a turn, a pull, or what is left of one that was cut into. */
  readonly isAnimating: boolean;
  /** Whether a turn is open: held, landing, or going back. */
  readonly turning: boolean;
  /** The viewport width used for displacement calculations. */
  viewportWidth: number;
  /** Where the pages are bound, as an x in the viewport: 0, or the middle of a two-page spread. */
  spine: number;
  /**
   * How turns look: the configured effect, or a cross-fade while the
   * system asks for reduced motion (unless `respectReducedMotion` is off).
   */
  readonly effect: TransitionEffect;
  /** How turns move when not by the built-in rules: the options' physics, else the effect's. */
  readonly physics: TransitionPhysics | undefined;
  /** Whether the system asks for reduced motion. */
  reducedMotion: boolean;

  /** What the host knows of the pages beside the one shown, asked at every call. */
  pagesFrom(pages: () => TurnPages): void;
  /** A finger came down at `origin` and moved far enough, the way pages turn, to mean a drag. */
  fingerDown(origin: TransitionPoint, timestamp: number): void;
  /** The finger is at `position`, having carried the turn `travel` px (the physics read it). */
  fingerMove(position: TransitionPoint, travel: number, timestamp: number): void;
  /** The finger lifted at `position`. */
  fingerUp(position: TransitionPoint, travel: number, timestamp: number): void;
  /** The finger was taken away. */
  fingerCancel(): void;
  /** Turns to the neighbour: false at the end of the book or while a finger holds the page. */
  command(direction: TurnDirection): boolean;
  /** The host landed the turn on screen (`ok`), or could not. */
  landed(ok: boolean): void;
  /** What the host knows of the pages changed: a page it was asked to bring is painted. */
  pagesChanged(): void;
  /** Something else moved the reader (a jump, a relayout): what is on screen ends interrupted. */
  interrupt(): void;
  /** Something asked of the reader directly: what is on screen ends at once where it was going. */
  settleNow(): void;

  /** Advance one frame. Returns what to draw. `dt` is in milliseconds. */
  step(dt: number): DrawInstruction;

  /** Update spring/swipe parameters at runtime. */
  configure(update: Partial<TransitionDriverOptions>): void;

  /** Prepares the effect again, as when it is set: after the display's context was restored. */
  prepareEffect(): void;

  /** What the engine asks the host to do: say a turn began or ended, land it, fetch a page. */
  onAction(cb: (action: TurnAction) => void): () => void;

  /** Register callback for when what a cut turn had left comes to rest, taken up by no turn. */
  onRest(cb: () => void): () => void;
}

/** `gl` is the display's context, which a painted effect is prepared with. */
export function createTransitionDriver(
  options?: Partial<TransitionDriverOptions>,
  gl: WebGL2RenderingContext | null = null,
): TransitionDriver {
  const state = createTransitionState({ ...DEFAULT_TRANSITION_OPTIONS, ...options }, gl);
  prepareEffect(state);
  const driver = createDriverAccessors(state) as TransitionDriver;
  Object.assign(driver, createInputActions(state), createDriverActions(state));
  return driver;
}

function createDriverAccessors(
  state: TransitionDriverState,
): Pick<
  TransitionDriver,
  | 'mode'
  | 'isAnimating'
  | 'turning'
  | 'viewportWidth'
  | 'spine'
  | 'effect'
  | 'physics'
  | 'reducedMotion'
> {
  return {
    get effect() {
      return activeEffect(state);
    },
    get physics() {
      return activePhysics(state);
    },
    get spine() {
      return state.spine;
    },
    set spine(x: number) {
      state.spine = x;
    },
    get reducedMotion() {
      return state.reducedMotion;
    },
    set reducedMotion(value: boolean) {
      state.reducedMotion = value;
    },
    get mode() {
      return modeOf(state.controller?.state);
    },
    get isAnimating() {
      return state.controller?.state.moving ?? false;
    },
    get turning() {
      return (state.controller?.state.turning ?? null) !== null;
    },
    get viewportWidth() {
      return state.viewportWidth;
    },
    set viewportWidth(w: number) {
      state.viewportWidth = w;
    },
  };
}

/** Each call tells the engine with what the host knows of the pages now, then carries out what it asks. */
function told(state: TransitionDriverState, tell: (pages: TurnPages) => void): void {
  tell(state.pages());
  drain(state);
}

function createInputActions(
  state: TransitionDriverState,
): Pick<
  TransitionDriver,
  'pagesFrom' | 'command' | 'landed' | 'pagesChanged' | keyof ReturnType<typeof createFingerActions>
> {
  const turns = () => controllerOf(state);
  return {
    ...createFingerActions(state),
    pagesFrom(pages): void {
      state.pages = pages;
    },
    command(direction): boolean {
      let taken = false;
      told(state, (pages) => {
        taken = turns().command(pages, direction);
      });
      return taken;
    },
    landed(ok): void {
      told(state, (pages) => {
        turns().landed(pages, ok);
      });
    },
    pagesChanged(): void {
      told(state, (pages) => {
        turns().pages(pages);
      });
    },
  };
}

/** What a finger does, told the engine; the physics read how far it carries a pull. */
function createFingerActions(
  state: TransitionDriverState,
): Pick<TransitionDriver, 'fingerDown' | 'fingerMove' | 'fingerUp' | 'fingerCancel'> {
  const turns = () => controllerOf(state);
  return {
    fingerDown(origin, timestamp): void {
      told(state, (pages) => {
        turns().fingerDown(pages, origin.x, origin.y, timestamp);
      });
    },
    fingerMove(position, travel, timestamp): void {
      const resisted = activePhysics(state)?.resist?.(travel, state.viewportWidth);
      told(state, (pages) => {
        turns().fingerMove(pages, position.x, position.y, travel, resisted, timestamp);
      });
    },
    fingerUp(position, travel, timestamp): void {
      told(state, (pages) => {
        turns().fingerUp(pages, position.x, position.y, travel, timestamp);
      });
    },
    fingerCancel(): void {
      told(state, (pages) => {
        turns().fingerCancel(pages);
      });
    },
  };
}

function createDriverActions(
  state: TransitionDriverState,
): Pick<
  TransitionDriver,
  'interrupt' | 'settleNow' | 'step' | 'configure' | 'prepareEffect' | 'onAction' | 'onRest'
> {
  return {
    interrupt(): void {
      if (!state.controller) return;
      state.controller.interrupt();
      state.settle = null;
      drain(state);
    },
    settleNow(): void {
      if (!state.controller) return;
      state.controller.settleNow();
      state.settle = null;
      drain(state);
    },
    step(dt): DrawInstruction {
      const controller = state.controller;
      if (!controller) return instructionOf(undefined);
      const seconds = dt / 1000;
      const host = state.settle?.at(controller.state.motion.elapsed + seconds);
      controllerOf(state).step(state.pages(), seconds, host);
      drain(state);
      return instructionOf(controller.state);
    },
    configure(update): void {
      state.opts = { ...state.opts, ...update };
      if (update.effect !== undefined) prepareEffect(state);
      if (state.controller) controllerOf(state);
    },
    prepareEffect(): void {
      prepareEffect(state);
    },
    onAction(cb): () => void {
      state.actionListeners.add(cb);
      return () => state.actionListeners.delete(cb);
    },
    onRest(cb): () => void {
      state.restListeners.add(cb);
      return () => state.restListeners.delete(cb);
    },
  };
}
