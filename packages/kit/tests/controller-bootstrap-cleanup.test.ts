// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createController } from '../src/controller';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('controller bootstrap cleanup', () => {
  it('contains annotation storage rejection and reports it while the controller is live', async () => {
    stubOffscreenBuffers();
    const sentinel = new Error('annotation storage load failed');
    const reader = createReaderStub({ listeners: new Set(), unsubscribe: vi.fn() });
    const controller = createController(reader as never, createCanvas(), {
      annotationStorage: {
        load: () => Promise.reject(sentinel),
        save: vi.fn(),
      },
    });
    const errors = vi.fn();
    controller.on('error', errors);

    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalledWith({
        message: sentinel.message,
        source: 'annotation-storage',
      });
    });
    controller.dispose();
  });

  it('terminals the public emitter when the controller is disposed', () => {
    stubOffscreenBuffers();
    const reader = createReaderStub({ listeners: new Set(), unsubscribe: vi.fn() });
    const controller = createController(reader as never, createCanvas());
    const existing = vi.fn();
    const late = vi.fn();
    controller.on('error', existing);

    controller.dispose();
    controller.emitter.emit('error', { message: 'late', source: 'test' });
    controller.on('error', late);
    controller.emitter.emit('error', { message: 'later', source: 'test' });

    expect(existing).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });

  it('rolls back earlier subscriptions and buffers when later wiring fails', () => {
    const buffers = stubOffscreenBuffers();
    const canvas = createCanvas();
    const listeners = new Set<(spreadIndex: number, spread: unknown) => void>();
    const unsubscribe = vi.fn((listener: (spreadIndex: number, spread: unknown) => void) => {
      listeners.delete(listener);
    });
    const sentinel = new Error('layout listener registration failed');
    const reader = createReaderStub({ listeners, unsubscribe, layoutFailure: sentinel });

    expect(() => {
      createController(reader as never, canvas);
    }).toThrow(sentinel);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(buffers).toHaveLength(4);
    expect(buffers.every((buffer) => buffer.width === 0 && buffer.height === 0)).toBe(true);
  });

  it('releases the pool when engine construction fails', () => {
    const buffers = stubOffscreenBuffers();
    const canvas = createCanvas();
    const sentinel = new Error('page snapshot failed');
    const reader = createReaderStub({
      listeners: new Set(),
      unsubscribe: vi.fn(),
    });
    Object.defineProperty(reader, 'pages', {
      get() {
        throw sentinel;
      },
    });

    expect(() => {
      createController(reader as never, canvas);
    }).toThrow(sentinel);
    expect(buffers).toHaveLength(4);
    expect(buffers.every((buffer) => buffer.width === 0 && buffer.height === 0)).toBe(true);
  });

  it('removes partially installed DOM wiring before rethrowing', () => {
    const buffers = stubOffscreenBuffers();
    const canvas = createCanvas();
    const sentinel = new Error('pointer listener registration failed');
    const activeListeners = new Set<EventListenerOrEventListenerObject>();
    const addEventListener = canvas.addEventListener.bind(canvas);
    const removeEventListener = canvas.removeEventListener.bind(canvas);
    canvas.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'pointerup') throw sentinel;
      activeListeners.add(listener);
      addEventListener(type, listener, options);
    }) as typeof canvas.addEventListener;
    canvas.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) => {
      activeListeners.delete(listener);
      removeEventListener(type, listener, options);
    }) as typeof canvas.removeEventListener;
    const listeners = new Set<(spreadIndex: number, spread: unknown) => void>();
    const unsubscribe = vi.fn((listener: (spreadIndex: number, spread: unknown) => void) => {
      listeners.delete(listener);
    });
    const reader = createReaderStub({ listeners, unsubscribe });

    expect(() => {
      createController(reader as never, canvas);
    }).toThrow(sentinel);
    expect(activeListeners.size).toBe(0);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
    expect(buffers.every((buffer) => buffer.width === 0 && buffer.height === 0)).toBe(true);
  });

  it('invalidates an annotation load when later controller construction fails', async () => {
    stubOffscreenBuffers();
    const canvas = createCanvas();
    const sentinel = new Error('pointer listener registration failed');
    const addEventListener = canvas.addEventListener.bind(canvas);
    canvas.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type === 'pointerup') throw sentinel;
      addEventListener(type, listener, options);
    }) as typeof canvas.addEventListener;
    const pending = deferred<readonly import('../src/interaction').AnnotationRecord[]>();
    let consumed = false;
    const records = {
      *[Symbol.iterator]() {
        consumed = true;
        yield annotationRecord();
      },
      length: 1,
    } as unknown as readonly import('../src/interaction').AnnotationRecord[];
    const reader = createReaderStub({ listeners: new Set(), unsubscribe: vi.fn() });

    expect(() => {
      createController(reader as never, canvas, {
        annotationStorage: { load: () => pending.promise, save: vi.fn() },
      });
    }).toThrow(sentinel);
    pending.resolve(records);
    await settleTasks();

    expect(consumed).toBe(false);
  });
});

