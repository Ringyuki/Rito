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
  });

  it('treats promised data as loading before reader creation starts', async () => {
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

    expect(expectHookValue(latest).isLoading).toBe(true);
    expect(createReaderMock).not.toHaveBeenCalled();

    deferred.resolve(new ArrayBuffer(16));
    const pendingLoad = expectDefined(loadPromise);
    await act(async () => {
      await pendingLoad;
    });

    expect(createReaderMock).toHaveBeenCalledTimes(1);
    expect(expectHookValue(latest).isLoading).toBe(false);
    expect(expectHookValue(latest).isLoaded).toBe(true);
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
