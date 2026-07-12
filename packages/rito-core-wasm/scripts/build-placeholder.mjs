import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

import { documentClassDeclarations } from './document-declarations.mjs';

const dist = new URL('../dist/', import.meta.url);
const runtimeSources = [
  'core-wasm-error-runtime.js',
  'pinned-font-policy-runtime.js',
  'core-wasm-document-runtime.js',
  'core-wasm-versioned-runtime.js',
  'core-wasm-versioned-mutation-runtime.js',
  'core-wasm-versioned-validation-runtime.js',
  'reader-compat-runtime.js',
  'reader-bounded-session-runtime.js',
  'reader-worker-cache-runtime.js',
  'reader-worker-client-runtime.js',
  'reader-worker-pinned-font-runtime.js',
  'reader-worker-interaction-validation-runtime.js',
  'reader-worker-text-geometry-validation-runtime.js',
  'shape-provenance-diagnostic-validation-runtime.js',
  'reader-worker-session-runtime.js',
  'reader-worker-versioned-client-runtime.js',
  'reader-worker-versioned-payload-runtime.js',
  'runtime-bundle-decoder-runtime.js',
  'frame-command-buffer-value-validation.js',
  'frame-command-buffer-paint-validation.js',
  'frame-command-buffer-command-validation.js',
  'frame-command-buffer-decoder-constants.js',
  'frame-command-buffer-decoder-records.js',
  'frame-command-buffer-decoder-runtime.js',
  'frame-command-buffer-decoder-validation.js',
].map((name) => ({
  source: new URL(`../src/${name}`, import.meta.url),
  target: new URL(name, dist),
}));
const errorDeclarationSource = new URL('../src/core-wasm-error-runtime.d.ts', import.meta.url);
const compatDeclarationSource = new URL('../src/reader-compat-runtime.d.ts', import.meta.url);
const decoderDeclarationSources = [
  'frame-command-buffer-decoder-runtime.d.ts',
  'runtime-bundle-decoder-runtime.d.ts',
].map((name) => new URL(`../src/${name}`, import.meta.url));
const typeDeclarationSources = [
  'common',
  'frame-command',
  'publication',
  'revision',
  'frame',
  'resource',
  'search',
  'reader-bounded-session',
  'reader-worker',
  'reader-worker-versioned',
  'runtime-bundle',
  'navigation',
  'page',
  'interaction',
  'status',
  'shape-provenance',
  'pinned-font',
].map((name) => new URL(`../src/types/${name}.ts`, import.meta.url));

await mkdir(dist, { recursive: true });
await Promise.all(runtimeSources.map(({ source, target }) => copyFile(source, target)));

const errorDeclarations = stripTypeOnlyImports(await readFile(errorDeclarationSource, 'utf8'));
const compatDeclarations = stripTypeOnlyImports(await readFile(compatDeclarationSource, 'utf8'));
const decoderDeclarations = await readTypeDeclarations(decoderDeclarationSources);
const typeDeclarations = await readTypeDeclarations(typeDeclarationSources);
await writeFile(new URL('decoder.mjs', dist), decoderEntry());
await writeFile(new URL('index.mjs', dist), indexEntry());
await writeFile(
  new URL('index.d.mts', dist),
  [
    errorDeclarations,
    typeDeclarations,
    compatDeclarations,
    decoderDeclarations,
    placeholderEngineDeclaration(),
    readerClientDeclarations(),
    'export declare function getRitoCoreWasmStatus(): RitoCoreWasmStatus;',
    '',
  ].join('\n'),
);

await writeFile(
  new URL('decoder.d.mts', dist),
  [
    errorDeclarations,
    typeDeclarations,
    compatDeclarations,
    decoderDeclarations,
    readerClientDeclarations(),
    '',
  ].join('\n'),
);

function decoderEntry() {
  return [
    "export { decodeRitoFrameCommandBuffer } from './frame-command-buffer-decoder-runtime.js';",
    "export { decodeRitoRuntimeBundle } from './runtime-bundle-decoder-runtime.js';",
    "export { createRitoCoreWasmReaderChapterMap, createRitoCoreWasmReaderChapterTextIndexMap, createRitoCoreWasmReaderFootnoteMap, createRitoCoreWasmReaderManifestHrefMap, createRitoCoreWasmReaderPages, createRitoCoreWasmReaderSpreads, findRitoCoreWasmReaderActiveTocEntry, findRitoCoreWasmReaderSpreadContainingPage, findRitoCoreWasmReaderTocTarget } from './reader-compat-runtime.js';",
    "export { createRitoCoreWasmBoundedReaderSession } from './reader-bounded-session-runtime.js';",
    "export { createRitoCoreWasmInProcessReaderClient, createRitoCoreWasmReaderWorkerHandler, createRitoCoreWasmWorkerReaderClient } from './reader-worker-client-runtime.js';",
    "export { normalizeRitoCoreWasmError, RitoCoreWasmError } from './core-wasm-error-runtime.js';",
    '',
  ].join('\n');
}

