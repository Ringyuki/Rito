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
  'chapter-local-owner-validation-runtime.js',
  'chapter-local-advance-validation-runtime.js',
  'chapter-local-frame-validation-runtime.js',
  'chapter-local-document-runtime.js',
  'revision-presentation-validation-runtime.js',
  'font-vertical-metric-validation-runtime.js',
  'font-vertical-metric-calibration-validation-runtime.js',
  'required-font-faces-validation-runtime.js',
  'reader-compat-runtime.js',
  'reader-bounded-session-runtime.js',
  'reader-bounded-session-support-runtime.js',
  'reader-worker-cache-runtime.js',
  'reader-worker-client-runtime.js',
  'reader-worker-pinned-font-runtime.js',
  'reader-worker-interaction-validation-runtime.js',
  'reader-worker-page-target-validation-runtime.js',
  'reader-worker-page-semantics-validation-runtime.js',
  'reader-worker-page-semantics-runtime.js',
  'reader-worker-page-reading-anchor-validation-runtime.js',
  'reader-worker-page-reading-anchor-runtime.js',
  'reader-worker-exact-text-interaction-validation-runtime.js',
  'reader-worker-exact-text-range-validation-runtime.js',
  'reader-worker-text-source-span-validation-runtime.js',
  'reader-worker-text-range-from-points-validation-runtime.js',
  'reader-worker-text-selection-movement-validation-runtime.js',
  'reader-worker-exact-source-range-validation-runtime.js',
  'reader-worker-text-geometry-validation-runtime.js',
  'reader-worker-versioned-read-validation-runtime.js',
  'shape-provenance-diagnostic-validation-runtime.js',
  'source-locator-continuation-validation-runtime.js',
  'reader-worker-session-runtime.js',
  'reader-worker-versioned-client-runtime.js',
  'reader-worker-versioned-payload-runtime.js',
  'reader-worker-chapter-local-client-runtime.js',
  'reader-worker-chapter-local-payload-runtime.js',
  'runtime-bundle-decoder-runtime.js',
  'frame-command-buffer-value-validation.js',
  'frame-command-buffer-paint-validation.js',
  'frame-command-buffer-command-validation.js',
  'frame-command-buffer-decoder-constants.js',
  'frame-command-buffer-decoder-records.js',
  'frame-command-buffer-decoder-runtime.js',
  'frame-command-buffer-decoder-validation.js',
  'reader-v1-wire-base-runtime.js',
  'reader-v1-display-paint-runtime.js',
  'reader-v1-display-decoder-runtime.js',
  'reader-v1-artifact-decoder-runtime.js',
  'reader-v1-publication-runtime.js',
  'reader-v1-request-runtime.js',
  'reader-v1-foreground-runtime.js',
  'reader-v1-background-runtime.js',
  'reader-v1-worker-runtime.js',
  'reader-v1-worker-client-runtime.js',
].map((name) => ({
  source: new URL(`../src/${name}`, import.meta.url),
  target: new URL(name, dist),
}));
const errorDeclarationSource = new URL('../src/core-wasm-error-runtime.d.ts', import.meta.url);
const compatDeclarationSource = new URL('../src/reader-compat-runtime.d.ts', import.meta.url);
const decoderDeclarationSources = [
  'frame-command-buffer-decoder-runtime.d.ts',
  'runtime-bundle-decoder-runtime.d.ts',
  'reader-v1-runtime.d.ts',
].map((name) => new URL(`../src/${name}`, import.meta.url));
const typeDeclarationSources = [
  'common',
  'frame-command',
  'publication',
  'revision',
  'chapter-local',
  'frame',
  'resource',
  'search',
  'reader-bounded-session',
  'reader-worker',
  'reader-worker-versioned',
  'runtime-bundle',
  'navigation',
  'page',
  'interaction-source',
  'interaction-text',
  'interaction-movement',
  'reading-anchor',
  'status',
  'shape-provenance',
  'pinned-font',
  'reader-v1-display',
  'reader-v1',
  'reader-v1-worker',
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
    ...readerV1RuntimeExports(),
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
    ...readerV1RuntimeExports(),
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
    '      pageSemanticsJson: true,',
    '      pageReadingAnchorJson: true,',
    '      pageTextPositionsJson: true,',
    '      textRangeGeometryJson: true,',
    '      exactTextInteractionJson: true,',
    '      locatorJson: true,',
    '      resourcePrefetchJson: true,',
    '      plannedFrameResourcePrefetchJson: true,',
    '      searchJson: true,',
    '      resourceTransferLeases: true,',
    '      versionedRevisionAccess: true,',
    '      boundedRevisionControl: true,',
    '      chapterLocalRevisionControl: true,',
    '      boundedSessionController: true,',
    '      readerSessionV1: false,',
    '      wasmBindgen: true,',
    '      npmWasmArtifact: false,',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');
}

function readerV1RuntimeExports() {
  return [
    "export { decodeRitoReaderArtifactV1, decodeRitoReaderResourceV1 } from './reader-v1-artifact-decoder-runtime.js';",
    "export { decodeRitoReaderPublicationV1 } from './reader-v1-publication-runtime.js';",
    "export { decodeRitoReaderDisplayListV1 } from './reader-v1-display-decoder-runtime.js';",
    "export { encodeRitoReaderAdjacentRequestV1, encodeRitoReaderArtifactRequestV1 } from './reader-v1-request-runtime.js';",
    "export { decodeRitoReaderForegroundHandoffAckV1, encodeRitoReaderForegroundHandoffV1 } from './reader-v1-foreground-runtime.js';",
    "export { decodeRitoReaderBackgroundAdvanceV1, decodeRitoReaderBackgroundHandoffAckV1, encodeRitoReaderBackgroundHandoffV1, encodeRitoReaderBackgroundRequestV1 } from './reader-v1-background-runtime.js';",
    "export { createRitoCoreWasmReaderV1WorkerHandler } from './reader-v1-worker-runtime.js';",
    "export { createRitoCoreWasmReaderV1WorkerClient, RitoReaderErrorV1 } from './reader-v1-worker-client-runtime.js';",
    "export { RitoReaderWireErrorV1 } from './reader-v1-wire-base-runtime.js';",
  ];
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
    '  options?: RitoCoreWasmWorkerReaderClientOptions,',
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
