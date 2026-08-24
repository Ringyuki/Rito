import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserReaderWorkerClientFactory } from '../../src/bindings/browser/reader/worker-client';
import type { BrowserReaderBindingModule } from '../../src/bindings/browser/reader/types';

const mocks = vi.hoisted(() => ({
  createInProcessClient: vi.fn((_module: unknown, _cache?: unknown) => ({
    kind: 'in-process',
    dispose: vi.fn(),
    whenDisposed: vi.fn(() => Promise.resolve()),
  })),
  createWorkerClient: vi.fn((_worker: unknown, _cache?: unknown, _options?: unknown) => ({
    kind: 'worker',
    dispose: vi.fn(),
    whenDisposed: vi.fn(() => Promise.resolve()),
  })),
}));

vi.mock('../../src/bindings/browser/core-contracts', () => ({
  createRitoCoreWasmInProcessReaderClient: mocks.createInProcessClient,
  createRitoCoreWasmWorkerReaderClient: mocks.createWorkerClient,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Browser reader worker client factory', () => {
  it('shares one cache only between clients created for the same in-process reader', () => {
    vi.stubGlobal('Worker', undefined);
    const module = {} as BrowserReaderBindingModule;
    const firstReaderFactory = createBrowserReaderWorkerClientFactory(module);

    firstReaderFactory();
    firstReaderFactory();

    const firstCache = mocks.createInProcessClient.mock.calls[0]?.[1];
    expect(firstCache).toEqual({});
    expect(mocks.createInProcessClient.mock.calls[1]?.[1]).toBe(firstCache);

    createBrowserReaderWorkerClientFactory(module)();
    expect(mocks.createInProcessClient.mock.calls[2]?.[1]).not.toBe(firstCache);
  });

  it('creates foreground and full-reflow workers with the same reader cache', () => {
    const workers: object[] = [];
    function TestWorker(this: object): void {
      workers.push(this);
    }
    vi.stubGlobal('Worker', TestWorker);
    const factory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);

    factory();
    factory();

    expect(workers).toHaveLength(2);
    expect(mocks.createWorkerClient.mock.calls[0]?.[0]).toBe(workers[0]);
    expect(mocks.createWorkerClient.mock.calls[1]?.[0]).toBe(workers[1]);
    expect(mocks.createWorkerClient.mock.calls[1]?.[1]).toBe(
      mocks.createWorkerClient.mock.calls[0]?.[1],
    );
  });

  it('reuses a released Worker shell across reader factories before the idle deadline', async () => {
    vi.useFakeTimers();
    const workers: TestWorker[] = [];
    function WorkerConstructor(this: TestWorker): void {
      this.terminate = vi.fn();
      workers.push(this);
    }
    vi.stubGlobal('Worker', WorkerConstructor);
    mocks.createWorkerClient
      .mockImplementationOnce(createRecyclableWorkerClient)
      .mockImplementationOnce(createRecyclableWorkerClient);

    const firstFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    firstFactory();
    await firstFactory.dispose?.();
    const secondFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    secondFactory();

    expect(workers).toHaveLength(1);
    expect(mocks.createWorkerClient.mock.calls[1]?.[0]).toBe(workers[0]);

    await secondFactory.dispose?.();
    vi.advanceTimersByTime(200);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
  });

  it('keeps at most one idle Worker shell', async () => {
    vi.useFakeTimers();
    const workers: TestWorker[] = [];
    function WorkerConstructor(this: TestWorker): void {
      this.terminate = vi.fn();
      workers.push(this);
    }
    vi.stubGlobal('Worker', WorkerConstructor);
    mocks.createWorkerClient
      .mockImplementationOnce(createRecyclableWorkerClient)
      .mockImplementationOnce(createRecyclableWorkerClient);
    const firstFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    const secondFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    firstFactory();
    secondFactory();

    await firstFactory.dispose?.();
    await secondFactory.dispose?.();

    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminate).not.toHaveBeenCalled();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(200);
    expect(workers[0]?.terminate).toHaveBeenCalledOnce();
    expect(workers[1]?.terminate).toHaveBeenCalledOnce();
  });

  it('contains termination failures from an idle deadline', async () => {
    vi.useFakeTimers();
    const failure = new Error('idle termination failed');
    const worker = {
      terminate: vi.fn(() => {
        throw failure;
      }),
    };
    vi.stubGlobal('Worker', function WorkerConstructor(): object {
      return worker;
    });
    mocks.createWorkerClient.mockImplementationOnce(createRecyclableWorkerClient);
    const factory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    factory();
    await factory.dispose?.();

    expect(() => {
      vi.advanceTimersByTime(200);
    }).not.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('contains termination failures while replacing an idle shell pool', async () => {
    vi.useFakeTimers();
    const failure = new Error('pool termination failed');
    const oldWorker = {
      terminate: vi.fn(() => {
        throw failure;
      }),
    };
    vi.stubGlobal('Worker', function OldWorkerConstructor(): object {
      return oldWorker;
    });
    mocks.createWorkerClient.mockImplementation(createRecyclableWorkerClient);
    const oldFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    oldFactory();
    await oldFactory.dispose?.();

    const newWorker = { terminate: vi.fn() };
    vi.stubGlobal('Worker', function NewWorkerConstructor(): object {
      return newWorker;
    });
    const newFactory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    expect(() => newFactory()).not.toThrow();
    expect(oldWorker.terminate).toHaveBeenCalledOnce();

    await newFactory.dispose?.();
  });

  it('releases all clients and rejects later clients after disposal', async () => {
    vi.stubGlobal('Worker', undefined);
    const factory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);

    const client = factory() as unknown as {
      readonly dispose: ReturnType<typeof vi.fn>;
    };
    const cache = mocks.createInProcessClient.mock.calls[0]?.[1];
    await factory.dispose?.();

    expect(() => factory()).toThrow('Browser reader worker factory is disposed');
    expect(mocks.createInProcessClient).toHaveBeenCalledTimes(1);
    expect(client.dispose).toHaveBeenCalledOnce();
    expect(cache).toEqual({});
  });

  it('isolates client failures and waits for every disposal completion', async () => {
    vi.stubGlobal('Worker', undefined);
    const completion = deferredVoid();
    const failure = new Error('first client dispose failed');
    const first = clientFixture(() => {
      throw failure;
    });
    const second = clientFixture(() => undefined, completion.promise);
    const third = clientFixture();
    mocks.createInProcessClient
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const factory = createBrowserReaderWorkerClientFactory({} as BrowserReaderBindingModule);
    factory();
    factory();
    factory();

    const disposal = factory.dispose?.();
    if (!disposal) throw new Error('Worker factory did not expose disposal');
    let settled = false;
    void disposal.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    expect(() => factory()).toThrow('Browser reader worker factory is disposed');
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
    expect(third.dispose).toHaveBeenCalledOnce();
    expect(factory.dispose?.()).toBe(disposal);
    await Promise.resolve();
    expect(settled).toBe(false);

    completion.resolve();
    await expect(disposal).rejects.toThrow('Reader worker disposal failed');
    expect(settled).toBe(true);
  });
});

function clientFixture(
  disposeImplementation: () => void = () => undefined,
  completion: Promise<void> = Promise.resolve(),
) {
  return {
    kind: 'in-process',
    dispose: vi.fn(disposeImplementation),
    whenDisposed: vi.fn(() => completion),
  };
}

function deferredVoid(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      if (!resolve) throw new Error('Deferred promise was not initialized');
      resolve();
    },
  };
}

interface TestWorker {
  terminate: () => void;
}

interface RecycleOptions {
  readonly recycleWorker?: ((worker: unknown) => boolean) | undefined;
}

function createRecyclableWorkerClient(worker: unknown, _cache?: unknown, options?: unknown) {
  const completion = deferredVoid();
  const recyclable = options as RecycleOptions | undefined;
  return {
    kind: 'worker',
    dispose: vi.fn(() => {
      if (!recyclable?.recycleWorker?.(worker)) (worker as TestWorker).terminate();
      completion.resolve();
    }),
    whenDisposed: vi.fn(() => completion.promise),
  };
}
