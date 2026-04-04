export interface KeyboardManager {
  /** Register a single shortcut. Returns unregister function. */
  register(shortcut: string, action: () => void): () => void;
  /** Register a built-in preset. Returns unregister function for all shortcuts in the preset. */
  registerPreset(
    preset: 'reader-navigation' | 'search',
    actions: Record<string, () => void>,
  ): () => void;
  /** Enable/disable the manager (e.g. disable when search input is focused). */
  setEnabled(enabled: boolean): void;
  /** Remove all listeners. */
  dispose(): void;
}
