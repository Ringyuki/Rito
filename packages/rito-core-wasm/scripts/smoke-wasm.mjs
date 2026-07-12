import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const entryUrl = new URL('../dist/index.mjs', import.meta.url);
const wasmUrl = new URL('../dist/rito_wasm_bg.wasm', import.meta.url);
const epubUrl = new URL(
  '../../../packages/rito/tests/fixtures/books/book-01.epub',
  import.meta.url,
);

if (!existsSync(entryUrl) || !existsSync(wasmUrl)) {
  throw new Error('WASM dist files are missing. Run `pnpm run rust:wasm:build` first.');
}

const {
  createRitoCoreWasmInProcessReaderClient,
  decodeRitoFrameCommandBuffer,
  getRitoCoreWasmStatus,
  initRitoCoreWasmEngine,
  RitoCoreWasmError,
} = await import(entryUrl.href);
const engine = await initRitoCoreWasmEngine({ module_or_path: await readFile(wasmUrl) });
const status = getRitoCoreWasmStatus();
const epubBytes = await readFile(epubUrl);

assertViewRevisionRuntimeBundleMatchesJson(engine, epubBytes);

const document = engine.openDocument(new Uint8Array(epubBytes));
const publication = document.publication();
const revisionBundle = document.createFullRevisionBundle({
  layoutConfig: layoutConfig(),
  lineBreaking: 'greedy',
  activeSpreadIndex: 0,
});
const fontAwareRevisionBundle = document.createFullRevisionBundle({
  layoutConfig: fontAwareLayoutConfig(),
  lineBreaking: 'greedy',
  activeSpreadIndex: 0,
});
const optimalRevisionBundle = document.createFullRevisionBundle({
  layoutConfig: layoutConfig(),
  lineBreaking: 'optimal',
  activeSpreadIndex: 0,
});
const revision = revisionBundle.bundle.revision;
const fontAwareRevision = fontAwareRevisionBundle.bundle.revision;
const optimalRevision = optimalRevisionBundle.bundle.revision;
const navigation = revisionBundle.bundle.navigation;
const legacyPinnedFontPolicy = document.pinnedFontPolicy();
const pinnedFontPolicy = openWithFirstPublicationFont(
  engine,
  document,
  epubBytes,
  publication,
  revision.revisionId,
);
releaseBundleInitialFrameResources(document, revisionBundle);
releaseBundleInitialFrameResources(document, fontAwareRevisionBundle);
releaseBundleInitialFrameResources(document, optimalRevisionBundle);
const frame = document.getFrame(revision.revisionId, 0);
const fontAwareFrame = document.getFrame(fontAwareRevision.revisionId, 0);
const frameCommandBuffer = document.readFrameCommandBuffer(revision.revisionId, 0);
const frameCommandBufferMetadata = document.getFrameCommandBufferMetadata(revision.revisionId, 0);
const decodedFrameCommandBuffer = decodeRitoFrameCommandBuffer(
  frameCommandBufferMetadata,
  frameCommandBuffer,
);
const targets = document.getPageTargets(revision.revisionId, 0);
const versionedTargets = document.readerWorkerPayload({
  id: 2,
  kind: 'getPageTargetsAtRevision',
  revision: {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  },
  pageIndex: 0,
});
const search = document.search(revision.revisionId, {
  query: '私',
  caseSensitive: false,
  wholeWord: false,
  limit: 1,
});
const textPageIndex = search.results[0]?.pageIndex;
if (!Number.isInteger(textPageIndex)) {
  throw new Error('Expected search payload to return a text-backed page index.');
}
const textFrameCommandBuffer = document.readFrameCommandBuffer(revision.revisionId, textPageIndex);
const textFrameCommandBufferMetadata = document.getFrameCommandBufferMetadata(
  revision.revisionId,
  textPageIndex,
);
const decodedTextFrameCommandBuffer = decodeRitoFrameCommandBuffer(
  textFrameCommandBufferMetadata,
  textFrameCommandBuffer,
);
const textPositions = document.getPageTextPositions(revision.revisionId, textPageIndex);
const diagnosticRangeRequest = {
  pageIndex: textPageIndex,
  start: search.results[0].matchRange.start,
  end: search.results[0].matchRange.end,
};
const textGeometry = document.getTextRangeGeometry(revision.revisionId, diagnosticRangeRequest);
const diagnosticClient = createRitoCoreWasmInProcessReaderClient({
  initRitoCoreWasmEngine: async () => ({ openDocument: () => document }),
});
await diagnosticClient.open(new ArrayBuffer(0));
const diagnosticHandle = {
  revisionId: revision.revisionId,
  revisionVersion: revision.revisionVersion,
};
const versionedTextPositions = await diagnosticClient.getPageTextPositionsAtRevision(
  diagnosticHandle,
  textPageIndex,
);
const versionedTextGeometry = await diagnosticClient.getTextRangeGeometryAtRevision(
  diagnosticHandle,
  diagnosticRangeRequest,
);
const firstTextRect = textGeometry.rects[0];
const exactPointRequest = {
  pageIndex: textPageIndex,
  x: firstTextRect.x + firstTextRect.width / 2,
  y: firstTextRect.y + firstTextRect.height / 2,
};
const versionedTextCaret = await diagnosticClient.resolveTextCaretAtRevision(
  diagnosticHandle,
  exactPointRequest,
);
const rangeAddress =
  versionedTextCaret.value.resolution.status === 'resolved'
    ? versionedTextCaret.value.resolution.caret.address
    : {
        pageIndex: textPageIndex,
        ...diagnosticRangeRequest.start,
        affinity: 'downstream',
      };
