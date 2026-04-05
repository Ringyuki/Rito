// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from 'rito';
import type { ReaderController } from '@rito/kit';
import { useRitoReader, type UseRitoReaderOptions } from '../src/hooks';

const { createReaderMock, createControllerMock } = vi.hoisted(() => ({
  createReaderMock: vi.fn(),
  createControllerMock: vi.fn(),
}));

vi.mock('rito', () => ({
  createReader: createReaderMock,
}));

vi.mock('@rito/kit', () => ({
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
    const fakeReader = {
      dispose: vi.fn(),
      totalSpreads: 1,
      metadata: null,
      toc: [],
      spreads: [],
    } as unknown as Reader;
    const fakeController = {
      dispose: vi.fn(),
      on: vi.fn(() => () => {}),
    } as unknown as ReaderController;
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
});
