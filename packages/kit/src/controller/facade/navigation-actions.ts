import type { Nav, NavigationActionsSlice } from './types';

/** Expose only the navigation operations that belong to ReaderController. */
export function buildNavigationActions(nav: Nav): NavigationActionsSlice {
  return {
    goToSpread(index): void {
      nav.goToSpread(index);
    },
    nextSpread(): void {
      nav.nextSpread();
    },
    prevSpread(): void {
      nav.prevSpread();
    },
    navigateToTocEntry(entry): void {
      nav.navigateToTocEntry(entry);
    },
    jumpToSpread(index): void {
      nav.jumpToSpread(index);
    },
  };
}
