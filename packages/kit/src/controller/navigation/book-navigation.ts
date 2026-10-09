import type { Reader } from '@ritojs/core';
import { claimNavigation } from './claim';
import type { NavigationDeps } from './index';
import {
  enqueueIntent,
  queuedBookTurn,
  type NavigationAttempt,
  type NavigationIntentSource,
  type NavigationMachine,
} from './machine';

/**
 * Whether `index` lies past the edge of a chapter that is laid out alone:
 * not the end of the book, only of what is laid out so far.
 */
export function leavesChapterLaidOutAlone(reader: Reader, index: number): boolean {
  return reader.layoutScope === 'chapter' && (index < 0 || index >= reader.totalSpreads);
}

/** A turn of `delta` spreads that waits for the whole book, then runs `resume`. */
export function waitForBook(
  attemptId: number,
  delta: number,
  source: NavigationIntentSource,
  resume: () => void,
): NavigationAttempt {
  return { claimedIntent: true, attemptId, pendingBookTurn: { attemptId, delta, source, resume } };
}

/**
 * Navigates to a spread a host names by its book-wide index. While a
 * chapter is laid out alone its spreads count from that chapter's first, so
 * the index means nothing yet: the navigation waits for the whole book.
 */
export function startBookNavigation(
  machine: NavigationMachine,
  deps: NavigationDeps,
  source: NavigationIntentSource,
  navigate: () => void,
): void {
  if (machine.disposed) return;
  if (deps.getReader()?.layoutScope !== 'chapter') {
    navigate();
    return;
  }
  const claim = claimNavigation(machine, deps);
  if (!claim.owns()) return;
  enqueueIntent(machine, {
    kind: 'book',
    turn: { attemptId: claim.id, source, resume: navigate },
  });
}

/** Continues the navigation that waited for the whole book, now that it is committed. */
export function continueBookTurn(machine: NavigationMachine, deps: NavigationDeps): void {
  const pending = queuedBookTurn(machine);
  if (!pending || pending.attemptId !== machine.claimSeq) return;
  if (deps.getReader()?.layoutScope === 'chapter') return;
  enqueueIntent(machine, undefined);
  pending.resume();
}
