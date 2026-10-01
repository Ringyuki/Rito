import type { LayoutConfig, ReaderLocator, ReaderLocatorResolution } from '../../reader';
import { commitBrowserReaderRevisionSnapshot } from './revision-commit';
import { cachedUnavailableFontFamilies } from './font-availability';
import { ensureCoalescedBrowserReaderRevisionLocator } from './revision-locator-mutation';
import type { BrowserReaderRevisionSnapshot } from './core-contracts';
import {
  abandonBrowserReaderRevisionCandidate,
  createBrowserReaderRevisionSessionOwner,
  installBrowserReaderRevisionCandidate,
  ownsBrowserReaderRevisionCandidate,
  ownsBrowserReaderCandidateGeneration,
  retireBrowserReaderRevisionOwner,
  watchBrowserReaderRevisionCandidateAbort,
} from './revision-session-owner';
import {
  restoreBrowserReaderExactReads,
  suspendBrowserReaderExactReads,
  type BrowserReaderRevisionSessionOwner,
  type BrowserReaderExactReadGate,
} from './reader-session-host';
import { toCoreLayoutConfig } from './reader-layout';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import { copyReaderLocator } from './reader/interaction-capture';
import type { BrowserReaderState } from './reader/types';
import { enqueueBrowserReaderCurrentMutation } from './current-mutation-queue';
import { startBrowserReaderCandidateTarget } from './revision-candidate-target';
import {
  beginBrowserReaderChapterLocalPreview,
  settleBrowserReaderChapterLocalPreview,
} from './chapter-local-preview/coordinator';

export { createBrowserReaderRevisionSessionOwner };

export interface BrowserReaderRevisionLayoutRequest {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly targetSpreadIndex: number;
  readonly preserveLocator?: ReaderLocator | undefined;
  /** Initial open may recover an invalid locator to its fallback spread. */
  readonly fallbackOnLocatorFailure?: boolean | undefined;
  readonly expectedActiveSpreadIndex?: number | undefined;
  readonly notifyLayoutCommitted?: boolean | undefined;
  readonly preserveActiveSpread?: (() => boolean) | undefined;
  readonly onCommitted?: (() => void) | undefined;
}

