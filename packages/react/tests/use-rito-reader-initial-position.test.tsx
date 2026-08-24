// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Reader } from '@ritojs/core';
import type { ReaderController, ReadingPosition } from '@ritojs/kit';
import { useRitoReader, type UseRitoReaderOptions } from '../src/hooks';

const mocks = vi.hoisted(() => ({
  createReader: vi.fn(),
  createController: vi.fn(),
  parseReadingPosition: vi.fn(),
}));

vi.mock('@ritojs/core', () => ({ createReader: mocks.createReader }));
vi.mock('@ritojs/kit', () => ({
  createController: mocks.createController,
  parseReadingPosition: mocks.parseReadingPosition,
}));

type HookValue = ReturnType<typeof useRitoReader>;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function position(spreadIndex = 4): ReadingPosition {
  return {
    sourceLocator: {
      href: 'Text/target.xhtml',
      sourcePoint: { nodePath: [1, 2], textOffset: 3 },
    },
    projection: { spreadIndex, pageIndex: spreadIndex },
    progress: 0.5,
    timestamp: 1,
  };
}

function reader(totalSpreads = 6, title = 'book'): Reader {
  return {
    dispose: vi.fn(),
    totalSpreads,
    metadata: { title } as Reader['metadata'],
    toc: [],
    spreads: [],
  } as unknown as Reader;
}

function controller(
  currentSpread = 0,
  restore: () => Promise<number | undefined> = () => Promise.resolve(undefined),
): ReaderController {
  return {
    currentSpread,
    restorePosition: vi.fn(restore),
    dispose: vi.fn(),
    on: vi.fn(() => vi.fn()),
  } as unknown as ReaderController;
}

function readControllerMocks(value: ReaderController): {
  readonly restorePosition: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
} {
  return value as unknown as {
    readonly restorePosition: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>;
  };
}

function storage(load: () => Promise<string | null>) {
  return {
    load: vi.fn(load),
    save: vi.fn(() => Promise.resolve()),
    clear: vi.fn(() => Promise.resolve()),
  };
}

function Harness({
  options,
  publish,
}: {
  readonly options: UseRitoReaderOptions;
  readonly publish: (value: HookValue) => void;
}) {
  publish(useRitoReader(options));
  return null;
}

