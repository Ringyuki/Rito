import type { LayoutConfig } from '../../reader';
import type { BrowserReaderRevisionResult } from './core-contracts';
import {
  requireBrowserReaderRevisionSnapshotCommit,
  type BrowserReaderRevisionSnapshotCommitContract,
} from './revision-snapshot';
import {
  resumeBrowserReaderExactReads,
  type BrowserReaderRevisionSessionOwner,
} from './reader-session-host';
import { applyBrowserReaderRevisionState } from './reader/revision';
import type { BrowserReaderState } from './reader/types';
import {
  canCommitBrowserReaderSameRevisionFrame,
  prepareBrowserReaderSameRevisionFrame,
  publishBrowserReaderSameRevisionFrame,
  type PreparedSameRevisionFrame,
} from './same-revision-commit';
import {
  clampBrowserReaderSpreadIndex,
  notifyBrowserReaderCommitCallback,
  notifyBrowserReaderLayoutCommitted,
} from './revision-commit-notifications';
import { createBrowserReaderRevisionResult } from './revision-result';
import { prepareBrowserReaderRevisionFrameCache } from './revision-frame-cache';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import {
  prepareControllerOwnedBrowserReaderCommitFrame,
  type BrowserReaderPreparedCommitFrame,
} from './commit-frame';
import { prepareControllerOwnedRevisionFonts } from './required-fonts';

export interface BrowserReaderRevisionCommitInput extends BrowserReaderRevisionSnapshotCommitContract {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  /** Capture after suspending a current session, or before starting a candidate. */
  readonly baseCommitGeneration: number;
  /** Internal latest-wins guard for a coalesced current-session mutation. */
  readonly isCurrent?: (() => boolean) | undefined;
  /** Resolves when commit preparation may stop waiting for non-critical resources. */
  readonly superseded?: Promise<void> | undefined;
  /** Same-session extent growth is published by its caller without a full layout reset. */
  readonly notifyLayoutCommitted?: boolean | undefined;
  /** Reject a candidate if navigation moved after its reading anchor was captured. */
  readonly expectedActiveSpreadIndex?: number | undefined;
  /** Runs inside the atomic publication, before public layout listeners. */
  readonly onCommitted?: (() => void) | undefined;
  /** Keep navigation stable when background growth was cancelled or superseded. */
  readonly preserveActiveSpread?: (() => boolean) | undefined;
}

export interface BrowserReaderRevisionCommitResult {
  readonly committed: boolean;
  /** The caller must drain this controller before disposing its worker. */
  readonly retiredOwner?: BrowserReaderRevisionSessionOwner | undefined;
}

