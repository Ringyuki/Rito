import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../core-contracts';
import type { BrowserReaderSessionCache } from '../core-contracts';
import type { BrowserReaderWorkerClient } from '../core-contracts';
import type { BrowserReaderBindingModule, BrowserReaderWorkerClientFactory } from './types';

const WORKER_SHELL_IDLE_TTL_MS = 200;

interface OptionalWorkerDisposalObserver {
  readonly whenDisposed?: (() => Promise<void>) | undefined;
}

let sharedWorkerConstructor: typeof Worker | undefined;
let sharedWorkerPool: BrowserReaderWorkerShellPool | undefined;

export function createBrowserReaderWorkerClientFactory(
  module: BrowserReaderBindingModule,
): BrowserReaderWorkerClientFactory {
  let cache: BrowserReaderSessionCache | undefined = {};
  const clients = new Map<BrowserReaderWorkerClient, Promise<void> | undefined>();
  let disposeTask: Promise<void> | undefined;
  const factory: BrowserReaderWorkerClientFactory = () => {
    const activeCache = cache;
    if (!activeCache) throw new Error('Browser reader worker factory is disposed');
    const client =
      typeof Worker === 'undefined'
        ? createInProcessBrowserReaderSession(module, activeCache)
        : createPooledBrowserReaderWorkerClient(activeCache, browserReaderWorkerShellPool());
    trackWorkerClient(clients, client);
    return client;
  };
  factory.dispose = () => {
    cache = undefined;
    disposeTask ??= disposeTrackedWorkerClients(clients);
    return disposeTask;
  };
  return factory;
}

export async function disposeAndWaitBrowserReaderWorkerClient(
  client: BrowserReaderWorkerClient,
): Promise<void> {
  await disposeTrackedWorkerClient(client, workerDisposalCompletion(client));
}

function trackWorkerClient(
  clients: Map<BrowserReaderWorkerClient, Promise<void> | undefined>,
  client: BrowserReaderWorkerClient,
): void {
  const completion = workerDisposalCompletion(client);
  clients.set(client, completion);
  if (!completion) return;
  void completion.then(
    () => {
      clients.delete(client);
    },
    () => undefined,
  );
}

function workerDisposalCompletion(client: BrowserReaderWorkerClient): Promise<void> | undefined {
  const observer = client as OptionalWorkerDisposalObserver;
  if (!observer.whenDisposed) return undefined;
  try {
    return observer.whenDisposed.call(client);
  } catch (error: unknown) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

async function disposeTrackedWorkerClients(
  clients: Map<BrowserReaderWorkerClient, Promise<void> | undefined>,
): Promise<void> {
  const entries = [...clients];
  const results = await Promise.allSettled(
    entries.map(([client, completion]) => disposeTrackedWorkerClient(client, completion)),
  );
  for (const [client] of entries) clients.delete(client);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason as unknown);
  if (failures.length > 0) throw new AggregateError(failures, 'Reader worker disposal failed');
}

async function disposeTrackedWorkerClient(
  client: BrowserReaderWorkerClient,
  completion: Promise<void> | undefined,
): Promise<void> {
  const failures: unknown[] = [];
  try {
    client.dispose();
  } catch (error: unknown) {
    failures.push(error);
  }
  if (completion) {
    try {
      await completion;
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(failures, 'Reader worker client disposal failed');
}

export const createInProcessBrowserReaderSession = createRitoCoreWasmInProcessReaderClient;

function createPooledBrowserReaderWorkerClient(
  cache: BrowserReaderSessionCache,
  pool: BrowserReaderWorkerShellPool,
): BrowserReaderWorkerClient {
  const worker = pool.acquire();
  return createRitoCoreWasmWorkerReaderClient(worker, cache, {
    recycleWorker: (releasedWorker) => releasedWorker === worker && pool.recycle(worker),
  });
}

function browserReaderWorkerShellPool(): BrowserReaderWorkerShellPool {
  const WorkerConstructor = Worker;
  if (sharedWorkerPool && sharedWorkerConstructor === WorkerConstructor) return sharedWorkerPool;
  sharedWorkerPool?.dispose();
  sharedWorkerConstructor = WorkerConstructor;
  sharedWorkerPool = createBrowserReaderWorkerShellPool(createBrowserWorker);
  return sharedWorkerPool;
}

function createBrowserWorker(): Worker {
  return new Worker(new URL('./worker-entry.mjs', import.meta.url), {
    type: 'module',
    name: 'rito-browser-reader',
  });
}

interface IdleWorkerShell {
  readonly timer: ReturnType<typeof globalThis.setTimeout>;
  readonly worker: Worker;
}

interface BrowserReaderWorkerShellPool {
  acquire(): Worker;
  dispose(): void;
  recycle(worker: Worker): boolean;
}

function createBrowserReaderWorkerShellPool(
  createWorker: () => Worker,
): BrowserReaderWorkerShellPool {
  let disposed = false;
  let idle: IdleWorkerShell | undefined;
  return {
    acquire: () => {
      if (disposed) throw new Error('Browser reader Worker shell pool is disposed');
      if (!idle) return createWorker();
      const { timer, worker } = idle;
      idle = undefined;
      globalThis.clearTimeout(timer);
      return worker;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (!idle) return;
      const { timer, worker } = idle;
      idle = undefined;
      globalThis.clearTimeout(timer);
      terminateBrowserReaderWorkerShell(worker);
    },
    recycle: (worker) => {
      if (disposed || idle) return false;
      const timer = globalThis.setTimeout(() => {
        if (idle?.worker !== worker) return;
        idle = undefined;
        terminateBrowserReaderWorkerShell(worker);
      }, WORKER_SHELL_IDLE_TTL_MS);
      idle = { timer, worker };
      return true;
    },
  };
}

function terminateBrowserReaderWorkerShell(worker: Worker): void {
  try {
    worker.terminate();
  } catch {
    // A recycled shell has no live client left to receive a termination failure.
  }
}
