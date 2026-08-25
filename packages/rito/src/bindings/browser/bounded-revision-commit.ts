import type { LayoutConfig } from '../../reader';
import type { BrowserReaderRevisionResult } from './core-contracts';
import {
  requireBrowserReaderBoundedSnapshotCommit,
  type BrowserReaderBoundedSnapshotCommitContract,
} from './bounded-revision-snapshot';
import {
  resumeBrowserReaderExactReads,
  type BrowserReaderBoundedSessionOwner,
} from './reader-session-host';
import { applyBrowserReaderRevisionState } from './reader/revision';
import type { BrowserReaderState } from './reader/types';
import {
  canCommitBrowserReaderSameRevisionFrame,
  prepareBrowserReaderSameRevisionFrame,
  publishBrowserReaderSameRevisionFrame,
  type PreparedSameRevisionFrame,
} from './bounded-same-revision-commit';
import {
  clampBrowserReaderSpreadIndex,
  notifyBrowserReaderCommitCallback,
  notifyBrowserReaderLayoutCommitted,
} from './bounded-commit-notifications';
import { createBrowserReaderBoundedRevisionResult } from './bounded-revision-result';
import { prepareBrowserReaderBoundedFrameCache } from './bounded-frame-cache';
import { resumeBrowserReaderSuspendedFrameMisses } from './suspended-frame-misses';
import {
  claimVerticalMetricCalibrationSamples,
  prepareBrowserReaderFontGeometryPublication,
  type PreparedFontGeometryPublication,
  type PreparedRevisionPublication as PreparedFontGeometryRevisionPublication,
  type PreparedVerticalFontGeometryCalibration,
} from './bounded-font-geometry-publication';

