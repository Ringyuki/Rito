import type { LayoutConfig, ReaderLocator, ReaderLocatorResolution } from '../../reader';
import { commitBrowserReaderBoundedSnapshot } from './bounded-revision-commit';
import { cachedHostLineMetricEntries, cachedUnavailableFontFamilies } from './host-line-metrics';
import { ensureCoalescedBrowserReaderBoundedLocator } from './bounded-locator-mutation';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import {
  abandonBrowserReaderBoundedCandidate,
  createBrowserReaderBoundedSessionOwner,
  installBrowserReaderBoundedCandidate,
  ownsBrowserReaderBoundedCandidate,
  ownsBrowserReaderCandidateGeneration,
  retireBrowserReaderBoundedOwner,
  watchBrowserReaderBoundedCandidateAbort,
} from './bounded-session-owner';
import {
  restoreBrowserReaderExactReads,
  suspendBrowserReaderExactReads,
  type BrowserReaderBoundedSessionOwner,
  type BrowserReaderExactReadGate,
} from './reader-session-host';
import { toCoreLayoutConfig } from './reader-layout';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import { copyReaderLocator } from './reader/interaction-capture';
import type { BrowserReaderState } from './reader/types';
import {
  replaceBrowserReaderFontGeometryMutation,
  type BrowserReaderBoundedReplacementTarget,
} from './bounded-font-geometry';
import { enqueueBrowserReaderCurrentMutation } from './current-mutation-queue';
import { startBrowserReaderCandidateTarget } from './bounded-candidate-target';
import {
  beginBrowserReaderChapterLocalPreview,
  settleBrowserReaderChapterLocalPreview,
} from './chapter-local-preview/coordinator';
import {
  activateBrowserReaderContinuationBatchCandidate,
  activateBrowserReaderContinuationBatchTargetWithoutPreview,
  beginBrowserReaderContinuationBatchIntent,
  createBrowserReaderContinuationBatchLocatorLifecycle,
} from './adaptive-continuation-batch';

const INITIAL_SPREAD_LAYOUT_NODE_BUDGET = 1;
const BOUNDED_GROWTH_LAYOUT_NODE_BUDGET = 32;

export { createBrowserReaderBoundedSessionOwner };

export interface BrowserReaderBoundedLayoutRequest {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly targetSpreadIndex: number;
  readonly preserveLocator?: ReaderLocator | undefined;
  /** Initial open may recover an invalid locator to its fallback spread. */
  readonly fallbackOnLocatorFailure?: boolean | undefined;
  readonly complete?: boolean | undefined;
  readonly expectedActiveSpreadIndex?: number | undefined;
  readonly notifyLayoutCommitted?: boolean | undefined;
  readonly preserveActiveSpread?: (() => boolean) | undefined;
  readonly onCommitted?: (() => void) | undefined;
}

export async function startBrowserReaderBoundedCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  request: BrowserReaderBoundedLayoutRequest,
  signal?: AbortSignal,
): Promise<BrowserReaderBoundedSnapshot | undefined> {
  if (state.disposed || signal?.aborted) {
    await retireBrowserReaderBoundedOwner(state, owner);
    return undefined;
  }
  const generation = await installBrowserReaderBoundedCandidate(state, owner);
  if (!ownsBrowserReaderBoundedCandidate(state, owner, generation) || signal?.aborted) {
    await abandonBrowserReaderBoundedCandidate(state, owner);
    return undefined;
  }
  const baseCommitGeneration = state.commitGeneration;
  const stopWatchingAbort = watchBrowserReaderBoundedCandidateAbort(
    state,
    owner,
    generation,
    signal,
  );
  try {
    return await runCandidate(state, owner, request, generation, baseCommitGeneration, signal);
  } catch (error) {
    await abandonBrowserReaderBoundedCandidate(state, owner);
    if (candidateWasCancelled(state, generation, signal)) {
      return undefined;
    }
    throw error;
  } finally {
    stopWatchingAbort();
  }
}

function candidateWasCancelled(
  state: BrowserReaderState,
  generation: number,
  signal: AbortSignal | undefined,
): boolean {
  return (
    state.disposed ||
    signal?.aborted === true ||
    !ownsBrowserReaderCandidateGeneration(state, generation)
  );
}

