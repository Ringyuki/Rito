import { expect } from '@playwright/test';
import type {
  ReaderWorkerCreationObservation,
  ReaderWorkerOperationObservation,
  ReaderWorkerTerminationObservation,
} from './reader-worker-probe';

const CONTINUATION_KINDS = [
  'continueRevision',
  'continueRevisionAfterTransferRelease',
  'continueRevisionTowardSourceLocator',
] as const;

export function assertReleaseProtocol(
  operations: readonly ReaderWorkerOperationObservation[],
  oldOpen: ReaderWorkerOperationObservation,
  continuationRequestId: number,
  creations: readonly ReaderWorkerCreationObservation[],
  terminations: readonly ReaderWorkerTerminationObservation[],
): void {
  const oldWorkerOperations = operations.filter((entry) => entry.workerId === oldOpen.workerId);
  const continuation = requireOperation(
    oldWorkerOperations,
    (entry) => entry.requestId === continuationRequestId,
    'held continuation',
  );
  expect(CONTINUATION_KINDS).toContain(continuation.responseKind);
  expect(['warming', 'ready']).toContain(continuation.revision?.status);
  const expectedRevision = revisionHandle(continuation);
  expect(continuation.requestedRevision).toEqual(
    previousRevisionHandle(expectedRevision, continuation.advancedQuanta ?? 1),
  );
  const transfers = requireFollowingExactRevisionOperation(
    oldWorkerOperations,
    continuation,
    'releaseRevisionTransfersAtRevision',
    expectedRevision,
  );
  expect(transfers.responseKind).toBe('releaseRevisionTransfersAtRevision');
  const cancel = requireFollowingOperation(
    oldWorkerOperations,
    transfers,
    'cancelRevision',
    (entry) => hasRequestedRevisionHandle(entry, expectedRevision),
  );
  expect(cancel.responseKind).toBe('cancelRevision');
  expect(cancel.revision?.status).toBe('cancelled');
  const cancelledRevision = nextRevisionHandle(expectedRevision);
  expect(revisionHandle(cancel)).toEqual(cancelledRevision);
  const release = requireFollowingExactRevisionOperation(
    oldWorkerOperations,
    cancel,
    'releaseRevisionAtRevision',
    cancelledRevision,
  );
  expect(release.responseKind).toBe('releaseRevisionAtRevision');
  const dispose = requireFollowingOperation(oldWorkerOperations, release, 'dispose');
  expect(dispose.responseKind).toBe('dispose');
  expect(dispose.ok).toBe(true);
  expect(dispose.releasedDocument).toBe(true);
  const replacement = requireReplacementOpen(operations, oldOpen, dispose);
  const disposeCompletedAt = requireCompletedAt(dispose);
  const oldSessionOperations = oldWorkerOperations.filter(
    (entry) => entry.startedAt <= dispose.startedAt,
  );
  expect(oldSessionOperations.filter((entry) => entry.completedAt === null)).toHaveLength(0);
  const oldWorkerTerminations = terminations.filter((entry) => entry.workerId === oldOpen.workerId);
  for (const termination of oldWorkerTerminations) {
    expect(termination.terminatedAt).toBeGreaterThanOrEqual(disposeCompletedAt);
  }
  if (replacement.workerId === oldOpen.workerId) expect(oldWorkerTerminations).toHaveLength(0);
  else expect(oldWorkerTerminations.length).toBeGreaterThan(0);
  expect(creations.some((entry) => entry.workerId === oldOpen.workerId)).toBe(true);
  expect(creations.some((entry) => entry.workerId === replacement.workerId)).toBe(true);
  expect(liveWorkerIds(creations, terminations)).toEqual([replacement.workerId]);
}

export function liveWorkerIds(
  creations: readonly ReaderWorkerCreationObservation[],
  terminations: readonly ReaderWorkerTerminationObservation[],
): number[] {
  const terminated = new Set(terminations.map((entry) => entry.workerId));
  return creations
    .map((entry) => entry.workerId)
    .filter((workerId) => !terminated.has(workerId))
    .sort((left, right) => left - right);
}

function requireFollowingExactRevisionOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  previous: ReaderWorkerOperationObservation,
  kind: string,
  revision: ReturnType<typeof revisionHandle>,
): ReaderWorkerOperationObservation {
  return requireFollowingOperation(
    operations,
    previous,
    kind,
    (entry) => hasRequestedRevisionHandle(entry, revision) && hasRevisionHandle(entry, revision),
  );
}

function requireFollowingOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  previous: ReaderWorkerOperationObservation,
  kind: string,
  extraPredicate: (entry: ReaderWorkerOperationObservation) => boolean = () => true,
): ReaderWorkerOperationObservation {
  const completedAt = requireCompletedAt(previous);
  return requireOperation(
    operations,
    (entry) => entry.kind === kind && entry.startedAt >= completedAt && extraPredicate(entry),
    kind,
  );
}

export function findSessionDispose(
  operations: readonly ReaderWorkerOperationObservation[],
  open: ReaderWorkerOperationObservation,
): ReaderWorkerOperationObservation | undefined {
  const openCompletedAt = requireCompletedAt(open);
  return operations.find(
    (entry) =>
      entry.workerId === open.workerId &&
      entry.kind === 'dispose' &&
      entry.startedAt >= openCompletedAt,
  );
}

export function findReplacementOpen(
  operations: readonly ReaderWorkerOperationObservation[],
  oldOpen: ReaderWorkerOperationObservation,
  dispose: ReaderWorkerOperationObservation,
): ReaderWorkerOperationObservation | undefined {
  const disposedAt = requireCompletedAt(dispose);
  return operations.find(
    (entry) =>
      entry.kind === 'open' &&
      entry.requestId !== oldOpen.requestId &&
      entry.startedAt >= disposedAt &&
      entry.ok === true,
  );
}

function requireReplacementOpen(
  operations: readonly ReaderWorkerOperationObservation[],
  oldOpen: ReaderWorkerOperationObservation,
  dispose: ReaderWorkerOperationObservation,
): ReaderWorkerOperationObservation {
  const replacement = findReplacementOpen(operations, oldOpen, dispose);
  if (!replacement) throw new Error('Missing replacement reader worker open operation');
  return replacement;
}

function hasRevisionHandle(
  operation: ReaderWorkerOperationObservation,
  expected: ReturnType<typeof revisionHandle>,
): boolean {
  const revision = operation.revision;
  return (
    revision?.revisionId === expected.revisionId &&
    revision.revisionVersion === expected.revisionVersion
  );
}

function hasRequestedRevisionHandle(
  operation: ReaderWorkerOperationObservation,
  expected: ReturnType<typeof revisionHandle>,
): boolean {
  const revision = operation.requestedRevision;
  return (
    revision?.revisionId === expected.revisionId &&
    revision.revisionVersion === expected.revisionVersion
  );
}

function requireOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  predicate: (entry: ReaderWorkerOperationObservation) => boolean,
  subject: string,
): ReaderWorkerOperationObservation {
  const operation = operations.find(predicate);
  if (!operation) throw new Error(`Missing reader worker ${subject} operation`);
  expect(operation.ok).toBe(true);
  return operation;
}

function requireCompletedAt(operation: ReaderWorkerOperationObservation): number {
  if (operation.completedAt === null) {
    throw new Error(`Reader worker ${operation.kind} operation did not complete`);
  }
  return operation.completedAt;
}

function revisionHandle(operation: ReaderWorkerOperationObservation): {
  readonly revisionId: string;
  readonly revisionVersion: number;
} {
  const revision = operation.revision;
  if (!revision) throw new Error(`Reader worker ${operation.kind} did not return a revision`);
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}

function previousRevisionHandle(
  revision: ReturnType<typeof revisionHandle>,
  advancedQuanta: number,
): {
  readonly revisionId: string;
  readonly revisionVersion: number;
} {
  if (
    !Number.isSafeInteger(advancedQuanta) ||
    advancedQuanta <= 0 ||
    revision.revisionVersion < advancedQuanta
  ) {
    throw new Error('Reader worker continuation returned an invalid advanced quantum count');
  }
  return { ...revision, revisionVersion: revision.revisionVersion - advancedQuanta };
}

function nextRevisionHandle(revision: ReturnType<typeof revisionHandle>): {
  readonly revisionId: string;
  readonly revisionVersion: number;
} {
  return { ...revision, revisionVersion: revision.revisionVersion + 1 };
}