const versionedExactTextRange = await diagnosticClient.resolveSameFlowTextRangeAtRevision(
  diagnosticHandle,
  { anchor: rangeAddress, focus: rangeAddress },
);
const imageFrame = findFirstImageFrame(document, revision.revisionId, revision.spreadCount);
const imageFrameCommandBuffer = document.readFrameCommandBuffer(
  revision.revisionId,
  imageFrame.spreadIndex,
);
const imageFrameCommandBufferMetadata = document.getFrameCommandBufferMetadata(
  revision.revisionId,
  imageFrame.spreadIndex,
);
const decodedImageFrameCommandBuffer = decodeRitoFrameCommandBuffer(
  imageFrameCommandBufferMetadata,
  imageFrameCommandBuffer,
);
const plannedFrameResources = document.prefetchPlannedFrameResources(
  revision.revisionId,
  imageFrame.spreadIndex,
);
const frameResources = plannedFrameResources.spreads.find(
  (spread) => spread.spreadIndex === imageFrame.spreadIndex,
);
const resource = document.getResourcePayload(revision.revisionId, 'image', 'Images/cover.jpg');
const resourceBytes = document.takeResourceTransfer(resource.transferId);
const legacyResource = document.getResourcePayload(
  revision.revisionId,
  'image',
  'Images/cover.jpg',
);
const legacyResourceBytes = document.readResourceTransfer(legacyResource.transferId);
const workerResource = document.readerWorkerPayload({
  id: 1,
  kind: 'readResource',
  revisionId: revision.revisionId,
  resourceKind: 'image',
  href: 'Images/cover.jpg',
});
const workerResourceBytes = workerResource.result.bytes;
const transferredWorkerResourceBytes = structuredClone(workerResourceBytes, {
  transfer: [workerResourceBytes.buffer],
});