interface PreparedRevisionPublication {
  readonly kind: 'revisionPublication';
  readonly input: BrowserReaderRevisionCommitInput;
  readonly result: BrowserReaderRevisionResult;
  readonly rollbackFonts: () => void;
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

type PreparedRevisionCommit = PreparedRevisionPublication | PreparedSameRevisionFrame;

export async function commitBrowserReaderRevisionSnapshot(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
): Promise<BrowserReaderRevisionCommitResult> {
  const prepared = await prepareRevisionCommit(state, input);
  if (!prepared) return { committed: false };
  const result = publishPreparedRevisionCommit(state, prepared);
  if (!result.committed) rollbackPreparedFonts(prepared);
  return result;
}

function rollbackPreparedFonts(prepared: PreparedRevisionCommit): void {
  if (prepared.kind !== 'sameRevisionFrame') prepared.rollbackFonts();
}

function publishPreparedRevisionCommit(
  state: BrowserReaderState,
  prepared: PreparedRevisionCommit,
): BrowserReaderRevisionCommitResult {
  try {
    return publishRevisionCommit(state, prepared);
  } catch (error) {
    rollbackPreparedFonts(prepared);
    throw error;
  }
}

async function prepareRevisionCommit(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
): Promise<PreparedRevisionCommit | undefined> {
  requireBrowserReaderRevisionSnapshotCommit(state, input);
  if (!isEligibleCommit(state, input)) return undefined;
  if (canCommitBrowserReaderSameRevisionFrame(state, input)) {
    return prepareBrowserReaderSameRevisionFrame(state, input, () =>
      isEligibleCommit(state, input),
    );
  }
  const result = await createBrowserReaderRevisionResult(input.owner, input.snapshot);
  if (!isEligibleCommit(state, input)) return undefined;
  return prepareRevisionPublication(state, input, result);
}

async function prepareRevisionPublication(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
  result: BrowserReaderRevisionResult,
): Promise<PreparedRevisionPublication | undefined> {
  const isEligible = (): boolean => isEligibleCommit(state, input);
  const rollbackFonts = await prepareControllerOwnedRevisionFonts(
    state,
    input.owner.worker,
    result.bundle,
    isEligible,
  );
  if (!rollbackFonts) return undefined;
  let commitFrame: BrowserReaderPreparedCommitFrame | undefined;
  try {
    commitFrame = await prepareControllerOwnedBrowserReaderCommitFrame(
      state,
      result,
      input.superseded,
    );
  } catch (error) {
    rollbackFonts();
    throw error;
  }
  if (commitFrame && isEligible()) {
    return { kind: 'revisionPublication', input, result, rollbackFonts, commitFrame };
  }
  rollbackFonts();
  return undefined;
}

function publishRevisionCommit(
  state: BrowserReaderState,
  prepared: PreparedRevisionCommit,
): BrowserReaderRevisionCommitResult {
  const { input } = prepared;
  if (!isEligibleCommit(state, input)) {
    return { committed: false };
  }
  if (prepared.kind === 'sameRevisionFrame') {
    return publishBrowserReaderSameRevisionFrame(state, prepared);
  }
  const candidate = state.revisionSessions.candidate === input.owner;
  const retiredOwner = candidate ? state.revisionSessions.current : undefined;
  if (candidate) {
    state.revisionSessions.current = input.owner;
    state.publishedFontAvailabilityEpoch = state.fontAvailabilityEpoch;
    state.revisionSessions.candidate = undefined;
    input.owner.readsSuspended = false;
  }
  const spreadsBefore = state.revisionBundle.navigation.spreads.map((spread) =>
    spread.pageIndexes.join(','),
  );
  applyRevisionState(state, prepared);
  {
    const spreadCount = prepared.result.bundle.revision.spreadCount;
    // An unchanged or purely-appended spread mapping never repositions
    // the reader: every existing index still names the same content, so
    // the anchor round-trip adds nothing and can only drift (measured on
    // eg.epub: the reading anchor of an image-boundary page resolved one
    // spread back, and every metrics-refresh candidate that landed while
    // the reader sat there yanked it backwards). Only a commit that
    // actually reshuffles existing spreads applies its anchor
    // resolution.
    const spreadsAfter = state.revisionBundle.navigation.spreads;
    const mappingIsPrefix =
      spreadsBefore.length <= spreadsAfter.length &&
      spreadsBefore.every((pages, i) => pages === spreadsAfter[i]?.pageIndexes.join(','));
    // Decided at the assignment instant, not earlier: async gaps inside
    // the commit let the reader navigate between an early check and this
    // write, and a request-time anchor landing here yanked the reader
    // backwards. The commit's target applies only when the reader still
    // sits where the request expected it (or the request carried no
    // expectation and asked for no preservation); any newer user
    // navigation wins and the live spread is kept, clamped to the new
    // extent.
    const preserveNow =
      (candidate &&
        input.expectedActiveSpreadIndex !== undefined &&
        mappingIsPrefix &&
        spreadsBefore.length > 0) ||
      input.preserveActiveSpread?.() === true ||
      (input.expectedActiveSpreadIndex !== undefined &&
        state.activeSpreadIndex !== input.expectedActiveSpreadIndex);
    const next = preserveNow
      ? clampBrowserReaderSpreadIndex(state.activeSpreadIndex, spreadCount)
      : revisionCommitActiveSpread(state, prepared);
    // A locator seek is asked to move the reader; every other commit
    // moving the visible spread is a defect worth reporting loudly.
    if (next !== state.activeSpreadIndex && prepared.input.snapshot.target.kind !== 'locator') {
      console.error(
        `[rito] revision commit moved activeSpreadIndex ${String(state.activeSpreadIndex)} -> ${String(next)} ` +
          `(target=${prepared.input.snapshot.target.kind})`,
      );
    }
    state.activeSpreadIndex = next;
  }
  reopenCurrentExactReads(state, input, candidate);
  notifyBrowserReaderCommitCallback(state, input.onCommitted);
  if (shouldNotifyLayoutCommitted(input)) notifyBrowserReaderLayoutCommitted(state);
  // A candidate can publish a new owner while the retired owner still holds
  // frame misses recorded behind its exact-read gate. Flush only after layout
  // listeners have installed the replacement revision so a deferred Kit
  // navigation retries against the new owner and is not reset by the layout
  // commit callback.
  if (retiredOwner) resumeBrowserReaderSuspendedFrameMisses(state, retiredOwner);
  return {
    committed: true,
    ...(retiredOwner && retiredOwner !== input.owner ? { retiredOwner } : {}),
  };
}

function shouldNotifyLayoutCommitted(input: BrowserReaderRevisionCommitInput): boolean {
  return input.notifyLayoutCommitted !== false && input.isCurrent?.() !== false;
}

function applyRevisionState(
  state: BrowserReaderState,
  prepared: PreparedRevisionPublication,
): void {
  const { input, result } = prepared;
  const frameCache = prepareBrowserReaderRevisionFrameCache(
    state,
    input.owner.worker,
    result,
    prepared.commitFrame.frame,
  );
  applyBrowserReaderRevisionState(state, {
    config: input.config,
    spreadMode: input.spreadMode,
    result,
    worker: input.owner.worker,
    ...frameCache,
  });
}

function revisionCommitActiveSpread(
  state: BrowserReaderState,
  prepared: PreparedRevisionPublication,
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
  input: BrowserReaderRevisionCommitInput,
  candidate: boolean,
): void {
  if (candidate || !input.exactReadGate) return;
  if (!resumeBrowserReaderExactReads(state, input.exactReadGate)) {
    throw new Error('Revision commit could not reopen its exact-read gate');
  }
}

function isEligibleCommit(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
): boolean {
  const accepted = input.owner.acceptedRevision;
  return (
    !state.disposed &&
    state.commitGeneration === input.baseCommitGeneration &&
    (input.expectedActiveSpreadIndex === undefined ||
      state.activeSpreadIndex === input.expectedActiveSpreadIndex) &&
    (state.revisionSessions.current === input.owner ||
      state.revisionSessions.candidate === input.owner) &&
    input.owner.worker.sessionId === accepted?.workerSessionId &&
    accepted.revisionId === input.snapshot.revision.revisionId &&
    accepted.revisionVersion === input.snapshot.revision.revisionVersion
  );
}