function createReaderStub(input: {
  readonly listeners: Set<(spreadIndex: number, spread: unknown) => void>;
  readonly unsubscribe: (listener: (spreadIndex: number, spread: unknown) => void) => void;
  readonly layoutFailure?: Error;
}): object {
  return {
    metadata: { title: 'Demo' },
    totalSpreads: 1,
    toc: [],
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    pages: [],
    spreads: [{ left: { index: 0 }, right: undefined }],
    dpr: 1,
    renderSpread: vi.fn(),
    renderSpreadTo: vi.fn(() => true),
    notifyActiveSpread: vi.fn(),
    resize: vi.fn(),
    setSpreadMode: vi.fn(),
    updateLayout: vi.fn(() => false),
    setTheme: vi.fn(),
    findPage: vi.fn(),
    findSpread: vi.fn(),
    resolveTocEntry: vi.fn(),
    findActiveTocEntry: vi.fn(),
    getCanvasSize: vi.fn(() => ({ width: 400, height: 300 })),
    getLayoutGeometry: vi.fn(() => ({
      viewportWidth: 400,
      viewportHeight: 300,
      marginLeft: 40,
      marginTop: 40,
      spreadGap: 20,
    })),
    getChapterTextIndices: vi.fn(() => new Map()),
    getFootnotes: vi.fn(() => new Map()),
    getImageBlobUrl: vi.fn(),
    measurer: {},
    setTypography: vi.fn(() => false),
    onSpreadRendered: vi.fn((listener: (spreadIndex: number, spread: unknown) => void) => {
      input.listeners.add(listener);
      return () => {
        input.unsubscribe(listener);
      };
    }),
    onLayoutCommitted: vi.fn(() => {
      if (input.layoutFailure) throw input.layoutFailure;
      return () => undefined;
    }),
    dispose: vi.fn(),
  };
}

function stubOffscreenBuffers(): Array<{ width: number; height: number }> {
  const buffers: Array<{ width: number; height: number }> = [];
  vi.stubGlobal(
    'OffscreenCanvas',
    class TestOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        buffers.push(this);
      }

      getContext(): { clearRect: ReturnType<typeof vi.fn>; drawImage: ReturnType<typeof vi.fn> } {
        return { clearRect: vi.fn(), drawImage: vi.fn() };
      }
    },
  );
  return buffers;
}

function createCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.getContext = vi.fn(() => ({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  })) as unknown as typeof canvas.getContext;
  return canvas;
}

function annotationRecord(): import('../src/interaction').AnnotationRecord {
  return {
    id: 'late',
    kind: 'highlight',
    createdAt: 1,
    target: {
      href: 'chapter.xhtml',
      selectors: {
        sourceRange: {
          type: 'SourceRangeSelector',
          start: { nodePath: [0], textOffset: 0 },
          end: { nodePath: [0], textOffset: 1 },
        },
        textQuote: { type: 'TextQuoteSelector', exact: 'x' },
        textPosition: { type: 'TextPositionSelector', start: 0, end: 1 },
        progression: { type: 'ProgressionSelector', chapter: 0, chapterProgress: 0 },
      },
      text: { highlight: 'x' },
    },
  };
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
