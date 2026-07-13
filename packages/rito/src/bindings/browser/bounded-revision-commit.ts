import type { LayoutConfig } from '../../reader';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderRevisionResult,
  CoreRevisionHandle,
} from './core-contracts';
import {
  prepareControllerOwnedBrowserReaderCommitFrame,
  type BrowserReaderPreparedCommitFrame,
} from './revision-commit';
import { prepareControllerOwnedRevisionFonts } from './required-fonts';
import {
  requireBrowserReaderBoundedSnapshotCommit,
  selectedBrowserReaderBoundedSnapshotFrame,
  type BrowserReaderBoundedSnapshotCommitContract,
} from './bounded-revision-snapshot';
import {
  resumeBrowserReaderExactReads,
  type BrowserReaderBoundedSessionOwner,
} from './reader-session-host';
import { applyBrowserReaderRevisionState } from './reader/revision';
import type { BrowserReaderState } from './reader/types';

export interface BrowserReaderBoundedCommitInput extends BrowserReaderBoundedSnapshotCommitContract {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
  /** Capture after suspending a current session, or before starting a candidate. */
  readonly baseCommitGeneration: number;
}

export interface BrowserReaderBoundedCommitResult {
  readonly committed: boolean;
  /** The caller must drain this controller before disposing its worker. */
  readonly retiredOwner?: BrowserReaderBoundedSessionOwner | undefined;
}

