import type { BrowserContext, Page } from '@playwright/test';

export interface ReaderWorkerRevisionObservation {
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly status: string | null;
  readonly knownPageCount: number | null;
  readonly knownSpreadCount: number | null;
}

export interface ReaderWorkerOperationObservation {
  readonly workerId: number;
  readonly requestId: number;
  readonly kind: string;
  readonly startedAt: number;
  readonly requestBytes: number | null;
  readonly maxTopLevelNodes: number | null;
  readonly spreadIndex: number | null;
  completedAt: number | null;
  durationMs: number | null;
  ok: boolean | null;
  responseKind: string | null;
  revision: ReaderWorkerRevisionObservation | null;
  error: string | null;
}

export interface ReaderLongTaskObservation {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
}

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface ReaderWorkerProbeGlobal {
  __RITO_READER_WORKER_OPERATIONS__?: ReaderWorkerOperationObservation[];
  __RITO_READER_LONG_TASKS__?: ReaderLongTaskObservation[];
  __RITO_READER_LONG_TASK_OBSERVER__?: PerformanceObserver;
}

export async function installReaderWorkerProbe(target: InitScriptTarget): Promise<void> {
  await target.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_WORKER_OPERATIONS__ = [];
    runtime.__RITO_READER_LONG_TASKS__ = [];
    installLongTaskProbe(runtime);

    const NativeWorker = globalThis.Worker;
    let nextWorkerId = 1;
    class ReaderWorkerProbe extends NativeWorker {
      readonly probeWorkerId: number;
      readonly shouldProbe: boolean;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.probeWorkerId = nextWorkerId;
        nextWorkerId += 1;
        this.shouldProbe = options?.name === 'rito-browser-reader';
        if (!this.shouldProbe) return;
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          recordResponse(runtime, this.probeWorkerId, event.data);
        });
      }

      override postMessage(message: unknown, transfer: Transferable[]): void;
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        if (this.shouldProbe) recordRequest(runtime, this.probeWorkerId, message);
        if (transferOrOptions === undefined) {
          super.postMessage(message);
        } else if (Array.isArray(transferOrOptions)) {
          super.postMessage(message, transferOrOptions);
        } else {
          super.postMessage(message, transferOrOptions);
        }
      }
    }
    globalThis.Worker = ReaderWorkerProbe;

    function installLongTaskProbe(root: typeof globalThis & ReaderWorkerProbeGlobal): void {
      if (
        typeof PerformanceObserver === 'undefined' ||
        !PerformanceObserver.supportedEntryTypes.includes('longtask')
      ) {
        return;
      }
      const observer = new PerformanceObserver((list) => {
        const tasks = root.__RITO_READER_LONG_TASKS__;
        if (!tasks) return;
        for (const entry of list.getEntries()) {
          tasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      root.__RITO_READER_LONG_TASK_OBSERVER__ = observer;
    }

    function recordRequest(
      root: typeof globalThis & ReaderWorkerProbeGlobal,
      workerId: number,
      value: unknown,
    ): void {
      const message = objectValue(value);
      if (typeof message?.['id'] !== 'number' || typeof message['kind'] !== 'string') return;
      if (message['kind'] === 'dispose') return;
      const request = objectValue(message['request']);
      const budget = objectValue(message['budget']) ?? objectValue(request?.['budget']);
      const data = message['data'];
      root.__RITO_READER_WORKER_OPERATIONS__?.push({
        workerId,
        requestId: message['id'],
        kind: message['kind'],
        startedAt: performance.now(),
        requestBytes: data instanceof ArrayBuffer ? data.byteLength : null,
        maxTopLevelNodes:
          typeof budget?.['maxTopLevelNodes'] === 'number' ? budget['maxTopLevelNodes'] : null,
        spreadIndex: typeof message['spreadIndex'] === 'number' ? message['spreadIndex'] : null,
        completedAt: null,
        durationMs: null,
        ok: null,
        responseKind: null,
        revision: null,
        error: null,
      });
    }

    function recordResponse(
      root: typeof globalThis & ReaderWorkerProbeGlobal,
      workerId: number,
      value: unknown,
    ): void {
      const message = objectValue(value);
      if (!message || typeof message['id'] !== 'number') return;
      const record = findPendingRecord(root, workerId, message['id']);
      if (!record) return;
      record.completedAt = performance.now();
      record.durationMs = record.completedAt - record.startedAt;
      record.ok = message['ok'] === true;
      if (message['ok'] !== true) {
        const error = objectValue(message['error']);
        record.error = typeof error?.['message'] === 'string' ? error['message'] : 'worker error';
        return;
      }
      const payload = objectValue(message['payload']);
      record.responseKind = typeof payload?.['kind'] === 'string' ? payload['kind'] : null;
      record.revision = revisionObservation(payload);
    }

    function findPendingRecord(
      root: typeof globalThis & ReaderWorkerProbeGlobal,
      workerId: number,
      requestId: number,
    ): ReaderWorkerOperationObservation | undefined {
      return root.__RITO_READER_WORKER_OPERATIONS__
        ?.slice()
        .reverse()
        .find(
          (candidate) =>
            candidate.workerId === workerId &&
            candidate.requestId === requestId &&
            candidate.completedAt === null,
        );
    }

    function revisionObservation(
      payload: Record<string, unknown> | undefined,
    ): ReaderWorkerRevisionObservation | null {
      const result = objectValue(payload?.['result']);
      const revision = objectValue(result?.['revision']) ?? objectValue(payload?.['revision']);
      if (
        typeof revision?.['revisionId'] !== 'string' ||
        typeof revision['revisionVersion'] !== 'number'
      ) {
        return null;
      }
      const extent = objectValue(revision['knownExtent']);
      return {
        revisionId: revision['revisionId'],
        revisionVersion: revision['revisionVersion'],
        status: typeof revision['status'] === 'string' ? revision['status'] : null,
        knownPageCount: typeof extent?.['pageCount'] === 'number' ? extent['pageCount'] : null,
        knownSpreadCount:
          typeof extent?.['spreadCount'] === 'number' ? extent['spreadCount'] : null,
      };
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }
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
        revision: entry.revision ? { ...entry.revision } : null,
      })) ?? []
    );
  });
}

export async function readReaderLongTasks(page: Page): Promise<ReaderLongTaskObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    return runtime.__RITO_READER_LONG_TASKS__?.map((entry) => ({ ...entry })) ?? [];
  });
}
