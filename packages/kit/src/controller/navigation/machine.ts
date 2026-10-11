import type { ReaderLocator } from '@ritojs/core';
import type { TransitionDriver } from '../../driver/transition-driver';

/** Where a navigation intent came from, for diagnostics. */
export type NavigationIntentSource = 'api' | 'keyboard' | 'pointer' | 'gesture' | 'locator';

export interface GestureNavigationRequest {
  readonly onTransitionStart: () => void;
  readonly onUnavailable?: (() => void) | undefined;
  started: boolean;
  cancelled: boolean;
}

/** A spread turn waiting for its incoming content slot to be painted. */
export interface PendingNavigation {
  readonly attemptId: number;
  readonly target: number;
  readonly direction: 'forward' | 'backward';
  readonly previous: number;
  readonly source?: NavigationIntentSource;
  readonly gesture?: GestureNavigationRequest;
}

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
  readonly pendingNavigation?: PendingNavigation;
  readonly pendingBookTurn?: PendingBookTurn;
}

/**
 * The single queued-intent slot. At most one intent waits at a time —
 * a newer intent always supersedes the older (latest wins). Making the
 * slot a discriminated union removes the illegal "two intents queued"
 * states the old three-field shape allowed by accident.
 */
export type QueuedIntent =
  | { readonly kind: 'spread'; readonly turn: PendingNavigation }
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
    case 'spread':
      return (
        `navigation to spread ${String(intent.turn.target)} ` +
        `(source: ${intent.turn.source ?? 'unknown'}, attempt ${String(intent.turn.attemptId)})`
      );
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
  switch (queued.kind) {
    case 'spread': {
      const gesture = queued.turn.gesture;
      if (gesture && !gesture.started) {
        gesture.cancelled = true;
        gesture.onUnavailable?.();
      }
      break;
    }
    case 'book':
      break;
    case 'locator':
      queued.seek.locatorAbort.abort();
      break;
  }
  return true;
}

// Typed accessors: consumers read the slot through these so a queued
// intent of another family reads as absence, exactly like the old
// per-family fields — without allowing two families to coexist.

export function queuedSpreadTurn(machine: NavigationMachine): PendingNavigation | undefined {
  return machine.queued?.kind === 'spread' ? machine.queued.turn : undefined;
}

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

export function supersedeNavigationForDirectInteraction(
  machine: NavigationMachine,
  transition: TransitionDriver,
): SupersededNavigation {
  const attemptId = ++machine.claimSeq;
  const cancelledPending = clearQueuedIntent(machine);
  if (machine.claimSeq === attemptId && transition.isAnimating) {
    transition.forceSettle();
  }
  return { attemptId, cancelledPending };
}

/**
 * A finger begins a turn of its own: older navigation work is retired, and
 * the turn in flight is cut into rather than landed at once, so the finger
 * takes the picture from where it is.
 */
export function supersedeNavigationForGesture(
  machine: NavigationMachine,
  transition: TransitionDriver,
): void {
  const attemptId = ++machine.claimSeq;
  clearQueuedIntent(machine);
  if (machine.claimSeq === attemptId) transition.handOver();
}
