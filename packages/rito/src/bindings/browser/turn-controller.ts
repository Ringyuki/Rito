import {
  RitoTurnController,
  type RitoRawTurnController,
  type RitoTurnControllerClass,
} from '@ritojs/core-wasm';

import {
  registerTurnController,
  type TurnAction,
  type TurnController,
  type TurnControllerFactory,
  type TurnControllerState,
  type TurnDirection,
  type TurnFrameState,
  type TurnPages,
  type TurnRequest,
} from '../../reader/turn-controller';
import { physicsNumbers, stateOf } from './turn-motion';

const PAGES_NUMBERS = 8;
const ACTION_NUMBERS = 5;
const STATE_NUMBERS = 40;
const NONE = new Float64Array(0);
const DIRECTIONS: readonly TurnDirection[] = ['next', 'previous'];
const OUTCOMES = ['committed', 'cancelled', 'interrupted'] as const;
const NEIGHBOURS = [null, 'next', 'prev'] as const;
const LEAVING = ['none', 'next', 'prev'] as const;
const PHASES = ['held', 'landing', 'returning'] as const;

/**
 * Makes the page turns of a reader on the engine a reader has just loaded:
 * the factory `loadedTurnController` gives from now on. The engine's
 * layouts are checked when the first controller is made.
 */
export function registerEngineTurnController(): TurnControllerFactory {
  const controller: RitoTurnControllerClass = RitoTurnController;
  let checked = false;
  const factory: TurnControllerFactory = (physics) => {
    if (!checked) checkLayouts(controller);
    checked = true;
    return controllerOf(new controller(physicsNumbers(physics)));
  };
  registerTurnController(factory);
  return factory;
}

function checkLayouts(controller: RitoTurnControllerClass): void {
  const layouts = [...controller.layouts()];
  const ours = [PAGES_NUMBERS, ACTION_NUMBERS, STATE_NUMBERS];
  if (layouts.join() !== ours.join()) {
    throw new Error(
      `The engine's turn controller numbers are laid out ${layouts.join()}, not ${ours.join()}`,
    );
  }
}

function writePages(pages: TurnPages, out: Float64Array): Float64Array {
  const sides = [pages.canTurn, pages.there, pages.drawable, pages.beyond];
  sides.forEach((side, index) => {
    out[2 * index] = side.next ? 1 : 0;
    out[2 * index + 1] = side.previous ? 1 : 0;
  });
  return out;
}

const directionOf = (direction: TurnDirection): number => (direction === 'next' ? 0 : 1);

type Pages = (given: TurnPages) => Float64Array;

function controllerOf(raw: RitoRawTurnController): TurnController {
  const pages = new Float64Array(PAGES_NUMBERS);
  const state = new Float64Array(STATE_NUMBERS);
  const action = new Float64Array(ACTION_NUMBERS);
  const p: Pages = (given) => writePages(given, pages);
  return {
    get state() {
      raw.state(state);
      return controllerStateOf(state);
    },
    configure: (physics, width, instant) => {
      raw.configure(physicsNumbers(physics), width, instant);
    },
    ...fingersOf(raw, p),
    ...newsOf(raw, p),
    takeAction: () => {
      raw.takeAction(action);
      return actionOf(action);
    },
    dispose: () => {
      raw.free();
    },
  };
}

function fingersOf(
  raw: RitoRawTurnController,
  p: Pages,
): Pick<TurnController, 'fingerDown' | 'fingerMove' | 'fingerUp' | 'fingerCancel' | 'answerLands'> {
  return {
    fingerDown: (given, x, y, time) => {
      raw.fingerDown(p(given), x, y, time);
    },
    fingerMove: (given, x, y, travel, resisted, time) => {
      raw.fingerMove(p(given), x, y, travel, resisted ?? Number.NaN, time);
    },
    fingerUp: (given, x, y, travel, time) => {
      raw.fingerUp(p(given), x, y, travel, time);
    },
    fingerCancel: (given) => {
      raw.fingerCancel(p(given));
    },
    answerLands: (lands) => {
      raw.answerLands(lands === undefined ? -1 : lands ? 1 : 0);
    },
  };
}

/** What the host tells the controller besides its fingers. */
function newsOf(
  raw: RitoRawTurnController,
  p: Pages,
): Omit<
  TurnController,
  'state' | 'configure' | 'takeAction' | 'dispose' | keyof ReturnType<typeof fingersOf>
> {
  const two = new Float64Array(2);
  const at = new Float64Array(3);
  return {
    command: (given, direction) => raw.command(p(given), directionOf(direction)),
    playJump: (given, direction) => {
      raw.playJump(p(given), directionOf(direction));
    },
    landed: (given, ok) => {
      raw.landed(p(given), ok);
    },
    pages: (given) => {
      raw.pages(p(given));
    },
    overdue: (given) => {
      raw.overdue(p(given));
    },
    interrupt: () => {
      raw.interrupt();
    },
    settleNow: () => {
      raw.settleNow();
    },
    step: (given, seconds, host) => {
      if (host) at.set([host.x, host.velocity, host.done ? 1 : 0]);
      raw.step(p(given), seconds, host ? at : NONE);
    },
    answerBegin: (begin) => {
      if (begin) two.set([begin.offset, begin.velocity]);
      raw.answerBegin(begin ? two : NONE);
    },
  };
}

function actionOf(numbers: Float64Array): TurnAction | null {
  const at = (index: number): number => numbers[index] ?? 0;
  const direction = DIRECTIONS[at(1)] ?? 'next';
  switch (at(0)) {
    case 1:
      return { kind: 'started', direction };
    case 2:
      return {
        kind: 'ended',
        direction,
        outcome: OUTCOMES[at(2)] ?? 'interrupted',
        carries: at(3) === 1,
      };
    case 3:
      return { kind: 'land', direction };
    case 4:
      return { kind: 'fetch', direction };
    case 5:
      return { kind: 'wait-for-effect', seconds: at(4) };
    case 6:
      return { kind: 'rested' };
    default:
      return null;
  }
}

function requestOf(at: (index: number) => number): TurnRequest | null {
  if (at(3) === 1) {
    return {
      kind: 'begin',
      leftover: { offset: at(4), velocity: at(5), leaving: LEAVING[at(6)] ?? 'none' },
      forward: at(7) === 1,
      hasIncoming: at(8) === 1,
    };
  }
  if (at(3) === 2) {
    return {
      kind: 'lands',
      release: { offset: at(4), from: at(5), velocity: at(6), width: at(7), forward: at(8) === 1 },
    };
  }
  return null;
}

function frameOf(at: (index: number) => number): TurnFrameState | null {
  if (at(9) !== 1) return null;
  return {
    offset: at(10),
    incoming: NEIGHBOURS[at(11)] ?? null,
    phase: PHASES[at(12)] ?? 'returning',
    velocity: at(13),
    touch:
      at(14) === 1
        ? {
            origin: { x: at(15), y: at(16) },
            position: { x: at(17), y: at(18) },
            farthest: { x: at(19), y: at(20) },
          }
        : null,
  };
}

function controllerStateOf(numbers: Float64Array): TurnControllerState {
  const at = (index: number): number => numbers[index] ?? 0;
  return {
    turning: at(0) === 0 ? null : (DIRECTIONS[at(0) - 1] ?? null),
    moving: at(1) === 1,
    held: at(2) === 1,
    request: requestOf(at),
    frame: frameOf(at),
    motion: stateOf(numbers.subarray(21)),
  };
}
