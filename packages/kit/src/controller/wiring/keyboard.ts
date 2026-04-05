import { createKeyboardManager, type KeyboardManager } from '../../keyboard/index';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { DisposableCollection } from '../../utils/disposable';
import type { ReaderControllerEvents } from '../types';

export interface KeyboardWiringDeps {
  emitter: TypedEmitter<ReaderControllerEvents>;
  nextSpread: () => void;
  prevSpread: () => void;
  goToSpread: (index: number) => void;
  getTotalSpreads: () => number;
  searchNext: () => void;
  searchPrev: () => void;
  clearSearch: () => void;
}

/**
 * Create a KeyboardManager bound to `document.documentElement` (global scope),
 * register navigation and search presets, and wire it into the controller lifecycle.
 */
export function wireKeyboard(
  deps: KeyboardWiringDeps,
  disposables: DisposableCollection,
): KeyboardManager {
  const keyboard = createKeyboardManager(document.documentElement);

  keyboard.registerPreset('reader-navigation', {
    next: deps.nextSpread,
    prev: deps.prevSpread,
    first: () => {
      deps.goToSpread(0);
    },
    last: () => {
      deps.goToSpread(deps.getTotalSpreads() - 1);
    },
  });

  keyboard.registerPreset('search', {
    open: () => {
      deps.emitter.emit('searchOpen', undefined);
    },
    close: deps.clearSearch,
    next: deps.searchNext,
    prev: deps.searchPrev,
  });

  disposables.add(() => {
    keyboard.dispose();
  });
  return keyboard;
}
