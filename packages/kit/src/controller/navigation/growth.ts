import type { Reader, ReaderIncrementalPagination } from '@ritojs/core';
import type { NavigationDeps } from './index';
import { emitNavigationStart } from './start';
import {
  type GestureNavigationRequest,
  type NavigationAttempt,
  type NavigationState,
  type PendingNavigation,
} from './state';

export function createSpreadGrowthAttempt(
  state: NavigationState,
  deps: NavigationDeps,
  pagination: ReaderIncrementalPagination,
  attemptId: number,
  target: number,
  previous: number,
  continuityDx: number,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  const growthAbort = new AbortController();
  const pending: PendingNavigation = {
    attemptId,
    target,
    direction: 'forward',
    previous,
    continuityDx,
    growthAbort,
    growthPagination: pagination,
    ...(gesture ? { gesture } : {}),
  };
  state.pendingNavigation = pending;
  let task: Promise<boolean | undefined>;
  try {
    task = Promise.resolve(pagination.ensureSpread(target, growthAbort.signal));
  } catch (error) {
    task = Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
  void task
    .then((available) => {
      settleSpreadGrowth(state, deps, pending, available);
    })
    .catch((error: unknown) => {
      handleSpreadGrowthFailure(state, deps, pending, error);
    });
  return { claimedIntent: true, attemptId, pendingNavigation: pending };
}

export function continuePendingNavigation(
  state: NavigationState,
  deps: NavigationDeps,
  spreadIndex: number,
): void {
  if (state.activeChapterLocalTransition || state.finalizingChapterLocalTransition) return;
  const pending = currentPending(state, spreadIndex);
  if (!pending || pending.gesture?.cancelled) return;
  if (!ensureIncomingSlot(deps, pending.target, pending.direction)) {
    deps.frameDriver.scheduleComposite();
    return;
  }
  if (currentPending(state, spreadIndex) !== pending) return;
  const reader = deps.getReader();
  if (!reader) return;
  state.pendingNavigation = undefined;
  emitNavigationStart(
    state,
    deps,
    reader,
    pending.attemptId,
    pending.target,
    pending.direction,
    pending.previous,
    pending.continuityDx,
    pending.gesture,
  );
}

export function ensureIncomingSlot(
  deps: NavigationDeps,
  spreadIndex: number,
  direction: 'forward' | 'backward',
): boolean {
  const slotPosition = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(spreadIndex) !== slotPosition) {
    deps.pool.assignSlot(slotPosition, spreadIndex);
  }
  return deps.pool.ensureContent(slotPosition, deps.contentRenderer);
}

export function navigationTarget(
  reader: Reader,
  requested: number,
): { readonly index: number; readonly pagination?: ReaderIncrementalPagination } {
  const pagination = reader.pagination;
  if (
    pagination &&
    !pagination.complete &&
    Number.isSafeInteger(requested) &&
    requested >= reader.totalSpreads
  ) {
    return { index: Math.max(0, requested), pagination };
  }
  return { index: Math.max(0, Math.min(requested, reader.totalSpreads - 1)) };
}

/** Grow one forward spread for an active selection without stealing navigation ownership. */
export async function ensureSelectionSpread(
  state: NavigationState,
  deps: NavigationDeps,
  target: number,
  signal: AbortSignal,
): Promise<boolean | undefined> {
  const reader = deps.getReader();
  if (state.disposed || signal.aborted || !reader) return undefined;
  if (target < reader.totalSpreads) return true;
  const pagination = reader.pagination;
  if (!pagination || pagination.complete || target !== reader.totalSpreads) return false;
  const snapshot: SelectionGrowthSnapshot = {
    reader,
    pagination,
    totalSpreads: reader.totalSpreads,
    complete: pagination.complete,
  };
  try {
    const available = await Promise.resolve(pagination.ensureSpread(target, signal));
    return settleSelectionGrowth(state, deps, snapshot, target, signal, available);
  } catch (error: unknown) {
    if (!ownsSelectionGrowth(state, deps, snapshot)) return undefined;
    publishSelectionExtentChange(deps, snapshot);
    if (selectionGrowthWasAborted(signal)) {
      return undefined;
    }
    failSelectionGrowth(deps, error);
    return undefined;
  }
}