function indexEntry() {
  return [
    "export { decodeRitoFrameCommandBuffer } from './frame-command-buffer-decoder-runtime.js';",
    "export { decodeRitoRuntimeBundle } from './runtime-bundle-decoder-runtime.js';",
    "export { createRitoCoreWasmReaderChapterMap, createRitoCoreWasmReaderChapterTextIndexMap, createRitoCoreWasmReaderFootnoteMap, createRitoCoreWasmReaderManifestHrefMap, createRitoCoreWasmReaderPages, createRitoCoreWasmReaderSpreads, findRitoCoreWasmReaderActiveTocEntry, findRitoCoreWasmReaderSpreadContainingPage, findRitoCoreWasmReaderTocTarget } from './reader-compat-runtime.js';",
    "export { createRitoCoreWasmBoundedReaderSession } from './reader-bounded-session-runtime.js';",
    "export { createRitoCoreWasmInProcessReaderClient, createRitoCoreWasmReaderWorkerHandler, createRitoCoreWasmWorkerReaderClient } from './reader-worker-client-runtime.js';",
    "export { normalizeRitoCoreWasmError, RitoCoreWasmError } from './core-wasm-error-runtime.js';",
    '',
    'export async function initRitoCoreWasmEngine() {',
    "  throw new Error('Rito core WASM is unavailable in the placeholder build; run the real WASM build');",
    '}',
    '',
    'export function getRitoCoreWasmStatus() {',
    '  return {',
    "    packageName: '@ritojs/core-wasm',",
    "    status: 'experimental',",
    "    engine: 'rust',",
    '    rustFacade: {',
    '      publicationJson: true,',
    '      pinnedFontPolicyJson: true,',
    '      createFullRevisionBundleJson: true,',
    '      createInitialPreviewRevisionBundleJson: true,',
    '      createActiveChapterPreviewRevisionBundleJson: true,',
    '      createPreviewRevisionBundleJson: true,',
    '      createViewRevisionBundleJson: true,',
    '      createViewRevisionBundleBytes: false,',
    '      runtimeBundleRitorb1: true,',
    '      frameJson: true,',
    '      packedFrameCommandBuffer: true,',
    '      footnoteJson: true,',
    '      footnotesJson: true,',
    '      chapterTextIndicesJson: true,',
    '      pageTargetsJson: true,',
    '      pageTextPositionsJson: true,',
    '      textRangeGeometryJson: true,',
    '      locatorJson: true,',
    '      resourcePrefetchJson: true,',
    '      plannedFrameResourcePrefetchJson: true,',
    '      searchJson: true,',
    '      resourceTransferLeases: true,',
    '      versionedRevisionAccess: true,',
    '      boundedRevisionControl: true,',
    '      boundedSessionController: true,',
    '      wasmBindgen: true,',
    '      npmWasmArtifact: false,',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');
}

function placeholderEngineDeclaration() {
  return [
    'export interface RitoCoreWasmEngine {',
    '  openDocument(',
    '    bytes: Uint8Array,',
    '    options?: RitoCoreWasmOpenDocumentOptions,',
    '  ): RitoCoreWasmDocument;',
    '}',
    'export declare function initRitoCoreWasmEngine(): Promise<RitoCoreWasmEngine>;',
    documentClassDeclarations({ typeOnly: true }),
  ].join('\n');
}

function readerClientDeclarations() {
  return [
    'export declare function createRitoCoreWasmWorkerReaderClient(',
    '  worker: RitoCoreWasmReaderWorkerLike,',
    '  cache?: RitoCoreWasmReaderSessionCache,',
    '): RitoCoreWasmReaderWorkerClient;',
    'export declare function createRitoCoreWasmInProcessReaderClient(',
    '  module: RitoCoreWasmReaderBindingRuntimeModule,',
    '  cache?: RitoCoreWasmReaderSessionCache,',
    '): RitoCoreWasmReaderWorkerClient;',
    'export declare function createRitoCoreWasmReaderWorkerHandler(',
    '  scope: RitoCoreWasmReaderWorkerScope,',
    '  deps: RitoCoreWasmReaderWorkerHandlerDeps,',
    '): void;',
  ].join('\n');
}

async function readTypeDeclarations(paths) {
  const sources = await Promise.all(paths.map((path) => readFile(path, 'utf8')));
  return sources.map(stripTypeOnlyImports).join('\n');
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
