import { getPreset, type PresetName } from './presets';
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

function createHandler(
  bindings: Map<string, () => void>,
  enabled: { value: boolean },
): (e: KeyboardEvent) => void {
  return (e: KeyboardEvent): void => {
    if (!enabled.value) return;
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
  const enabled = { value: true };
  const handler = createHandler(bindings, enabled);

  target.addEventListener('keydown', handler);

  return {
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
      enabled.value = value;
    },

    dispose(): void {
      target.removeEventListener('keydown', handler);
      bindings.clear();
    },
  };
}
