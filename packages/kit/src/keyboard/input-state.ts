import type { KeyboardManager } from './types';

export interface KeyboardManagerInputState {
  enabled: boolean;
  disposed: boolean;
  readonly listeners: Set<(enabled: boolean) => void>;
}

const states = new WeakMap<KeyboardManager, KeyboardManagerInputState>();

export function createKeyboardManagerInputState(): KeyboardManagerInputState {
  return { enabled: true, disposed: false, listeners: new Set() };
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
  return state.enabled && !state.disposed;
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
