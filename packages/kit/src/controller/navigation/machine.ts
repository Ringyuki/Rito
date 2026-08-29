import type {
  ReaderIncrementalPagination,
  ReaderLocator,
  ReaderLocatorResolution,
  TocEntry,
} from '@ritojs/core';
import type { TransitionDriver } from '../../driver/transition-driver';

/** Where a navigation intent came from, for diagnostics. */
export type NavigationIntentSource = 'api' | 'keyboard' | 'pointer' | 'gesture' | 'locator';

export interface GestureNavigationRequest {
  readonly onTransitionStart: () => void;
  readonly onUnavailable?: (() => void) | undefined;
  started: boolean;
  cancelled: boolean;
}

/** A spread turn waiting for its content slot or pagination growth. */
export interface PendingNavigation {
  readonly attemptId: number;
  readonly target: number;
  readonly direction: 'forward' | 'backward';
  readonly previous: number;
  readonly continuityDx: number;
  readonly source?: NavigationIntentSource;
  readonly gesture?: GestureNavigationRequest;
  readonly growthPagination?: ReaderIncrementalPagination;
  growthAbort?: AbortController | undefined;
}

/** A TOC target waiting for the publication to grow far enough to resolve. */
export interface PendingTocNavigation {
  readonly attemptId: number;
  readonly entry: TocEntry;
}

/** A durable-locator seek waiting for engine-side resolution. */
export interface PendingLocatorNavigation {
  readonly attemptId: number;
  readonly locator: ReaderLocator;
  readonly locatorAbort: AbortController;
  readonly failureSource: string;
  readonly targetLabel: string;
  readonly onResolved: (spreadIndex: number) => void;
  provisionalPhase: 'none' | 'animating' | 'committed';
  previewReadySpread: number | undefined;
  exactResolution: Extract<ReaderLocatorResolution, { readonly status: 'resolved' }> | undefined;
}

export interface ChapterLocalPresentationLease {
  readonly direction: 'forward' | 'backward';
  render(context: OffscreenCanvasRenderingContext2D): boolean;
  composited(): boolean;
  transitionSettled(): boolean;
  finish(): boolean;
}

export interface ChapterLocalTermination {
  readonly kind: 'cancelled' | 'failed' | 'superseded';
  readonly error?: unknown;
  readonly failureSource?: string;
  readonly fallbackToExact?: boolean;
}

export interface ActiveChapterLocalTransition {
  readonly attemptId: number;
  readonly pending: PendingLocatorNavigation;
  readonly mountSpreadIndex: number;
  readonly direction: 'forward' | 'backward';
  readonly stageToken: number;
  readonly lease: ChapterLocalPresentationLease;
  phase: 'animating' | 'committed' | 'rollingBack' | 'restoringExact' | 'awaitingExactFallback';
  visualTransitionSettled: boolean;
  leaseFinished: boolean;
  exactPublished: boolean;
  mountExactPaintRequired: boolean;
  mountExactInvalidated: boolean;
  termination: ChapterLocalTermination | undefined;
}

export interface NavigationAttempt {
  readonly claimedIntent: boolean;
  readonly attemptId?: number;
  readonly pendingNavigation?: PendingNavigation;
}

/**
 * The single queued-intent slot. At most one intent waits at a time —
 * a newer intent always supersedes the older (latest wins). Making the
 * slot a discriminated union removes the illegal "two intents queued"
 * states the old three-field shape allowed by accident.
 */
export type QueuedIntent =
  | { readonly kind: 'spread'; readonly turn: PendingNavigation }
  | { readonly kind: 'toc'; readonly target: PendingTocNavigation }
  | { readonly kind: 'locator'; readonly seek: PendingLocatorNavigation };

/**
 * Who owns the visible raster. `local-preview` is the chapter-local
 * provisional presentation (its own sub-phases live on the transition);
 * `local-finalizing` is the window where its runtime unwinds and no new
 * presentation may mount.
 */
export type ForegroundPresentation =
  | { readonly kind: 'steady' }
  | { readonly kind: 'local-preview'; readonly active: ActiveChapterLocalTransition }
  | { readonly kind: 'local-finalizing' };

