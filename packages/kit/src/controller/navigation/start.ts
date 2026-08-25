import type { Reader } from '@ritojs/core';
import { publishSpreadChange } from '../core/spread-change';
import { claimOf, type NavigationClaim } from './claim';
import type { NavigationDeps } from './index';
import type { GestureNavigationRequest, NavigationMachine } from './machine';
import { ownsPresentation, presentSpread } from './present';

/**
 * Presents an accepted spread turn and starts its transition. A gesture
 * may be cancelled between any two externally observable steps (the
 * engine notification and the event listeners run synchronously), so the
 * cancellation check is re-evaluated after each checkpoint instead of
 * being folded into the shared presentation helper.
 */
export function emitNavigationStart(
  machine: NavigationMachine,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: number,
  direction: 'forward' | 'backward',
  previous: number,
  continuityDx: number,
  gesture?: GestureNavigationRequest,
): void {
  const claim = claimOf(machine, attemptId);
  if (gesture?.cancelled || !claim.owns()) return;
  deps.setCurrentSpread(target, 'navigation-start');
  reader.notifyActiveSpread(target);
  if (!ownsPresentation(deps, claim, target)) return;
  if (gesture?.cancelled) {
    revertCancelledGesture(deps, reader, claim, previous, false);
    return;
  }
  publishSpreadChange(deps.emitter, reader, target);
  if (!ownsPresentation(deps, claim, target)) return;
  if (gesture?.cancelled) {
    revertCancelledGesture(deps, reader, claim, previous, true);
    return;
  }
  deps.td.goToTarget(direction, previous, target, continuityDx);
  if (gesture) {
    gesture.started = true;
    gesture.onTransitionStart();
  }
  deps.emitter.emit('transitionStart', { direction });
  deps.frameDriver.scheduleComposite();
}

function revertCancelledGesture(
  deps: NavigationDeps,
  reader: Reader,
  claim: NavigationClaim,
  previous: number,
  targetWasPublished: boolean,
): void {
  if (!presentSpread(deps, reader, claim, previous, 'navigation-cancel', targetWasPublished)) {
    return;
  }
  deps.onNavigationCancelled?.();
  if (!ownsPresentation(deps, claim, previous)) return;
  deps.frameDriver.scheduleComposite();
}
