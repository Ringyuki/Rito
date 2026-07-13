import type { SlotPosition } from '../../painter/types';
import type { NavigationDeps } from './index';
import { clearPendingNavigation, type NavigationState } from './state';

export type NavigationJumpOutcome = 'committed' | 'not-ready' | 'superseded';

export function claimNavigationAttempt(
  state: NavigationState,
  deps: NavigationDeps,
  preservePositionIntent = false,
): number {
  const attemptId = ++state.navigationAttemptId;
  clearPendingNavigation(state);
  deps.onContentInteractionIntent?.();
  if (!preservePositionIntent) deps.onNavigationIntent?.();
  return attemptId;
}

export function jumpToSpread(
  state: NavigationState,
  deps: NavigationDeps,
  attemptId: number,
  index: number,
): boolean {
  if (attemptId !== state.navigationAttemptId) return false;
  const reader = deps.getReader();
  if (!reader) return false;
  const target = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  if (deps.td.isAnimating) deps.td.forceSettle();
  if (attemptId !== state.navigationAttemptId) return false;
  deps.pool.jump(target);
  deps.pool.ensureContent('curr', deps.contentRenderer);
  return commitJump(state, deps, attemptId, target);
}

export function jumpToSpreadIfReady(
  state: NavigationState,
  deps: NavigationDeps,
  attemptId: number,
  index: number,
): NavigationJumpOutcome {
  if (attemptId !== state.navigationAttemptId) return 'superseded';
  const reader = deps.getReader();
  if (!reader) return 'superseded';
  const target = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  if (deps.td.isAnimating) deps.td.forceSettle();
  if (attemptId !== state.navigationAttemptId) return 'superseded';

  const previous = deps.getCurrentSpread();
  const slot = incomingSlot(previous, target);
  if (deps.pool.getSlotFor(target) !== slot) deps.pool.assignSlot(slot, target);
  const ready = deps.pool.ensureContent(slot, deps.contentRenderer);
  if (attemptId !== state.navigationAttemptId) return 'superseded';
  if (!ready) return 'not-ready';

  promoteIncomingSlot(deps, previous, target);
  return commitJump(state, deps, attemptId, target) ? 'committed' : 'superseded';
}

function commitJump(
  state: NavigationState,
  deps: NavigationDeps,
  attemptId: number,
  target: number,
): boolean {
  const reader = deps.getReader();
  if (!reader || attemptId !== state.navigationAttemptId) return false;
  deps.setCurrentSpread(target);
  reader.notifyActiveSpread(target);
  if (!stillOwnsJump(state, deps, attemptId, target)) return false;
  const spread = reader.spreads[target];
  if (spread) deps.emitter.emit('spreadChange', { spreadIndex: target, spread });
  if (!stillOwnsJump(state, deps, attemptId, target)) return false;
  deps.frameDriver.scheduleComposite();
  return true;
}

function incomingSlot(previous: number, target: number): SlotPosition {
  if (target === previous) return 'curr';
  return target > previous ? 'next' : 'prev';
}

function promoteIncomingSlot(deps: NavigationDeps, previous: number, target: number): void {
  if (target === previous) return;
  if (target > previous) deps.pool.rotateForward();
  else deps.pool.rotateBackward();
}

function stillOwnsJump(
  state: NavigationState,
  deps: NavigationDeps,
  attemptId: number,
  target: number,
): boolean {
  return attemptId === state.navigationAttemptId && deps.getCurrentSpread() === target;
}
