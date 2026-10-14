// The files the two build paths emit into dist/. The real build compiles
// the wasm module and the placeholder build stands in for it where no Rust
// toolchain exists, but both ship the same JavaScript runtime and the same
// declarations. Held here once: when the lists lived in both scripts they
// drifted on a rename, and only the placeholder path failed.

import { readFile } from 'node:fs/promises';

/** Runtime modules copied verbatim from src/ into dist/. */
export const runtimeModules = [
  'pinned-font-policy-runtime.js',
  'reader-session-wire-base-runtime.js',
  'reader-session-display-paint-runtime.js',
  'reader-session-display-decoder-runtime.js',
  'reader-session-primitive-decoder-runtime.js',
  'reader-session-artifact-decoder-runtime.js',
  'reader-session-publication-runtime.js',
  'reader-session-request-runtime.js',
  'reader-session-foreground-runtime.js',
  'reader-session-background-runtime.js',
  'reader-session-query-request-runtime.js',
  'reader-session-query-decoder-runtime.js',
  'reader-session-yield-runtime.js',
  'reader-session-worker-query-runtime.js',
  'reader-session-worker-runtime.js',
  'reader-session-worker-client-query-runtime.js',
  'reader-session-worker-client-runtime.js',
  'shard-prefetch-lane-runtime.js',
];

/** Hand-written declaration files whose contents are inlined into the bundle. */
export const decoderDeclarationFiles = ['reader-session-runtime.d.ts'];

/** Type modules under src/types/, named without their extension. */
export const typeModules = [
  'frame-command',
  'pinned-font',
  'sharded-publication',
  'reader-session-display',
  'reader-session-primitive',
  'reader-session',
  'reader-session-query',
  'reader-session-worker',
];

/**
 * The runtime both entries export: the session worker's handler and its
 * client, and the codecs of the wire between them. The main entry adds the
 * WASM module itself; the decoder entry is everything a page loads.
 */
export function readerSessionRuntimeExports() {
  return [
    "export { decodeRitoReaderArtifact, decodeRitoReaderResource } from './reader-session-artifact-decoder-runtime.js';",
    "export { decodeRitoReaderPublication } from './reader-session-publication-runtime.js';",
    "export { decodeRitoReaderPrimitiveList, READER_V1_PRIMITIVE_LIST_FORMAT_VERSION } from './reader-session-primitive-decoder-runtime.js';",
    "export { encodeRitoReaderAdjacentRequest, encodeRitoReaderArtifactRequest, encodeRitoReaderSpreadRequest } from './reader-session-request-runtime.js';",
    "export { decodeRitoReaderForegroundHandoffAck, encodeRitoReaderForegroundHandoff } from './reader-session-foreground-runtime.js';",
    "export { decodeRitoReaderBackgroundAdvance, decodeRitoReaderBackgroundHandoffAck, encodeRitoReaderBackgroundHandoff, encodeRitoReaderBackgroundRequest } from './reader-session-background-runtime.js';",
    "export { createRitoCoreWasmReaderSessionWorkerHandler } from './reader-session-worker-runtime.js';",
    "export { createRitoCoreWasmReaderSessionWorkerClient, RitoReaderError } from './reader-session-worker-client-runtime.js';",
    "export { RitoReaderWireError } from './reader-session-wire-base-runtime.js';",
  ];
}

/** The declarations both entries share: every type module, then the hand-written ones. */
export async function sharedDeclarations(sourceUrl) {
  const read = async (names, directory) => {
    const sources = await Promise.all(
      names.map((name) => readFile(sourceUrl(`${directory}${name}`), 'utf8')),
    );
    return sources.map(stripTypeOnlyImports).join('\n');
  };
  const types = await read(
    typeModules.map((name) => `${name}.ts`),
    'types/',
  );
  return [types, await read(decoderDeclarationFiles, '')].join('\n');
}

function stripTypeOnlyImports(source) {
  const lines = [];
  let skippingImport = false;
  for (const line of source.split('\n')) {
    if (skippingImport) {
      if (line.includes(';')) skippingImport = false;
      continue;
    }
    if (!line.startsWith('import type ')) {
      lines.push(line);
      continue;
    }
    skippingImport = !line.includes(';');
  }
  return lines.join('\n');
}
