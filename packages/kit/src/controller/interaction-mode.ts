import type { InteractionMode } from './types';

export interface InteractionModeManager {
  readonly mode: InteractionMode;
  setMode(mode: InteractionMode): void;
  onModeChange(cb: (mode: InteractionMode) => void): () => void;
}

export function createInteractionModeManager(initial: InteractionMode): InteractionModeManager {
  let mode = initial;
  const listeners = new Set<(mode: InteractionMode) => void>();

  return {
    get mode(): InteractionMode {
      return mode;
    },
    setMode(newMode: InteractionMode): void {
      if (newMode === mode) return;
      mode = newMode;
      for (const cb of listeners) cb(mode);
    },
    onModeChange(cb: (m: InteractionMode) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}

/** Detect if touch is the primary input. */
export function detectDefaultMode(): InteractionMode {
  return typeof window !== 'undefined' && 'ontouchstart' in window ? 'gesture' : 'selection';
}
