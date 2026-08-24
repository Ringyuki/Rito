import { getPreset, type PresetName } from './presets';
import {
  acceptsKeyboardInputState,
  createKeyboardManagerInputState,
  disposeKeyboardManagerInputState,
  registerKeyboardManagerInputState,
  setKeyboardManagerEnabled,
  type KeyboardManagerInputState,
} from './input-state';
import type { KeyboardManager } from './types';

export type { KeyboardManager } from './types';

/** Normalize a key event into a canonical shortcut string. */
function eventToShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key);
  return parts.join('+');
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLElement
    ? target.isContentEditable ||
        !!target.closest('[contenteditable]:not([contenteditable="false"])')
    : false;
}

function createHandler(
  bindings: Map<string, () => void>,
  state: KeyboardManagerInputState,
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (!acceptsKeyboardInputState(state)) return;
    if (isEditableTarget(e.target)) return;
    const shortcut = eventToShortcut(e);
    const action = bindings.get(shortcut);
    if (action) {
      e.preventDefault();
      action();
    }
  };
}

export function createKeyboardManager(target: HTMLElement): KeyboardManager {
  const bindings = new Map<string, () => void>();
  const state = createKeyboardManagerInputState();
  const handler = createHandler(bindings, state);

  target.addEventListener('keydown', handler);

  const manager: KeyboardManager = {
    register(shortcut: string, action: () => void): () => void {
      bindings.set(shortcut, action);
      return () => {
        bindings.delete(shortcut);
      };
    },

    registerPreset(preset: PresetName, actions: Record<string, () => void>): () => void {
      const entries = getPreset(preset);
      const keys: string[] = [];
      for (const entry of entries) {
        const action = actions[entry.actionKey];
        if (action) {
          bindings.set(entry.shortcut, action);
          keys.push(entry.shortcut);
        }
      }
      return () => {
        for (const k of keys) bindings.delete(k);
      };
    },

    setEnabled(value: boolean): void {
      setKeyboardManagerEnabled(state, value);
    },

    dispose(): void {
      disposeKeyboardManager(target, handler, bindings, state);
    },
  };
  registerKeyboardManagerInputState(manager, state);
  return manager;
}

function disposeKeyboardManager(
  target: HTMLElement,
  handler: (event: KeyboardEvent) => void,
  bindings: Map<string, () => void>,
  state: KeyboardManagerInputState,
): void {
  if (state.disposed) return;
  target.removeEventListener('keydown', handler);
  bindings.clear();
  disposeKeyboardManagerInputState(state);
}