describe('useRitoReader initial position', () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: HookValue | null;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    latest = null;
    mocks.createReader.mockReset();
    mocks.createController.mockReset();
    mocks.parseReadingPosition.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    host.remove();
  });

  function render(options: UseRitoReaderOptions): void {
    act(() => {
      root.render(
        <Harness
          options={options}
          publish={(value) => {
            latest = value;
          }}
        />,
      );
    });
  }

  function value(): HookValue {
    expect(latest).not.toBeNull();
    return latest as HookValue;
  }

  it('hydrates an explicit position before exposing the loaded stack', async () => {
    const target = position();
    const restored = deferred<number | undefined>();
    const stored = storage(() => Promise.resolve(null));
    const ctrl = controller(4, () => restored.promise);
    const ctrlMocks = readControllerMocks(ctrl);
    mocks.createReader.mockResolvedValue(reader());
    mocks.createController.mockReturnValue(ctrl);
    render({
      reader: { width: 800, height: 600 },
      controller: { positionStorage: stored },
      initialPosition: target,
    });

    let loading: Promise<void> | undefined;
    act(() => {
      loading = value().load(new ArrayBuffer(16));
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(ctrlMocks.restorePosition).toHaveBeenCalledOnce();
      });
    });

    expect(stored.load).not.toHaveBeenCalled();
    expect(mocks.createReader).toHaveBeenCalledWith(
      expect.any(ArrayBuffer),
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ initialLocator: target.sourceLocator }),
    );
    expect(ctrlMocks.restorePosition).toHaveBeenCalledWith(JSON.stringify(target));
    expect(value().controller).toBeNull();
    expect(value().isLoaded).toBe(false);

    restored.resolve(4);
    await act(async () => loading);
    expect(value().controller).toBe(ctrl);
    expect(value().currentSpread).toBe(4);
    expect(value().isLoaded).toBe(true);
  });

  it('exposes the core fallback when controller hydration rejects', async () => {
    const failure = new Error('locator no longer resolves');
    const ctrl = controller(0, () => Promise.reject(failure));
    const ctrlMocks = readControllerMocks(ctrl);
    mocks.createReader.mockResolvedValue(reader());
    mocks.createController.mockReturnValue(ctrl);
    render({ reader: { width: 800, height: 600 }, initialPosition: position() });

    await act(async () => value().load(new ArrayBuffer(16)));

    expect(ctrlMocks.restorePosition).toHaveBeenCalledOnce();
    expect(ctrlMocks.dispose).not.toHaveBeenCalled();
    expect(value().controller).toBe(ctrl);
    expect(value().currentSpread).toBe(0);
    expect(value().isLoaded).toBe(true);
    expect(value().error).toBeNull();
  });

  it('loads storage once and reuses its serialized value for hydration', async () => {
    const target = position(3);
    const serialized = JSON.stringify(target);
    const stored = storage(() => Promise.resolve(serialized));
    const ctrl = controller(3, () => Promise.resolve(3));
    const restorePosition = readControllerMocks(ctrl).restorePosition;
    mocks.parseReadingPosition.mockReturnValue(target);
    mocks.createReader.mockResolvedValue(reader(5));
    mocks.createController.mockReturnValue(ctrl);
    render({
      reader: { width: 800, height: 600 },
      controller: { positionStorage: stored },
    });

    await act(async () => value().load(new ArrayBuffer(16)));

    expect(stored.load).toHaveBeenCalledOnce();
    expect(mocks.parseReadingPosition).toHaveBeenCalledWith(serialized);
    expect(restorePosition).toHaveBeenCalledWith(serialized);
    expect(mocks.createReader.mock.calls[0]?.[2]).toMatchObject({
      initialLocator: target.sourceLocator,
    });
    expect(value().currentSpread).toBe(3);
  });

  it.each([null, '{malformed'] as const)('falls back to zero for %s storage', async (raw) => {
    const stored = storage(() => Promise.resolve(raw));
    const ctrl = controller();
    const restorePosition = readControllerMocks(ctrl).restorePosition;
    mocks.parseReadingPosition.mockReturnValue(undefined);
    mocks.createReader.mockResolvedValue(reader());
    mocks.createController.mockReturnValue(ctrl);
    render({
      reader: { width: 800, height: 600 },
      controller: { positionStorage: stored },
    });

    await act(async () => value().load(new ArrayBuffer(16)));

    expect(stored.load).toHaveBeenCalledOnce();
    expect(restorePosition).toHaveBeenCalledWith(raw);
    expect(mocks.createReader.mock.calls[0]?.[2]).not.toHaveProperty('initialLocator');
    expect(value().currentSpread).toBe(0);
    expect(value().isLoaded).toBe(true);
  });

  it('does not let a stale preload overwrite a newer stack', async () => {
    const staleValue = deferred<string | null>();
    const staleStorage = storage(() => staleValue.promise);
    const activeReader = reader(1, 'active');
    const activeController = controller();
    mocks.createReader.mockResolvedValue(activeReader);
    mocks.createController.mockReturnValue(activeController);
    render({
      reader: { width: 800, height: 600 },
      controller: { positionStorage: staleStorage },
    });

    let staleLoad: Promise<void> | undefined;
    act(() => {
      staleLoad = value().load(new ArrayBuffer(8));
    });
    await act(async () => {
      await vi.waitFor(() => {
        expect(staleStorage.load).toHaveBeenCalledOnce();
      });
    });

    render({ reader: { width: 800, height: 600 }, initialPosition: null });
    await act(async () => value().load(new ArrayBuffer(16)));
    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(value().metadata).toEqual(activeReader.metadata);
    expect(value().controller).toBe(activeController);

    staleValue.resolve(JSON.stringify(position()));
    await act(async () => staleLoad);
    expect(mocks.createReader).toHaveBeenCalledOnce();
    expect(value().controller).toBe(activeController);
  });
});
