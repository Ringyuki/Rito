import {
  createRitoCoreWasmInProcessReaderClient,
  createRitoCoreWasmWorkerReaderClient,
} from '../core-contracts';
import type { BrowserReaderSessionCache } from '../core-contracts';
import type { BrowserReaderBindingModule, BrowserReaderWorkerClientFactory } from './types';

export function createBrowserReaderWorkerClientFactory(
  module: BrowserReaderBindingModule,
): BrowserReaderWorkerClientFactory {
  const cache: BrowserReaderSessionCache = {};
  return () =>
    typeof Worker === 'undefined'
      ? createInProcessBrowserReaderSession(module, cache)
      : createRitoCoreWasmWorkerReaderClient(createBrowserWorker(), cache);
}

export const createInProcessBrowserReaderSession = createRitoCoreWasmInProcessReaderClient;

function createBrowserWorker(): Worker {
  return new Worker(new URL('./worker-entry.mjs', import.meta.url), {
    type: 'module',
    name: 'rito-browser-reader',
  });
}
