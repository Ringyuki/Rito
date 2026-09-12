import { expect, type Page } from '@playwright/test';

export interface ReaderWorkerRevisionHandleObservation {
  readonly revisionId: string;
  readonly revisionVersion: number;
}

export interface ReaderWorkerRevisionObservation extends ReaderWorkerRevisionHandleObservation {
  readonly status: string | null;
  readonly knownPageCount: number | null;
  readonly knownSpreadCount: number | null;
}

export interface ReaderWorkerChapterLocalRevisionObservation extends ReaderWorkerRevisionHandleObservation {
  readonly chapterIndex: number;
  readonly href: string;
  readonly status: string | null;
  readonly knownLocalPageCount: number | null;
  readonly knownLocalSpreadCount: number | null;
}

export interface ReaderWorkerOperationObservation {
  readonly workerId: number;
  readonly requestId: number;
  readonly kind: string;
  readonly startedAt: number;
  readonly requestBytes: number | null;
  readonly spreadIndex: number | null;
  completedAt: number | null;
  durationMs: number | null;
  ok: boolean | null;
  responseKind: string | null;
  releasedDocument: boolean | null;
  /** WASM linear-memory high-water mark reported by the dispose acknowledgement. */
  wasmMemoryByteLength: number | null;
  readonly requestedRevision: ReaderWorkerRevisionHandleObservation | null;
  revision: ReaderWorkerRevisionObservation | null;
  chapterLocalRevision: ReaderWorkerChapterLocalRevisionObservation | null;
  error: string | null;
}

export interface ReaderLongTaskObservation {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
}

export interface ReaderWorkerHeldMutationObservation {
  readonly workerId: number;
  readonly requestId: number;
  readonly kind: string;
  readonly category: ReaderWorkerResponseHoldCategory;
  readonly heldAt: number;
  releasedAt: number | null;
}

export type ReaderWorkerResponseHoldCategory = 'chapterLocalMutation';

export const READER_WORKER_CHAPTER_LOCAL_MUTATION_KINDS = [
  'createBoundedChapterLocalRevision',
] as const;

export interface ReaderWorkerResponseHoldPlan {
  readonly chapterLocalMutation: boolean;
}

export function readerWorkerResponseHoldCategory(
  kind: string,
): ReaderWorkerResponseHoldCategory | undefined {
  if (READER_WORKER_CHAPTER_LOCAL_MUTATION_KINDS.some((candidate) => candidate === kind)) {
    return 'chapterLocalMutation';
  }
  return undefined;
}

export function readerWorkerTocResponseHoldPlan(
  chapterLocalPreviewEnabled: boolean,
): ReaderWorkerResponseHoldPlan {
  return { chapterLocalMutation: chapterLocalPreviewEnabled };
}

export interface ReaderWorkerCreationObservation {
  readonly workerId: number;
  readonly createdAt: number;
}

export interface ReaderWorkerTerminationObservation {
  readonly workerId: number;
  readonly terminatedAt: number;
}

export interface ReaderProbeCursor {
  readonly operationIndex: number;
  readonly longTaskIndex: number;
  readonly capturedAt: number;
}

export interface ReaderProbeSlice {
  readonly operations: ReaderWorkerOperationObservation[];
  readonly longTasks: ReaderLongTaskObservation[];
  readonly startedAt: number;
  readonly completedAt: number;
}

export interface ReaderProbeIdleOptions {
  readonly idleForMs?: number;
  readonly timeoutMs?: number;
}

interface ReaderWorkerProbeGlobal {
  __RITO_READER_WORKER_OPERATIONS__?: ReaderWorkerOperationObservation[];
  __RITO_READER_WORKER_CREATIONS__?: ReaderWorkerCreationObservation[];
  __RITO_READER_WORKER_HELD_MUTATIONS__?: ReaderWorkerHeldMutationObservation[];
  __RITO_READER_WORKER_TERMINATIONS__?: ReaderWorkerTerminationObservation[];
  __RITO_READER_WORKER_RESPONSE_HOLD_PLAN__?: ReaderWorkerResponseHoldPlan;
  __RITO_READER_WORKER_RELEASE_MUTATIONS__?: () => void;
  __RITO_READER_LONG_TASKS__?: ReaderLongTaskObservation[];
  __RITO_READER_LONG_TASK_OBSERVER__?: PerformanceObserver;
  __RITO_READER_FLUSH_LONG_TASKS__?: () => void;
}

export async function readReaderWorkerCreations(
  page: Page,
): Promise<ReaderWorkerCreationObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    return runtime.__RITO_READER_WORKER_CREATIONS__?.map((entry) => ({ ...entry })) ?? [];
  });
}

export async function armReaderWorkerResponseHolds(
  page: Page,
  plan: ReaderWorkerResponseHoldPlan,
): Promise<void> {
  await page.evaluate((nextPlan) => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_WORKER_RESPONSE_HOLD_PLAN__ = { ...nextPlan };
  }, plan);
}