async function runCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  request: BrowserReaderBoundedLayoutRequest,
  generation: number,
  baseCommitGeneration: number,
  signal?: AbortSignal,
): Promise<BrowserReaderBoundedSnapshot | undefined> {
  const startRequest = {
    layoutConfig: toCoreLayoutConfig(request.config, state.fontMetrics),
    lineBreaking: request.lineBreaking,
    budget: {
      maxTopLevelNodes: candidateStartBudget(request),
    },
    growthBudget: { maxTopLevelNodes: BOUNDED_GROWTH_LAYOUT_NODE_BUDGET },
  } as const;
  activateBrowserReaderContinuationBatchCandidate(owner);
  let snapshot = await startBrowserReaderCandidateTarget(owner, request, startRequest);
  if (request.complete) snapshot = await owner.controller.complete();
  if (!ownsBrowserReaderBoundedCandidate(state, owner, generation) || signal?.aborted) {
    await abandonBrowserReaderBoundedCandidate(state, owner);
    return undefined;
  }
  const result = await commitBrowserReaderBoundedSnapshot(state, {
    owner,
    snapshot,
    config: request.config,
    spreadMode: request.spreadMode,
    lineBreaking: request.lineBreaking,
    baseCommitGeneration,
    expectedActiveSpreadIndex: request.expectedActiveSpreadIndex,
    notifyLayoutCommitted: request.notifyLayoutCommitted,
    preserveActiveSpread: request.preserveActiveSpread,
    onCommitted: request.onCommitted,
  });
  if (!result.committed) {
    await abandonBrowserReaderBoundedCandidate(state, owner);
    return undefined;
  }
  if (result.retiredOwner) await retireBrowserReaderBoundedOwner(state, result.retiredOwner);
  return signal?.aborted ? undefined : (result.committedSnapshot ?? snapshot);
}

function candidateStartBudget(request: BrowserReaderBoundedLayoutRequest): number {
  return request.preserveLocator || request.targetSpreadIndex !== 0
    ? BOUNDED_GROWTH_LAYOUT_NODE_BUDGET
    : INITIAL_SPREAD_LAYOUT_NODE_BUDGET;
}

export function ensureBrowserReaderBoundedSpread(
  state: BrowserReaderState,
  spreadIndex: number,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  if (!Number.isSafeInteger(spreadIndex) || spreadIndex < 0) {
    return Promise.reject(
      new RangeError('Bounded reader spread index must be a non-negative integer'),
    );
  }
  const continuationBatchIntent = beginBrowserReaderContinuationBatchIntent(state);
  return enqueueBrowserReaderCurrentMutation(state, async () => {
    if (signal?.aborted || state.disposed) return undefined;
    if (spreadIndex < state.revisionBundle.revision.spreadCount) return true;
    if (state.revisionBundle.revision.status === 'complete') return false;
    activateBrowserReaderContinuationBatchTargetWithoutPreview(state, continuationBatchIntent);
    // A growth commit extends the page table; it never moves the visible
    // spread. The reader may have navigated while this layout was in
    // flight, and the request-time target is stale by then — the
    // navigation layer performs the actual turn when it resumes off the
    // commit (measured: rapid keyboard turns during pagination bounced
    // back to the growth target one spread behind).
    const snapshot = await mutateCurrent(
      state,
      (owner) => owner.controller.ensureSpread(spreadIndex),
      false,
      () => ({ targetSpreadIndex: spreadIndex }),
      undefined,
      undefined,
      () => true,
    );
    if (!snapshot || signal?.aborted) return undefined;
    return spreadIndex < snapshot.revision.spreadCount;
  });
}

export function ensureBrowserReaderBoundedLocator(
  state: BrowserReaderState,
  locator: ReaderLocator,
  signal?: AbortSignal,
): Promise<ReaderLocatorResolution | undefined> {
  const copied = copyReaderLocator(locator);
  const continuationBatchIntent = signal?.aborted
    ? undefined
    : beginBrowserReaderContinuationBatchIntent(state);
  const preview = beginBrowserReaderChapterLocalPreview(state, copied, continuationBatchIntent);
  // Without a provisional owner, the exact revision publication is the visual
  // handoff. Notify Kit before resolving the locator so its subsequent
  // onResolved continuation observes the target as current and stays atomic.
  // A live preview owns that handoff and must retain its animated lifecycle.
  const notifyExactLayoutCommitted = preview === undefined;
  const main = ensureCoalescedBrowserReaderBoundedLocator(
    state,
    copied,
    signal,
    (target, replacementTarget, isCurrent, whenSuperseded) =>
      mutateCurrent(
        state,
        target,
        notifyExactLayoutCommitted,
        replacementTarget,
        isCurrent,
        whenSuperseded,
      ),
    createBrowserReaderContinuationBatchLocatorLifecycle(state, preview, continuationBatchIntent),
  );
  return main.then(
    (resolution) => {
      settleBrowserReaderChapterLocalPreview(state, preview, resolution);
      return resolution;
    },
    (error: unknown) => {
      settleBrowserReaderChapterLocalPreview(state, preview, undefined);
      throw error;
    },
  );
}

