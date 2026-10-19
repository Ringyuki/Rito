import {
  createRitoCoreWasmReaderSessionWorkerHandler,
  RitoReaderSession,
  type RitoReaderSessionWorkerLike,
  type RitoReaderSessionWorkerScope,
} from '@ritojs/core-wasm';

import { engineModuleReady } from './engine-module';

type MessageListener = (event: { readonly data: unknown }) => void;

/**
 * A reader session's engine on the page's own thread. The session client
 * and the engine exchange their messages as microtasks rather than through
 * a worker, so an answer is ready before the page next paints: the frame
 * that asks for a size can draw it. The engine's work then holds the page
 * for as long as it takes, which is why the work a session does on its own
 * (the whole book behind the page shown) comes in small steps.
 */
export function createInThreadReaderSessionWorker(): RitoReaderSessionWorkerLike {
  const toEngine = new Set<MessageListener>();
  const toPage = new Set<MessageListener>();
  let terminated = false;
  const deliver = (listeners: Set<MessageListener>, data: unknown): void => {
    if (terminated) return;
    queueMicrotask(() => {
      for (const listener of listeners) listener({ data });
    });
  };
  const scope: RitoReaderSessionWorkerScope = {
    addEventListener: (_type, listener) => {
      toEngine.add(listener);
    },
    postMessage: (data) => {
      deliver(toPage, data);
    },
  };
  const engine = createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: engineModuleReady,
    RitoReaderSession,
  });
  const worker = {
    addEventListener(type: string, listener: MessageListener): void {
      if (type === 'message') toPage.add(listener);
    },
    removeEventListener(type: string, listener: MessageListener): void {
      if (type === 'message') toPage.delete(listener);
    },
    postMessage(data: unknown): void {
      deliver(toEngine, data);
    },
    terminate(): void {
      // A session ended without a dispose, as one that failed is, is freed
      // here: nothing else on the page would free it.
      engine.close();
      terminated = true;
      toEngine.clear();
      toPage.clear();
    },
  };
  return worker as RitoReaderSessionWorkerLike;
}
