import type { SelectionEngine } from './engine';
import { registerSelectionInteractionOwner } from './selection-interaction-owner';

interface LegacyGestureState {
  generation: number;
  active: object | null;
}

/** Give the synchronous fallback engine the same private exact-gesture ownership contract. */
export function registerLegacySelectionGestureOwner(engine: SelectionEngine): SelectionEngine {
  const state: LegacyGestureState = { generation: 0, active: null };
  const owner = buildOwnedEngine(engine, state);
  return registerSelectionInteractionOwner(owner, () => state.generation, {
    capture: () => state.active,
    owns: (token) => token === state.active && engine.getState() === 'selecting',
  });
}

function buildOwnedEngine(engine: SelectionEngine, state: LegacyGestureState): SelectionEngine {
  return {
    ...engine,
    handlePointerDown(input, granularity) {
      beginGesture(engine, state, input, granularity);
    },
    handlePointerUp(input) {
      finishGesture(engine, state, input);
    },
    setSpread(spread, config, measurer, projection, update) {
      supersede(state);
      engine.setSpread(spread, config, measurer, projection, update);
    },
    clear() {
      supersede(state);
      engine.clear();
    },
    invalidate() {
      supersede(state);
      engine.invalidate();
    },
    dispose() {
      supersede(state);
      engine.dispose();
    },
  };
}

function beginGesture(
  engine: SelectionEngine,
  state: LegacyGestureState,
  input: Parameters<SelectionEngine['handlePointerDown']>[0],
  granularity: Parameters<SelectionEngine['handlePointerDown']>[1],
): void {
  const intentGeneration = ++state.generation;
  const gesture = {};
  state.active = null;
  if (engine.getState() !== 'idle') engine.clear();
  if (state.generation !== intentGeneration) return;
  engine.handlePointerDown(input, granularity);
  if (state.generation === intentGeneration && engine.getState() === 'selecting') {
    state.active = gesture;
  }
}

function finishGesture(
  engine: SelectionEngine,
  state: LegacyGestureState,
  input: Parameters<SelectionEngine['handlePointerUp']>[0],
): void {
  const intentGeneration = state.generation;
  try {
    engine.handlePointerUp(input);
  } finally {
    if (state.generation === intentGeneration) state.active = null;
  }
}

function supersede(state: LegacyGestureState): void {
  state.generation += 1;
  state.active = null;
}