export async function startBrowserReaderRevisionCandidate(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
  request: BrowserReaderRevisionLayoutRequest,
  signal?: AbortSignal,
): Promise<BrowserReaderRevisionSnapshot | undefined> {
  if (state.disposed || signal?.aborted) {
    await retireBrowserReaderRevisionOwner(state, owner);
    return undefined;
  }
  const generation = await installBrowserReaderRevisionCandidate(state, owner);
  if (!ownsBrowserReaderRevisionCandidate(state, owner, generation) || signal?.aborted) {
    await abandonBrowserReaderRevisionCandidate(state, owner);
    return undefined;
  }
  const baseCommitGeneration = state.commitGeneration;
  const stopWatchingAbort = watchBrowserReaderRevisionCandidateAbort(
    state,
    owner,
    generation,
    signal,
  );
  try {
    return await runCandidate(state, owner, request, generation, baseCommitGeneration, signal);
  } catch (error) {
    await abandonBrowserReaderRevisionCandidate(state, owner);
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
  owner: BrowserReaderRevisionSessionOwner,
  request: BrowserReaderRevisionLayoutRequest,
  generation: number,
  baseCommitGeneration: number,
  signal?: AbortSignal,
): Promise<BrowserReaderRevisionSnapshot | undefined> {
  const startRequest = { layoutConfig: toCoreLayoutConfig(request.config) } as const;
  const snapshot = await startBrowserReaderCandidateTarget(owner, request, startRequest);
  if (!ownsBrowserReaderRevisionCandidate(state, owner, generation) || signal?.aborted) {
    await abandonBrowserReaderRevisionCandidate(state, owner);
    return undefined;
  }
  const result = await commitBrowserReaderRevisionSnapshot(state, {
    owner,
    snapshot,
    config: request.config,
    spreadMode: request.spreadMode,
    baseCommitGeneration,
    expectedActiveSpreadIndex: request.expectedActiveSpreadIndex,
    notifyLayoutCommitted: request.notifyLayoutCommitted,
    preserveActiveSpread: request.preserveActiveSpread,
    onCommitted: request.onCommitted,
  });
  if (!result.committed) {
    await abandonBrowserReaderRevisionCandidate(state, owner);
    return undefined;
  }
  if (result.retiredOwner) await retireBrowserReaderRevisionOwner(state, result.retiredOwner);
  return signal?.aborted ? undefined : snapshot;
}

export function ensureBrowserReaderRevisionLocator(
  state: BrowserReaderState,
  locator: ReaderLocator,
  signal?: AbortSignal,
): Promise<ReaderLocatorResolution | undefined> {
  const copied = copyReaderLocator(locator);
  const preview = beginBrowserReaderChapterLocalPreview(state, copied);
  // Without a provisional owner, the exact revision publication is the visual
  // handoff. Notify Kit before resolving the locator so its subsequent
  // onResolved continuation observes the target as current and stays atomic.
  // A live preview owns that handoff and must retain its animated lifecycle.
  const notifyExactLayoutCommitted = preview === undefined;
  const main = ensureCoalescedBrowserReaderRevisionLocator(
    state,
    copied,
    signal,
    (target, isCurrent, whenSuperseded) =>
      mutateCurrent(state, target, notifyExactLayoutCommitted, isCurrent, whenSuperseded),
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

/// Faces rejected AFTER the revision worker opened never reached it, so
/// this pushes the rejected font faces (with the render ratio) into the
/// committed revision's worker and commits that same revision's whole-book
/// target again. It does not lay the book out again: `controller.complete()`
/// re-evaluates the target on the existing revision, whose page table stays
/// as built; the engine rebuilds without the rejected faces, and the layout
/// that applies that to the whole book is the forced reflow each
/// convergence round schedules.
///
/// The visible spread stays wherever the reader is at commit time: a
/// request-time capture would be stale once the user turns mid-flight.
/// Resolves `undefined` when the reader was disposed, the signal aborted,
/// or another mutation superseded the commit.
export function refreshBrowserReaderFontAvailability(
  state: BrowserReaderState,
  signal?: AbortSignal,
): Promise<BrowserReaderRevisionSnapshot | undefined> {
  return enqueueBrowserReaderCurrentMutation(state, async () => {
    if (signal?.aborted || state.disposed) return undefined;
    const snapshot = await mutateCurrent(
      state,
      async (owner) => {
        await owner.worker.setRenderRatio(state.dpr);
        const denied = cachedUnavailableFontFamilies();
        if (denied.length > 0) await owner.worker.setUnavailableFontFaces(denied);
        return owner.controller.complete();
      },
      true,
      undefined,
      undefined,
      () => true,
    );
    if (!snapshot || signal?.aborted) return undefined;
    if (snapshot.target.kind !== 'complete') {
      throw new Error('Font availability refresh did not commit a whole-book target');
    }
    return snapshot;
  });
}

async function mutateCurrent(
  state: BrowserReaderState,
  target: (owner: BrowserReaderRevisionSessionOwner) => Promise<BrowserReaderRevisionSnapshot>,
  notifyLayoutCommitted: boolean,
  isCurrent: () => boolean = () => true,
  whenSuperseded?: () => Promise<void>,
  preserveActiveSpread?: () => boolean,
): Promise<BrowserReaderRevisionSnapshot | undefined> {
  const owner = state.revisionSessions.current;
  if (!owner) throw new Error('Browser reader has no current revision session');
  const gate = suspendBrowserReaderExactReads(state);
  if (!gate)
    throw new Error('Browser reader could not suspend exact reads for a revision mutation');
  const baseCommitGeneration = state.commitGeneration;
  try {
    const snapshot = await target(owner);
    const result = await commitBrowserReaderRevisionSnapshot(state, {
      owner,
      snapshot,
      config: state.config,
      spreadMode: state.spreadMode,
      baseCommitGeneration,
      exactReadGate: gate,
      notifyLayoutCommitted,
      isCurrent,
      superseded: whenSuperseded?.(),
      preserveActiveSpread: preserveActiveSpread ?? (() => !isCurrent()),
    });
    if (result.committed) return snapshot;
    await recoverUncommittedMutation(state, owner, gate);
    return undefined;
  } catch (error) {
    // A suspension outlives the operation that created it, so every exit has
    // to either hand reads back or retire the owner that holds them. Leaving
    // both undone strands `readsSuspended` and every later reflow waits on a
    // gate nobody can reopen.
    if (state.disposed) return undefined;
    if (state.revisionSessions.current !== owner) {
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
  owner: BrowserReaderRevisionSessionOwner,
  gate: BrowserReaderExactReadGate,
): void {
  if (owner.gateGeneration !== gate.generation) return;
  owner.readsSuspended = false;
  resumeBrowserReaderSuspendedFrameMisses(state, owner);
}

async function recoverUncommittedMutation(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
  gate: BrowserReaderExactReadGate,
): Promise<void> {
  if (state.revisionSessions.current !== owner) {
    releaseStrandedExactReads(state, owner, gate);
    return;
  }
  if (!restoreBrowserReaderExactReads(state, gate)) {
    await detachFailedCurrentOwner(
      state,
      owner,
      new Error('Revision mutation could not restore its exact revision'),
    );
  }
}

/// Retires a revision session whose suspended reads never reopened.
///
/// Suspension is handed back by whichever operation took it, so an operation
/// that never settles keeps the gate shut forever. The session is then
/// unusable: retire it so a caller can rebuild instead of waiting on a gate
/// nobody will reopen.
export async function reclaimBrowserReaderStalledSession(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
): Promise<void> {
  if (state.revisionSessions.current !== owner) return;
  await detachFailedCurrentOwner(
    state,
    owner,
    new Error('Revision session never reopened its exact reads'),
  );
}

async function detachFailedCurrentOwner(
  state: BrowserReaderState,
  owner: BrowserReaderRevisionSessionOwner,
  error: unknown,
): Promise<void> {
  owner.terminalError = error instanceof Error ? error : new Error(String(error));
  if (state.revisionSessions.current === owner) state.revisionSessions.current = undefined;
  if (state.worker === owner.worker) state.revisionHandle = undefined;
  await retireBrowserReaderRevisionOwner(state, owner);
}
