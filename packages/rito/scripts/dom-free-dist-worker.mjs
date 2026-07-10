import { parentPort, workerData } from 'node:worker_threads';

if (!parentPort) throw new Error('DOM-free dist verification must run in a worker');

const core = await import(workerData.moduleUrl);
const document = core.loadEpub(workerData.epub);

try {
  const pages = core.paginate(
    document,
    core.createLayoutConfig({ width: 640, height: 800, margin: 40 }),
    {
      measureText(text) {
        return { width: Array.from(text).length * 8, height: 16 };
      },
    },
  );

  parentPort.postMessage({
    hasDomParser: typeof globalThis.DOMParser !== 'undefined',
    title: document.packageDocument.metadata.title,
    toc: document.toc,
    pageCount: pages.length,
  });
} finally {
  document.close();
}
