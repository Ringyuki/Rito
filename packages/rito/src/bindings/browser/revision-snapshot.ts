import type { BrowserReaderRevisionSnapshot, BrowserReaderFrameBuffer } from './core-contracts';
import type {
  BrowserReaderRevisionSessionOwner,
  BrowserReaderExactReadGate,
} from './reader-session-host';
import type { BrowserReaderState } from './reader/types';

export interface BrowserReaderRevisionSnapshotCommitContract {
  readonly owner: BrowserReaderRevisionSessionOwner;
  readonly snapshot: BrowserReaderRevisionSnapshot;
  readonly exactReadGate?: BrowserReaderExactReadGate | undefined;
}

export interface BrowserReaderRevisionSelectedFrame {
  readonly spreadIndex: number;
  readonly displaySpreadIndex: number;
  readonly frame: BrowserReaderFrameBuffer;
}

export function requireBrowserReaderRevisionSnapshotCommit(
  state: BrowserReaderState,
  input: BrowserReaderRevisionSnapshotCommitContract,
): void {
  const { snapshot } = input;
  requireSameRevision(snapshot.presentation.revision, snapshot.revision, 'presentation');
  if (
    snapshot.navigation.revisionId !== snapshot.revision.revisionId ||
    snapshot.navigation.pageCount !== snapshot.revision.pageCount ||
    snapshot.navigation.spreadCount !== snapshot.revision.spreadCount ||
    snapshot.presentation.navigation !== snapshot.navigation
  ) {
    throw new Error('Revision snapshot navigation does not match its revision');
  }
  if (snapshot.presentation.tocTargets.revisionId !== snapshot.revision.revisionId) {
    throw new Error('Revision snapshot TOC targets do not match its revision');
  }
  requireSelectedSnapshotFrame(snapshot);
  requireCommitGate(state, input);
}

export function selectedBrowserReaderRevisionSnapshotFrame(
  snapshot: BrowserReaderRevisionSnapshot,
): BrowserReaderRevisionSelectedFrame | undefined {
  const window = snapshot.frameWindow;
  const frame = window?.frames.find(
    (item) => item.metadata.spreadIndex === snapshot.presentationSpreadIndex,
  );
  if (!window || !frame) return undefined;
  if (frame.metadata.revisionId !== snapshot.revision.revisionId) {
    throw new Error('Revision snapshot frame does not match its revision');
  }
  return {
    spreadIndex: snapshot.presentationSpreadIndex,
    displaySpreadIndex: window.plan.displaySpreadIndex,
    frame,
  };
}

function requireCommitGate(
  state: BrowserReaderState,
  input: BrowserReaderRevisionSnapshotCommitContract,
): void {
  if (state.revisionSessions.current !== input.owner) return;
  const gate = input.exactReadGate;
  const revisionChanged =
    state.revisionBundle.revision.revisionId !== input.snapshot.revision.revisionId ||
    state.revisionBundle.revision.revisionVersion !== input.snapshot.revision.revisionVersion;
  if (!input.owner.readsSuspended) {
    if (revisionChanged) {
      throw new Error('A mutation of the current session must suspend exact reads before commit');
    }
    return;
  }
  if (gate?.owner !== input.owner || gate.generation !== input.owner.gateGeneration) {
    throw new Error('A mutation of the current session requires its exact-read gate');
  }
}

function requireSelectedSnapshotFrame(snapshot: BrowserReaderRevisionSnapshot): void {
  requireTargetAvailability(snapshot);
  const selected = selectedBrowserReaderRevisionSnapshotFrame(snapshot);
  if (!selected && !targetRequiresFrame(snapshot)) return;
  if (
    !selected ||
    snapshot.frameWindow?.plan.revisionId !== snapshot.revision.revisionId ||
    snapshot.frameWindow.plan.centerSpreadIndex !== snapshot.presentationSpreadIndex
  ) {
    throw new Error('Revision snapshot is missing its exact target frame');
  }
}

// The revision is complete by construction, so a spread beyond its table
// is simply beyond the book; only a locator can still be unavailable.
function requireTargetAvailability(snapshot: BrowserReaderRevisionSnapshot): void {
  const { target, revision } = snapshot;
  if (
    target.kind === 'locator' &&
    (target.resolution.revisionId !== revision.revisionId ||
      (target.resolution.status === 'pending' && target.resolution.reason !== 'noPageProjection'))
  ) {
    throw new Error('Revision locator snapshot is not available');
  }
}

function targetRequiresFrame(snapshot: BrowserReaderRevisionSnapshot): boolean {
  const { target } = snapshot;
  return (
    (target.kind === 'spread' && target.spreadIndex < snapshot.revision.spreadCount) ||
    (target.kind === 'locator' && target.resolution.status === 'resolved')
  );
}

function requireSameRevision(
  actual: BrowserReaderRevisionSnapshot['revision'],
  expected: BrowserReaderRevisionSnapshot['revision'],
  label: string,
): void {
  if (
    actual.revisionId !== expected.revisionId ||
    actual.revisionVersion !== expected.revisionVersion ||
    actual.layoutKey !== expected.layoutKey ||
    actual.pageCount !== expected.pageCount ||
    actual.spreadCount !== expected.spreadCount
  ) {
    throw new Error(`Revision snapshot ${label} does not match its exact revision`);
  }
}
