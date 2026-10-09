import type { BrowserContext, Page } from '@playwright/test';

/** One request a page sent its reader session worker, and how it was answered. */
export interface ReaderWorkerOperationObservation {
  readonly workerId: number;
  readonly requestId: number;
  readonly kind: string;
  readonly startedAt: number;
  completedAt: number | null;
  ok: boolean | null;
  error: string | null;
}

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface ReaderWorkerProbeGlobal {
  __RITO_READER_WORKER_OPERATIONS__?: ReaderWorkerOperationObservation[];
}

/**
 * Records every request a page posts to a reader session worker and the
 * answer it gets, in the order they are sent: what a test reads to say
 * which protocol a reader spoke and whether any of it failed.
 */
export async function installReaderWorkerProbe(target: InitScriptTarget): Promise<void> {
  // Playwright serializes this callback, so its helpers stay self-contained.
  await target.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    const operations: ReaderWorkerOperationObservation[] = [];
    runtime.__RITO_READER_WORKER_OPERATIONS__ = operations;

    const NativeWorker = globalThis.Worker;
    let nextWorkerId = 1;
    class ReaderWorkerProbe extends NativeWorker {
      readonly probeWorkerId: number;
      readonly shouldProbe: boolean;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.probeWorkerId = nextWorkerId;
        nextWorkerId += 1;
        this.shouldProbe = options?.name === 'rito-browser-reader-session';
        if (!this.shouldProbe) return;
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          recordResponse(this.probeWorkerId, event.data);
        });
      }

      override postMessage(message: unknown, transfer: Transferable[]): void;
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        if (this.shouldProbe) recordRequest(this.probeWorkerId, message);
        if (transferOrOptions === undefined) super.postMessage(message);
        else if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
        else super.postMessage(message, transferOrOptions);
      }
    }
    globalThis.Worker = ReaderWorkerProbe;

    function recordRequest(workerId: number, value: unknown): void {
      const message = objectValue(value);
      if (typeof message?.['id'] !== 'number' || typeof message['kind'] !== 'string') return;
      operations.push({
        workerId,
        requestId: message['id'],
        kind: message['kind'],
        startedAt: performance.now(),
        completedAt: null,
        ok: null,
        error: null,
      });
    }

    function recordResponse(workerId: number, value: unknown): void {
      const message = objectValue(value);
      const id = message?.['id'];
      if (typeof id !== 'number') return;
      const record = operations
        .slice()
        .reverse()
        .find(
          (candidate) =>
            candidate.workerId === workerId &&
            candidate.requestId === id &&
            candidate.completedAt === null,
        );
      if (!record) return;
      record.completedAt = performance.now();
      record.ok = message?.['ok'] === true;
      if (!record.ok) {
        const error = objectValue(message?.['error']);
        record.error = typeof error?.['message'] === 'string' ? error['message'] : 'worker error';
      }
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }
  });
}

export async function readReaderWorkerOperations(
  page: Page,
): Promise<readonly ReaderWorkerOperationObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    const operations = runtime.__RITO_READER_WORKER_OPERATIONS__;
    if (!operations) throw new Error('Reader worker probe is not installed');
    return operations.map((operation) => ({ ...operation }));
  });
}
