import type { LayoutConfig, ReaderLocator, ReaderLocatorResolution } from '../../reader';
import { commitBrowserReaderBoundedSnapshot } from './bounded-revision-commit';
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
import { copyReaderLocator } from './reader/interaction-capture';
import type { BrowserReaderState } from './reader/types';
import {
  replaceBrowserReaderFontGeometryMutation,
  type BrowserReaderBoundedReplacementTarget,
} from './bounded-font-geometry';
import { enqueueBrowserReaderCurrentMutation } from './current-mutation-queue';

const INITIAL_SPREAD_LAYOUT_NODE_BUDGET = 1;
const BOUNDED_GROWTH_LAYOUT_NODE_BUDGET = 32;

export { createBrowserReaderBoundedSessionOwner };

export interface BrowserReaderBoundedLayoutRequest {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  readonly targetSpreadIndex: number;
  readonly preserveLocator?: ReaderLocator | undefined;
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
  let snapshot = await owner.controller.start({
    layoutConfig: toCoreLayoutConfig(request.config, state.fontMetrics),
    lineBreaking: request.lineBreaking,
    budget: {
      maxTopLevelNodes:
        request.targetSpreadIndex === 0
          ? INITIAL_SPREAD_LAYOUT_NODE_BUDGET
          : BOUNDED_GROWTH_LAYOUT_NODE_BUDGET,
    },
    growthBudget: { maxTopLevelNodes: BOUNDED_GROWTH_LAYOUT_NODE_BUDGET },
    targetSpreadIndex: request.targetSpreadIndex,
  });
  if (request.preserveLocator) {
    snapshot = await owner.controller.ensureLocator(copyReaderLocator(request.preserveLocator));
  }
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
  return signal?.aborted ? undefined : snapshot;
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
  return enqueueBrowserReaderCurrentMutation(state, async () => {
    if (signal?.aborted || state.disposed) return undefined;
    if (spreadIndex < state.revisionBundle.revision.spreadCount) return true;
    if (state.revisionBundle.revision.status === 'complete') return false;
    const snapshot = await mutateCurrent(
      state,
      (owner) => owner.controller.ensureSpread(spreadIndex),
      false,
      () => ({ targetSpreadIndex: spreadIndex }),
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
  return ensureCoalescedBrowserReaderBoundedLocator(
    state,
    copied,
    signal,
    (target, replacementTarget, isCurrent) =>
      mutateCurrent(state, target, false, replacementTarget, isCurrent),
  );
}

export function completeBrowserReaderBoundedSession(
  state: BrowserReaderState,
  signal?: AbortSignal,
): Promise<boolean | undefined> {
  return enqueueBrowserReaderCurrentMutation(state, async () => {
    if (signal?.aborted || state.disposed) return undefined;
    if (state.revisionBundle.revision.status === 'complete') return true;
    const snapshot = await mutateCurrent(
      state,
      (owner) => owner.controller.complete(),
      true,
      () => ({ targetSpreadIndex: state.activeSpreadIndex, complete: true }),
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
      preserveActiveSpread: () => !isCurrent(),
    });
    if (result.committed) return snapshot;
    if (result.requiresFontGeometryReflow) {
      const replacement = await replaceBrowserReaderFontGeometryMutation(
        state,
        owner,
        replacementTarget,
        // A font-geometry candidate is a full replacement, even when the
        // mutation started as a stable-prefix pagination append.
        true,
        startBrowserReaderBoundedCandidate,
        () => !isCurrent(),
      );
      if (replacement) return replacement;
    }
    await recoverUncommittedMutation(state, owner, gate);
    return undefined;
  } catch (error) {
    if (state.disposed || state.boundedSessions.current !== owner) return undefined;
    if (!restoreBrowserReaderExactReads(state, gate)) {
      await detachFailedCurrentOwner(state, owner, error);
    }
    throw error;
  }
}

async function recoverUncommittedMutation(
  state: BrowserReaderState,
  owner: BrowserReaderBoundedSessionOwner,
  gate: BrowserReaderExactReadGate,
): Promise<void> {
  if (state.boundedSessions.current !== owner) return;
  if (!restoreBrowserReaderExactReads(state, gate)) {
    await detachFailedCurrentOwner(
      state,
      owner,
      new Error('Bounded reader mutation could not restore its exact revision'),
    );
  }
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
