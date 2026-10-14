import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const distRoot = join(packageRoot, 'dist');
const workerEntryName = 'reader-session-worker-entry.mjs';
const workerEntry = join(distRoot, workerEntryName);
const staticWorkerPattern =
  /new Worker\(new URL\(["']\.\/reader-session-worker-entry\.mjs["'],\s*import\.meta\.url\)/;

if (!existsSync(workerEntry)) {
  throw new Error(`@ritojs/core build is missing dist/${workerEntryName}`);
}
if (!readFileSync(workerEntry, 'utf8').includes('createRitoCoreWasmReaderSessionWorkerHandler')) {
  throw new Error(`dist/${workerEntryName} is not the compiled reader session worker`);
}

const rootModules = readdirSync(distRoot)
  .filter((entry) => entry.endsWith('.mjs') && entry !== workerEntryName)
  .map((entry) => ({ entry, source: readFileSync(join(distRoot, entry), 'utf8') }));
const workerClients = rootModules.filter(({ source }) => staticWorkerPattern.test(source));
if (workerClients.length !== 1) {
  throw new Error(
    `Expected one root dist chunk with the static reader session worker URL, found ${String(
      workerClients.length,
    )}`,
  );
}
