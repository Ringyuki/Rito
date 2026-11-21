import type { TurnControllerState, TurnRequest } from '@ritojs/core';

import { activePhysics, type TransitionDriverState } from './transition-state';

/**
 * Carries out what the engine asks after a call: its questions answered by
 * the physics that answer them (the built-in rules otherwise), then each
 * action handed to the listeners in order. A listener that calls the driver
 * again adds to the actions, which are taken after those already asked.
 */
export function drain(state: TransitionDriverState): void {
  const controller = state.controller;
  if (!controller || state.draining) return;
  state.draining = true;
  try {
    for (;;) {
      const now = controller.state;
      if (now.request) {
        answer(state, now, now.request);
        continue;
      }
      const action = controller.takeAction();
      if (!action) break;
      if (action.kind === 'rested') for (const listener of state.restListeners) listener();
      for (const listener of state.actionListeners) listener(action);
    }
  } finally {
    state.draining = false;
  }
  followSettle(state);
}

function answer(
  state: TransitionDriverState,
  now: TurnControllerState,
  request: TurnRequest,
): void {
  const controller = state.controller;
  if (!controller) return;
  const physics = activePhysics(state);
  if (request.kind === 'begin') {
    const own = request.hasIncoming ? (request.forward ? 'next' : 'prev') : null;
    const begun = physics?.begins?.({
      dx: request.leftover.offset,
      velocity: request.leftover.velocity,
      width: state.viewportWidth,
      direction: request.forward ? 'forward' : 'backward',
      sameSpreads: request.leftover.leaving === own,
    });
    controller.answerBegin(begun ? { offset: begun.dx, velocity: begun.velocity } : undefined);
    return;
  }
  const { release } = request;
  const touch = now.frame?.touch ?? null;
  controller.answerLands(
    physics?.lands?.({
      dx: release.offset,
      from: release.from,
      velocity: release.velocity,
      width: release.width,
      direction: release.forward ? 'forward' : 'backward',
      touch,
      spine: state.spine,
    }),
  );
}

/**
 * Starts the physics' own motion when the engine has started one for them
 * to carry: from where, how fast and to where it says.
 */
function followSettle(state: TransitionDriverState): void {
  const motion = state.controller?.state.motion;
  const physics = activePhysics(state);
  if (!motion || (motion.phase !== 'settling' && motion.phase !== 'finishing')) return;
  if (state.settle?.generation === motion.settle.generation) return;
  if (!physics?.settle) {
    state.settle = null;
    return;
  }
  const { from, velocity, to } = motion.settle;
  state.settle = { generation: motion.settle.generation, at: physics.settle(from, velocity, to) };
}
