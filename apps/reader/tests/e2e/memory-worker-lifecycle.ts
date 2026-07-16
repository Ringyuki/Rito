import { expect, type Page } from '@playwright/test';
import type {
  ReaderMemoryWorkerLifecycle,
  ReaderMemoryWorkerSessionRelease,
} from './memory-gate-types';
import {
  readReaderWorkerCreations,
  readReaderWorkerOperations,
  readReaderWorkerTerminations,
  type ReaderWorkerCreationObservation,
  type ReaderWorkerOperationObservation,
  type ReaderWorkerTerminationObservation,
} from './reader-worker-probe';
import {
  currentSuccessfulSession,
  requireReaderSessionReleaseFromSnapshot,
  requireReaderSessionReleasesFromSnapshot,
  type ReaderWorkerOpenSessionReference,
} from './memory-worker-session-sequence';

export {
  requireReaderSessionReleaseFromSnapshot,
  requireReaderSessionReleasesFromSnapshot,
} from './memory-worker-session-sequence';
export type { ReaderWorkerOpenSessionReference } from './memory-worker-session-sequence';

const WORKER_TIMEOUT_MS = 90_000;

export async function requireExactlyOneLiveReaderWorker(page: Page): Promise<number> {
  await expect
    .poll(() => singleSuccessfulLiveWorkerId(page), { timeout: WORKER_TIMEOUT_MS })
    .not.toBeNull();
  const workerId = await singleSuccessfulLiveWorkerId(page);
  if (workerId === null) throw new Error('Reader memory scenario has no live reader worker');
  return workerId;
}

export async function requireCurrentReaderOpenSession(
  page: Page,
): Promise<ReaderWorkerOpenSessionReference> {
  await expect
    .poll(() => currentReaderOpenSession(page), { timeout: WORKER_TIMEOUT_MS })
    .not.toBeNull();
  const session = await currentReaderOpenSession(page);
  if (!session) throw new Error('Reader memory scenario has no active reader session');
  return session;
}

export async function requireReaderSessionReleased(
  page: Page,
  session: ReaderWorkerOpenSessionReference,
): Promise<void> {
  await expect
    .poll(() => readerSessionRelease(page, session), { timeout: WORKER_TIMEOUT_MS })
    .not.toBeNull();
}

export async function requireFinalReaderWorkerLifecycle(
  page: Page,
): Promise<ReaderMemoryWorkerLifecycle> {
  const [creations, operations, terminations] = await Promise.all([
    readReaderWorkerCreations(page),
    readReaderWorkerOperations(page),
    readReaderWorkerTerminations(page),
  ]);
  const sessions = requireReaderSessionReleasesFromSnapshot(operations);
  requirePhysicalWorkerLifecycle(creations, operations, terminations, sessions);
  const liveWorkerIds = observedLiveWorkerIdsFromSnapshot(creations, terminations);
  if (liveWorkerIds.length > 0) {
    throw new Error(`Reader memory scenario retained workers ${liveWorkerIds.join(', ')}`);
  }
  return {
    createdWorkers: creations.map((entry) => ({ ...entry })),
    sessions,
    terminations: terminations.map((entry) => ({ ...entry })),
    liveWorkerIds,
  };
}

export async function observedLiveReaderWorkerIds(page: Page): Promise<number[]> {
  const [creations, terminations] = await Promise.all([
    readReaderWorkerCreations(page),
    readReaderWorkerTerminations(page),
  ]);
  return observedLiveWorkerIdsFromSnapshot(creations, terminations);
}

export async function readerSuccessfulOpenCount(page: Page): Promise<number> {
  return (await readReaderWorkerOperations(page)).filter(
    (entry) => entry.kind === 'open' && entry.ok === true,
  ).length;
}

export async function readerHasIncompleteRevision(page: Page): Promise<boolean> {
  return (await readReaderWorkerOperations(page)).some(
    (entry) =>
      entry.revision !== null &&
      entry.revision.status !== null &&
      entry.revision.status !== 'complete',
  );
}

async function readerSessionRelease(
  page: Page,
  session: ReaderWorkerOpenSessionReference,
): Promise<ReaderMemoryWorkerSessionRelease | null> {
  try {
    return requireReaderSessionReleaseFromSnapshot(await readReaderWorkerOperations(page), session);
  } catch {
    return null;
  }
}

async function currentReaderOpenSession(
  page: Page,
): Promise<ReaderWorkerOpenSessionReference | null> {
  const [creations, operations, terminations] = await Promise.all([
    readReaderWorkerCreations(page),
    readReaderWorkerOperations(page),
    readReaderWorkerTerminations(page),
  ]);
  const liveWorkerIds = observedLiveWorkerIdsFromSnapshot(creations, terminations);
  if (liveWorkerIds.length !== 1) return null;
  return currentSuccessfulSession(operations, requireOne(liveWorkerIds));
}

async function singleSuccessfulLiveWorkerId(page: Page): Promise<number | null> {
  return (await currentReaderOpenSession(page))?.workerId ?? null;
}

function requirePhysicalWorkerLifecycle(
  creations: readonly ReaderWorkerCreationObservation[],
  operations: readonly ReaderWorkerOperationObservation[],
  terminations: readonly ReaderWorkerTerminationObservation[],
  sessions: readonly ReaderMemoryWorkerSessionRelease[],
): void {
  const created = exactWorkerIds(creations, 'created');
  const terminated = exactWorkerIds(terminations, 'terminated');
  if (
    created.size !== terminated.size ||
    [...created].some((workerId) => !terminated.has(workerId))
  ) {
    throw new Error('Reader memory scenario did not terminate every created physical worker');
  }
  if (operations.some((entry) => !created.has(entry.workerId))) {
    throw new Error('Reader memory scenario observed operations from an unconstructed worker');
  }
  for (const termination of terminations) {
    const lastDispose = sessions
      .filter((entry) => entry.workerId === termination.workerId)
      .at(-1)?.disposedAt;
    if (lastDispose !== undefined && termination.terminatedAt < lastDispose) {
      throw new Error(
        `Reader worker ${String(termination.workerId)} terminated before its final dispose acknowledgement`,
      );
    }
  }
}

export function observedLiveWorkerIdsFromSnapshot(
  creations: readonly ReaderWorkerCreationObservation[],
  terminations: readonly { readonly workerId: number }[],
): number[] {
  const terminated = new Set(terminations.map((entry) => entry.workerId));
  return uniqueWorkerIds(creations.map((entry) => entry.workerId)).filter(
    (workerId) => !terminated.has(workerId),
  );
}

function exactWorkerIds(
  entries: readonly { readonly workerId: number }[],
  label: string,
): Set<number> {
  const ids = new Set(entries.map((entry) => entry.workerId));
  if (ids.size !== entries.length) {
    throw new Error(`Reader memory scenario observed duplicate ${label} physical workers`);
  }
  return ids;
}

function requireOne(values: readonly number[]): number {
  const value = values[0];
  if (value === undefined) throw new Error('Reader memory scenario has no live reader worker');
  return value;
}

function uniqueWorkerIds(workerIds: readonly number[]): number[] {
  return [...new Set(workerIds)].sort((left, right) => left - right);
}
