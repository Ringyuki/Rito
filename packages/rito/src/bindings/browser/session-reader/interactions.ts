import type { ReaderInteractions } from '../../../reader';
import { locateSessionReaderLocator } from './navigation';
import type { SessionReaderState } from './state';

export function createSessionReaderInteractions(state: SessionReaderState): ReaderInteractions {
  return {
    get enabled() {
      return !state.disposed;
    },
    textSelection: {
      resolveCaret: () => Promise.resolve(undefined),
      resolveTextRange: () => Promise.resolve(undefined),
      resolveTextRangeToPoint: () => Promise.resolve(undefined),
      resolveTextRangeFromPoints: () => Promise.resolve(undefined),
    },
    getPageTargets: () => Promise.resolve(undefined),
    getFootnote: () => Promise.resolve(undefined),
    resolveLocator: (locator) => locateSessionReaderLocator(state, locator),
  };
}
