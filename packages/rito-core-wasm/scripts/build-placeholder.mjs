import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';

import { decoderDeclarationFiles, runtimeModules, typeModules } from './emitted-sources.mjs';
import { documentClassDeclarations } from './document-declarations.mjs';

const dist = new URL('../dist/', import.meta.url);
const runtimeSources = runtimeModules.map((name) => ({
  source: new URL(`../src/${name}`, import.meta.url),
  target: new URL(name, dist),
}));
const errorDeclarationSource = new URL('../src/core-wasm-error-runtime.d.ts', import.meta.url);
const navigationDeclarationSource = new URL(
  '../src/reader-navigation-runtime.d.ts',
  import.meta.url,
);
const decoderDeclarationSources = decoderDeclarationFiles.map(
  (name) => new URL(`../src/${name}`, import.meta.url),
);
const typeDeclarationSources = typeModules.map(
  (name) => new URL(`../src/types/${name}.ts`, import.meta.url),
);

await mkdir(dist, { recursive: true });
await Promise.all(runtimeSources.map(({ source, target }) => copyFile(source, target)));

const errorDeclarations = stripTypeOnlyImports(await readFile(errorDeclarationSource, 'utf8'));
const compatDeclarations = stripTypeOnlyImports(
  await readFile(navigationDeclarationSource, 'utf8'),
);
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
    "export { createRitoCoreWasmReaderChapterMap, createRitoCoreWasmReaderFootnoteMap, createRitoCoreWasmReaderManifestHrefMap, createRitoCoreWasmReaderSpreads, findRitoCoreWasmReaderActiveTocEntry, findRitoCoreWasmReaderSpreadContainingPage, findRitoCoreWasmReaderTocTarget } from './reader-navigation-runtime.js';",
    "export { createRitoCoreWasmReaderRevisionSession } from './reader-revision-session-runtime.js';",
    "export { createRitoCoreWasmInProcessReaderClient, createRitoCoreWasmReaderWorkerHandler, createRitoCoreWasmWorkerReaderClient } from './reader-worker-client-runtime.js';",
    ...readerSessionRuntimeExports(),
    "export { normalizeRitoCoreWasmError, RitoCoreWasmError } from './core-wasm-error-runtime.js';",
    '',
  ].join('\n');
}

function indexEntry() {
  return [
    "export { decodeRitoFrameCommandBuffer } from './frame-command-buffer-decoder-runtime.js';",
    "export { createRitoCoreWasmReaderChapterMap, createRitoCoreWasmReaderFootnoteMap, createRitoCoreWasmReaderManifestHrefMap, createRitoCoreWasmReaderSpreads, findRitoCoreWasmReaderActiveTocEntry, findRitoCoreWasmReaderSpreadContainingPage, findRitoCoreWasmReaderTocTarget } from './reader-navigation-runtime.js';",
    "export { createRitoCoreWasmReaderRevisionSession } from './reader-revision-session-runtime.js';",
    "export { createRitoCoreWasmInProcessReaderClient, createRitoCoreWasmReaderWorkerHandler, createRitoCoreWasmWorkerReaderClient } from './reader-worker-client-runtime.js';",
    ...readerSessionRuntimeExports(),
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
    '      runtimeBundleRitorb1: true,',
    '      frameJson: true,',
    '      packedFrameCommandBuffer: true,',
    '      footnoteJson: true,',
    '      footnotesJson: true,',
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
    '      revisionControl: true,',
    '      chapterLocalRevisionControl: true,',
    '      revisionSessionController: true,',
    '      readerSession: false,',
    '      wasmBindgen: true,',
    '      npmWasmArtifact: false,',
    '    },',
    '  };',
    '}',
    '',
  ].join('\n');
}

function readerSessionRuntimeExports() {
  return [
    "export { decodeRitoReaderArtifact, decodeRitoReaderResource } from './reader-session-artifact-decoder-runtime.js';",
    "export { decodeRitoReaderPublication } from './reader-session-publication-runtime.js';",
    "export { decodeRitoReaderPrimitiveList, READER_V1_PRIMITIVE_LIST_FORMAT_VERSION } from './reader-session-primitive-decoder-runtime.js';",
    "export { encodeRitoReaderAdjacentRequest, encodeRitoReaderArtifactRequest } from './reader-session-request-runtime.js';",
    "export { decodeRitoReaderForegroundHandoffAck, encodeRitoReaderForegroundHandoff } from './reader-session-foreground-runtime.js';",
    "export { decodeRitoReaderBackgroundAdvance, decodeRitoReaderBackgroundHandoffAck, encodeRitoReaderBackgroundHandoff, encodeRitoReaderBackgroundRequest } from './reader-session-background-runtime.js';",
    "export { createRitoCoreWasmReaderSessionWorkerHandler } from './reader-session-worker-runtime.js';",
    "export { createRitoCoreWasmReaderSessionWorkerClient, RitoReaderError } from './reader-session-worker-client-runtime.js';",
    "export { RitoReaderWireError } from './reader-session-wire-base-runtime.js';",
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
