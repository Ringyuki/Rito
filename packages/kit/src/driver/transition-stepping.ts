import { activeEffect, type TransitionDriverState } from './transition-state';
import {
  turningInstruction,
  stepSettling,
  stepBoundaryElastic,
  stepFinishing,
  forceSettleMode,
} from './transition-steps';
import type { DrawInstruction, SettledEvent } from './types';

/** Moves the driver on by `dt` ms and says what to draw. */
export function stepTransition(state: TransitionDriverState, dt: number): DrawInstruction {
  switch (state.mode.kind) {
    case 'idle':
      return { kind: 'single', slot: 'curr' };
    case 'tracking':
      return turningInstruction(state.mode);
    case 'settling':
      return applyStepResult(
        state,
        stepSettling(state.mode, state.opts, dt, activeEffect(state).instant),
      );
    case 'boundary-elastic':
      return applyStepResult(state, stepBoundaryElastic(state.mode, state.opts, dt));
    case 'finishing': {
      const result = stepFinishing(state.mode, state.opts, dt);
      state.mode = result.nextMode;
      if (result.nextMode.kind === 'idle') for (const cb of state.restListeners) cb();
      return result.instruction;
    }
  }
}

function applyStepResult(
  state: TransitionDriverState,
  result: ReturnType<typeof stepSettling> | ReturnType<typeof stepBoundaryElastic>,
): DrawInstruction {
  state.mode = result.nextMode;
  if (result.settled) emitSettled(state, result.settled);
  return result.instruction;
}

/** Stops whatever is moving where it stands, reporting a turn that was open. */
export function forceSettle(state: TransitionDriverState): number {
  const result = forceSettleMode(state.mode);
  state.mode = { kind: 'idle' };
  if (result.settled) emitSettled(state, result.settled);
  return result.residualDx;
}

export function emitSettled(state: TransitionDriverState, event: SettledEvent): void {
  for (const cb of state.settledListeners) cb(event);
}
