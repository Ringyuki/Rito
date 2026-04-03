// Rito pagination Worker entry point.
// Import this module as a Web Worker to run pagination off the main thread.
//
// Usage:
//   const worker = new Worker(new URL('rito/worker', import.meta.url), { type: 'module' });
//   const result = await paginateInWorker(worker, doc, config, assets);

export { handlePaginate, initWorker } from './workers/pagination-worker';

// Auto-register the message handler when loaded as a Worker.
import { initWorker } from './workers/pagination-worker';
initWorker();
