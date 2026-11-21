import type { ReaderLocator } from '@ritojs/core';
import type { TransitionDriver } from '../../driver/transition-driver';

/** Where a navigation intent came from, for diagnostics. */
export type NavigationIntentSource = 'api' | 'keyboard' | 'pointer' | 'gesture' | 'locator';

/**
 * A turn past the edge of a chapter that is laid out alone: the spread it
 * leads to exists only once the whole book is laid out, so it waits for
 * that layout to be committed.
 */
export interface PendingBookTurn {
  readonly attemptId: number;
  /**
   * For a turn by spreads: how many, from wherever the reader is when the
   * book arrives. Absent for a spread a host named by its book-wide index.
   */
  readonly delta?: number;
  readonly source?: NavigationIntentSource;
  /** Starts the navigation once the whole book is committed. */
  readonly resume: () => void;
}

/** A durable-locator seek waiting for engine-side resolution. */
export interface PendingLocatorNavigation {
  readonly attemptId: number;
  readonly locator: ReaderLocator;
  readonly locatorAbort: AbortController;
  readonly failureSource: string;
  readonly targetLabel: string;
  readonly onResolved: (spreadIndex: number) => void;
}

export interface NavigationAttempt {
  readonly claimedIntent: boolean;
  readonly attemptId?: number;
  readonly pendingBookTurn?: PendingBookTurn;
}

/**
 * The single queued-intent slot. At most one intent waits at a time —
 * a newer intent always supersedes the older (latest wins). Making the
 * slot a discriminated union removes the illegal "two intents queued"
 * states the old three-field shape allowed by accident.
 */
export type QueuedIntent =
  | { readonly kind: 'book'; readonly turn: PendingBookTurn }
  | { readonly kind: 'locator'; readonly seek: PendingLocatorNavigation };

/**
 * The navigation state machine: one queued intent, one ownership
 * sequence. Every transition goes through the functions in this file
 * (architecture-tested), so a wrong-looking navigation can always be
 * attributed.
 */
export interface NavigationMachine {
  /** Ownership sequence: bumping it revokes every outstanding claim. */
  claimSeq: number;
  queued: QueuedIntent | undefined;
  watchdog: ReturnType<typeof setTimeout> | undefined;
  disposed: boolean;
}

export function createNavigationMachine(): NavigationMachine {
  return {
    claimSeq: 0,
    queued: undefined,
    watchdog: undefined,
    disposed: false,
  };
}

// ---------------------------------------------------------------------------
// Queued-intent slot

/** A queued intent older than this is reported (never force-cancelled). */
const PARKED_INTENT_REPORT_MS = 8000;

/**
 * The only writer of the queued slot. Arms a report-only watchdog: a
 * silently forever-parked intent is the failure mode this makes
 * visible. It reports; it never force-cancels (a slow content paint or
 * locator seek is the reader's to finish).
 */
export function enqueueIntent(machine: NavigationMachine, intent: QueuedIntent | undefined): void {
  machine.queued = intent;
  if (machine.watchdog !== undefined) {
    clearTimeout(machine.watchdog);
    machine.watchdog = undefined;
  }
  if (!intent) return;
  const timer = setTimeout(() => {
    machine.watchdog = undefined;
    if (machine.queued !== intent) return;
    console.error(
      `[rito] ${describeQueuedIntent(intent)} has been parked for ` +
        `${String(PARKED_INTENT_REPORT_MS)}ms (phase: ${describeNavigationPhase(machine)})`,
    );
  }, PARKED_INTENT_REPORT_MS);
  (timer as { unref?: () => void }).unref?.();
  machine.watchdog = timer;
}

function describeQueuedIntent(intent: QueuedIntent): string {
  switch (intent.kind) {
    case 'book':
      return (
        `navigation ${String(intent.turn.delta ?? 'to a book spread')} past the chapter laid out ` +
        `(source: ${intent.turn.source ?? 'unknown'}, attempt ${String(intent.turn.attemptId)})`
      );
    case 'locator':
      return `locator navigation to ${intent.seek.targetLabel}`;
  }
}

/** Clears the queued slot, aborting and notifying the displaced intent. */
export function clearQueuedIntent(machine: NavigationMachine): boolean {
  const queued = machine.queued;
  enqueueIntent(machine, undefined);
  if (!queued) return false;
  if (queued.kind === 'locator') queued.seek.locatorAbort.abort();
  return true;
}

// Typed accessors: consumers read the slot through these so a queued
// intent of another family reads as absence, exactly like the old
// per-family fields — without allowing two families to coexist.

export function queuedBookTurn(machine: NavigationMachine): PendingBookTurn | undefined {
  return machine.queued?.kind === 'book' ? machine.queued.turn : undefined;
}

export function queuedLocatorSeek(
  machine: NavigationMachine,
): PendingLocatorNavigation | undefined {
  return machine.queued?.kind === 'locator' ? machine.queued.seek : undefined;
}

// ---------------------------------------------------------------------------
// Diagnostics

/** One-line answer to "what is navigation doing right now". */
export function describeNavigationPhase(machine: NavigationMachine): string {
  if (machine.disposed) return 'disposed';
  return machine.queued ? `${machine.queued.kind}-queued` : 'idle';
}

// ---------------------------------------------------------------------------
// A newer intent meeting a turn in flight

export interface SupersededNavigation {
  readonly attemptId: number;
  readonly cancelledPending: boolean;
}

/**
 * Something asked of the reader directly: older navigation work is retired,
 * and the turn on screen ends where it was going. A turn still waiting for
 * its page, which nothing on screen shows yet, is dropped with it.
 */
export function supersedeNavigationForDirectInteraction(
  machine: NavigationMachine,
  transition: TransitionDriver,
): SupersededNavigation {
  const attemptId = ++machine.claimSeq;
  const cancelledPending = clearQueuedIntent(machine);
  if (machine.claimSeq === attemptId) transition.settleNow();
  return { attemptId, cancelledPending };
}

/**
 * A finger begins a turn of its own: older navigation work is retired. The
 * turn in flight is the engine's to cut into, the finger taking the picture
 * from where it is.
 */
export function supersedeNavigationForGesture(machine: NavigationMachine): void {
  machine.claimSeq += 1;
  clearQueuedIntent(machine);
}
