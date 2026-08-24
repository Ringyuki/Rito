import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(packageRoot, 'dist');
const workerEntry = join(distRoot, 'worker-entry.mjs');
const readerV1WorkerEntry = join(distRoot, 'reader-v1-worker-entry.mjs');
const staticWorkerPattern =
  /new Worker\(new URL\(["']\.\/worker-entry\.mjs["'],\s*import\.meta\.url\)/;
const staticReaderV1WorkerPattern =
  /new Worker\(new URL\(["']\.\/reader-v1-worker-entry\.mjs["'],\s*import\.meta\.url\)/;

if (!existsSync(workerEntry)) {
  throw new Error('@ritojs/core build is missing dist/worker-entry.mjs');
}
if (!existsSync(readerV1WorkerEntry)) {
  throw new Error('@ritojs/core build is missing dist/reader-v1-worker-entry.mjs');
}

const workerSource = readFileSync(workerEntry, 'utf8');
if (!workerSource.includes('createRitoCoreWasmReaderWorkerHandler')) {
  throw new Error('dist/worker-entry.mjs is not the compiled reader worker');
}
const readerV1WorkerSource = readFileSync(readerV1WorkerEntry, 'utf8');
if (!readerV1WorkerSource.includes('createRitoCoreWasmReaderV1WorkerHandler')) {
  throw new Error('dist/reader-v1-worker-entry.mjs is not the compiled Reader v1 worker');
}

const rootModules = readdirSync(distRoot)
  .filter(
    (entry) =>
      entry.endsWith('.mjs') &&
      entry !== 'worker-entry.mjs' &&
      entry !== 'reader-v1-worker-entry.mjs',
  )
  .map((entry) => ({ entry, source: readFileSync(join(distRoot, entry), 'utf8') }));
const workerClients = rootModules.filter(({ source }) => staticWorkerPattern.test(source));
if (workerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static worker URL, found ${String(workerClients.length)}`,
  );
}
const readerV1WorkerClients = rootModules.filter(({ source }) =>
  staticReaderV1WorkerPattern.test(source),
);
if (readerV1WorkerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static Reader v1 worker URL, found ${String(
      readerV1WorkerClients.length,
    )}`,
  );
}

const stalePaths = rootModules.filter(({ source }) =>
  source.includes('bindings/browser/reader/worker-main.mjs'),
);
if (stalePaths.length > 0) {
  throw new Error(
    `Built reader chunks contain the stale nested worker path: ${stalePaths
      .map(({ entry }) => entry)
      .join(', ')}`,
  );
}
