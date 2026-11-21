import {
  RitoTurnMotion,
  type RitoRawTurnMotion,
  type RitoTurnMotionClass,
} from '@ritojs/core-wasm';

import {
  registerTurnMotion,
  type TurnMotion,
  type TurnMotionFactory,
  type TurnMotionPhase,
  type TurnMotionPhysics,
  type TurnMotionState,
  type TurnMotionStep,
} from '../../reader/turn-motion';
import { engineModuleReady } from './engine-module';

const PHYSICS_NUMBERS = 7;
const STATE_NUMBERS = 19;
const AT_NUMBERS = 3;
const NONE = new Float64Array(0);
const PHASES: readonly TurnMotionPhase[] = ['idle', 'dragging', 'settling', 'finishing'];
const NEIGHBOURS = [null, 'next', 'prev'] as const;
const LEAVING = [null, 'next', 'prev', 'none'] as const;
const STEPS: readonly TurnMotionStep[] = ['still', 'moving', 'committed', 'cancelled', 'rested'];

/** Makes turn motions on the page's one instance of the engine, loading it first. */
export async function loadTurnMotion(): Promise<TurnMotionFactory> {
  await engineModuleReady();
  return registerEngineTurnMotion();
}

/**
 * Makes turn motions on the engine, which a reader has just loaded: the
 * factory `loadedTurnMotion` gives from now on. The engine's layouts are
 * checked when the first motion is made.
 */
export function registerEngineTurnMotion(): TurnMotionFactory {
  const motion: RitoTurnMotionClass = RitoTurnMotion;
  let checked = false;
  const factory: TurnMotionFactory = (physics) => {
    if (!checked) checkLayouts(motion);
    checked = true;
    return turnMotionOf(new motion(physicsNumbers(physics)));
  };
  registerTurnMotion(factory);
  return factory;
}

function checkLayouts(motion: RitoTurnMotionClass): void {
  const layouts = [...motion.layouts()];
  const ours = [PHYSICS_NUMBERS, STATE_NUMBERS, AT_NUMBERS];
  if (layouts.join() !== ours.join()) {
    throw new Error(
      `The engine's turn motion numbers are laid out ${layouts.join()}, not ${ours.join()}`,
    );
  }
}

function physicsNumbers(physics: TurnMotionPhysics): Float64Array {
  return Float64Array.of(
    physics.stiffness,
    physics.damping,
    physics.swipeThreshold,
    physics.velocityCommit,
    physics.projection,
    physics.pullBack,
    physics.elasticFactor,
  );
}

function turnMotionOf(raw: RitoRawTurnMotion): TurnMotion {
  const numbers = new Float64Array(STATE_NUMBERS);
  return {
    get state() {
      raw.state(numbers);
      return stateOf(numbers);
    },
    ...fingerActionsOf(raw),
    ...motionActionsOf(raw),
  };
}

type Place = { readonly offset: number; readonly velocity: number } | undefined;

/** The begin a call passes: where the host's physics place a turn, or none. */
function placer(): (place: Place) => Float64Array {
  const begin = new Float64Array(2);
  return (place) => {
    if (place === undefined) return NONE;
    begin[0] = place.offset;
    begin[1] = place.velocity;
    return begin;
  };
}

function fingerActionsOf(
  raw: RitoRawTurnMotion,
): Pick<TurnMotion, 'startDrag' | 'drag' | 'dragCarried' | 'release' | 'cancel' | 'interrupt'> {
  const beginOf = placer();
  return {
    startDrag: (forward, hasIncoming, time, place) => {
      raw.startDrag(forward, hasIncoming, time, beginOf(place));
    },
    drag: (travel, time) => {
      raw.drag(travel, time, false);
    },
    dragCarried: (carried, time) => {
      raw.drag(carried, time, true);
    },
    release: (lands) => raw.release(lands === undefined ? -1 : lands ? 1 : 0),
    cancel: () => raw.cancel(),
    interrupt: (time) => raw.interrupt(time),
  };
}

function motionActionsOf(
  raw: RitoRawTurnMotion,
): Omit<TurnMotion, 'state' | keyof ReturnType<typeof fingerActionsOf>> {
  const beginOf = placer();
  const at = new Float64Array(AT_NUMBERS);
  return {
    configure: (physics, width, hostSettles) => {
      raw.configure(physicsNumbers(physics), width, hostSettles);
    },
    turn: (forward, place) => {
      raw.turn(forward, beginOf(place));
    },
    carryOn: (committed) => {
      raw.carryOn(committed);
    },
    step: (seconds, host, instant = false) => {
      if (host !== undefined) {
        at[0] = host.x;
        at[1] = host.velocity;
        at[2] = host.done ? 1 : 0;
      }
      return STEPS[raw.step(seconds, host === undefined ? NONE : at, instant)] ?? 'still';
    },
    finish: () => {
      raw.finish();
    },
    reset: () => {
      raw.reset();
    },
    dispose: () => {
      raw.free();
    },
  };
}

function stateOf(numbers: Float64Array): TurnMotionState {
  const at = (index: number): number => numbers[index] ?? 0;
  return {
    phase: PHASES[at(0)] ?? 'idle',
    forward: at(1) === 1,
    hasIncoming: at(2) === 1,
    offset: at(3),
    velocity: at(4),
    target: at(5),
    from: at(6),
    fingerVelocity: at(7),
    elapsed: at(8),
    showing: NEIGHBOURS[at(9)] ?? null,
    onFarSide: at(10) === 1,
    committing: at(11) === 1,
    landing: at(12) === 1,
    leaving: LEAVING[at(13)] ?? null,
    settle: { generation: at(14), from: at(15), velocity: at(16), to: at(17) },
    shift: at(18),
  };
}