interface PreparedBoundedCommit {
  readonly input: BrowserReaderBoundedCommitInput;
  readonly result: BrowserReaderRevisionResult;
  readonly rollbackFonts: () => void;
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

export async function commitBrowserReaderBoundedSnapshot(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
): Promise<BrowserReaderBoundedCommitResult> {
  const prepared = await prepareBoundedCommit(state, input);
  if (!prepared) return { committed: false };
  return publishBoundedCommit(state, prepared);
}

async function prepareBoundedCommit(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
): Promise<PreparedBoundedCommit | undefined> {
  requireBrowserReaderBoundedSnapshotCommit(state, input);
  if (!isEligibleCommit(state, input)) return undefined;
  const result = await createBoundedRevisionResult(input);
  if (!isEligibleCommit(state, input)) return undefined;
  const rollbackFonts = await prepareControllerOwnedRevisionFonts(
    state,
    input.owner.worker,
    result.bundle,
    () => isEligibleCommit(state, input),
  );
  if (!rollbackFonts) return undefined;
  try {
    const commitFrame = await prepareControllerOwnedBrowserReaderCommitFrame(
      state,
      input.owner.worker,
      result,
    );
    if (isEligibleCommit(state, input)) return { input, result, rollbackFonts, commitFrame };
    rollbackFonts();
    return undefined;
  } catch (error) {
    rollbackFonts();
    throw error;
  }
}

async function createBoundedRevisionResult(
  input: BrowserReaderBoundedCommitInput,
): Promise<BrowserReaderRevisionResult> {
  const { owner, snapshot } = input;
  const handle = revisionHandle(snapshot);
  const [footnotes, chapterTextIndices] = await Promise.all([
    owner.worker.getFootnotesAtRevision(handle),
    owner.worker.getChapterTextIndicesAtRevision(handle),
  ]);
  requireExactAggregate(footnotes, handle, footnotes.value.revisionId, 'footnotes');
  requireExactAggregate(
    chapterTextIndices,
    handle,
    chapterTextIndices.value.revisionId,
    'chapter text indices',
  );
  return resultFromSnapshot(snapshot, footnotes.value, chapterTextIndices.value);
}

function resultFromSnapshot(
  snapshot: BrowserReaderBoundedSnapshot,
  footnotes: BrowserReaderRevisionResult['bundle']['footnotes'],
  chapterTextIndices: BrowserReaderRevisionResult['bundle']['chapterTextIndices'],
): BrowserReaderRevisionResult {
  const selectedFrame = selectedBrowserReaderBoundedSnapshotFrame(snapshot);
  return {
    bundle: {
      ...snapshot.presentation,
      footnotes,
      chapterTextIndices,
    },
    ...(selectedFrame
      ? {
          frameSelection: {
            spreadIndex: selectedFrame.spreadIndex,
            displaySpreadIndex: selectedFrame.displaySpreadIndex,
          },
          selectedFrame,
        }
      : {}),
    ...(snapshot.frameWindow ? { frameWindow: snapshot.frameWindow } : {}),
    preview: false,
  };
}

function publishBoundedCommit(
  state: BrowserReaderState,
  prepared: PreparedBoundedCommit,
): BrowserReaderBoundedCommitResult {
  const { input } = prepared;
  if (!isEligibleCommit(state, input)) {
    prepared.rollbackFonts();
    return { committed: false };
  }
  const candidate = state.boundedSessions.candidate === input.owner;
  const current = state.boundedSessions.current === input.owner;
  const retiredOwner = candidate ? state.boundedSessions.current : undefined;
  if (candidate) {
    state.boundedSessions.current = input.owner;
    state.boundedSessions.candidate = undefined;
    input.owner.readsSuspended = false;
  }
  applyBrowserReaderRevisionState(state, {
    config: input.config,
    spreadMode: input.spreadMode,
    lineBreaking: input.lineBreaking,
    result: prepared.result,
    worker: input.owner.worker,
    initialFrame: prepared.commitFrame.frame,
    previousRevisionOwnedByController: current || retiredOwner !== undefined,
  });
  state.activeSpreadIndex = boundedCommitActiveSpread(state, prepared);
  reopenCurrentExactReads(state, input, candidate);
  notifyLayoutCommitted(state);
  return {
    committed: true,
    ...(retiredOwner && retiredOwner !== input.owner ? { retiredOwner } : {}),
  };
}

function boundedCommitActiveSpread(
  state: BrowserReaderState,
  prepared: PreparedBoundedCommit,
): number {
  const frameSpread = prepared.commitFrame.frame?.spreadIndex;
  if (frameSpread !== undefined) return frameSpread;
  const { target, revision } = prepared.input.snapshot;
  if (target.kind === 'spread' && target.spreadIndex < revision.spreadCount) {
    return target.spreadIndex;
  }
  if (target.kind === 'locator' && target.resolution.status === 'resolved') {
    return target.resolution.spreadIndex;
  }
  return Math.max(0, Math.min(state.activeSpreadIndex, revision.spreadCount - 1));
}

function reopenCurrentExactReads(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
  candidate: boolean,
): void {
  if (candidate || !input.exactReadGate) return;
  if (!resumeBrowserReaderExactReads(state, input.exactReadGate)) {
    throw new Error('Bounded reader commit could not reopen its exact-read gate');
  }
}

function isEligibleCommit(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
): boolean {
  const accepted = input.owner.acceptedRevision;
  return (
    !state.disposed &&
    state.commitGeneration === input.baseCommitGeneration &&
    (state.boundedSessions.current === input.owner ||
      state.boundedSessions.candidate === input.owner) &&
    input.owner.worker.sessionId === accepted?.workerSessionId &&
    accepted.revisionId === input.snapshot.revision.revisionId &&
    accepted.revisionVersion === input.snapshot.revision.revisionVersion
  );
}

function requireExactAggregate(
  response: { readonly revision: CoreRevisionHandle },
  expected: CoreRevisionHandle,
  valueRevisionId: string,
  label: string,
): void {
  if (
    response.revision.revisionId !== expected.revisionId ||
    response.revision.revisionVersion !== expected.revisionVersion ||
    valueRevisionId !== expected.revisionId
  ) {
    throw new Error(`Bounded reader ${label} do not match their exact revision`);
  }
}

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot): CoreRevisionHandle {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

function notifyLayoutCommitted(state: BrowserReaderState): void {
  for (const listener of state.layoutCommittedListeners) {
    try {
      listener(state.activeSpreadIndex);
    } catch (error) {
      state.logger.warn('reader layout committed listener failed', error);
    }
  }
}
