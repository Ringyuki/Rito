import type { ReaderMemoryWorkerSessionRelease } from './memory-gate-types';
import type { ReaderWorkerOperationObservation } from './reader-worker-probe';

export interface ReaderWorkerOpenSessionReference {
  readonly workerId: number;
  readonly openOrdinal: number;
  readonly openRequestId: number;
  readonly openStartedAt: number;
}

interface PendingReaderWorkerSession {
  readonly reference: ReaderWorkerOpenSessionReference;
  readonly open: ReaderWorkerOperationObservation;
}

export function currentSuccessfulSession(
  operations: readonly ReaderWorkerOperationObservation[],
  workerId: number,
): ReaderWorkerOpenSessionReference | null {
  let openOrdinal = 0;
  let active: ReaderWorkerOpenSessionReference | null = null;
  for (const operation of operations) {
    if (operation.kind === 'open') {
      openOrdinal += 1;
      if (operation.workerId === workerId) {
        active =
          operation.ok === true && operation.completedAt !== null
            ? sessionReference(operation, openOrdinal)
            : null;
      }
    } else if (operation.kind === 'dispose' && operation.workerId === workerId) {
      active = null;
    }
  }
  return active;
}

export function requireReaderSessionReleasesFromSnapshot(
  operations: readonly ReaderWorkerOperationObservation[],
): ReaderMemoryWorkerSessionRelease[] {
  return parseReaderSessions(operations, true).releases;
}

export function requireReaderSessionReleaseFromSnapshot(
  operations: readonly ReaderWorkerOperationObservation[],
  session: ReaderWorkerOpenSessionReference,
): ReaderMemoryWorkerSessionRelease {
  const release = parseReaderSessions(operations, false).releases.find(
    (entry) =>
      entry.openOrdinal === session.openOrdinal &&
      entry.workerId === session.workerId &&
      entry.openRequestId === session.openRequestId &&
      entry.openStartedAt === session.openStartedAt,
  );
  if (!release) {
    throw new Error(
      `Reader worker ${String(session.workerId)} session ${String(session.openOrdinal)} has not acknowledged disposal`,
    );
  }
  return release;
}

function parseReaderSessions(
  operations: readonly ReaderWorkerOperationObservation[],
  requireAllReleased: boolean,
): {
  readonly releases: ReaderMemoryWorkerSessionRelease[];
  readonly pending: ReadonlyMap<number, PendingReaderWorkerSession>;
} {
  const pending = new Map<number, PendingReaderWorkerSession>();
  const lastDisposedAt = new Map<number, number>();
  const releases: ReaderMemoryWorkerSessionRelease[] = [];
  let openOrdinal = 0;
  for (const operation of operations) {
    if (operation.kind === 'open') {
      openOrdinal += 1;
      startSession(operation, openOrdinal, pending, lastDisposedAt);
    } else if (operation.kind === 'dispose') {
      releases.push(finishSession(operation, pending, lastDisposedAt));
    }
  }
  if (requireAllReleased && pending.size > 0) {
    const session = pending.values().next().value;
    throw new Error(
      `Reader worker ${String(session?.reference.workerId)} session ${String(session?.reference.openOrdinal)} has no dispose acknowledgement`,
    );
  }
  return { releases, pending };
}

function startSession(
  open: ReaderWorkerOperationObservation,
  openOrdinal: number,
  pending: Map<number, PendingReaderWorkerSession>,
  lastDisposedAt: ReadonlyMap<number, number>,
): void {
  const previous = pending.get(open.workerId);
  if (previous) {
    throw new Error(
      `Reader worker ${String(open.workerId)} started session ${String(openOrdinal)} before session ${String(previous.reference.openOrdinal)} disposal completed`,
    );
  }
  const disposedAt = lastDisposedAt.get(open.workerId);
  if (disposedAt !== undefined && open.startedAt < disposedAt) {
    throw new Error(
      `Reader worker ${String(open.workerId)} started session ${String(openOrdinal)} before the previous dispose acknowledgement`,
    );
  }
  if (open.completedAt === null || typeof open.ok !== 'boolean') {
    throw new Error(
      `Reader worker ${String(open.workerId)} session ${String(openOrdinal)} has no open result`,
    );
  }
  pending.set(open.workerId, { reference: sessionReference(open, openOrdinal), open });
}

function finishSession(
  dispose: ReaderWorkerOperationObservation,
  pending: Map<number, PendingReaderWorkerSession>,
  lastDisposedAt: Map<number, number>,
): ReaderMemoryWorkerSessionRelease {
  const session = pending.get(dispose.workerId);
  if (!session) {
    throw new Error(
      `Reader worker ${String(dispose.workerId)} issued a dispose without an open session`,
    );
  }
  if (
    dispose.completedAt === null ||
    dispose.ok !== true ||
    typeof dispose.releasedDocument !== 'boolean'
  ) {
    throw new Error(
      `Reader worker ${String(dispose.workerId)} session ${String(session.reference.openOrdinal)} did not acknowledge disposal`,
    );
  }
  if (dispose.completedAt < requireCompletedAt(session.open)) {
    throw new Error(
      `Reader worker ${String(dispose.workerId)} session ${String(session.reference.openOrdinal)} disposed before open completed`,
    );
  }
  if (session.open.ok === true && !dispose.releasedDocument) {
    throw new Error(
      `Reader worker ${String(dispose.workerId)} session ${String(session.reference.openOrdinal)} did not release its opened document`,
    );
  }
  pending.delete(dispose.workerId);
  lastDisposedAt.set(dispose.workerId, dispose.completedAt);
  return {
    ...session.reference,
    openCompletedAt: requireCompletedAt(session.open),
    openSucceeded: session.open.ok === true,
    disposeRequestId: dispose.requestId,
    disposeStartedAt: dispose.startedAt,
    releasedDocument: dispose.releasedDocument,
    wasmMemoryByteLength: dispose.wasmMemoryByteLength,
    disposedAt: dispose.completedAt,
  };
}

function sessionReference(
  open: ReaderWorkerOperationObservation,
  openOrdinal: number,
): ReaderWorkerOpenSessionReference {
  return {
    workerId: open.workerId,
    openOrdinal,
    openRequestId: open.requestId,
    openStartedAt: open.startedAt,
  };
}

function requireCompletedAt(operation: ReaderWorkerOperationObservation): number {
  if (operation.completedAt === null) throw new Error('Reader worker operation is incomplete');
  return operation.completedAt;
}
