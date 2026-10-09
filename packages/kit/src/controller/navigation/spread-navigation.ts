import type { Reader } from '@ritojs/core';
import { claimNavigation } from './claim';
import type { GestureNavigationToken, NavigationDeps } from './index';
import { ensureIncomingSlot, navigationTarget } from './pending';
import { leavesChapterLaidOutAlone, waitForBook } from './book-navigation';
import {
  clearQueuedIntent,
  enqueueIntent,
  queuedBookTurn,
  queuedSpreadTurn,
  settleNavigationForContinuity,
  type GestureNavigationRequest,
  type NavigationAttempt,
  type NavigationIntentSource,
  type NavigationMachine,
} from './machine';
import { emitNavigationStart } from './start';

export function createLocatorNavigator(
  machine: NavigationMachine,
  deps: NavigationDeps,
): (spreadIndex: number) => void {
  return (spreadIndex): void => {
    replaceWithNavigation(machine, deps, goToSpread(machine, deps, spreadIndex, 'locator'));
  };
}

export function startNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  index: number,
  source: NavigationIntentSource = 'api',
): void {
  replaceWithNavigation(machine, deps, goToSpread(machine, deps, index, source));
}

/**
 * A turn of one spread. Turns already waiting for the whole book count:
 * two presses at the chapter's last page are two pages on, and a press
 * back takes one of them away.
 */
export function startRelativeNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  step: 1 | -1,
  source: NavigationIntentSource = 'api',
): void {
  const waiting = queuedBookTurn(machine)?.delta ?? 0;
  startNavigation(machine, deps, deps.getCurrentSpread() + waiting + step, source);
}

export function startGestureNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  index: number,
  onTransitionStart: () => void,
  onUnavailable?: () => void,
): GestureNavigationToken {
  if (machine.disposed) {
    onUnavailable?.();
    return { cancel() {} };
  }
  const request: GestureNavigationRequest = {
    onTransitionStart,
    ...(onUnavailable ? { onUnavailable } : {}),
    started: false,
    cancelled: false,
  };
  replaceWithNavigation(machine, deps, goToSpread(machine, deps, index, 'gesture', request));
  return createGestureToken(machine, deps, request);
}

function createGestureToken(
  machine: NavigationMachine,
  deps: NavigationDeps,
  request: GestureNavigationRequest,
): GestureNavigationToken {
  return {
    cancel(): void {
      if (request.started) return;
      request.cancelled = true;
      if (queuedSpreadTurn(machine)?.gesture === request) {
        machine.claimSeq += 1;
        clearQueuedIntent(machine);
        deps.onNavigationCancelled?.();
      }
    },
  };
}

function goToSpread(
  machine: NavigationMachine,
  deps: NavigationDeps,
  index: number,
  source: NavigationIntentSource,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  const initialReader = deps.getReader();
  if (machine.disposed || !initialReader) return { claimedIntent: false };
  const initialTarget = navigationTarget(initialReader, index);
  const initialPrevious = deps.getCurrentSpread();
  const claim = claimNavigation(machine, deps);
  if (!claim.owns()) return { claimedIntent: true, attemptId: claim.id };
  if (leavesChapterLaidOutAlone(initialReader, index)) {
    if (gesture) return completeNoOpNavigation(deps, claim.id, gesture);
    return waitForBook(claim.id, index - initialPrevious, source, () => {
      startNavigation(machine, deps, deps.getCurrentSpread() + index - initialPrevious, source);
    });
  }
  if (initialTarget === initialPrevious) {
    return completeNoOpNavigation(deps, claim.id, gesture);
  }

  const continuityDx = navigationContinuity(deps);
  const previous = deps.getCurrentSpread();
  if (!claim.owns()) return { claimedIntent: true, attemptId: claim.id };
  const reader = deps.getReader();
  if (!reader) return { claimedIntent: true, attemptId: claim.id };
  const target = navigationTarget(reader, index);
  if (target === previous) {
    return completeNoOpNavigation(deps, claim.id, gesture);
  }
  const direction = target > previous ? 'forward' : 'backward';
  return createKnownSpreadAttempt(
    machine,
    deps,
    reader,
    claim.id,
    target,
    direction,
    previous,
    continuityDx,
    source,
    gesture,
  );
}

/** How far the turn in flight still had to travel, carried into the one that replaces it. */
function navigationContinuity(deps: NavigationDeps): number {
  return deps.td.isAnimating ? settleNavigationForContinuity(deps.td) : 0;
}

function createKnownSpreadAttempt(
  machine: NavigationMachine,
  deps: NavigationDeps,
  reader: Reader,
  attemptId: number,
  target: number,
  direction: 'forward' | 'backward',
  previous: number,
  continuityDx: number,
  source: NavigationIntentSource,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  if (!ensureIncomingSlot(deps, target, direction)) {
    deps.frameDriver.scheduleComposite();
    return {
      claimedIntent: true,
      attemptId,
      pendingNavigation: {
        attemptId,
        target,
        direction,
        previous,
        continuityDx,
        source,
        ...(gesture ? { gesture } : {}),
      },
    };
  }
  emitNavigationStart(
    machine,
    deps,
    reader,
    attemptId,
    target,
    direction,
    previous,
    continuityDx,
    gesture,
  );
  return { claimedIntent: true, attemptId };
}

function completeNoOpNavigation(
  deps: NavigationDeps,
  attemptId: number,
  gesture?: GestureNavigationRequest,
): NavigationAttempt {
  if (gesture && !gesture.started) {
    gesture.cancelled = true;
    gesture.onUnavailable?.();
  }
  deps.onNavigationCancelled?.();
  return { claimedIntent: true, attemptId };
}

function replaceWithNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  attempt: NavigationAttempt,
): void {
  if (!attempt.claimedIntent) {
    const cancelledIntent = clearQueuedIntent(machine);
    if (cancelledIntent) {
      machine.claimSeq += 1;
      deps.onNavigationCancelled?.();
    }
    return;
  }
  if (attempt.attemptId !== machine.claimSeq) return;
  if (attempt.pendingBookTurn) {
    enqueueIntent(machine, { kind: 'book', turn: attempt.pendingBookTurn });
    return;
  }
  enqueueIntent(
    machine,
    attempt.pendingNavigation ? { kind: 'spread', turn: attempt.pendingNavigation } : undefined,
  );
}
