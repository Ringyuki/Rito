import { copyFile, mkdir, writeFile } from 'node:fs/promises';

import {
  readerSessionRuntimeExports,
  runtimeModules,
  sharedDeclarations,
} from './emitted-sources.mjs';

// Stands in for the real build where no Rust toolchain exists: the same
// JavaScript runtime and declarations, and a WASM module that says it is
// missing the moment a session is opened on it.
const dist = new URL('../dist/', import.meta.url);
const UNAVAILABLE =
  'Rito core WASM is unavailable in the placeholder build; run the real WASM build';

await mkdir(dist, { recursive: true });
await Promise.all(
  runtimeModules.map((name) =>
    copyFile(new URL(`../src/${name}`, import.meta.url), new URL(name, dist)),
  ),
);

const declarations = await sharedDeclarations((path) => new URL(`../src/${path}`, import.meta.url));
const runtimeExports = readerSessionRuntimeExports();
await writeFile(new URL('decoder.mjs', dist), [...runtimeExports, ''].join('\n'));
await writeFile(
  new URL('index.mjs', dist),
  [
    ...runtimeExports,
    '',
    'export async function initRitoCoreWasm() {',
    `  throw new Error(${JSON.stringify(UNAVAILABLE)});`,
    '}',
    '',
    'export class RitoReaderSession {',
    '  constructor() {',
    `    throw new Error(${JSON.stringify(UNAVAILABLE)});`,
    '  }',
    '}',
    '',
  ].join('\n'),
);
await writeFile(
  new URL('index.d.mts', dist),
  [
    declarations,
    "export declare const initRitoCoreWasm: RitoReaderSessionWorkerHandlerDependencies['initRitoCoreWasm'];",
    "export declare const RitoReaderSession: RitoReaderSessionWorkerHandlerDependencies['RitoReaderSession'];",
    '',
  ].join('\n'),
);
await writeFile(new URL('decoder.d.mts', dist), [declarations, ''].join('\n'));
