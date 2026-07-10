import type { BrowserContext, Page } from '@playwright/test';

export type ReaderRuntimeWire = 'json' | 'ritorb1';

export interface ReaderWireMetrics {
  readonly rawWireBytes: number;
  readonly wasmMethodMs: number;
  readonly rustEncodeMs: number;
  readonly jsDecodeMs: number;
  readonly workerProcessingMs: number;
}

export interface ReaderRevisionWireObservation {
  readonly workerId: number;
  readonly requestId: number;
  readonly wire: string;
  readonly mode: string;
  readonly hasPreviousRevision: boolean;
  readonly startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  ok: boolean | null;
  viewKind: string | null;
  display: string | null;
  preview: boolean | null;
  spreadCount: number | null;
  metrics: ReaderWireMetrics | null;
  error: string | null;
}

export interface ReaderLongTaskObservation {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
}

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface ReaderWireProbeGlobal {
  __RITO_CORE_WASM_READER_WIRE__?: ReaderRuntimeWire;
  __RITO_WIRE_AB_REVISIONS__?: ReaderRevisionWireObservation[];
  __RITO_WIRE_AB_LONG_TASKS__?: ReaderLongTaskObservation[];
  __RITO_WIRE_AB_LONG_TASK_OBSERVER__?: PerformanceObserver;
}

interface ReaderWireProbeConfig {
  readonly selectedWire: ReaderRuntimeWire;
  readonly shouldCollectWireMetrics: boolean;
}

