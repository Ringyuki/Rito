import type { Reader, TocEntry } from 'rito';
import type { TypedEmitter } from '../utils/event-emitter';
import type { TransitionEngine } from '../transition/types';
import type { ReaderControllerEvents } from './types';

export interface NavigationDeps {
  getReader: () => Reader | null;
  getCurrentSpread: () => number;
  setCurrentSpread: (index: number) => void;
  emitter: TypedEmitter<ReaderControllerEvents>;
  transition: TransitionEngine;
}

export interface NavigationActions {
  goToSpread(index: number): void;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;
}

export function createNavigation(deps: NavigationDeps): NavigationActions {
  const goTo = (index: number): void => {
    const reader = deps.getReader();
    if (!reader) return;
    const clamped = Math.max(0, Math.min(index, reader.totalSpreads - 1));
    if (clamped === deps.getCurrentSpread()) return;
    const dir = clamped > deps.getCurrentSpread() ? 'forward' : 'backward';
    deps.setCurrentSpread(clamped);
    deps.emitter.emit('transitionStart', { direction: dir });
    void deps.transition
      .transitionTo(dir, () => {
        reader.renderSpread(clamped);
      })
      .then(() => {
        deps.emitter.emit('transitionEnd', { direction: dir });
      });
    const spread = reader.spreads[clamped];
    if (spread) deps.emitter.emit('spreadChange', { spreadIndex: clamped, spread });
  };

  return {
    goToSpread: goTo,
    nextSpread(): void {
      goTo(deps.getCurrentSpread() + 1);
    },
    prevSpread(): void {
      goTo(deps.getCurrentSpread() - 1);
    },
    navigateToTocEntry(entry: TocEntry): void {
      const reader = deps.getReader();
      if (!reader) return;
      const resolved = reader.resolveTocEntry(entry);
      if (resolved) goTo(resolved.spreadIndex);
    },
  };
}
