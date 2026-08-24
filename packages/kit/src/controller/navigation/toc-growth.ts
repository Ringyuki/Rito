import type { Reader, ReaderLocator, ReaderLocatorResolution, TocEntry } from '@ritojs/core';
import type { NavigationDeps } from './index';
import { claimNavigationAttempt } from './jump';
import type { NavigationState, PendingLocatorNavigation } from './state';
import { failChapterLocalLocator, settleChapterLocalExact } from './chapter-local-preview';
import { continueResolvedLocatorNavigation } from './locator-continuation';

const TOC_FAILURE_SOURCE = 'reader TOC locator navigation';
const LINK_FAILURE_SOURCE = 'reader link locator navigation';

export function navigateTocEntry(
  state: NavigationState,
  deps: NavigationDeps,
  entry: TocEntry,
  onResolved: (spreadIndex: number) => void,
): void {
  if (state.disposed) return;
  const reader = deps.getReader();
  const resolved = reader?.resolveTocEntry(entry);
  if (resolved) {
    onResolved(resolved.spreadIndex);
    return;
  }
  const attemptId = claimNavigationAttempt(state, deps);
  if (!reader?.navigateToLocator) {
    state.pendingTocNavigation = { attemptId, entry };
    return;
  }
  startLocatorGrowth(
    state,
    deps,
    reader,
    { href: entry.href },
    attemptId,
    onResolved,
    TOC_FAILURE_SOURCE,
    'TOC target',
  );
}

export function navigateReaderLocator(
  state: NavigationState,
  deps: NavigationDeps,
  locator: ReaderLocator,
  onResolved: (spreadIndex: number) => void,
): void {
  if (state.disposed) return;
  const reader = deps.getReader();
  const attemptId = claimNavigationAttempt(state, deps);
  if (!reader?.navigateToLocator) {
    deps.onNavigationCancelled?.();
    reportLocatorFailure(deps, LINK_FAILURE_SOURCE, new Error('Reader cannot grow a link target'));
    return;
  }
  startLocatorGrowth(
    state,
    deps,
    reader,
    locator,
    attemptId,
    onResolved,
    LINK_FAILURE_SOURCE,
    'link target',
  );
}

export function retryPendingTocEntry(
  state: NavigationState,
  deps: NavigationDeps,
  onResolved: (spreadIndex: number) => void,
): void {
  const entry = pendingLegacyTocEntry(state);
  if (!entry) return;
  const resolved = deps.getReader()?.resolveTocEntry(entry);
  if (resolved) onResolved(resolved.spreadIndex);
}

function startLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  locator: ReaderLocator,
  attemptId: number,
  onResolved: (spreadIndex: number) => void,
  failureSource: string,
  targetLabel: string,
): void {
  if (!reader.navigateToLocator) return;
  const locatorAbort = new AbortController();
  const pending: PendingLocatorNavigation = {
    attemptId,
    locator,
    locatorAbort,
    failureSource,
    targetLabel,
    onResolved,
    provisionalPhase: 'none',
    previewReadySpread: undefined,
    exactResolution: undefined,
  };
  state.pendingLocatorNavigation = pending;
  let task: Promise<ReaderLocatorResolution | undefined>;
  try {
    task = Promise.resolve(reader.navigateToLocator(locator, locatorAbort.signal));
  } catch (error) {
    task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  void task
    .then((resolution) => {
      settleLocatorGrowth(state, deps, reader, pending, resolution);
    })
    .catch((error: unknown) => {
      handleLocatorGrowthFailure(state, deps, pending, error);
    });
}

export function pendingLegacyTocEntry(state: NavigationState): TocEntry | undefined {
  return state.pendingTocNavigation?.entry;
}

function settleLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  pending: PendingLocatorNavigation,
  resolution: ReaderLocatorResolution | undefined,
): void {
  if (!ownsLocatorGrowth(state, pending)) return;
  if (!resolution) {
    if (failChapterLocalLocator(state, deps, pending)) return;
    state.pendingLocatorNavigation = undefined;
    deps.onNavigationCancelled?.();
    return;
  }
  if (resolution.status !== 'resolved') {
    failOwnedLocatorGrowth(
      state,
      deps,
      pending,
      new Error(`Reader locator navigation did not resolve its ${pending.targetLabel}`),
    );
    return;
  }
  const currentReader = deps.getReader();
  if (
    currentReader !== reader ||
    !Number.isSafeInteger(resolution.spreadIndex) ||
    resolution.spreadIndex < 0 ||
    resolution.spreadIndex >= reader.totalSpreads ||
    !reader.spreads[resolution.spreadIndex]
  ) {
    failOwnedLocatorGrowth(
      state,
      deps,
      pending,
      new Error('Reader locator navigation resolved outside its committed spread extent'),
    );
    return;
  }
  try {
    deps.onPaginationChanged?.();
    if (state.disposed || state.navigationAttemptId !== pending.attemptId) return;
    if (settleChapterLocalExact(state, deps, pending, resolution)) return;
  } catch (error) {
    handleLocatorGrowthFailure(state, deps, pending, error);
    return;
  }
  continueResolvedLocatorNavigation(state, deps, pending, resolution.spreadIndex);
}

function failLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  if (!ownsLocatorGrowth(state, pending)) return;
  if (failChapterLocalLocator(state, deps, pending, error)) return;
  state.pendingLocatorNavigation = undefined;
  failOwnedLocatorGrowth(state, deps, pending, error);
}

function handleLocatorGrowthFailure(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  try {
    failLocatorGrowth(state, deps, pending, error);
  } catch {
    if (ownsLocatorGrowth(state, pending)) state.pendingLocatorNavigation = undefined;
  }
}

function failOwnedLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingLocatorNavigation,
  error: unknown,
): void {
  if (failChapterLocalLocator(state, deps, pending, error)) return;
  if (pending.attemptId === state.navigationAttemptId) deps.onNavigationCancelled?.();
  reportLocatorFailure(deps, pending.failureSource, error);
}

function reportLocatorFailure(deps: NavigationDeps, source: string, error: unknown): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source,
  });
}

function ownsLocatorGrowth(state: NavigationState, pending: PendingLocatorNavigation): boolean {
  return (
    !state.disposed &&
    state.pendingLocatorNavigation === pending &&
    state.navigationAttemptId === pending.attemptId
  );
}
