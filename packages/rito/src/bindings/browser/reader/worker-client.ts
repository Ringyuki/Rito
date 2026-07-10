import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../core-contracts';
import type { BrowserReaderBindingModule } from './types';
import type { BrowserReaderWorkerClient } from '../core-contracts';

export function createBrowserReaderWorkerClient(
  module: BrowserReaderBindingModule,
): BrowserReaderWorkerClient {
  if (typeof Worker === 'undefined') return createInProcessBrowserReaderSession(module);
  return createRitoCoreWasmWorkerReaderClient(createBrowserWorker());
}

export const createInProcessBrowserReaderSession = createRitoCoreWasmInProcessReaderClient;

function createBrowserWorker(): Worker {
  return new Worker(new URL('./worker-entry.mjs', import.meta.url), {
    type: 'module',
    name: 'rito-browser-reader',
  });
}
