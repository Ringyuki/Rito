// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useRitoReader, type UseRitoReaderOptions } from '../src/hooks';

const { createReaderMock, createControllerMock } = vi.hoisted(() => ({
  createReaderMock: vi.fn(),
  createControllerMock: vi.fn(),
}));

vi.mock('@ritojs/core', () => ({
  createReader: createReaderMock,
}));

vi.mock('@ritojs/kit', () => ({
  createController: createControllerMock,
}));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type HookValue = ReturnType<typeof useRitoReader>;

function Harness({
  options,
  onValue,
}: {
  options: UseRitoReaderOptions;
  onValue: (value: HookValue) => void;
}) {
  const value = useRitoReader(options);
  onValue(value);
  return null;
}

function expectHookValue(value: HookValue | null): HookValue {
  expect(value).not.toBeNull();
  return value as HookValue;
}

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  return value as T;
}

function createReaderStub(
  overrides?: Partial<Pick<Reader, 'totalSpreads' | 'metadata' | 'toc' | 'spreads'>>,
): Reader {
  return {
    dispose: vi.fn(),
    totalSpreads: overrides?.totalSpreads ?? 1,
    metadata: overrides?.metadata ?? null,
    toc: overrides?.toc ?? [],
    spreads: overrides?.spreads ?? [],
  } as unknown as Reader;
}

function createControllerStub(): ReaderController {
  return {
    dispose: vi.fn(),
    on: vi.fn(() => vi.fn()),
  } as unknown as ReaderController;
}

function createDeferredLayoutReader(overrides?: Partial<Pick<Reader, 'metadata' | 'toc'>>): {
  readonly reader: Reader;
  readonly dispose: ReturnType<typeof vi.fn>;
  commitLayout(totalSpreads: number): void;
} {
  let totalSpreads = 0;
  const listeners = new Set<() => void>();
  const dispose = vi.fn();
  const reader = {
    dispose,
    get totalSpreads() {
      return totalSpreads;
    },
    get metadata() {
      return overrides?.metadata ?? null;
    },
    get toc() {
      return overrides?.toc ?? [];
    },
    get spreads() {
      return Array.from({ length: totalSpreads }, (_, index) => ({ left: { index } }));
    },
    onLayoutCommitted(cb: () => void) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  } as unknown as Reader;
  return {
    reader,
    dispose,
    commitLayout(nextTotalSpreads) {
      totalSpreads = nextTotalSpreads;
      for (const listener of listeners) listener();
    },
  };
}

