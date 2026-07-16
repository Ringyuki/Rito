import type { BrowserContext, Page } from '@playwright/test';
import type {
  ReaderLongTaskObservation,
  ReaderWorkerCreationObservation,
  ReaderWorkerHeldContinuationObservation,
  ReaderWorkerOperationObservation,
  ReaderWorkerRevisionHandleObservation,
  ReaderWorkerRevisionObservation,
  ReaderWorkerTerminationObservation,
} from './reader-worker-probe-observations';

export * from './reader-worker-probe-observations';

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface ReaderWorkerProbeGlobal {
  __RITO_READER_WORKER_OPERATIONS__?: ReaderWorkerOperationObservation[];
  __RITO_READER_WORKER_CREATIONS__?: ReaderWorkerCreationObservation[];
  __RITO_READER_WORKER_HELD_CONTINUATIONS__?: ReaderWorkerHeldContinuationObservation[];
  __RITO_READER_WORKER_TERMINATIONS__?: ReaderWorkerTerminationObservation[];
  __RITO_READER_WORKER_HOLD_NEXT_CONTINUATION__?: boolean;
  __RITO_READER_WORKER_RELEASE_CONTINUATIONS__?: () => void;
  __RITO_READER_LONG_TASKS__?: ReaderLongTaskObservation[];
  __RITO_READER_LONG_TASK_OBSERVER__?: PerformanceObserver;
  __RITO_READER_FLUSH_LONG_TASKS__?: () => void;
}

export async function installReaderWorkerProbe(target: InitScriptTarget): Promise<void> {
  await target.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & ReaderWorkerProbeGlobal;
    runtime.__RITO_READER_WORKER_OPERATIONS__ = [];
    runtime.__RITO_READER_WORKER_CREATIONS__ = [];
    runtime.__RITO_READER_WORKER_HELD_CONTINUATIONS__ = [];
    runtime.__RITO_READER_WORKER_TERMINATIONS__ = [];
    runtime.__RITO_READER_WORKER_HOLD_NEXT_CONTINUATION__ = false;
    runtime.__RITO_READER_LONG_TASKS__ = [];
    installLongTaskProbe(runtime);
    runtime.__RITO_READER_FLUSH_LONG_TASKS__ = () => {
      flushLongTasks(runtime);
    };

    const NativeWorker = globalThis.Worker;
    let nextWorkerId = 1;
    const releaseContinuations = new Set<() => void>();
    runtime.__RITO_READER_WORKER_RELEASE_CONTINUATIONS__ = () => {
      for (const release of releaseContinuations) release();
    };
    class ReaderWorkerProbe extends NativeWorker {
      readonly probeWorkerId: number;
      readonly shouldProbe: boolean;
      readonly heldResponses = new Map<number, unknown>();
      readonly bypassHold = new Set<number>();

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.probeWorkerId = nextWorkerId;
        nextWorkerId += 1;
        this.shouldProbe = options?.name === 'rito-browser-reader';
        if (!this.shouldProbe) return;
        runtime.__RITO_READER_WORKER_CREATIONS__?.push({
          workerId: this.probeWorkerId,
          createdAt: performance.now(),
        });
        releaseContinuations.add(this.releaseHeldResponses);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (this.holdContinuationResponse(event)) return;
          recordResponse(runtime, this.probeWorkerId, event.data);
        });
      }

      override terminate(): void {
        if (this.shouldProbe) {
          releaseContinuations.delete(this.releaseHeldResponses);
          runtime.__RITO_READER_WORKER_TERMINATIONS__?.push({
            workerId: this.probeWorkerId,
            terminatedAt: performance.now(),
          });
        }
        super.terminate();
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

      private readonly releaseHeldResponses = (): void => {
        for (const [requestId, data] of this.heldResponses) {
          this.bypassHold.add(requestId);
          markHeldContinuationReleased(runtime, this.probeWorkerId, requestId);
          this.dispatchEvent(new MessageEvent('message', { data }));
          this.heldResponses.delete(requestId);
        }
      };

      private holdContinuationResponse(event: MessageEvent<unknown>): boolean {
        const response = objectValue(event.data);
        const requestId = response?.['id'];
        if (typeof requestId !== 'number') return false;
        if (this.bypassHold.delete(requestId)) return false;
        if (!runtime.__RITO_READER_WORKER_HOLD_NEXT_CONTINUATION__) return false;
        const request = findPendingRecord(runtime, this.probeWorkerId, requestId);
        if (request?.kind !== 'continueRevision') return false;
        runtime.__RITO_READER_WORKER_HOLD_NEXT_CONTINUATION__ = false;
        this.heldResponses.set(requestId, event.data);
        runtime.__RITO_READER_WORKER_HELD_CONTINUATIONS__?.push({
          workerId: this.probeWorkerId,
          requestId,
          heldAt: performance.now(),
          releasedAt: null,
        });
        event.stopImmediatePropagation();
        return true;
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

    function flushLongTasks(root: typeof globalThis & ReaderWorkerProbeGlobal): void {
      const tasks = root.__RITO_READER_LONG_TASKS__;
      const observer = root.__RITO_READER_LONG_TASK_OBSERVER__;
      if (!tasks || !observer) return;
      for (const entry of observer.takeRecords()) {
        tasks.push({ startTime: entry.startTime, duration: entry.duration, name: entry.name });
      }
    }

    function recordRequest(
      root: typeof globalThis & ReaderWorkerProbeGlobal,
      workerId: number,
      value: unknown,
    ): void {
      const message = objectValue(value);
      if (typeof message?.['id'] !== 'number' || typeof message['kind'] !== 'string') return;
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
        releasedDocument: null,
        requestedRevision: revisionHandleObservation(message['revision']),
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
      record.releasedDocument =
        typeof payload?.['releasedDocument'] === 'boolean' ? payload['releasedDocument'] : null;
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

    function markHeldContinuationReleased(
      root: typeof globalThis & ReaderWorkerProbeGlobal,
      workerId: number,
      requestId: number,
    ): void {
      const held = root.__RITO_READER_WORKER_HELD_CONTINUATIONS__?.find(
        (entry) =>
          entry.workerId === workerId && entry.requestId === requestId && entry.releasedAt === null,
      );
      if (held) held.releasedAt = performance.now();
    }

    function revisionObservation(
      payload: Record<string, unknown> | undefined,
    ): ReaderWorkerRevisionObservation | null {
      const result = objectValue(payload?.['result']);
      const resultRevision = revisionHandleObservation(result) ? result : undefined;
      const revision =
        objectValue(result?.['revision']) ?? resultRevision ?? objectValue(payload?.['revision']);
      const handle = revisionHandleObservation(revision);
      if (!revision || !handle) return null;
      const extent = objectValue(revision['knownExtent']);
      return {
        ...handle,
        status: typeof revision['status'] === 'string' ? revision['status'] : null,
        knownPageCount: typeof extent?.['pageCount'] === 'number' ? extent['pageCount'] : null,
        knownSpreadCount:
          typeof extent?.['spreadCount'] === 'number' ? extent['spreadCount'] : null,
      };
    }

    function revisionHandleObservation(
      value: unknown,
    ): ReaderWorkerRevisionHandleObservation | null {
      const revision = objectValue(value);
      if (
        typeof revision?.['revisionId'] !== 'string' ||
        typeof revision['revisionVersion'] !== 'number'
      ) {
        return null;
      }
      return {
        revisionId: revision['revisionId'],
        revisionVersion: revision['revisionVersion'],
      };
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }
  });
}
