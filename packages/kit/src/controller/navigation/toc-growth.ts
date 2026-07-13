import type { Reader, ReaderLocatorResolution, TocEntry } from '@ritojs/core';
import type { NavigationDeps } from './index';
import { claimNavigationAttempt } from './jump';
import type { NavigationState, PendingTocNavigation } from './state';

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
  startTocLocatorGrowth(state, deps, reader, entry, attemptId, onResolved);
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

function startTocLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  entry: TocEntry,
  attemptId: number,
  onResolved: (spreadIndex: number) => void,
): void {
  if (!reader.navigateToLocator) return;
  const locatorAbort = new AbortController();
  const pending: PendingTocNavigation = { attemptId, entry, locatorAbort };
  state.pendingTocNavigation = pending;
  let task: Promise<ReaderLocatorResolution | undefined>;
  try {
    task = Promise.resolve(reader.navigateToLocator({ href: entry.href }, locatorAbort.signal));
  } catch (error) {
    task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  void task
    .then((resolution) => {
      settleTocLocatorGrowth(state, deps, reader, pending, resolution, onResolved);
    })
    .catch((error: unknown) => {
      handleTocLocatorGrowthFailure(state, deps, pending, error);
    });
}

export function pendingLegacyTocEntry(state: NavigationState): TocEntry | undefined {
  const pending = state.pendingTocNavigation;
  return pending?.locatorAbort ? undefined : pending?.entry;
}

function settleTocLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  reader: Reader,
  pending: PendingTocNavigation,
  resolution: ReaderLocatorResolution | undefined,
  onResolved: (spreadIndex: number) => void,
): void {
  if (!ownsTocGrowth(state, pending)) return;
  state.pendingTocNavigation = undefined;
  if (!resolution) {
    deps.onNavigationCancelled?.();
    return;
  }
  if (resolution.status !== 'resolved') {
    failOwnedTocGrowth(
      state,
      deps,
      pending,
      new Error('Reader locator navigation did not resolve its TOC target'),
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
    failOwnedTocGrowth(
      state,
      deps,
      pending,
      new Error('Reader locator navigation resolved outside its committed spread extent'),
    );
    return;
  }
  try {
    onResolved(resolution.spreadIndex);
  } catch (error) {
    deps.onNavigationCancelled?.();
    reportTocLocatorFailure(deps, error);
  }
}

function failTocLocatorGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingTocNavigation,
  error: unknown,
): void {
  if (!ownsTocGrowth(state, pending)) return;
  state.pendingTocNavigation = undefined;
  failOwnedTocGrowth(state, deps, pending, error);
}

function handleTocLocatorGrowthFailure(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingTocNavigation,
  error: unknown,
): void {
  try {
    failTocLocatorGrowth(state, deps, pending, error);
  } catch {
    if (ownsTocGrowth(state, pending)) state.pendingTocNavigation = undefined;
  }
}

function failOwnedTocGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingTocNavigation,
  error: unknown,
): void {
  if (pending.attemptId === state.navigationAttemptId) deps.onNavigationCancelled?.();
  reportTocLocatorFailure(deps, error);
}

function reportTocLocatorFailure(deps: NavigationDeps, error: unknown): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source: 'reader TOC locator navigation',
  });
}

function ownsTocGrowth(state: NavigationState, pending: PendingTocNavigation): boolean {
  return (
    !state.disposed &&
    state.pendingTocNavigation === pending &&
    state.navigationAttemptId === pending.attemptId
  );
}
