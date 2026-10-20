import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  readerSessionRuntimeExports,
  runtimeModules,
  sharedDeclarations,
} from './emitted-sources.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(packageRoot, '../..');
const dist = resolve(packageRoot, 'dist');
const wasmOutput = resolve(repoRoot, 'target/wasm32-unknown-unknown/release');
// The reader engine, and the packer `@ritojs/pack` runs on servers.
const wasmInputs = ['rito_wasm.wasm', 'rito_pack.wasm'].map((name) => resolve(wasmOutput, name));

ensureWasmBindgen();
run('cargo', [
  'build',
  '-p',
  'rito-wasm',
  '-p',
  'rito-pack',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
]);

for (const wasmInput of wasmInputs) {
  if (!existsSync(wasmInput)) {
    throw new Error(`Expected wasm artifact was not produced: ${wasmInput}`);
  }
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const wasmInput of wasmInputs) {
  run('wasm-bindgen', [wasmInput, '--out-dir', dist, '--target', 'web', '--typescript']);
}
await Promise.all(
  runtimeModules.map((name) => copyFile(resolve(packageRoot, `src/${name}`), resolve(dist, name))),
);

const declarations = await sharedDeclarations((path) =>
  pathToFileURL(resolve(packageRoot, `src/${path}`)),
);
const runtimeExports = readerSessionRuntimeExports();
await writeFile(resolve(dist, 'decoder.mjs'), [...runtimeExports, ''].join('\n'));
await writeFile(
  resolve(dist, 'index.mjs'),
  [
    "export { default as initRitoCoreWasm, initSync as initRitoCoreWasmSync, RitoPaperTurn, RitoReaderSession } from './rito_wasm.js';",
    ...runtimeExports,
    '',
  ].join('\n'),
);
await writeFile(
  resolve(dist, 'index.d.mts'),
  [
    "export { default as initRitoCoreWasm, initSync as initRitoCoreWasmSync, RitoPaperTurn, RitoReaderSession } from './rito_wasm.js';",
    "export type { InitInput } from './rito_wasm.js';",
    declarations,
    '',
  ].join('\n'),
);
await writeFile(resolve(dist, 'decoder.d.mts'), [declarations, ''].join('\n'));

function ensureWasmBindgen() {
  const result = spawnSync('wasm-bindgen', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status === 0) {
    return;
  }
  throw new Error(
    'wasm-bindgen CLI is required for build:wasm. Install it with `cargo install wasm-bindgen-cli`.',
  );
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}
