import type { Logger } from '../utils/logger';
import type { JsonValue, ReaderRuntimeMessagePort } from '../runtime/reader-session';

export interface WebWorkerReaderRuntimeMessageTarget {
  postMessage(message: JsonValue): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
}

export interface CreateWebWorkerReaderRuntimeMessagePortOptions {
  readonly logger?: Logger;
}

export function createWebWorkerReaderRuntimeMessagePort(
  worker: WebWorkerReaderRuntimeMessageTarget,
  options?: CreateWebWorkerReaderRuntimeMessagePortOptions,
): ReaderRuntimeMessagePort {
  return {
    postMessage(message) {
      worker.postMessage(message);
    },
    subscribe(listener) {
      const messageListener = (event: MessageEvent<unknown>): void => {
        listener(event.data);
      };
      const messageErrorListener = (event: MessageEvent<unknown>): void => {
        options?.logger?.error('Reader runtime worker messageerror', event);
      };
      const errorListener = (event: ErrorEvent): void => {
        options?.logger?.error('Reader runtime worker error', event);
      };

      const unsubscribe = (): void => {
        worker.removeEventListener('message', messageListener);
        worker.removeEventListener('messageerror', messageErrorListener);
        worker.removeEventListener('error', errorListener);
      };

      try {
        worker.addEventListener('message', messageListener);
        worker.addEventListener('messageerror', messageErrorListener);
        worker.addEventListener('error', errorListener);
      } catch (error) {
        unsubscribe();
        throw error;
      }

      return unsubscribe;
    },
  };
}
