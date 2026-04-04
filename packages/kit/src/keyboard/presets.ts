export type PresetName = 'reader-navigation' | 'search';

export interface PresetEntry {
  readonly shortcut: string;
  readonly actionKey: string;
}

const READER_NAVIGATION: readonly PresetEntry[] = [
  { shortcut: 'ArrowRight', actionKey: 'next' },
  { shortcut: 'ArrowLeft', actionKey: 'prev' },
  { shortcut: 'PageDown', actionKey: 'next' },
  { shortcut: 'PageUp', actionKey: 'prev' },
  { shortcut: ' ', actionKey: 'next' },
  { shortcut: 'Home', actionKey: 'first' },
  { shortcut: 'End', actionKey: 'last' },
];

const SEARCH: readonly PresetEntry[] = [
  { shortcut: 'ctrl+f', actionKey: 'open' },
  { shortcut: 'meta+f', actionKey: 'open' },
  { shortcut: 'Escape', actionKey: 'close' },
  { shortcut: 'Enter', actionKey: 'next' },
  { shortcut: 'shift+Enter', actionKey: 'prev' },
];

export function getPreset(name: PresetName): readonly PresetEntry[] {
  switch (name) {
    case 'reader-navigation':
      return READER_NAVIGATION;
    case 'search':
      return SEARCH;
  }
}