if (revision.revisionId !== 'rev-1') {
  throw new Error(`Expected first revision to be rev-1, got ${revision.revisionId}`);
}
if (fontAwareRevision.revisionId !== 'rev-2') {
  throw new Error(`Expected font-aware revision to be rev-2, got ${fontAwareRevision.revisionId}`);
}
if (optimalRevision.revisionId !== 'rev-3') {
  throw new Error(`Expected optimal revision to be rev-3, got ${optimalRevision.revisionId}`);
}
const optimalLineBreakingDiff = findFirstDifferentFrameHash(
  document,
  revision.revisionId,
  optimalRevision.revisionId,
  Math.min(revision.spreadCount, optimalRevision.spreadCount),
);
if (optimalLineBreakingDiff === undefined) {
  throw new Error('Expected optimal line breaking to produce a distinct runtime frame.');
}
if (
  status.status !== 'experimental' ||
  status.engine !== 'rust' ||
  status.rustFacade?.wasmBindgen !== true ||
  status.rustFacade?.npmWasmArtifact !== true ||
  status.rustFacade?.packedFrameCommandBuffer !== true ||
  status.rustFacade?.pinnedFontPolicyJson !== true ||
  status.rustFacade?.exactTextInteractionJson !== true ||
  status.rustFacade?.resourceTransferLeases !== true
) {
  throw new Error(
    `Expected generated WASM package status to expose experimental runtime capabilities.`,
  );
}
if (legacyPinnedFontPolicy.faces.length !== 0 || pinnedFontPolicy.faces.length !== 1) {
  throw new Error('Expected legacy and pinned document opens to expose canonical font policies.');
}
if (
  typeof publication.package?.metadata?.title !== 'string' ||
  publication.package.metadata.title.length === 0
) {
  throw new Error('Expected fixture publication metadata to include a title.');
}
if (!Array.isArray(publication.chapters) || publication.chapters.length === 0) {
  throw new Error('Expected fixture publication metadata to include chapters.');
}
if (!Number.isInteger(revision.pageCount) || revision.pageCount < 1) {
  throw new Error(`Expected a positive page count, got ${revision.pageCount}`);
}
if (
  !Number.isInteger(fontAwareRevision.pageCount) ||
  fontAwareRevision.pageCount < 1 ||
  !Array.isArray(fontAwareFrame.commands) ||
  fontAwareFrame.commands.length === 0
) {
  throw new Error('Expected font-aware text measurement revision to produce a frame.');
}
if (
  navigation.revisionId !== revision.revisionId ||
  navigation.pageCount !== revision.pageCount ||
  !Array.isArray(navigation.chapters) ||
  navigation.chapters.length < 1
) {
  throw new Error('Expected revision navigation to include chapter page ranges.');
}
if (!Array.isArray(frame.commands) || frame.commands.length === 0) {
  throw new Error('Expected first frame to include display-list commands.');
}
if (typeof frame.commandHash !== 'string' || frame.commandHash.length === 0) {
  throw new Error('Expected first frame to include a command hash.');
}
if (
  frameCommandBufferMetadata.revisionId !== revision.revisionId ||
  frameCommandBufferMetadata.spreadIndex !== 0 ||
  frameCommandBufferMetadata.commandHash !== frame.commandHash ||
  frameCommandBufferMetadata.commandCount !== frame.commandCount ||
  stableStringify(frameCommandBufferMetadata.commandCounts) !==
    stableStringify(frame.commandCounts) ||
  stableStringify(frameCommandBufferMetadata.recordStats) !==
    stableStringify(decodedFrameCommandBuffer.recordStats) ||
  decodedFrameCommandBuffer.commandHash !== frame.commandHash ||
  stableStringify(decodedFrameCommandBuffer.commandCounts) !==
    stableStringify(frame.commandCounts) ||
  decodedFrameCommandBuffer.records.length !== frame.commandCount ||
  decodedFrameCommandBuffer.resourceRefCount !== frame.resourceRefs.imageRefs ||
  stableStringify(decodedFrameCommandBuffer.resourceTable) !==
    stableStringify(frame.resourceRefs.images) ||
  !decodedFrameCommandBuffer.records.some((record) => record.hasPayload) ||
  frameCommandBufferMetadata.byteLength !== frameCommandBuffer.length ||
  frameCommandBufferMetadata.resourceRefCount !== frame.resourceRefs.imageRefs ||
  stableStringify(frameCommandBufferMetadata.resourceTable) !==
    stableStringify(frame.resourceRefs.images) ||
  !Array.isArray(frameCommandBufferMetadata.payloadTable) ||
  frameCommandBufferMetadata.payloadTable.length === 0 ||
  new TextDecoder().decode(frameCommandBuffer.slice(0, 8)) !== 'RITOFCB2'
) {
  throw new Error('Expected packed frame command buffer metadata and bytes to match the frame.');
}
assertDecodedFrameMatchesRuntimeFrame(frame, decodedFrameCommandBuffer);
if (
  textFrameCommandBufferMetadata.commandHash !== decodedTextFrameCommandBuffer.commandHash ||
  !decodedTextFrameCommandBuffer.records.some((record) => record.kind === 'paintText') ||
  !decodedTextFrameCommandBuffer.records.some(
    (record) => record.kind === 'paintText' && record.hasPayload,
  )
) {
  throw new Error(
    'Expected decoded text frame command buffer to include payload-backed text records.',
  );
}
if (targets.revisionId !== revision.revisionId || targets.pageIndex !== 0) {
  throw new Error('Expected page target payload to match the requested revision/page.');
}
if (
  versionedTargets.revision.revisionId !== revision.revisionId ||
  versionedTargets.revision.revisionVersion !== revision.revisionVersion ||
  versionedTargets.result.entryCount !== targets.entryCount
) {
  throw new Error('Expected versioned page targets to pass the worker contract.');
}
if (
  textPositions.revisionId !== revision.revisionId ||
  textPositions.pageIndex !== textPageIndex ||
  typeof textPositions.text !== 'string' ||
  textPositions.textLength < 1 ||
  !Array.isArray(textPositions.offsets) ||
  textPositions.offsets.length < 1
) {
  throw new Error(
    'Expected page text-position payload to include text offsets for the requested page.',
  );
}
if (search.revisionId !== revision.revisionId || search.resultCount < 1) {
  throw new Error('Expected search payload to return at least one fixture match.');
}
if (
  textGeometry.revisionId !== revision.revisionId ||
  textGeometry.pageIndex !== textPageIndex ||
  !Array.isArray(textGeometry.rects) ||
  textGeometry.rects.length < 1
) {
  throw new Error('Expected search text range geometry to return at least one rect.');
}
if (
  stableStringify(versionedTextPositions.revision) !== stableStringify(diagnosticHandle) ||
  stableStringify(versionedTextPositions.value) !== stableStringify(textPositions) ||
  stableStringify(versionedTextGeometry.revision) !== stableStringify(diagnosticHandle) ||
  stableStringify(versionedTextGeometry.value.request) !==
    stableStringify(diagnosticRangeRequest) ||
  stableStringify(versionedTextGeometry.value.geometry) !== stableStringify(textGeometry)
) {
  throw new Error('Expected exact Worker text diagnostics to match direct WASM reads.');
}
if (
  stableStringify(versionedTextCaret.revision) !== stableStringify(diagnosticHandle) ||
  versionedTextCaret.value.revisionId !== diagnosticHandle.revisionId ||
  versionedTextCaret.value.pageIndex !== textPageIndex ||
  !['resolved', 'unavailable', 'miss'].includes(versionedTextCaret.value.resolution.status) ||
  stableStringify(versionedExactTextRange.revision) !== stableStringify(diagnosticHandle) ||
  versionedExactTextRange.value.revisionId !== diagnosticHandle.revisionId ||
  !['resolved', 'unavailable'].includes(versionedExactTextRange.value.resolution.status)
) {
  throw new Error(
    'Expected exact Worker caret and same-flow range reads to preserve their handle.',
  );
}
assertDecodedFrameMatchesRuntimeFrame(imageFrame, decodedImageFrameCommandBuffer);
if (
  plannedFrameResources.plan.revisionId !== revision.revisionId ||
  plannedFrameResources.plan.centerSpreadIndex !== imageFrame.spreadIndex ||
  frameResources?.revisionId !== revision.revisionId ||
  frameResources.spreadIndex !== imageFrame.spreadIndex ||
  !Array.isArray(frameResources.payloads) ||
  frameResources.payloads.length < 1
) {
  throw new Error('Expected frame resource prefetch to return image transfer payloads.');
}
releasePlannedFrameResources(document, plannedFrameResources);
if (resource.kind !== 'image' || resource.byteLength !== resourceBytes.length) {
  throw new Error('Expected resource payload byteLength to match transfer bytes.');
}
if (
  legacyResource.byteLength !== legacyResourceBytes.length ||
  workerResource.kind !== 'readResource' ||
  workerResource.result.payload.byteLength !== transferredWorkerResourceBytes.length ||
  workerResourceBytes.byteLength !== 0
) {
  throw new Error('Expected legacy and transferable reader-worker resource bytes.');
}
assertStructuredRuntimeError(() => document.getResourcePayload(revision.revisionId, 'audio', 'x'));
assertConsumedResourceTransfer(document, resource.transferId);
if (!document.releaseResourceTransfer(legacyResource.transferId)) {
  throw new Error('Expected legacy resource transfer release to succeed.');
}
if (document.pendingResourceTransferCount() !== 0) {
  throw new Error('Expected no pending resource transfers after take and release.');
}
diagnosticClient.dispose();

