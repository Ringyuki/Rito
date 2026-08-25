import { activeLocalPreview } from '../machine';
import type { ActiveChapterLocalTransition, NavigationMachine } from '../machine';
import type { SettledEvent } from '../../../driver/types';
import type { NavigationDeps } from '../index';
import { finishChapterLocalLease, oppositeDirection, type ResolvedLocator } from './shared';
import {
  completeExactPromotion,
  fatalChapterLocalContainment,
  finishTerminatedTransition,
  tryFinishRestoredMount,
} from './terminal';

export function settleChapterLocalIncoming(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  event: SettledEvent,
): boolean {
  if (event.direction !== active.direction || event.targetSpread !== active.mountSpreadIndex) {
    fatalChapterLocalContainment(machine, deps, active, 'preview settle identity mismatch');
    return true;
  }
  if (!event.committed) {
    if (!deps.pool.cancelProvisionalStage(active.stageToken)) {
      fatalChapterLocalContainment(
        machine,
        deps,
        active,
        'preview cancellation could not release its stage',
      );
      return true;
    }
    tryFinishRestoredMount(machine, deps, active);
    return true;
  }
  if (!deps.pool.commitProvisionalStage(active.stageToken)) {
    fatalChapterLocalContainment(machine, deps, active, 'preview stage commit failed');
    return true;
  }
  active.phase = 'committed';
  active.pending.provisionalPhase = 'committed';
  if (!active.lease.transitionSettled()) {
    active.termination = {
      kind: 'failed',
      error: new Error('Reader retired the exact preview owner before visual settle'),
      failureSource: 'reader chapter-local presentation',
      fallbackToExact: true,
    };
  }
  if (active.termination) {
    startChapterLocalTermination(machine, deps, active);
  } else if (active.pending.exactResolution) {
    promoteOrSettleChapterLocalVisual(machine, deps, active);
  } else {
    settleChapterLocalVisual(deps, active);
  }
  return true;
}

function promoteOrSettleChapterLocalVisual(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  if (promoteChapterLocalExact(machine, deps, active)) return;
  if (
    activeLocalPreview(machine) === active &&
    active.phase === 'committed' &&
    !active.termination
  ) {
    settleChapterLocalVisual(deps, active);
  }
}

function settleChapterLocalVisual(
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  active.visualTransitionSettled = true;
  deps.provisionalRuntime?.visualSettled(active.direction);
}

export function settleChapterLocalRollback(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  event: SettledEvent,
): boolean {
  const direction = oppositeDirection(active.direction);
  if (
    !event.committed ||
    event.direction !== direction ||
    event.targetSpread !== active.mountSpreadIndex
  ) {
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      'preview rollback settle identity mismatch',
    );
    return true;
  }
  if (!deps.pool.completeProvisionalRollback(active.stageToken)) {
    fatalChapterLocalContainment(machine, deps, active, 'preview rollback promotion failed');
    return true;
  }
  tryFinishRestoredMount(machine, deps, active);
  return true;
}

export function startChapterLocalTermination(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  if (activeLocalPreview(machine) !== active) return;
  if (active.phase === 'animating') {
    if (!deps.td.cancelTracking()) {
      fatalChapterLocalContainment(
        machine,
        deps,
        active,
        'preview animation could not settle to zero',
      );
      return;
    }
    deps.frameDriver.scheduleComposite();
  } else if (active.phase === 'committed') {
    startRollback(machine, deps, active);
  } else if (active.phase === 'restoringExact') {
    if (!active.termination?.fallbackToExact) {
      tryFinishRestoredMount(machine, deps, active);
    }
  } else if (active.phase === 'awaitingExactFallback') {
    if (!active.termination?.fallbackToExact) {
      finishTerminatedTransition(machine, deps, active);
    }
  }
}

export function promoteChapterLocalExact(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): boolean {
  const exact = active.pending.exactResolution;
  if (!exact || active.phase !== 'committed') return false;
  const current = deps.getCurrentSpread();
  if (exact.spreadIndex === current) {
    return promoteSameSpreadExact(machine, deps, active, exact);
  }
  const direction = exact.spreadIndex > current ? 'forward' : 'backward';
  if (direction !== active.direction) {
    active.termination = {
      kind: 'failed',
      error: new Error('Exact locator resolved opposite its frozen preview direction'),
      failureSource: active.pending.failureSource,
      fallbackToExact: true,
    };
    startRollback(machine, deps, active);
    return false;
  }
  const slot = direction === 'forward' ? 'next' : 'prev';
  if (deps.pool.getSlotFor(exact.spreadIndex) !== slot) {
    deps.pool.assignSlot(slot, exact.spreadIndex);
  }
  if (deps.pool[slot].spreadIndex !== exact.spreadIndex) return false;
  if (!deps.pool.ensureContent(slot, deps.contentRenderer)) return false;
  if (!deps.pool.promoteProvisionalExact(active.stageToken, slot, exact.spreadIndex)) {
    fatalChapterLocalContainment(machine, deps, active, 'exact preview promotion failed');
    return false;
  }
  finishChapterLocalLease(active);
  completeExactPromotion(machine, deps, active, exact);
  return true;
}

function startRollback(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
): void {
  if (
    activeLocalPreview(machine) !== active ||
    !deps.pool.beginProvisionalRollback(active.stageToken)
  ) {
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      'preview rollback could not claim old raster',
    );
    return;
  }
  active.phase = 'rollingBack';
  const direction = oppositeDirection(active.direction);
  const reopenVisual = active.visualTransitionSettled;
  if (reopenVisual && !deps.provisionalRuntime?.reopenVisual(active.direction, direction)) {
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      'preview rollback could not reopen its visual lifecycle',
    );
    return;
  }
  deps.td.goToTarget(direction, active.mountSpreadIndex, active.mountSpreadIndex);
  if (reopenVisual) deps.emitter.emit('transitionStart', { direction });
  deps.frameDriver.scheduleComposite();
}

function promoteSameSpreadExact(
  machine: NavigationMachine,
  deps: NavigationDeps,
  active: ActiveChapterLocalTransition,
  exact: ResolvedLocator,
): boolean {
  deps.pool.invalidateContentForSpread(active.mountSpreadIndex);
  if (!deps.pool.ensureContent('curr', deps.contentRenderer)) return false;
  if (!deps.pool.finishSameSpreadProvisionalExact(active.stageToken, active.mountSpreadIndex)) {
    fatalChapterLocalContainment(
      machine,
      deps,
      active,
      'same-spread exact preview promotion failed',
    );
    return false;
  }
  finishChapterLocalLease(active);
  completeExactPromotion(machine, deps, active, exact);
  return true;
}