interface SelectionGrowthSnapshot {
  readonly reader: Reader;
  readonly pagination: ReaderIncrementalPagination;
  readonly totalSpreads: number;
  readonly complete: boolean;
}

function settleSelectionGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  snapshot: SelectionGrowthSnapshot,
  target: number,
  signal: AbortSignal,
  available: boolean | undefined,
): boolean | undefined {
  if (!ownsSelectionGrowth(state, deps, snapshot)) return undefined;
  const extentChanged = selectionExtentChanged(snapshot);
  if (selectionGrowthWasAborted(signal)) {
    if (extentChanged) deps.onPaginationChanged?.();
    return undefined;
  }
  if (available === false && !snapshot.pagination.complete) {
    throw new Error('Reader returned a final pagination miss before committing completion');
  }
  if (available !== undefined || extentChanged) deps.onPaginationChanged?.();
  if (available !== true) return available;
  if (target < snapshot.reader.totalSpreads) return true;
  failSelectionGrowth(deps, 'Reader did not publish the requested selection spread');
  return undefined;
}

function ownsSelectionGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  snapshot: SelectionGrowthSnapshot,
): boolean {
  const currentReader = deps.getReader();
  return (
    !state.disposed &&
    currentReader === snapshot.reader &&
    currentReader.pagination === snapshot.pagination
  );
}

function selectionExtentChanged(snapshot: SelectionGrowthSnapshot): boolean {
  return (
    snapshot.reader.totalSpreads !== snapshot.totalSpreads ||
    snapshot.pagination.complete !== snapshot.complete
  );
}

function selectionGrowthWasAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

function publishSelectionExtentChange(
  deps: NavigationDeps,
  snapshot: SelectionGrowthSnapshot,
): void {
  if (selectionExtentChanged(snapshot)) deps.onPaginationChanged?.();
}

function failSelectionGrowth(deps: NavigationDeps, error: unknown): void {
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source: 'reader pagination',
  });
}

function settleSpreadGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingNavigation,
  available: boolean | undefined,
): void {
  if (currentPending(state, pending.target) !== pending) return;
  pending.growthAbort = undefined;
  if (available === false && pending.growthPagination?.complete !== true) {
    throw new Error('Reader returned a final pagination miss before committing completion');
  }
  if (available !== true) {
    console.error(
      `[rito] queued navigation to spread ${String(pending.target)} abandoned: the spread never became available`,
    );
    state.pendingNavigation = undefined;
    pending.gesture?.onUnavailable?.();
    if (available === false) {
      deps.onPaginationChanged?.();
    }
    if (pending.attemptId === state.navigationAttemptId) deps.onNavigationCancelled?.();
    return;
  }
  deps.onPaginationChanged?.();
  if (currentPending(state, pending.target) !== pending) return;
  const reader = deps.getReader();
  if (!reader || pending.target >= reader.totalSpreads) {
    failSpreadGrowth(
      state,
      deps,
      pending,
      new Error('Reader reported a spread available without committing its extent'),
    );
    return;
  }
  continuePendingNavigation(state, deps, pending.target);
}

function handleSpreadGrowthFailure(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingNavigation,
  error: unknown,
): void {
  try {
    failSpreadGrowth(state, deps, pending, error);
  } catch {
    if (currentPending(state, pending.target) === pending) state.pendingNavigation = undefined;
  }
}

function failSpreadGrowth(
  state: NavigationState,
  deps: NavigationDeps,
  pending: PendingNavigation,
  error: unknown,
): void {
  if (currentPending(state, pending.target) !== pending) return;
  pending.growthAbort = undefined;
  state.pendingNavigation = undefined;
  pending.gesture?.onUnavailable?.();
  if (pending.attemptId === state.navigationAttemptId) deps.onNavigationCancelled?.();
  deps.emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source: 'reader pagination',
  });
}

function currentPending(
  state: NavigationState,
  spreadIndex: number,
): PendingNavigation | undefined {
  const pending = state.pendingNavigation;
  return pending?.attemptId === state.navigationAttemptId && pending.target === spreadIndex
    ? pending
    : undefined;
}
