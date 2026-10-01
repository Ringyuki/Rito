import type { BrowserReaderRevisionResult } from './core-contracts';
import type {
  BrowserReaderRevisionCommitInput,
  BrowserReaderRevisionCommitResult,
} from './revision-commit';
import {
  clampBrowserReaderSpreadIndex,
  notifyBrowserReaderCommitCallback,
  notifyBrowserReaderLayoutCommitted,
} from './revision-commit-notifications';
import { selectedBrowserReaderRevisionSnapshotFrame } from './revision-snapshot';
import {
  prepareBrowserReaderCommitResources,
  prepareControllerOwnedBrowserReaderCommitFrame,
  type BrowserReaderPreparedCommitFrame,
} from './commit-frame';
import { applyBrowserReaderFrameWindow, cacheFrame } from './reader/frame-cache';
import type { BrowserReaderState } from './reader/types';
import { restoreBrowserReaderExactReads } from './reader-session-host';

export interface PreparedSameRevisionFrame {
  readonly kind: 'sameRevisionFrame';
  readonly input: BrowserReaderRevisionCommitInput;
  readonly result: BrowserReaderRevisionResult;
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

export function canCommitBrowserReaderSameRevisionFrame(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
): boolean {
  const gate = input.exactReadGate;
  const published = state.revisionBundle.revision;
  const next = input.snapshot.revision;
  return (
    gate !== undefined &&
    // Faces rejected after the published layout invalidate it: reusing the
    // published frames would keep lines shaped with a face the canvas
    // cannot paint.
    state.fontAvailabilityEpoch === state.publishedFontAvailabilityEpoch &&
    gate.publicationGeneration !== undefined &&
    gate.owner === input.owner &&
    gate.generation === input.owner.gateGeneration &&
    input.owner.readsSuspended &&
    state.revisionHandle === undefined &&
    state.revisionSessions.current === input.owner &&
    state.worker === input.owner.worker &&
    state.config === input.config &&
    state.spreadMode === input.spreadMode &&
    published.revisionId === next.revisionId &&
    published.revisionVersion === next.revisionVersion
  );
}

export async function prepareBrowserReaderSameRevisionFrame(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
  isEligible: () => boolean,
): Promise<PreparedSameRevisionFrame | undefined> {
  const result = resultFromPublishedSnapshot(state, input);
  const selectedSpreadIndex = result.selectedFrame?.spreadIndex;
  const cachedFrame =
    selectedSpreadIndex === undefined ? undefined : state.frames.get(selectedSpreadIndex);
  const reusableFrame =
    cachedFrame?.revisionId === input.snapshot.revision.revisionId ? cachedFrame : undefined;
  const resources = input.snapshot.frameWindow?.spreads.find(
    (spread) => spread.spreadIndex === reusableFrame?.spreadIndex,
  )?.resources;
  let commitFrame: BrowserReaderPreparedCommitFrame | undefined;
  if (reusableFrame) {
    const ready =
      !reusableFrame.imageDominated ||
      (await prepareBrowserReaderCommitResources(state, resources, input.superseded));
    if (!ready) return undefined;
    commitFrame = { frame: reusableFrame };
  } else {
    commitFrame = await prepareControllerOwnedBrowserReaderCommitFrame(
      state,
      result,
      input.superseded,
    );
  }
  if (!commitFrame || input.isCurrent?.() === false || !isEligible()) return undefined;
  return { kind: 'sameRevisionFrame', input, result, commitFrame };
}

export function publishBrowserReaderSameRevisionFrame(
  state: BrowserReaderState,
  prepared: PreparedSameRevisionFrame,
): BrowserReaderRevisionCommitResult {
  const { input } = prepared;
  // Evaluated before the exact-read gate restores: a throwing preserve
  // predicate must fail the commit while reads stay closed. This path
  // is synchronous, so the early result cannot go stale before the
  // assignment below.
  const preserveRequested = input.preserveActiveSpread?.() === true;
  const gate = input.exactReadGate;
  if (!gate || !restoreBrowserReaderExactReads(state, gate)) {
    throw new Error('Same-revision commit could not restore its exact-read gate');
  }
  const frame = prepared.commitFrame.frame;
  if (frame) cacheFrame(state, frame.spreadIndex, frame);
  const revision = state.revisionHandle;
  if (!revision) {
    throw new Error('Same-revision commit did not restore an exact revision');
  }
  applyBrowserReaderFrameWindow(state, revision, prepared.result.frameWindow, {
    notifyFrameInvalidation: false,
  });
  {
    const spreadCount = state.revisionBundle.revision.spreadCount;
    // Mirrors the revision commit's rule: a newer user navigation
    // always wins over the request-time target.
    const preserveNow =
      preserveRequested ||
      (input.expectedActiveSpreadIndex !== undefined &&
        state.activeSpreadIndex !== input.expectedActiveSpreadIndex);
    const next = preserveNow
      ? clampBrowserReaderSpreadIndex(state.activeSpreadIndex, spreadCount)
      : sameRevisionActiveSpread(state, prepared);
    // A locator seek is asked to move the reader; every other
    // same-revision commit moving the visible spread is a defect.
    if (next !== state.activeSpreadIndex && prepared.input.snapshot.target.kind !== 'locator') {
      console.error(
        `[rito] same-revision frame commit moved activeSpreadIndex ${String(state.activeSpreadIndex)} -> ${String(next)} ` +
          `(target=${prepared.input.snapshot.target.kind})`,
      );
    }
    state.activeSpreadIndex = next;
  }
  notifyBrowserReaderCommitCallback(state, input.onCommitted);
  if (input.notifyLayoutCommitted !== false) notifyBrowserReaderLayoutCommitted(state);
  return { committed: true };
}

function resultFromPublishedSnapshot(
  state: BrowserReaderState,
  input: BrowserReaderRevisionCommitInput,
): BrowserReaderRevisionResult {
  const { snapshot } = input;
  const selectedFrame = selectedBrowserReaderRevisionSnapshotFrame(snapshot);
  return {
    bundle: state.revisionBundle,
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

function sameRevisionActiveSpread(
  state: BrowserReaderState,
  prepared: PreparedSameRevisionFrame,
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
  return clampBrowserReaderSpreadIndex(state.activeSpreadIndex, revision.spreadCount);
}