/**
 * The navigation state machine: one foreground presentation, one queued
 * intent, one ownership sequence. Every transition goes through the
 * functions in this file (architecture-tested), so a wrong-looking
 * navigation can always be attributed.
 */
export interface NavigationMachine {
  /** Ownership sequence: bumping it revokes every outstanding claim. */
  claimSeq: number;
  zeroContinuityClaim: number | undefined;
  foreground: ForegroundPresentation;
  queued: QueuedIntent | undefined;
  watchdog: ReturnType<typeof setTimeout> | undefined;
  disposed: boolean;
}

export function createNavigationMachine(): NavigationMachine {
  return {
    claimSeq: 0,
    zeroContinuityClaim: undefined,
    foreground: { kind: 'steady' },
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
 * visible. It reports; it never force-cancels (a large book's growth
 * can genuinely be slow).
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
    case 'toc':
      return `TOC navigation to ${intent.target.entry.href}`;
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
      queued.turn.growthAbort?.abort();
      const gesture = queued.turn.gesture;
      if (gesture && !gesture.started) {
        gesture.cancelled = true;
        gesture.onUnavailable?.();
      }
      break;
    }
    case 'locator':
      queued.seek.locatorAbort.abort();
      break;
    case 'toc':
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

export function queuedTocNavigation(machine: NavigationMachine): PendingTocNavigation | undefined {
  return machine.queued?.kind === 'toc' ? machine.queued.target : undefined;
}

export function queuedLocatorSeek(
  machine: NavigationMachine,
): PendingLocatorNavigation | undefined {
  return machine.queued?.kind === 'locator' ? machine.queued.seek : undefined;
}

// ---------------------------------------------------------------------------
// Foreground slot

export function activeLocalPreview(
  machine: NavigationMachine,
): ActiveChapterLocalTransition | undefined {
  return machine.foreground.kind === 'local-preview' ? machine.foreground.active : undefined;
}

export function foregroundIsBusy(machine: NavigationMachine): boolean {
  return machine.foreground.kind !== 'steady';
}

/** The only mount point for a chapter-local presentation. */
export function mountLocalPreview(
  machine: NavigationMachine,
  active: ActiveChapterLocalTransition,
): void {
  machine.foreground = { kind: 'local-preview', active };
}

/** Returns the foreground to steady (preview fully unwound). */
export function dismissLocalPreview(machine: NavigationMachine): void {
  machine.foreground = { kind: 'steady' };
}

/** The unwind window where no new presentation may mount. */
export function beginLocalFinalizing(machine: NavigationMachine): void {
  machine.foreground = { kind: 'local-finalizing' };
}

export function endLocalFinalizing(machine: NavigationMachine): void {
  if (machine.foreground.kind === 'local-finalizing') {
    machine.foreground = { kind: 'steady' };
  }
}

// ---------------------------------------------------------------------------
// Diagnostics

/** One-line answer to "what is navigation doing right now". */
export function describeNavigationPhase(machine: NavigationMachine): string {
  if (machine.disposed) return 'disposed';
  const foreground =
    machine.foreground.kind === 'local-preview'
      ? `local-preview-${machine.foreground.active.phase}`
      : machine.foreground.kind;
  const queued = machine.queued
    ? machine.queued.kind === 'spread' && machine.queued.turn.growthPagination
      ? 'spread-awaiting-growth'
      : `${machine.queued.kind}-queued`
    : 'none';
  return machine.foreground.kind === 'steady' && !machine.queued
    ? 'idle'
    : `${foreground} / ${queued}`;
}

// ---------------------------------------------------------------------------
// Continuity (unchanged semantics from the pre-machine implementation)

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

export function settleNavigationForContinuity(transition: TransitionDriver): number {
  const residualDx = transition.forceSettle();
  const width = transition.viewportWidth;
  return residualDx > 0 ? residualDx - width : residualDx + width;
}

/** Finish a superseded provisional rollback without carrying its displacement into a new intent. */
export function settleNavigationAttemptForContinuity(
  machine: NavigationMachine,
  transition: TransitionDriver,
  attemptId: number,
): number {
  if (machine.zeroContinuityClaim !== attemptId) {
    return settleNavigationForContinuity(transition);
  }
  machine.zeroContinuityClaim = undefined;
  transition.forceSettle();
  return 0;
}
