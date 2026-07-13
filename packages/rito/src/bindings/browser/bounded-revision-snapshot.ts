import type { BrowserReaderBoundedSnapshot, BrowserReaderFrameBuffer } from './core-contracts';
import type {
  BrowserReaderBoundedSessionOwner,
  BrowserReaderExactReadGate,
} from './reader-session-host';
import type { BrowserReaderState } from './reader/types';

export interface BrowserReaderBoundedSnapshotCommitContract {
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly snapshot: BrowserReaderBoundedSnapshot;
  readonly exactReadGate?: BrowserReaderExactReadGate | undefined;
}

export interface BrowserReaderBoundedSelectedFrame {
  readonly spreadIndex: number;
  readonly displaySpreadIndex: number;
  readonly frame: BrowserReaderFrameBuffer;
}

export function requireBrowserReaderBoundedSnapshotCommit(
  state: BrowserReaderState,
  input: BrowserReaderBoundedSnapshotCommitContract,
): void {
  const { snapshot } = input;
  requireSameRevision(snapshot.presentation.revision, snapshot.revision, 'presentation');
  if (
    snapshot.navigation.revisionId !== snapshot.revision.revisionId ||
    snapshot.navigation.pageCount !== snapshot.revision.pageCount ||
    snapshot.navigation.spreadCount !== snapshot.revision.spreadCount ||
    snapshot.presentation.navigation !== snapshot.navigation
  ) {
    throw new Error('Bounded reader snapshot navigation does not match its revision');
  }
  if (snapshot.presentation.tocTargets.revisionId !== snapshot.revision.revisionId) {
    throw new Error('Bounded reader snapshot TOC targets do not match its revision');
  }
  requireSelectedSnapshotFrame(snapshot);
  requireCommitGate(state, input);
}

export function selectedBrowserReaderBoundedSnapshotFrame(
  snapshot: BrowserReaderBoundedSnapshot,
): BrowserReaderBoundedSelectedFrame | undefined {
  const window = snapshot.frameWindow;
  const frame = window?.frames.find(
    (item) => item.metadata.spreadIndex === snapshot.presentationSpreadIndex,
  );
  if (!window || !frame) return undefined;
  if (frame.metadata.revisionId !== snapshot.revision.revisionId) {
    throw new Error('Bounded reader snapshot frame does not match its revision');
  }
  return {
    spreadIndex: snapshot.presentationSpreadIndex,
    displaySpreadIndex: window.plan.displaySpreadIndex,
    frame,
  };
}

function requireCommitGate(
  state: BrowserReaderState,
  input: BrowserReaderBoundedSnapshotCommitContract,
): void {
  if (state.boundedSessions.current !== input.owner) return;
  const gate = input.exactReadGate;
  const revisionChanged =
    state.revisionBundle.revision.revisionId !== input.snapshot.revision.revisionId ||
    state.revisionBundle.revision.revisionVersion !== input.snapshot.revision.revisionVersion;
  if (!input.owner.readsSuspended) {
    if (revisionChanged) {
      throw new Error('Bounded reader current growth must suspend exact reads before commit');
    }
    return;
  }
  if (gate?.owner !== input.owner || gate.generation !== input.owner.gateGeneration) {
    throw new Error('Bounded reader current growth requires its exact-read gate');
  }
}

function requireSelectedSnapshotFrame(snapshot: BrowserReaderBoundedSnapshot): void {
  requireTargetAvailability(snapshot);
  const selected = selectedBrowserReaderBoundedSnapshotFrame(snapshot);
  if (!selected && !targetRequiresFrame(snapshot)) return;
  if (
    !selected ||
    snapshot.frameWindow?.plan.revisionId !== snapshot.revision.revisionId ||
    snapshot.frameWindow.plan.centerSpreadIndex !== snapshot.presentationSpreadIndex
  ) {
    throw new Error('Bounded reader snapshot is missing its exact target frame');
  }
}

function requireTargetAvailability(snapshot: BrowserReaderBoundedSnapshot): void {
  const { target, revision } = snapshot;
  if (target.kind === 'complete' && revision.status !== 'complete') {
    throw new Error('Bounded reader completion snapshot is not complete');
  }
  if (
    target.kind === 'spread' &&
    target.spreadIndex >= revision.spreadCount &&
    revision.status !== 'complete'
  ) {
    throw new Error('Bounded reader spread snapshot is not yet available');
  }
  if (
    target.kind === 'locator' &&
    (target.resolution.revisionId !== revision.revisionId ||
      (target.resolution.status === 'pending' && target.resolution.reason !== 'noPageProjection'))
  ) {
    throw new Error('Bounded reader locator snapshot is not available');
  }
}

function targetRequiresFrame(snapshot: BrowserReaderBoundedSnapshot): boolean {
  const { target } = snapshot;
  return (
    (target.kind === 'spread' && target.spreadIndex < snapshot.revision.spreadCount) ||
    (target.kind === 'locator' && target.resolution.status === 'resolved')
  );
}

function requireSameRevision(
  actual: BrowserReaderBoundedSnapshot['revision'],
  expected: BrowserReaderBoundedSnapshot['revision'],
  label: string,
): void {
  if (
    actual.revisionId !== expected.revisionId ||
    actual.revisionVersion !== expected.revisionVersion ||
    actual.layoutKey !== expected.layoutKey ||
    actual.status !== expected.status ||
    actual.pageCount !== expected.pageCount ||
    actual.spreadCount !== expected.spreadCount
  ) {
    throw new Error(`Bounded reader ${label} does not match its exact revision`);
  }
}
