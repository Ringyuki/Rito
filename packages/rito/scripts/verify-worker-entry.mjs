import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(packageRoot, 'dist');
const workerEntry = join(distRoot, 'worker-entry.mjs');
const staticWorkerPattern =
  /new Worker\(new URL\(["']\.\/worker-entry\.mjs["'],\s*import\.meta\.url\)/;

if (!existsSync(workerEntry)) {
  throw new Error('@ritojs/core build is missing dist/worker-entry.mjs');
}

const workerSource = readFileSync(workerEntry, 'utf8');
if (!workerSource.includes('createRitoCoreWasmReaderWorkerHandler')) {
  throw new Error('dist/worker-entry.mjs is not the compiled reader worker');
}

const rootModules = readdirSync(distRoot)
  .filter((entry) => entry.endsWith('.mjs') && entry !== 'worker-entry.mjs')
  .map((entry) => ({ entry, source: readFileSync(join(distRoot, entry), 'utf8') }));
const workerClients = rootModules.filter(({ source }) => staticWorkerPattern.test(source));
if (workerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static worker URL, found ${String(workerClients.length)}`,
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