console.log(
  JSON.stringify({
    title: publication.package.metadata.title,
    revisionId: revision.revisionId,
    fontAwareRevisionId: fontAwareRevision.revisionId,
    optimalRevisionId: optimalRevision.revisionId,
    optimalLineBreakingDiff,
    pageCount: revision.pageCount,
    fontAwarePageCount: fontAwareRevision.pageCount,
    spreadCount: revision.spreadCount,
    chapterCount: navigation.chapters.length,
    commandCount: frame.commands.length,
    commandHash: frame.commandHash,
    commandBufferBytes: frameCommandBuffer.length,
    textPageIndex,
    textLength: textPositions.textLength,
    textGeometryRects: textGeometry.rects.length,
    exactCaretStatus: versionedTextCaret.value.resolution.status,
    exactRangeStatus: versionedExactTextRange.value.resolution.status,
    imageFrameSpreadIndex: imageFrame.spreadIndex,
    frameResourceTransfers: frameResources.payloads.length,
    searchResultCount: search.resultCount,
    resourceByteLength: resource.byteLength,
  }),
);

function openWithFirstPublicationFont(engine, source, epubBytes, publication, revisionId) {
  const font = publication.resources.fonts[0];
  if (!font) throw new Error('Expected fixture EPUB to include an embedded font.');
  const payload = source.getResourcePayload(revisionId, 'font', font.href);
  const bytes = source.takeResourceTransfer(payload.transferId);
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  const document = engine.openDocument(new Uint8Array(epubBytes), {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes, expectedSha256, genericRole: 'serif' }],
    },
  });
  try {
    const summary = document.pinnedFontPolicy();
    if (
      summary.faces[0]?.sha256 !== expectedSha256 ||
      summary.faces[0]?.byteLength !== bytes.byteLength ||
      summary.faces[0]?.language !== 'und'
    ) {
      throw new Error('Expected pinned font summary to bind to the supplied face bytes.');
    }
    return summary;
  } finally {
    document.free();
  }
}