describe('useRitoReader', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    createReaderMock.mockReset();
    createControllerMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it('shows loading for promised data only after the fast-path delay', async () => {
    vi.useFakeTimers();
    const fakeReader = createReaderStub();
    const fakeController = createControllerStub();
    createReaderMock.mockResolvedValue(fakeReader);
    createControllerMock.mockReturnValue(fakeController);

    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={options}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    const deferred = createDeferred<ArrayBuffer>();
    let loadPromise: Promise<void> | undefined;

    act(() => {
      loadPromise = expectHookValue(latest).load(deferred.promise);
    });

    expect(expectHookValue(latest).isLoading).toBe(false);
    expect(createReaderMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(expectHookValue(latest).isLoading).toBe(true);

    deferred.resolve(new ArrayBuffer(16));
    const pendingLoad = expectDefined(loadPromise);
    await act(async () => {
      await pendingLoad;
    });

    expect(createReaderMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).isLoading).toBe(false);
    expect(expectHookValue(latest).isLoaded).toBe(true);
  });

  it('waits for the first reader layout before creating the controller', async () => {
    vi.useFakeTimers();
    const layout = createDeferredLayoutReader({
      metadata: { title: 'deferred' } as unknown as Reader['metadata'],
    });
    const fakeController = createControllerStub();
    createReaderMock.mockResolvedValue(layout.reader);
    createControllerMock.mockReturnValue(fakeController);

    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={options}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let loadPromise: Promise<void> | undefined;
    act(() => {
      loadPromise = expectHookValue(latest).load(Promise.resolve(new ArrayBuffer(16)));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createReaderMock).toHaveBeenCalledTimes(1);
    expect(createControllerMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120);
    });
    expect(expectHookValue(latest).isLoading).toBe(true);

    act(() => {
      layout.commitLayout(2);
    });
    await act(async () => {
      await expectDefined(loadPromise);
    });

    expect(createControllerMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).isLoading).toBe(false);
    expect(expectHookValue(latest).totalSpreads).toBe(2);
    expect(expectHookValue(latest).metadata).toEqual(layout.reader.metadata);
  });

  it('disposes the active stack before starting a replacement load', async () => {
    const firstReaderDispose = vi.fn();
    const firstReader = {
      ...createReaderStub({ totalSpreads: 2 }),
      dispose: firstReaderDispose,
    } as Reader;
    const secondReader = createReaderStub({ totalSpreads: 3 });
    const firstControllerDispose = vi.fn();
    const firstController = {
      ...createControllerStub(),
      dispose: firstControllerDispose,
    } as ReaderController;
    const secondController = createControllerStub();
    const secondData = createDeferred<ArrayBuffer>();

    createReaderMock.mockResolvedValueOnce(firstReader).mockResolvedValueOnce(secondReader);
    createControllerMock.mockReturnValueOnce(firstController).mockReturnValueOnce(secondController);

    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={options}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await expectHookValue(latest).load(Promise.resolve(new ArrayBuffer(8)));
    });

    expect(expectHookValue(latest).controller).toBe(firstController);

    let secondLoad: Promise<void> | undefined;
    act(() => {
      secondLoad = expectHookValue(latest).load(secondData.promise);
    });

    expect(firstControllerDispose).toHaveBeenCalledTimes(1);
    expect(firstReaderDispose).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).controller).toBeNull();
    expect(expectHookValue(latest).isLoading).toBe(false);

    secondData.resolve(new ArrayBuffer(16));
    await act(async () => {
      await expectDefined(secondLoad);
    });

    expect(expectHookValue(latest).controller).toBe(secondController);
    expect(expectHookValue(latest).totalSpreads).toBe(3);
  });

  it('ignores stale in-flight load completions from older requests', async () => {
    const staleReaderDispose = vi.fn();
    const staleReader = {
      ...createReaderStub({
        metadata: { title: 'stale' } as unknown as Reader['metadata'],
      }),
      dispose: staleReaderDispose,
    } as Reader;
    const activeReader = createReaderStub({
      totalSpreads: 3,
      metadata: { title: 'active' } as unknown as Reader['metadata'],
    });
    const activeController = createControllerStub();
    const staleReaderDeferred = createDeferred<Reader>();

    createReaderMock
      .mockReturnValueOnce(staleReaderDeferred.promise)
      .mockResolvedValueOnce(activeReader);
    createControllerMock.mockReturnValue(activeController);

    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={options}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let firstLoad: Promise<void> | undefined;
    let secondLoad: Promise<void> | undefined;

    act(() => {
      firstLoad = expectHookValue(latest).load(Promise.resolve(new ArrayBuffer(8)));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(createReaderMock).toHaveBeenCalledTimes(1);

    act(() => {
      secondLoad = expectHookValue(latest).load(Promise.resolve(new ArrayBuffer(16)));
    });
    await act(async () => {
      await expectDefined(secondLoad);
    });

    expect(createReaderMock).toHaveBeenCalledTimes(2);
    expect(createControllerMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).metadata).toEqual(activeReader.metadata);
    expect(expectHookValue(latest).totalSpreads).toBe(3);

    staleReaderDeferred.resolve(staleReader);
    await act(async () => {
      await expectDefined(firstLoad);
    });

    expect(staleReaderDispose).toHaveBeenCalledTimes(1);
    expect(createControllerMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).metadata).toEqual(activeReader.metadata);
    expect(expectHookValue(latest).totalSpreads).toBe(3);
  });

  it('disposes a created reader when controller construction fails', async () => {
    const dispose = vi.fn();
    createReaderMock.mockResolvedValue({ ...createReaderStub(), dispose });
    createControllerMock.mockImplementation(() => {
      throw new Error('controller setup failed');
    });
    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };
    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={options}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(8));
    });

    expect(dispose).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).isLoaded).toBe(false);
    expect(expectHookValue(latest).error).toBe('controller setup failed');
  });

  it('renders safely without document during server rendering', () => {
    const options: UseRitoReaderOptions = {
      reader: { width: 800, height: 600 },
    };
    const originalDocument = globalThis.document;

    Object.defineProperty(globalThis, 'document', {
      value: undefined,
      configurable: true,
    });

    try {
      expect(() => {
        renderToString(<Harness options={options} onValue={() => {}} />);
      }).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'document', {
        value: originalDocument,
        configurable: true,
      });
    }
  });
});
