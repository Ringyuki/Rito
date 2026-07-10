import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

const dist = new URL('../dist/', import.meta.url);
const runtimeSources = [
  'core-wasm-error-runtime.js',
  'reader-compat-runtime.js',
  'reader-worker-client-runtime.js',
  'reader-worker-session-runtime.js',
  'runtime-bundle-decoder-runtime.js',
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
const typeDeclarationSources = [
  'common',
  'publication',
  'revision',
  'frame',
  'resource',
  'search',
  'reader-worker',
  'runtime-bundle',
  'navigation',
  'page',
  'interaction',
  'status',
].map((name) => new URL(`../src/types/${name}.ts`, import.meta.url));

await mkdir(dist, { recursive: true });
await Promise.all(runtimeSources.map(({ source, target }) => copyFile(source, target)));

const errorDeclarations = await readFile(errorDeclarationSource, 'utf8');
const compatDeclarations = stripTypeOnlyImports(await readFile(compatDeclarationSource, 'utf8'));
const typeDeclarations = await readTypeDeclarations(typeDeclarationSources);
await writeFile(new URL('decoder.mjs', dist), decoderEntry());
await writeFile(new URL('index.mjs', dist), indexEntry());
await writeFile(
  new URL('index.d.mts', dist),
  [
    errorDeclarations,
    typeDeclarations,
    compatDeclarations,
    decoderDeclaration(),
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
    decoderDeclaration(),
    readerClientDeclarations(),
    '',
  ].join('\n'),
);

function decoderEntry() {
  return [
    "export { decodeRitoFrameCommandBuffer } from './frame-command-buffer-decoder-runtime.js';",
    "export { decodeRitoRuntimeBundle } from './runtime-bundle-decoder-runtime.js';",
    "export { createRitoCoreWasmReaderChapterMap, createRitoCoreWasmReaderChapterTextIndexMap, createRitoCoreWasmReaderFootnoteMap, createRitoCoreWasmReaderManifestHrefMap, createRitoCoreWasmReaderPages, createRitoCoreWasmReaderSpreads, findRitoCoreWasmReaderActiveTocEntry, findRitoCoreWasmReaderSpreadContainingPage, findRitoCoreWasmReaderTocTarget } from './reader-compat-runtime.js';",
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
    '      wasmBindgen: true,',
    '      npmWasmArtifact: false,',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');
}

function decoderDeclaration() {
  return [
    'export declare const decodeRitoFrameCommandBuffer: (',
    '  metadata: RitoFrameCommandBufferMetadata,',
    '  bytes: Uint8Array,',
    ') => DecodedRitoFrameCommandBuffer;',
    'export declare const decodeRitoRuntimeBundle: (',
    '  bytes: Uint8Array,',
    ') => DecodedRitoRuntimeBundle;',
  ].join('\n');
}

function placeholderEngineDeclaration() {
  return [
    'export declare function initRitoCoreWasmEngine():',
    '  Promise<RitoCoreWasmReaderEngineRuntime>;',
  ].join('\n');
}

function readerClientDeclarations() {
  return [
    'export declare function createRitoCoreWasmWorkerReaderClient(',
    '  worker: RitoCoreWasmReaderWorkerLike,',
    '): RitoCoreWasmReaderWorkerClient;',
    'export declare function createRitoCoreWasmInProcessReaderClient(',
    '  module: RitoCoreWasmReaderBindingRuntimeModule,',
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
