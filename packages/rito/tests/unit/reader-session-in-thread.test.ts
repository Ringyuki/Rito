import { describe, expect, it, vi } from 'vitest';

interface FakeEngine {
  scope: {
    addEventListener(type: string, listener: (event: { data: unknown }) => void): void;
    postMessage(data: unknown): void;
  };
  received: unknown[];
  close: ReturnType<typeof vi.fn>;
  initialized: boolean;
}

const engines: FakeEngine[] = [];

// The engine itself is the wasm runtime's; here it echoes what it is sent.
vi.mock('@ritojs/core-wasm', () => ({
  initRitoCoreWasm: () => Promise.resolve(),
  RitoReaderSession: {},
  createRitoCoreWasmReaderSessionWorkerHandler: (
    scope: FakeEngine['scope'],
    deps: { initRitoCoreWasm(): Promise<void> },
  ) => {
    const engine: FakeEngine = { scope, received: [], close: vi.fn(), initialized: false };
    void deps.initRitoCoreWasm().then(() => {
      engine.initialized = true;
    });
    scope.addEventListener('message', (event) => {
      engine.received.push(event.data);
      scope.postMessage({ echo: event.data });
    });
    engines.push(engine);
    return { close: engine.close };
  },
}));

const { createInThreadReaderSessionWorker } =
  await import('../../src/bindings/browser/reader-session-in-thread');

function latest(): FakeEngine {
  const engine = engines.at(-1);
  if (!engine) throw new Error('no engine was created');
  return engine;
}

describe('a reader session engine on the page thread', () => {
  it('hands each message across as a microtask, both ways, before the page next paints', async () => {
    const worker = createInThreadReaderSessionWorker();
    const answers: unknown[] = [];
    worker.addEventListener('message', (event: { data: unknown }) => answers.push(event.data));

    worker.postMessage({ ask: 1 });
    // Not within the call: the session client and the engine never
    // re-enter each other.
    expect(latest().received).toEqual([]);
    await Promise.resolve();
    expect(latest().received).toEqual([{ ask: 1 }]);
    await Promise.resolve();
    expect(answers).toEqual([{ echo: { ask: 1 } }]);
    expect(latest().initialized).toBe(true);
  });

  it('stops answering a listener the page removed', async () => {
    const worker = createInThreadReaderSessionWorker();
    const answers: unknown[] = [];
    const listener = (event: { data: unknown }): void => {
      answers.push(event.data);
    };
    const failed = (): void => undefined;
    worker.addEventListener('message', listener);
    // Only messages travel between the two: an error listener holds nothing.
    worker.addEventListener('error', failed);
    worker.removeEventListener('error', failed);
    worker.removeEventListener('message', listener);

    worker.postMessage('ask');
    await new Promise((done) => setTimeout(done, 0));
    expect(latest().received).toEqual(['ask']);
    expect(answers).toEqual([]);
  });

  it('frees the engine when terminated and carries nothing after', async () => {
    const worker = createInThreadReaderSessionWorker();
    const answers: unknown[] = [];
    worker.addEventListener('message', (event: { data: unknown }) => answers.push(event.data));
    worker.postMessage('in flight');
    worker.terminate();

    worker.postMessage('after');
    await new Promise((done) => setTimeout(done, 0));
    expect(latest().close).toHaveBeenCalledOnce();
    expect(latest().received).toEqual([]);
    expect(answers).toEqual([]);
  });
});
