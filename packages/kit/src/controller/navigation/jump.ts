import type { SlotPosition } from '../../painter/types';
import type { SelectionGestureLease } from '../../interaction/selection/selection-interaction-owner';
import { claimNavigation, type NavigationClaim } from './claim';
import type { NavigationDeps } from './index';
import { foregroundIsBusy, type NavigationMachine } from './machine';
import { presentSpread } from './present';

export type NavigationJumpOutcome = 'committed' | 'not-ready' | 'superseded';
export type NavigationJumpReadiness = 'ready' | 'not-ready' | 'superseded';

/** Prepare a known spread's buffer without claiming navigation or position ownership. */
export function prepareSpreadForJump(deps: NavigationDeps, index: number): NavigationJumpReadiness {
  if (deps.td.isAnimating) return 'not-ready';
  const reader = deps.getReader();
  if (!reader) return 'superseded';
  const target = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  const slot = incomingSlot(deps.getCurrentSpread(), target);
  if (deps.pool.getSlotFor(target) !== slot) deps.pool.assignSlot(slot, target);
  return deps.pool.ensureContent(slot, deps.contentRenderer) ? 'ready' : 'not-ready';
}

/** Claim and perform one paint-ready snap, optionally preserving one exact native gesture. */
export function performReadyJump(
  machine: NavigationMachine,
  deps: NavigationDeps,
  index: number,
  selectionGesture?: SelectionGestureLease,
): NavigationJumpOutcome {
  if (machine.disposed) return 'superseded';
  const claim = claimNavigation(machine, deps);
  if (foregroundIsBusy(machine)) return 'not-ready';
  if (!claim.owns()) return 'superseded';
  const endTransfer = selectionGesture
    ? deps.beginSelectionProjectionTransfer?.(index, selectionGesture)
    : undefined;
  try {
    return jumpToSpreadIfReady(deps, claim, index);
  } finally {
    endTransfer?.();
  }
}

export function jumpToSpread(deps: NavigationDeps, claim: NavigationClaim, index: number): boolean {
  if (!claim.owns()) return false;
  const reader = deps.getReader();
  if (!reader) return false;
  const target = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  if (deps.td.isAnimating) deps.td.forceSettle();
  if (!claim.owns()) return false;
  deps.pool.jump(target);
  deps.pool.ensureContent('curr', deps.contentRenderer);
  return commitJump(deps, claim, target);
}

export function jumpToSpreadIfReady(
  deps: NavigationDeps,
  claim: NavigationClaim,
  index: number,
): NavigationJumpOutcome {
  if (!claim.owns()) return 'superseded';
  const reader = deps.getReader();
  if (!reader) return 'superseded';
  const target = Math.max(0, Math.min(index, reader.totalSpreads - 1));
  if (deps.td.isAnimating) deps.td.forceSettle();
  if (!claim.owns()) return 'superseded';

  const previous = deps.getCurrentSpread();
  const slot = incomingSlot(previous, target);
  if (deps.pool.getSlotFor(target) !== slot) deps.pool.assignSlot(slot, target);
  const ready = deps.pool.ensureContent(slot, deps.contentRenderer);
  if (!claim.owns()) return 'superseded';
  if (!ready) return 'not-ready';

  promoteIncomingSlot(deps, previous, target);
  return commitJump(deps, claim, target) ? 'committed' : 'superseded';
}

function commitJump(deps: NavigationDeps, claim: NavigationClaim, target: number): boolean {
  const reader = deps.getReader();
  if (!reader || !claim.owns()) return false;
  if (!presentSpread(deps, reader, claim, target, 'jump')) return false;
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