function findFirstImageFrame(document, revisionId, spreadCount) {
  for (let spreadIndex = 0; spreadIndex < spreadCount; spreadIndex += 1) {
    const frame = document.getFrame(revisionId, spreadIndex);
    if (Array.isArray(frame.resourceRefs?.images) && frame.resourceRefs.images.length > 0) {
      return frame;
    }
  }
  throw new Error('Expected fixture EPUB to include at least one image-backed frame.');
}

function assertViewRevisionRuntimeBundleMatchesJson(engine, epubBytes) {
  const request = {
    layoutConfig: layoutConfig(),
    lineBreaking: 'greedy',
    activeSpreadIndex: 0,
    mode: 'preview',
  };
  const jsonDocument = engine.openDocument(new Uint8Array(epubBytes));
  const binaryDocument = engine.openDocument(new Uint8Array(epubBytes));
  let jsonView;
  let binaryView;
  try {
    jsonView = jsonDocument.createViewRevisionBundle(request);
    binaryView = binaryDocument.createViewRevisionBundleBytes(request);
    if (stableStringify(jsonView) !== stableStringify(binaryView)) {
      throw new Error('Expected RITORB1 view revision bundle to match JSON view output.');
    }
  } finally {
    if (jsonView) releaseBundleInitialFrameResources(jsonDocument, jsonView.result);
    if (binaryView) releaseBundleInitialFrameResources(binaryDocument, binaryView.result);
    jsonDocument.free();
    binaryDocument.free();
  }
}

function releaseBundleInitialFrameResources(document, bundle) {
  for (const spread of bundle.initialFrameWindow?.spreads ?? []) {
    for (const payload of spread.payloads ?? []) {
      if (!document.releaseResourceTransfer(payload.transferId)) {
        throw new Error(
          `Expected initial frame resource release to succeed: ${payload.transferId}`,
        );
      }
    }
  }
}

function releasePlannedFrameResources(document, plannedFrameResources) {
  for (const spread of plannedFrameResources.spreads ?? []) {
    for (const payload of spread.payloads ?? []) {
      if (payload.kind !== 'image') {
        throw new Error(`Expected frame resource payload to be image, got ${payload.kind}`);
      }
      if (!document.releaseResourceTransfer(payload.transferId)) {
        throw new Error(
          `Expected prefetched frame resource release to succeed: ${payload.transferId}`,
        );
      }
    }
  }
}