export async function waitForHeldReaderWorkerResponses(
  page: Page,
  categories: readonly ReaderWorkerResponseHoldCategory[],
  timeoutMs = 15_000,
): Promise<ReaderWorkerHeldMutationObservation[]> {
  const expected = new Set(categories);
  await expect
    .poll(
      async () => {
        const held = await readHeldReaderWorkerMutations(page);
        return [...expected].every(() => held.some((entry) => entry.releasedAt === null));
      },
      { timeout: timeoutMs },
    )
    .toBe(true);
  const held = await readHeldReaderWorkerMutations(page);
  return categories.map((category) => {
    const entry = held.find((candidate) => candidate.releasedAt === null);
    if (!entry) throw new Error(`Reader worker response was not held for ${category}`);
    return entry;
  });
}

export async function releaseHeldReaderWorkerMutations(page: Page): Promise<void> {
  await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_WORKER_RESPONSE_HOLD_PLAN__ = { chapterLocalMutation: false };
    runtime.__RITO_READER_WORKER_RELEASE_MUTATIONS__?.();
  });
}

export async function readHeldReaderWorkerMutations(
  page: Page,
): Promise<ReaderWorkerHeldMutationObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    return runtime.__RITO_READER_WORKER_HELD_MUTATIONS__?.map((entry) => ({ ...entry })) ?? [];
  });
}

export async function readReaderWorkerTerminations(
  page: Page,
): Promise<ReaderWorkerTerminationObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    return runtime.__RITO_READER_WORKER_TERMINATIONS__?.map((entry) => ({ ...entry })) ?? [];
  });
}

export async function readReaderWorkerOperations(
  page: Page,
): Promise<ReaderWorkerOperationObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    return (
      runtime.__RITO_READER_WORKER_OPERATIONS__?.map((entry) => ({
        ...entry,
        requestedRevision: entry.requestedRevision ? { ...entry.requestedRevision } : null,
        revision: entry.revision ? { ...entry.revision } : null,
        chapterLocalRevision: entry.chapterLocalRevision ? { ...entry.chapterLocalRevision } : null,
      })) ?? []
    );
  });
}

export async function readReaderLongTasks(page: Page): Promise<ReaderLongTaskObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_FLUSH_LONG_TASKS__?.();
    return runtime.__RITO_READER_LONG_TASKS__?.map((entry) => ({ ...entry })) ?? [];
  });
}

export async function captureReaderProbeCursor(page: Page): Promise<ReaderProbeCursor> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_FLUSH_LONG_TASKS__?.();
    return {
      operationIndex: runtime.__RITO_READER_WORKER_OPERATIONS__?.length ?? 0,
      longTaskIndex: runtime.__RITO_READER_LONG_TASKS__?.length ?? 0,
      capturedAt: performance.now(),
    };
  });
}

export async function readReaderProbeSlice(
  page: Page,
  cursor: ReaderProbeCursor,
): Promise<ReaderProbeSlice> {
  return page.evaluate((probeCursor) => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_FLUSH_LONG_TASKS__?.();
    const completedAt = performance.now();
    const operations = runtime.__RITO_READER_WORKER_OPERATIONS__ ?? [];
    const longTasks = runtime.__RITO_READER_LONG_TASKS__ ?? [];
    return {
      startedAt: probeCursor.capturedAt,
      completedAt,
      operations: operations.slice(probeCursor.operationIndex).map((entry) => ({
        ...entry,
        requestedRevision: entry.requestedRevision ? { ...entry.requestedRevision } : null,
        revision: entry.revision ? { ...entry.revision } : null,
        chapterLocalRevision: entry.chapterLocalRevision ? { ...entry.chapterLocalRevision } : null,
      })),
      longTasks: longTasks
        .slice(probeCursor.longTaskIndex)
        .filter(
          (entry) =>
            entry.startTime <= completedAt &&
            entry.startTime + entry.duration >= probeCursor.capturedAt,
        )
        .map((entry) => ({ ...entry })),
    };
  }, cursor);
}

export async function waitForReaderProbeIdle(
  page: Page,
  options: ReaderProbeIdleOptions = {},
): Promise<void> {
  const idleForMs = options.idleForMs ?? 200;
  let previousSignature = '';
  let quietSince = Date.now();
  await expect
    .poll(
      async () => {
        const snapshot = await readReaderProbeIdleSnapshot(page);
        const signature = `${String(snapshot.operationCount)}:${String(snapshot.pendingCount)}:${String(snapshot.longTaskCount)}`;
        if (signature !== previousSignature) {
          previousSignature = signature;
          quietSince = Date.now();
        }
        return snapshot.pendingCount === 0 && Date.now() - quietSince >= idleForMs;
      },
      { timeout: options.timeoutMs ?? 90_000 },
    )
    .toBe(true);
}

async function readReaderProbeIdleSnapshot(page: Page): Promise<{
  readonly operationCount: number;
  readonly pendingCount: number;
  readonly longTaskCount: number;
}> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_FLUSH_LONG_TASKS__?.();
    const operations = runtime.__RITO_READER_WORKER_OPERATIONS__ ?? [];
    return {
      operationCount: operations.length,
      pendingCount: operations.filter((entry) => entry.completedAt === null).length,
      longTaskCount: runtime.__RITO_READER_LONG_TASKS__?.length ?? 0,
    };
  });
}
