import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserReaderWorkerClientFactory } from '../../src/bindings/browser/reader/worker-client';
import type { BrowserReaderBindingModule } from '../../src/bindings/browser/reader/types';

const mocks = vi.hoisted(() => ({
  createInProcessClient: vi.fn((_module: unknown, _cache?: unknown) => ({
    kind: 'in-process',
  })),
  createWorkerClient: vi.fn((_worker: unknown, _cache?: unknown) => ({ kind: 'worker' })),
}));

vi.mock('../../src/bindings/browser/core-contracts', () => ({
  createRitoCoreWasmInProcessReaderClient: mocks.createInProcessClient,
  createRitoCoreWasmWorkerReaderClient: mocks.createWorkerClient,
}));

afterEach(() => {
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
});
