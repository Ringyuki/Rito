import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(packageRoot, 'dist');
const workerEntry = join(distRoot, 'worker-entry.mjs');
const readerSessionWorkerEntry = join(distRoot, 'reader-session-worker-entry.mjs');
const staticWorkerPattern =
  /new Worker\(new URL\(["']\.\/worker-entry\.mjs["'],\s*import\.meta\.url\)/;
const staticReaderSessionWorkerPattern =
  /new Worker\(new URL\(["']\.\/reader-session-worker-entry\.mjs["'],\s*import\.meta\.url\)/;

if (!existsSync(workerEntry)) {
  throw new Error('@ritojs/core build is missing dist/worker-entry.mjs');
}
if (!existsSync(readerSessionWorkerEntry)) {
  throw new Error('@ritojs/core build is missing dist/reader-session-worker-entry.mjs');
}

const workerSource = readFileSync(workerEntry, 'utf8');
if (!workerSource.includes('createRitoCoreWasmReaderWorkerHandler')) {
  throw new Error('dist/worker-entry.mjs is not the compiled reader worker');
}
const readerSessionWorkerSource = readFileSync(readerSessionWorkerEntry, 'utf8');
if (!readerSessionWorkerSource.includes('createRitoCoreWasmReaderSessionWorkerHandler')) {
  throw new Error('dist/reader-session-worker-entry.mjs is not the compiled reader session worker');
}

const rootModules = readdirSync(distRoot)
  .filter(
    (entry) =>
      entry.endsWith('.mjs') &&
      entry !== 'worker-entry.mjs' &&
      entry !== 'reader-session-worker-entry.mjs',
  )
  .map((entry) => ({ entry, source: readFileSync(join(distRoot, entry), 'utf8') }));
const workerClients = rootModules.filter(({ source }) => staticWorkerPattern.test(source));
if (workerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static worker URL, found ${String(workerClients.length)}`,
  );
}
const readerSessionWorkerClients = rootModules.filter(({ source }) =>
  staticReaderSessionWorkerPattern.test(source),
);
if (readerSessionWorkerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static reader session worker URL, found ${String(
      readerSessionWorkerClients.length,
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