export function completeBrowserReaderBoundedSession(
  state: BrowserReaderState,
  signal?: AbortSignal,
  options?: { readonly refreshHostLineMetrics?: boolean },
): Promise<boolean | undefined> {
  return enqueueBrowserReaderCurrentMutation(state, async () => {
    if (signal?.aborted || state.disposed) return undefined;
    // A completed table normally stands — but host line metrics measured
    // AFTER the bounded worker opened never reached it, so a refresh
    // pushes the full metric cache into that worker and re-completes:
    // without this, lines whose metrics arrived late stay laid out with
    // the shaped fallback forever (a footnote-marker line painted its
    // baseline one row high).
    const refresh = options?.refreshHostLineMetrics === true;
    if (!refresh && state.revisionBundle.revision.status === 'complete') return true;
    // Completion also only extends/settles the table; the visible spread
    // stays wherever the reader is at commit time (the request-time
    // capture below is stale once the user turns mid-flight).
    const snapshot = await mutateCurrent(
      state,
      async (owner) => {
        if (refresh) {
          const cached = cachedHostLineMetricEntries();
          if (cached.length > 0) await owner.worker.setHostLineMetrics(cached);
          const denied = cachedUnavailableFontFamilies();
          if (denied.length > 0) await owner.worker.setUnavailableFontFaces(denied);
        }
        return owner.controller.complete();
      },
      true,
      () => ({ targetSpreadIndex: state.activeSpreadIndex, complete: true }),
      undefined,
      undefined,
      () => true,
    );
    if (!snapshot || signal?.aborted) return undefined;
    if (snapshot.target.kind !== 'complete' || snapshot.revision.status !== 'complete') {
      throw new Error('Bounded reader completion mutation did not commit a complete revision');
    }
    return true;
  });
}

async function mutateCurrent(
  state: BrowserReaderState,
  target: (owner: BrowserReaderBoundedSessionOwner) => Promise<BrowserReaderBoundedSnapshot>,
  notifyLayoutCommitted: boolean,
  replacementTarget: () => BrowserReaderBoundedReplacementTarget,
  isCurrent: () => boolean = () => true,
  whenSuperseded?: () => Promise<void>,
  preserveActiveSpread?: () => boolean,
): Promise<BrowserReaderBoundedSnapshot | undefined> {
  const owner = state.boundedSessions.current;
  if (!owner) throw new Error('Browser reader has no current bounded session');
  const gate = suspendBrowserReaderExactReads(state);
  if (!gate) throw new Error('Browser reader could not suspend exact reads for bounded growth');
  const baseCommitGeneration = state.commitGeneration;
  try {
    const snapshot = await target(owner);
    const result = await commitBrowserReaderBoundedSnapshot(state, {
      owner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      lineBreaking: state.lineBreaking,
      baseCommitGeneration,
      exactReadGate: gate,
      notifyLayoutCommitted,
      isCurrent,
      superseded: whenSuperseded?.(),
      preserveActiveSpread: preserveActiveSpread ?? (() => !isCurrent()),
    });
    if (result.committed) return result.committedSnapshot ?? snapshot;
    if (result.requiresFontGeometryReflow) {
      const replacement = await replaceBrowserReaderFontGeometryMutation(
        state,
        owner,
        replacementTarget,
        true, // Font-geometry fallback always replaces the stable-prefix session.
        startBrowserReaderBoundedCandidate,
        preserveActiveSpread ?? (() => !isCurrent()),
      );
      if (replacement) return replacement;
    }
    await recoverUncommittedMutation(state, owner, gate);
    return undefined;
  } catch (error) {
    // A suspension outlives the operation that created it, so every exit has
    // to either hand reads back or retire the owner that holds them. Leaving
    // both undone strands `readsSuspended` and every later reflow waits on a
    // gate nobody can reopen.
    if (state.disposed) return undefined;
    if (state.boundedSessions.current !== owner) {
      releaseStrandedExactReads(state, owner, gate);
      return undefined;
    }
    if (!restoreBrowserReaderExactReads(state, gate)) {
      await detachFailedCurrentOwner(state, owner, error);
    }
    throw error;
  }
}

// Hands reads back on an owner this state no longer tracks.
///
// The owner is already superseded, so nothing will commit through its gate;
// the flag would otherwise stay set on a session that outlives the failure.
function releaseStrandedExactReads(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  gate: BrowserReaderExactReadGate,
): void {
  if (owner.gateGeneration !== gate.generation) return;
  owner.readsSuspended = false;
  resumeBrowserReaderSuspendedFrameMisses(state, owner);
}

async function recoverUncommittedMutation(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  gate: BrowserReaderExactReadGate,
): Promise<void> {
  if (state.boundedSessions.current !== owner) {
    releaseStrandedExactReads(state, owner, gate);
    return;
  }
  if (!restoreBrowserReaderExactReads(state, gate)) {
    await detachFailedCurrentOwner(
      state,
      owner,
      new Error('Bounded reader mutation could not restore its exact revision'),
    );
  }
}

/// Retires a bounded session whose suspended reads never reopened.
///
/// Suspension is handed back by whichever operation took it, so an operation
/// that never settles keeps the gate shut forever. The session is then
/// unusable: retire it so a caller can rebuild instead of waiting on a gate
/// nobody will reopen.
export async function reclaimBrowserReaderStalledSession(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
): Promise<void> {
  if (state.boundedSessions.current !== owner) return;
  await detachFailedCurrentOwner(
    state,
    owner,
    new Error('Bounded reader session never reopened its exact reads'),
  );
}

async function detachFailedCurrentOwner(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  error: unknown,
): Promise<void> {
  owner.terminalError = error instanceof Error ? error : new Error(String(error));
  if (state.boundedSessions.current === owner) state.boundedSessions.current = undefined;
  if (state.worker === owner.worker) state.revisionHandle = undefined;
  await retireBrowserReaderBoundedOwner(state, owner);
}