export interface BrowserReaderBoundedCommitInput extends BrowserReaderBoundedSnapshotCommitContract {
  readonly config: LayoutConfig;
  readonly spreadMode: 'single' | 'double';
  readonly lineBreaking: 'greedy' | 'optimal';
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

export interface BrowserReaderBoundedCommitResult {
  readonly committed: boolean;
  readonly requiresFontGeometryReflow?: boolean | undefined;
  /** Present when same-owner vertical calibration advanced the committed snapshot. */
  readonly committedSnapshot?: BrowserReaderBoundedSnapshotCommitContract['snapshot'] | undefined;
  /** The caller must drain this controller before disposing its worker. */
  readonly retiredOwner?: BrowserReaderBoundedSessionOwner | undefined;
}

interface PreparedBoundedCommitBase {
  readonly input: BrowserReaderBoundedCommitInput;
  readonly result: BrowserReaderRevisionResult;
  readonly rollbackFonts: () => void;
}

type PreparedRevisionPublication = PreparedBoundedCommitBase &
  PreparedFontGeometryRevisionPublication;

type PreparedBoundedCommit =
  | (PreparedBoundedCommitBase & PreparedFontGeometryPublication)
  | PreparedSameRevisionFrame;

type PublishableBoundedCommit = Exclude<
  PreparedBoundedCommit,
  PreparedVerticalFontGeometryCalibration
>;

export async function commitBrowserReaderBoundedSnapshot(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
): Promise<BrowserReaderBoundedCommitResult> {
  let current = input;
  let committedSnapshot: BrowserReaderBoundedSnapshotCommitContract['snapshot'] | undefined;
  const calibrationRollbacks: Array<() => void> = [];
  const calibratedVerticalMetricProgressKeys = new Set<string>();
  try {
    for (;;) {
      const prepared = await prepareBoundedCommit(state, current);
      if (!prepared) {
        rollbackFontPreparations(calibrationRollbacks);
        return { committed: false };
      }
      if (prepared.kind === 'verticalFontGeometryCalibration') {
        const samples = claimVerticalMetricCalibrationSamples(
          calibratedVerticalMetricProgressKeys,
          current.snapshot,
          prepared.samples,
        );
        if (samples.length === 0) {
          prepared.rollbackFonts();
          rollbackFontPreparations(calibrationRollbacks);
          return { committed: false, requiresFontGeometryReflow: true };
        }
        calibrationRollbacks.push(prepared.rollbackFonts);
        const snapshot = await current.owner.controller.calibrateFontVerticalMetrics(samples);
        current = { ...current, snapshot };
        committedSnapshot = snapshot;
        continue;
      }
      const result = publishPreparedBoundedCommit(state, prepared);
      if (!result.committed) {
        rollbackPreparedFonts(prepared);
        rollbackFontPreparations(calibrationRollbacks);
        return result;
      }
      calibrationRollbacks.length = 0;
      return committedSnapshot ? { ...result, committedSnapshot } : result;
    }
  } catch (error) {
    rollbackFontPreparations(calibrationRollbacks);
    throw error;
  }
}

function rollbackPreparedFonts(prepared: PublishableBoundedCommit): void {
  if (prepared.kind !== 'sameRevisionFrame') prepared.rollbackFonts();
}

function publishPreparedBoundedCommit(
  state: BrowserReaderState,
  prepared: PublishableBoundedCommit,
): BrowserReaderBoundedCommitResult {
  try {
    return publishBoundedCommit(state, prepared);
  } catch (error) {
    rollbackPreparedFonts(prepared);
    throw error;
  }
}

function rollbackFontPreparations(rollbacks: readonly (() => void)[]): void {
  for (let index = rollbacks.length - 1; index >= 0; index -= 1) rollbacks[index]?.();
}

async function prepareBoundedCommit(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
): Promise<PreparedBoundedCommit | undefined> {
  requireBrowserReaderBoundedSnapshotCommit(state, input);
  if (!isEligibleCommit(state, input)) return undefined;
  if (canCommitBrowserReaderSameRevisionFrame(state, input)) {
    return prepareBrowserReaderSameRevisionFrame(state, input, () =>
      isEligibleCommit(state, input),
    );
  }
  const result = await createBrowserReaderBoundedRevisionResult(input.owner, input.snapshot);
  if (!isEligibleCommit(state, input)) return undefined;
  return prepareRevisionPublication(state, input, result);
}

async function prepareRevisionPublication(
  state: BrowserReaderState,
  input: BrowserReaderBoundedCommitInput,
  result: BrowserReaderRevisionResult,
): Promise<PreparedBoundedCommit | undefined> {
  const prepared = await prepareBrowserReaderFontGeometryPublication(state, input, result, () =>
    isEligibleCommit(state, input),
  );
  return prepared ? { ...prepared, input, result } : undefined;
}

function publishBoundedCommit(
  state: BrowserReaderState,
  prepared: PublishableBoundedCommit,
): BrowserReaderBoundedCommitResult {
  const { input } = prepared;
  if (!isEligibleCommit(state, input)) {
    return { committed: false };
  }
  if (prepared.kind === 'sameRevisionFrame') {
    return publishBrowserReaderSameRevisionFrame(state, prepared);
  }
  if (prepared.kind === 'horizontalFontGeometryReplacement') {
    return { committed: false, requiresFontGeometryReflow: true };
  }
  const candidate = state.boundedSessions.candidate === input.owner;
  const retiredOwner = candidate ? state.boundedSessions.current : undefined;
  if (candidate) {
    state.boundedSessions.current = input.owner;
    state.publishedHostLineMetricsEpoch = state.hostLineMetricsEpoch;
    state.boundedSessions.candidate = undefined;
    input.owner.readsSuspended = false;
  }
  const spreadsBefore = state.revisionBundle.navigation.spreads.map((spread) =>
    spread.pageIndexes.join(','),
  );
  applyBoundedRevisionState(state, prepared);
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
      : boundedCommitActiveSpread(state, prepared);
    // A locator seek is asked to move the reader; every other commit
    // moving the visible spread is a defect worth reporting loudly.
    if (next !== state.activeSpreadIndex && prepared.input.snapshot.target.kind !== 'locator') {
      console.error(
        `[rito] bounded revision commit moved activeSpreadIndex ${String(state.activeSpreadIndex)} -> ${String(next)} ` +
          `(target=${prepared.input.snapshot.target.kind})`,
      );
    }
    state.activeSpreadIndex = next;
  }
  reopenCurrentExactReads(state, input, candidate);
  notifyBrowserReaderCommitCallback(state, input.onCommitted);
  if (shouldNotifyLayoutCommitted(input)) notifyBrowserReaderLayoutCommitted(state);
  // A font-geometry replacement can publish a new owner while the retired
  // owner still holds frame misses recorded behind its exact-read gate. Flush
  // only after layout listeners have installed the replacement revision so a
  // deferred Kit navigation retries against the new owner and is not reset by
  // the layout commit callback.
  if (retiredOwner) resumeBrowserReaderSuspendedFrameMisses(state, retiredOwner);
  return {
    committed: true,
    ...(retiredOwner && retiredOwner !== input.owner ? { retiredOwner } : {}),
  };
}

function shouldNotifyLayoutCommitted(input: BrowserReaderBoundedCommitInput): boolean {
  return input.notifyLayoutCommitted !== false && input.isCurrent?.() !== false;
}

function applyBoundedRevisionState(
  state: BrowserReaderState,
  prepared: PreparedRevisionPublication,
): void {
  const { input, result } = prepared;
  const frameCache = prepareBrowserReaderBoundedFrameCache(
    state,
    input.owner.worker,
    result,
    prepared.commitFrame.frame,
  );
  applyBrowserReaderRevisionState(state, {
    config: input.config,
    spreadMode: input.spreadMode,
    lineBreaking: input.lineBreaking,
    result,
    worker: input.owner.worker,
    ...frameCache,
  });
}

function boundedCommitActiveSpread(
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
    (input.expectedActiveSpreadIndex === undefined ||
      state.activeSpreadIndex === input.expectedActiveSpreadIndex) &&
    (state.boundedSessions.current === input.owner ||
      state.boundedSessions.candidate === input.owner) &&
    input.owner.worker.sessionId === accepted?.workerSessionId &&
    accepted.revisionId === input.snapshot.revision.revisionId &&
    accepted.revisionVersion === input.snapshot.revision.revisionVersion
  );
}