function findFirstDifferentFrameHash(document, leftRevisionId, rightRevisionId, spreadCount) {
  for (let spreadIndex = 0; spreadIndex < spreadCount; spreadIndex += 1) {
    const leftFrame = document.getFrame(leftRevisionId, spreadIndex);
    const rightFrame = document.getFrame(rightRevisionId, spreadIndex);
    if (leftFrame.commandHash !== rightFrame.commandHash) return spreadIndex;
  }
  return undefined;
}

function assertDecodedFrameMatchesRuntimeFrame(frame, decoded) {
  if (decoded.commandCount !== frame.commandCount || decoded.commandHash !== frame.commandHash) {
    throw new Error('Decoded frame command buffer does not match runtime frame identity.');
  }
  if (stableStringify(decoded.commandCounts) !== stableStringify(frame.commandCounts)) {
    throw new Error('Decoded frame command counts do not match runtime frame command counts.');
  }
  if (!Array.isArray(decoded.commands) || decoded.commands.length !== frame.commandCount) {
    throw new Error('Decoded frame command buffer did not reconstruct all display commands.');
  }
  const runtimeCommandPayloads = new Set(frame.commands.map((command) => stableStringify(command)));
  for (const [index, record] of decoded.records.entries()) {
    if (!record.hasPayload) continue;
    if (typeof record.payload !== 'string') {
      throw new Error(`Decoded ${record.kind} record is missing its payload.`);
    }
    const payload = JSON.parse(record.payload);
    if (!runtimeCommandPayloads.has(stableStringify(payload))) {
      throw new Error(`Decoded ${record.kind} payload is not present in runtime frame commands.`);
    }
    if (stableStringify(decoded.commands[index]) !== stableStringify(payload)) {
      throw new Error(`Decoded ${record.kind} command does not match its payload table entry.`);
    }
  }
  const decodedImages = collectDecodedFrameImageRefs(decoded);
  const frameImages = [...(frame.resourceRefs?.images ?? [])].sort();
  if (stableStringify(decodedImages) !== stableStringify(frameImages)) {
    throw new Error(
      `Decoded frame image refs do not match runtime resource refs: decoded=${stableStringify(decodedImages)} frame=${stableStringify(frameImages)}`,
    );
  }
}

function collectDecodedFrameImageRefs(decoded) {
  const images = new Set();
  for (const command of decoded.commands) {
    if (command.kind === 'paintImage' && typeof command.src === 'string') {
      images.add(command.src);
    }
    const backgroundImage = command.paint?.background?.image;
    if (command.kind === 'paintBlock' && typeof backgroundImage === 'string') {
      images.add(backgroundImage);
    }
  }
  return [...images].sort();
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function assertStructuredRuntimeError(callback) {
  try {
    callback();
  } catch (error) {
    if (!(error instanceof RitoCoreWasmError)) {
      throw new Error(`Expected RitoCoreWasmError, got ${String(error)}`, { cause: error });
    }
    if (error.code !== 'bad-request' || !error.message.includes('unsupported resource kind')) {
      throw new Error(
        `Expected bad-request unsupported resource error, got ${error.code}: ${error.message}`,
        { cause: error },
      );
    }
    return;
  }
  throw new Error('Expected invalid resource kind to throw.');
}

function assertConsumedResourceTransfer(document, transferId) {
  for (const callback of [
    () => document.readResourceTransfer(transferId),
    () => document.takeResourceTransfer(transferId),
  ]) {
    try {
      callback();
    } catch (error) {
      if (
        error instanceof RitoCoreWasmError &&
        error.code === 'engine-error' &&
        error.message.includes('unknown resource transfer')
      ) {
        continue;
      }
      throw new Error(`Expected consumed transfer error, got ${String(error)}`, { cause: error });
    }
    throw new Error('Expected consumed resource transfer to be unavailable.');
  }
  if (document.releaseResourceTransfer(transferId)) {
    throw new Error('Expected consumed resource transfer release to return false.');
  }
}

function layoutConfig() {
  return {
    firstPageAlone: true,
    marginBottom: 24,
    marginLeft: 24,
    marginRight: 24,
    marginTop: 24,
    pageHeight: 640,
    pageWidth: 420,
    rootFontSize: 16,
    spreadGap: 0,
    spreadMode: 'single',
    viewportHeight: 640,
    viewportWidth: 420,
  };
}

function fontAwareLayoutConfig() {
  return {
    ...layoutConfig(),
    textMeasurement: 'fontAware',
  };
}
