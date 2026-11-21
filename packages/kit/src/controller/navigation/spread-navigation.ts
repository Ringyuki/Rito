import { claimNavigation } from './claim';
import type { NavigationDeps } from './index';
import { navigationTarget } from './pending';
import { leavesChapterLaidOutAlone, waitForBook } from './book-navigation';
import {
  clearQueuedIntent,
  enqueueIntent,
  queuedBookTurn,
  type NavigationAttempt,
  type NavigationIntentSource,
  type NavigationMachine,
} from './machine';

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
  const index = deps.getCurrentSpread() + waiting + step;
  replaceWithNavigation(machine, deps, goToSpread(machine, deps, index, source, true));
}

/**
 * A turn to `index`, commanded of the engine. `relative` says it is a step
 * to the neighbour: the engine counts steps made during a turn, and turns a
 * turn going back round. A spread further off is named for the one turn.
 */
function goToSpread(
  machine: NavigationMachine,
  deps: NavigationDeps,
  index: number,
  source: NavigationIntentSource,
  relative = false,
): NavigationAttempt {
  const reader = deps.getReader();
  if (machine.disposed || !reader) return { claimedIntent: false };
  const previous = deps.getCurrentSpread();
  const claim = claimNavigation(machine, deps);
  if (!claim.owns()) return { claimedIntent: true, attemptId: claim.id };
  if (leavesChapterLaidOutAlone(reader, index)) {
    return waitForBook(claim.id, index - previous, source, () => {
      startNavigation(machine, deps, deps.getCurrentSpread() + index - previous, source);
    });
  }
  const target = navigationTarget(reader, index);
  if (target === previous) return completeNoOpNavigation(deps, claim.id);
  const direction = target > previous ? 'next' : 'previous';
  const far = !relative && Math.abs(target - previous) !== 1;
  // A turn to a spread further off lands where it is named: the turn on
  // screen is settled first, so the spread named is the next turn's.
  if (far && deps.td.turning) deps.td.settleNow();
  if (far) deps.turnTargets.aim(direction, target);
  if (!deps.td.command(direction)) {
    deps.turnTargets.forget();
    return completeNoOpNavigation(deps, claim.id);
  }
  deps.frameDriver.scheduleComposite();
  return { claimedIntent: true, attemptId: claim.id };
}

function completeNoOpNavigation(deps: NavigationDeps, attemptId: number): NavigationAttempt {
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
  enqueueIntent(machine, undefined);
}
