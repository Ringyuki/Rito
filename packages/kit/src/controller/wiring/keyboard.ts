import { createKeyboardManager, type KeyboardManager } from '../../keyboard/index';
import type { TypedEmitter } from '../../utils/event-emitter';
import type { DisposableCollection } from '../../utils/disposable';
import type { ReaderControllerEvents } from '../types';

export interface KeyboardWiringDeps {
  emitter: TypedEmitter<ReaderControllerEvents>;
  nextSpread: () => void;
  prevSpread: () => void;
  goToFirstSpread: () => void;
  goToLastSpread: () => void;
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
  disposables.add(() => {
    keyboard.dispose();
  });

  keyboard.registerPreset('reader-navigation', {
    next: deps.nextSpread,
    prev: deps.prevSpread,
    first: deps.goToFirstSpread,
    last: deps.goToLastSpread,
  });

  keyboard.registerPreset('search', {
    open: () => {
      deps.emitter.emit('searchOpen', undefined);
    },
    close: deps.clearSearch,
    next: deps.searchNext,
    prev: deps.searchPrev,
  });

  return keyboard;
}
