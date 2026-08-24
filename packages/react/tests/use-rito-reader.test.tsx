// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useRitoReader, type UseRitoReaderOptions } from '../src/hooks';

const { createReaderMock, createControllerMock, parseReadingPositionMock } = vi.hoisted(() => ({
  createReaderMock: vi.fn(),
  createControllerMock: vi.fn(),
  parseReadingPositionMock: vi.fn(),
}));

vi.mock('@ritojs/core', () => ({
  createReader: createReaderMock,
}));

vi.mock('@ritojs/kit', () => ({
  createController: createControllerMock,
  parseReadingPosition: parseReadingPositionMock,
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

function createControllerStub(
  currentSpread = 0,
  restorePosition: () => Promise<number | undefined> = () => Promise.resolve(undefined),
): ReaderController {
  return {
    currentSpread,
    restorePosition: vi.fn(restorePosition),
    dispose: vi.fn(),
    on: vi.fn(() => vi.fn()),
  } as unknown as ReaderController;
}

function createThrowingCleanupStack(totalSpreads: number): {
  readonly reader: Reader;
  readonly controller: ReaderController;
  readonly detachEvents: ReturnType<typeof vi.fn>;
  readonly disposeController: ReturnType<typeof vi.fn>;
  readonly disposeReader: ReturnType<typeof vi.fn>;
} {
  const detachEvents = vi.fn(() => {
    throw new Error('detach failed');
  });
  const disposeController = vi.fn(() => {
    throw new Error('controller dispose failed');
  });
  const disposeReader = vi.fn();
  return {
    reader: {
      ...createReaderStub({ totalSpreads }),
      dispose: disposeReader,
    } as Reader,
    controller: {
      ...createControllerStub(),
      dispose: disposeController,
      on: vi.fn(() => detachEvents),
    } as unknown as ReaderController,
    detachEvents,
    disposeController,
    disposeReader,
  };
}

function createDeferredLayoutReader(
  overrides?: Partial<Pick<Reader, 'metadata' | 'toc'>>,
  disposeTask?: Promise<undefined>,
): {
  readonly reader: Reader;
  readonly dispose: ReturnType<typeof vi.fn>;
  commitLayout(totalSpreads: number): void;
} {
  let totalSpreads = 0;
  const listeners = new Set<() => void>();
  const dispose = vi.fn(() => disposeTask);
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
    parseReadingPositionMock.mockReset();
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

  it('does not let unresolved stale input data block a newer load', async () => {
    const staleData = createDeferred<ArrayBuffer>();
    const activeReader = createReaderStub({
      metadata: { title: 'active' } as unknown as Reader['metadata'],
    });
    createReaderMock.mockResolvedValue(activeReader);
    createControllerMock.mockReturnValue(createControllerStub());

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let staleLoad: Promise<void> | undefined;
    act(() => {
      staleLoad = expectHookValue(latest).load(staleData.promise);
    });
    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(16));
    });

    expect(createReaderMock).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).metadata).toEqual(activeReader.metadata);

    staleData.resolve(new ArrayBuffer(8));
    await act(async () => {
      await expectDefined(staleLoad);
    });

    expect(createReaderMock).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).metadata).toEqual(activeReader.metadata);
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

  it('releases a stale layout-wait reader before creating its replacement', async () => {
    vi.useFakeTimers();
    const release = createDeferred<undefined>();
    const staleLayout = createDeferredLayoutReader(undefined, release.promise);
    const activeReader = createReaderStub({ totalSpreads: 3 });
    createReaderMock.mockResolvedValueOnce(staleLayout.reader).mockResolvedValueOnce(activeReader);
    createControllerMock.mockReturnValue(createControllerStub());

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });

    let staleLoad: Promise<void> | undefined;
    let activeLoad: Promise<void> | undefined;
    act(() => {
      staleLoad = expectHookValue(latest).load(new ArrayBuffer(8));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(createReaderMock).toHaveBeenCalledOnce();
    expect(createControllerMock).not.toHaveBeenCalled();

    act(() => {
      activeLoad = expectHookValue(latest).load(new ArrayBuffer(16));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(staleLayout.dispose).toHaveBeenCalledOnce();
    expect(createReaderMock).toHaveBeenCalledOnce();

    release.resolve(undefined);
    await act(async () => {
      await Promise.all([expectDefined(staleLoad), expectDefined(activeLoad)]);
    });

    expect(createReaderMock).toHaveBeenCalledTimes(2);
    expect(createControllerMock).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).totalSpreads).toBe(3);
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

  it('waits for asynchronous reader release before creating a replacement stack', async () => {
    const release = createDeferred<undefined>();
    const firstReaderDispose = vi.fn(() => release.promise);
    const firstReader = {
      ...createReaderStub({ totalSpreads: 2 }),
      dispose: firstReaderDispose,
    } as Reader;
    const secondReader = createReaderStub({ totalSpreads: 3 });
    createReaderMock.mockResolvedValueOnce(firstReader).mockResolvedValueOnce(secondReader);
    createControllerMock
      .mockReturnValueOnce(createControllerStub())
      .mockReturnValueOnce(createControllerStub());

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(8));
    });

    let replacementLoad: Promise<void> | undefined;
    act(() => {
      replacementLoad = expectHookValue(latest).load(new ArrayBuffer(16));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(firstReaderDispose).toHaveBeenCalledOnce();
    expect(createReaderMock).toHaveBeenCalledOnce();

    release.resolve(undefined);
    await act(async () => {
      await expectDefined(replacementLoad);
    });

    expect(createReaderMock).toHaveBeenCalledTimes(2);
    expect(expectHookValue(latest).totalSpreads).toBe(3);
  });

  it('continues a replacement load after detach and controller cleanup fail', async () => {
    const first = createThrowingCleanupStack(2);
    const secondReader = createReaderStub({ totalSpreads: 3 });
    const secondController = createControllerStub();
    createReaderMock.mockResolvedValueOnce(first.reader).mockResolvedValueOnce(secondReader);
    createControllerMock
      .mockReturnValueOnce(first.controller)
      .mockReturnValueOnce(secondController);

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(8));
      await expectHookValue(latest).load(new ArrayBuffer(16));
    });

    expect(first.detachEvents).toHaveBeenCalledTimes(3);
    expect(first.disposeController).toHaveBeenCalledOnce();
    expect(first.disposeReader).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).controller).toBe(secondController);
    expect(expectHookValue(latest).totalSpreads).toBe(3);
  });

  it('still disposes the reader when detach and controller cleanup fail on unmount', async () => {
    const stack = createThrowingCleanupStack(2);
    createReaderMock.mockResolvedValue(stack.reader);
    createControllerMock.mockReturnValue(stack.controller);

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(8));
    });

    expect(() => {
      act(() => {
        root.unmount();
      });
    }).not.toThrow();
    expect(stack.detachEvents).toHaveBeenCalledTimes(3);
    expect(stack.disposeController).toHaveBeenCalledOnce();
    expect(stack.disposeReader).toHaveBeenCalledOnce();
  });

  it('releases a stale provisional reader before starting the next creation', async () => {
    const staleRelease = createDeferred<undefined>();
    const staleReaderDispose = vi.fn(() => staleRelease.promise);
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
      await Promise.resolve();
    });

    expect(createReaderMock).toHaveBeenCalledOnce();
    expect(createControllerMock).not.toHaveBeenCalled();

    staleReaderDeferred.resolve(staleReader);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(staleReaderDispose).toHaveBeenCalledOnce();
    expect(createReaderMock).toHaveBeenCalledOnce();

    staleRelease.resolve(undefined);
    await act(async () => {
      await Promise.all([expectDefined(firstLoad), expectDefined(secondLoad)]);
    });

    expect(createReaderMock).toHaveBeenCalledTimes(2);
    expect(createControllerMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).metadata).toEqual(activeReader.metadata);
    expect(expectHookValue(latest).totalSpreads).toBe(3);
  });

  it('rolls back partial event subscriptions when stack commit fails', async () => {
    const readerDispose = vi.fn();
    const reader = {
      ...createReaderStub({ totalSpreads: 2 }),
      dispose: readerDispose,
    } as Reader;
    const unsubscribe = vi.fn();
    const controllerDispose = vi.fn();
    const controller = {
      ...createControllerStub(),
      dispose: controllerDispose,
      on: vi
        .fn()
        .mockReturnValueOnce(unsubscribe)
        .mockImplementationOnce(() => {
          throw new Error('event subscription failed');
        }),
    } as unknown as ReaderController;
    createReaderMock.mockResolvedValue(reader);
    createControllerMock.mockReturnValue(controller);

    let latest: HookValue | null = null;
    act(() => {
      root.render(
        <Harness
          options={{ reader: { width: 800, height: 600 } }}
          onValue={(value) => {
            latest = value;
          }}
        />,
      );
    });
    await act(async () => {
      await expectHookValue(latest).load(new ArrayBuffer(8));
    });

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(readerDispose).toHaveBeenCalledOnce();
    expect(expectHookValue(latest).controller).toBeNull();
    expect(expectHookValue(latest).isLoaded).toBe(false);
    expect(expectHookValue(latest).error).toBe('event subscription failed');
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
