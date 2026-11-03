import type { KeyboardManager } from './types';

export interface KeyboardManagerInputState {
  enabled: boolean;
  /** Holds taken by a controller that hands its view over: no keys reach it meanwhile. */
  held: number;
  disposed: boolean;
  readonly listeners: Set<(enabled: boolean) => void>;
}

const states = new WeakMap<KeyboardManager, KeyboardManagerInputState>();

export function createKeyboardManagerInputState(): KeyboardManagerInputState {
  return { enabled: true, held: 0, disposed: false, listeners: new Set() };
}

export function registerKeyboardManagerInputState(
  manager: KeyboardManager,
  state: KeyboardManagerInputState,
): void {
  states.set(manager, state);
}

export function acceptsKeyboardManagerInput(manager: KeyboardManager): boolean {
  const state = states.get(manager);
  return state !== undefined && acceptsKeyboardInputState(state);
}

export function subscribeKeyboardManagerInput(
  manager: KeyboardManager,
  listener: (enabled: boolean) => void,
): () => void {
  const state = states.get(manager);
  if (!state || state.disposed) return () => undefined;
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function acceptsKeyboardInputState(state: KeyboardManagerInputState): boolean {
  return state.enabled && state.held === 0 && !state.disposed;
}

/**
 * Keeps the manager from acting on keys until the returned release is
 * called, whatever its host enables meanwhile: the host's own
 * `setEnabled` is left as it was set.
 */
export function holdKeyboardManagerInput(manager: KeyboardManager): () => void {
  const state = states.get(manager);
  if (!state || state.disposed) return () => undefined;
  const previous = acceptsKeyboardInputState(state);
  state.held += 1;
  publishInputStateChange(state, previous);
  let released = false;
  return () => {
    if (released || state.disposed) return;
    released = true;
    const before = acceptsKeyboardInputState(state);
    state.held -= 1;
    publishInputStateChange(state, before);
  };
}

export function setKeyboardManagerEnabled(state: KeyboardManagerInputState, value: boolean): void {
  const previous = acceptsKeyboardInputState(state);
  state.enabled = value;
  publishInputStateChange(state, previous);
}

export function disposeKeyboardManagerInputState(state: KeyboardManagerInputState): void {
  if (state.disposed) return;
  const previous = acceptsKeyboardInputState(state);
  state.disposed = true;
  publishInputStateChange(state, previous);
  state.listeners.clear();
}

function publishInputStateChange(state: KeyboardManagerInputState, previous: boolean): void {
  const current = acceptsKeyboardInputState(state);
  if (current === previous) return;
  for (const listener of state.listeners) {
    try {
      listener(current);
    } catch {
      // Private lifecycle observers must not make setEnabled() or dispose() throw.
    }
  }
}