export async function installReaderWireProbe(
  target: InitScriptTarget,
  wire: ReaderRuntimeWire,
  collectWireMetrics = false,
): Promise<void> {
  const config: ReaderWireProbeConfig = {
    selectedWire: wire,
    shouldCollectWireMetrics: collectWireMetrics,
  };
  await target.addInitScript((probeConfig: ReaderWireProbeConfig) => {
    const { selectedWire, shouldCollectWireMetrics } = probeConfig;
    const runtime = globalThis as typeof globalThis & ReaderWireProbeGlobal;
    runtime.__RITO_CORE_WASM_READER_WIRE__ = selectedWire;
    runtime.__RITO_WIRE_AB_REVISIONS__ = [];
    runtime.__RITO_WIRE_AB_LONG_TASKS__ = [];
    installLongTaskProbe(runtime);

    const NativeWorker = globalThis.Worker;
    let nextWorkerId = 1;
    class ReaderWireProbeWorker extends NativeWorker {
      readonly probeWorkerId: number;

      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.probeWorkerId = nextWorkerId;
        nextWorkerId += 1;
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          recordResponse(runtime, this.probeWorkerId, event.data, shouldCollectWireMetrics);
        });
      }

      override postMessage(message: unknown, transfer: Transferable[]): void;
      override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
      override postMessage(
        message: unknown,
        transferOrOptions?: Transferable[] | StructuredSerializeOptions,
      ): void {
        const forwardedMessage = withWireMetricCollection(message, shouldCollectWireMetrics);
        recordRequest(runtime, this.probeWorkerId, forwardedMessage);
        if (transferOrOptions === undefined) {
          super.postMessage(forwardedMessage);
        } else if (Array.isArray(transferOrOptions)) {
          super.postMessage(forwardedMessage, transferOrOptions);
        } else {
          super.postMessage(forwardedMessage, transferOrOptions);
        }
      }
    }
    globalThis.Worker = ReaderWireProbeWorker;

    function installLongTaskProbe(root: typeof globalThis & ReaderWireProbeGlobal): void {
      if (
        typeof PerformanceObserver === 'undefined' ||
        !PerformanceObserver.supportedEntryTypes.includes('longtask')
      ) {
        return;
      }
      const observer = new PerformanceObserver((list) => {
        const tasks = root.__RITO_WIRE_AB_LONG_TASKS__;
        if (!tasks) return;
        for (const entry of list.getEntries()) {
          tasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      root.__RITO_WIRE_AB_LONG_TASK_OBSERVER__ = observer;
    }

    function recordRequest(
      root: typeof globalThis & ReaderWireProbeGlobal,
      workerId: number,
      value: unknown,
    ): void {
      const message = objectValue(value);
      if (message?.['kind'] !== 'createViewRevision' || typeof message['id'] !== 'number') return;
      const request = objectValue(message['request']);
      root.__RITO_WIRE_AB_REVISIONS__?.push({
        workerId,
        requestId: message['id'],
        wire: typeof message['wire'] === 'string' ? message['wire'] : '<missing>',
        mode: typeof request?.['mode'] === 'string' ? request['mode'] : '<missing>',
        hasPreviousRevision: typeof request?.['previousRevisionId'] === 'string',
        startedAt: performance.now(),
        completedAt: null,
        durationMs: null,
        ok: null,
        viewKind: null,
        display: null,
        preview: null,
        spreadCount: null,
        metrics: null,
        error: null,
      });
    }

    function recordResponse(
      root: typeof globalThis & ReaderWireProbeGlobal,
      workerId: number,
      value: unknown,
      shouldCollectWireMetrics: boolean,
    ): void {
      const message = objectValue(value);
      if (!message || typeof message['id'] !== 'number') return;
      const records = root.__RITO_WIRE_AB_REVISIONS__;
      const record = records
        ?.slice()
        .reverse()
        .find(
          (candidate) =>
            candidate.workerId === workerId &&
            candidate.requestId === message['id'] &&
            candidate.completedAt === null,
        );
      if (!record) return;
      const completedAt = performance.now();
      record.completedAt = completedAt;
      record.durationMs = completedAt - record.startedAt;
      record.ok = message['ok'] === true;
      record.metrics = shouldCollectWireMetrics
        ? wireMetricsValue(message['__ritoWireMetrics'])
        : null;
      if (message['ok'] !== true) {
        const error = objectValue(message['error']);
        record.error = typeof error?.['message'] === 'string' ? error['message'] : 'worker error';
        return;
      }
      const payload = objectValue(message['payload']);
      if (payload?.['kind'] !== 'createViewRevision') return;
      const view = objectValue(payload['result']);
      const result = objectValue(view?.['result']);
      const bundle = objectValue(result?.['bundle']);
      const revision = objectValue(bundle?.['revision']);
      record.viewKind = typeof view?.['kind'] === 'string' ? view['kind'] : null;
      record.display = typeof view?.['display'] === 'string' ? view['display'] : null;
      record.preview = typeof result?.['preview'] === 'boolean' ? result['preview'] : null;
      record.spreadCount =
        typeof revision?.['spreadCount'] === 'number' ? revision['spreadCount'] : null;
    }

    function withWireMetricCollection(value: unknown, enabled: boolean): unknown {
      if (!enabled) return value;
      const message = objectValue(value);
      if (message?.['kind'] !== 'createViewRevision') return value;
      return { ...message, __ritoCollectWireMetrics: true };
    }

    function wireMetricsValue(value: unknown): ReaderWireMetrics | null {
      const metrics = objectValue(value);
      if (
        typeof metrics?.['rawWireBytes'] !== 'number' ||
        typeof metrics['wasmMethodMs'] !== 'number' ||
        typeof metrics['rustEncodeMs'] !== 'number' ||
        typeof metrics['jsDecodeMs'] !== 'number' ||
        typeof metrics['workerProcessingMs'] !== 'number'
      ) {
        return null;
      }
      return {
        rawWireBytes: metrics['rawWireBytes'],
        wasmMethodMs: metrics['wasmMethodMs'],
        rustEncodeMs: metrics['rustEncodeMs'],
        jsDecodeMs: metrics['jsDecodeMs'],
        workerProcessingMs: metrics['workerProcessingMs'],
      };
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }
  }, config);
}

export async function readReaderWireObservations(
  page: Page,
): Promise<ReaderRevisionWireObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWireProbeGlobal;
    return runtime.__RITO_WIRE_AB_REVISIONS__?.map((entry) => ({ ...entry })) ?? [];
  });
}

export async function readReaderLongTasks(page: Page): Promise<ReaderLongTaskObservation[]> {
  return page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & ReaderWireProbeGlobal;
    return runtime.__RITO_WIRE_AB_LONG_TASKS__?.map((entry) => ({ ...entry })) ?? [];
  });
}
