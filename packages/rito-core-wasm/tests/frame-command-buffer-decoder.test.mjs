import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  decodeRitoFrameCommandBuffer,
  decodeRitoRuntimeBundle,
  getRitoCoreWasmStatus,
  normalizeRitoCoreWasmError,
  RitoCoreWasmError,
} from '../dist/index.mjs';

const VERSION = 2;
const HEADER_BYTES = 16;
const RECORD_BYTES = 32;
const NO_INDEX = 0xffffffff;
const RUNTIME_BUNDLE_VERSION = 1;
const RUNTIME_BUNDLE_HEADER_BYTES = 56;
const RUNTIME_BUNDLE_GOLDEN_ROOT = new URL(
  '../../../crates/rito-core/src/runtime/bundle_wire/fixtures/',
  import.meta.url,
);

test('getRitoCoreWasmStatus reports the experimental Rust boundary', () => {
  const status = getRitoCoreWasmStatus();
  assert.deepEqual(
    {
      ...status,
      rustFacade: {
        ...status.rustFacade,
        createViewRevisionBundleBytes: true,
        npmWasmArtifact: true,
      },
    },
    {
      packageName: '@ritojs/core-wasm',
      status: 'experimental',
      engine: 'rust',
      rustFacade: {
        publicationJson: true,
        pinnedFontPolicyJson: true,
        createFullRevisionBundleJson: true,
        createInitialPreviewRevisionBundleJson: true,
        createActiveChapterPreviewRevisionBundleJson: true,
        createPreviewRevisionBundleJson: true,
        createViewRevisionBundleJson: true,
        createViewRevisionBundleBytes: true,
        runtimeBundleRitorb1: true,
        frameJson: true,
        packedFrameCommandBuffer: true,
        footnoteJson: true,
        footnotesJson: true,
        chapterTextIndicesJson: true,
        pageTargetsJson: true,
        pageTextPositionsJson: true,
        textRangeGeometryJson: true,
        locatorJson: true,
        resourcePrefetchJson: true,
        plannedFrameResourcePrefetchJson: true,
        searchJson: true,
        resourceTransferLeases: true,
        versionedRevisionAccess: true,
        boundedRevisionControl: true,
        boundedSessionController: true,
        wasmBindgen: true,
        npmWasmArtifact: true,
      },
    },
  );
  assert.equal(typeof status.rustFacade.npmWasmArtifact, 'boolean');
});

test('decoder entry exposes the WASM-free browser runtime surface', async () => {
  const decoderEntryUrl = new URL('../dist/decoder.mjs', import.meta.url);
  const decoderDeclarationUrl = new URL('../dist/decoder.d.mts', import.meta.url);
  const [decoder, entrySource, declarationSource] = await Promise.all([
    import(decoderEntryUrl.href),
    readFile(decoderEntryUrl, 'utf8'),
    readFile(decoderDeclarationUrl, 'utf8'),
  ]);

  for (const exportName of [
    'createRitoCoreWasmBoundedReaderSession',
    'createRitoCoreWasmInProcessReaderClient',
    'createRitoCoreWasmReaderChapterMap',
    'createRitoCoreWasmReaderPages',
    'createRitoCoreWasmReaderSpreads',
    'createRitoCoreWasmWorkerReaderClient',
    'decodeRitoFrameCommandBuffer',
    'decodeRitoRuntimeBundle',
    'normalizeRitoCoreWasmError',
  ]) {
    assert.equal(typeof decoder[exportName], 'function', `${exportName} should be exported`);
    assert.match(declarationSource, new RegExp(`(?:function|const) ${exportName}`));
  }

  assert.doesNotMatch(entrySource, /rito_wasm(?:_bg)?\.js|core-wasm-document-runtime|WebAssembly/);
  assert.deepEqual(decoder.createRitoCoreWasmReaderPages(1, { pageWidth: 320, pageHeight: 480 }), [
    {
      index: 0,
      bounds: { x: 0, y: 0, width: 320, height: 480 },
      content: [],
    },
  ]);
});

test('generated type surface does not expose publication and layout as generic JSON', async () => {
  const [declaration, decoderDeclaration, wasmBuilder, runtime] = await Promise.all([
    readFile(new URL('../dist/index.d.mts', import.meta.url), 'utf8'),
    readFile(new URL('../dist/decoder.d.mts', import.meta.url), 'utf8'),
    readFile(new URL('../scripts/build-wasm.mjs', import.meta.url), 'utf8'),
    import(new URL('../dist/index.mjs', import.meta.url).href),
  ]);
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );

  assert.match(declaration, /export interface RitoCoreWasmPublicationInfo/);
  assert.match(declaration, /export interface RitoCoreWasmLayoutConfig/);
  assert.match(declaration, /export interface RitoCoreWasmFootnotes/);
  assert.match(declaration, /getFootnotes\(revisionId: string\): RitoCoreWasmFootnotes;/);
  assert.match(declaration, /export interface RitoCoreWasmChapterTextIndices/);
  assert.match(
    declaration,
    /getChapterTextIndices\(revisionId: string\): RitoCoreWasmChapterTextIndices;/,
  );
  assert.match(declaration, /export interface RitoCoreWasmRevisionBundle/);
  assert.match(declaration, /export interface RitoCoreWasmPageTarget/);
  const pageTargets = interfaceBody(declaration, 'RitoCoreWasmPageTargets');
  assert.match(pageTargets, /readonly entries: readonly RitoCoreWasmPageTarget\[];/);
  assert.doesNotMatch(pageTargets, /RitoCoreWasmJsonObject/);
  assert.match(declaration, /export interface RitoCoreWasmFullRevisionBundleRequest/);
  assert.match(declaration, /export interface RitoCoreWasmInitialPreviewRevisionRequest/);
  assert.match(declaration, /export interface RitoCoreWasmActiveChapterPreviewRevisionRequest/);
  assert.match(declaration, /export interface RitoCoreWasmPreviewRevisionBundleRequest/);
  assert.match(declaration, /export interface RitoCoreWasmViewRevisionRequest/);
  assert.match(declaration, /export interface RitoCoreWasmViewRevisionResponse/);
  assert.match(declaration, /export type RitoCoreWasmViewRevisionDisplay/);
  assert.match(declaration, /readonly display: RitoCoreWasmViewRevisionDisplay;/);
  assert.match(declaration, /export interface RitoCoreWasmViewRevisionFollowUp/);
  assert.match(declaration, /readonly followUp\?: RitoCoreWasmViewRevisionFollowUp/);
  const viewRevisionFollowUp = interfaceBody(declaration, 'RitoCoreWasmViewRevisionFollowUp');
  assert.match(viewRevisionFollowUp, /readonly delayMs: number;/);
  assert.match(viewRevisionFollowUp, /readonly request: RitoCoreWasmViewRevisionRequest &/);
  assert.match(viewRevisionFollowUp, /readonly mode: 'full';/);
  assert.match(viewRevisionFollowUp, /readonly previousRevisionId: string;/);
  assert.doesNotMatch(viewRevisionFollowUp, /^ {2}readonly mode:/m);
  assert.doesNotMatch(viewRevisionFollowUp, /^ {2}readonly previousRevisionId:/m);
  assert.match(declaration, /export interface RitoCoreWasmRevisionBundleResponse/);
  assert.match(declaration, /export interface RitoCoreWasmRevisionFrameSelection/);
  const revisionBundle = interfaceBody(declaration, 'RitoCoreWasmRevisionBundle');
  const revisionBundleResponse = interfaceBody(declaration, 'RitoCoreWasmRevisionBundleResponse');
  const revisionFrameSelection = interfaceBody(declaration, 'RitoCoreWasmRevisionFrameSelection');
  const frameResourceWarmPlan = interfaceBody(declaration, 'RitoCoreWasmFrameResourceWarmPlan');
  assert.match(
    revisionBundleResponse,
    /readonly frameSelection\?: RitoCoreWasmRevisionFrameSelection/,
  );
  assert.match(revisionFrameSelection, /readonly spreadIndex: number;/);
  assert.match(revisionFrameSelection, /readonly displaySpreadIndex: number;/);
  assert.match(
    revisionBundleResponse,
    /readonly initialFrameWindow\?: RitoCoreWasmPlannedFrameResourcePrefetchResponse/,
  );
  assert.doesNotMatch(declaration, /readonly initialFrame\?: RitoCoreWasmInitialFrameDecision/);
  assert.doesNotMatch(declaration, /initialFrameResourcePayloads/);
  assert.match(revisionBundle, /readonly fontFamilies: readonly string\[];/);
  assert.doesNotMatch(revisionBundleResponse, /displaySpreadIndex/);
  assert.match(frameResourceWarmPlan, /readonly displaySpreadIndex: number;/);
  assert.match(declaration, /createFullRevisionBundle\(/);
  assert.match(declaration, /createInitialPreviewRevisionBundle\(/);
  assert.match(declaration, /createActiveChapterPreviewRevisionBundle\(/);
  assert.match(declaration, /createPreviewRevisionBundle\(/);
  assert.match(declaration, /createViewRevisionBundle\(/);
  assert.match(declaration, /createViewRevisionBundleBytes\(/);
  assert.doesNotMatch(declaration, /createRevisionBundle\(/);
  assert.doesNotMatch(declaration, /activeChapterPreview\(/);
  assert.doesNotMatch(declaration, /initialFrameDecision\(/);
  assert.doesNotMatch(declaration, /tocTargets\(/);
  assert.doesNotMatch(declaration, /revisionBundle\(/);
  assert.doesNotMatch(declaration, /createRevision\(/);
  assert.doesNotMatch(declaration, /revisionNavigation\(/);
  assert.doesNotMatch(declaration, /prefetchFrames\(/);
  assert.match(declaration, /export type RitoCoreWasmTextMeasurementMode/);
  assert.match(declaration, /readonly textMeasurement\?: RitoCoreWasmTextMeasurementMode/);
  assert.match(declaration, /export declare class RitoCoreWasmError extends Error/);
  if (getRitoCoreWasmStatus().rustFacade.npmWasmArtifact) {
    assert.match(declaration, /export declare class RitoCoreWasmDocument/);
    assert.equal(typeof runtime.RitoCoreWasmDocument, 'function');
  } else {
    assert.match(declaration, /export interface RitoCoreWasmDocument/);
    assert.doesNotMatch(declaration, /export declare class RitoCoreWasmDocument/);
    assert.equal('RitoCoreWasmDocument' in runtime, false);
  }
  assert.match(declaration, /readonly commandCounts: Readonly<Record<string, number>>;/);
  assert.match(declaration, /readonly recordStats: RitoFrameCommandBufferRecordStats;/);
  assert.match(declaration, /readonly resourceTable: readonly string\[];/);
  assert.match(declaration, /readonly fontFamilies: readonly string\[];/);
  assert.match(declaration, /readonly imageDominated: boolean;/);
  assert.match(declaration, /export type RitoCoreWasmFrameCommand/);
  assert.match(declaration, /readonly commands: readonly RitoCoreWasmFrameCommand\[];/);
  assert.match(declaration, /decodeRitoFrameCommandBuffer/);
  assert.match(declaration, /decodeRitoRuntimeBundle/);
  assert.match(declaration, /export interface DecodedRitoRuntimeBundle/);
  for (const surface of [declaration, decoderDeclaration]) {
    assert.match(surface, /export type RitoCoreWasmRuntimeBundlePayload = RitoCoreWasmJsonValue;/);
    assert.doesNotMatch(
      surface,
      /RitoCoreWasmRuntimeBundlePayload = RitoCoreWasmViewRevisionResponse/,
    );
  }
  assert.match(declaration, /export interface RitoCoreWasmFrameResourceWarmPlan/);
  assert.doesNotMatch(declaration, /frameResourceWarmPlan\(/);
  assert.match(declaration, /export interface RitoCoreWasmPlannedFrameResourcePrefetchResponse/);
  assert.doesNotMatch(declaration, /prefetchFrameResources\(/);
  assert.match(declaration, /prefetchPlannedFrameResources\(/);
  assert.match(declaration, /takeResourceTransfer\(transferId: string\): Uint8Array;/);
  assert.match(declaration, /warmFrameWindowAtRevision\(/);
  assert.match(declaration, /metadata: RitoFrameCommandBufferMetadata/);
  assert.match(declaration, /\) => DecodedRitoFrameCommandBuffer;/);
  assert.match(declaration, /normalizeRitoCoreWasmError/);
  assert.match(wasmBuilder, /publication\(\): RitoCoreWasmPublicationInfo;/);
  assert.match(wasmBuilder, /request: RitoCoreWasmFullRevisionBundleRequest,/);
  assert.match(wasmBuilder, /runtime-bundle-decoder-runtime\.d\.ts/);
  assert.match(wasmBuilder, /takeResourceTransfer\(transferId: string\): Uint8Array;/);
  assert.doesNotMatch(wasmBuilder, /'\) => DecodedRitoRuntimeBundle;'/);
  assert.doesNotMatch(wasmBuilder, /publication\(\): RitoCoreWasmJsonObject;/);
  assert.doesNotMatch(wasmBuilder, /layoutConfig: RitoCoreWasmJsonObject,/);
  assert.equal(packageJson.scripts.build, 'node scripts/build-wasm.mjs');
  assert.equal(packageJson.scripts['build:placeholder'], 'node scripts/build-placeholder.mjs');
});

function interfaceBody(declaration, name) {
  const pattern = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`);
  const match = declaration.match(pattern);
  assert.ok(match, `missing interface ${name}`);
  return match[1];
}

function runtimeBundleBytes({ strings, values, rootIndex }) {
  const stringBytes = joinBytes(
    strings.flatMap((value) => {
      const utf8 = new TextEncoder().encode(value);
      return [u32Bytes(utf8.byteLength), utf8];
    }),
  );
  const valueBytes = joinBytes(values);
  const bytes = new Uint8Array(
    RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength + valueBytes.byteLength,
  );
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RITORB1'), 0);
  view.setUint8(7, 0);
  view.setUint32(8, RUNTIME_BUNDLE_VERSION, true);
  view.setUint32(12, RUNTIME_BUNDLE_HEADER_BYTES, true);
  view.setUint32(16, bytes.byteLength, true);
  view.setUint32(20, strings.length, true);
  view.setUint32(24, values.length, true);
  view.setUint32(28, RUNTIME_BUNDLE_HEADER_BYTES, true);
  view.setUint32(32, stringBytes.byteLength, true);
  view.setUint32(36, RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength, true);
  view.setUint32(40, valueBytes.byteLength, true);
  view.setUint32(44, rootIndex, true);
  bytes.set(stringBytes, RUNTIME_BUNDLE_HEADER_BYTES);
  bytes.set(valueBytes, RUNTIME_BUNDLE_HEADER_BYTES + stringBytes.byteLength);
  writeRuntimeChecksum(view, runtimeBundleChecksum(bytes.subarray(RUNTIME_BUNDLE_HEADER_BYTES)));
  return bytes;
}

function runtimeTrueRecord() {
  return new Uint8Array([2]);
}

function runtimeStringRecord(index) {
  return joinBytes([new Uint8Array([6]), u32Bytes(index)]);
}

function runtimeU64Record(value) {
  const bytes = new Uint8Array(9);
  const view = new DataView(bytes.buffer);
  view.setUint8(0, 4);
  view.setBigUint64(1, BigInt(value), true);
  return bytes;
}

function runtimeArrayRecord(indexes, declaredCount = indexes.length) {
  return joinBytes([
    new Uint8Array([7]),
    u32Bytes(declaredCount),
    ...indexes.map((index) => u32Bytes(index)),
  ]);
}

function runtimeObjectRecord(entries, declaredCount = entries.length) {
  return joinBytes([
    new Uint8Array([8]),
    u32Bytes(declaredCount),
    ...entries.flatMap(([keyIndex, valueIndex]) => [u32Bytes(keyIndex), u32Bytes(valueIndex)]),
  ]);
}

function writeRuntimeChecksum(view, checksum) {
  view.setUint32(48, Number(checksum & 0xffffffffn), true);
  view.setUint32(52, Number(checksum >> 32n), true);
}

function runtimeBundleChecksum(bytes) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash;
}

function u32Bytes(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function joinBytes(chunks) {
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

test('normalizeRitoCoreWasmError preserves structured Rust error payloads', () => {
  const cause = '{"code":"bad-request","message":"unsupported resource kind: audio"}';
  const error = normalizeRitoCoreWasmError(cause, 'getResourcePayload');

  assert.ok(error instanceof RitoCoreWasmError);
  assert.equal(error.name, 'RitoCoreWasmError');
  assert.equal(error.code, 'bad-request');
  assert.equal(error.message, 'unsupported resource kind: audio');
  assert.equal(error.cause, cause);
});

test('normalizeRitoCoreWasmError wraps unstructured failures', () => {
  const cause = new Error('boom');
  const error = normalizeRitoCoreWasmError(cause, 'search');

  assert.ok(error instanceof RitoCoreWasmError);
  assert.equal(error.code, 'internal-error');
  assert.equal(error.message, 'search failed: boom');
  assert.equal(error.cause, cause);
});

test('decodeRitoRuntimeBundle decodes string-table object payloads', () => {
  const bytes = runtimeBundleBytes({
    strings: ['kind', 'preview', 'result', 'ok', 'count'],
    values: [
      runtimeStringRecord(1),
      runtimeTrueRecord(),
      runtimeU64Record(2),
      runtimeObjectRecord([
        [3, 1],
        [4, 2],
      ]),
      runtimeObjectRecord([
        [0, 0],
        [2, 3],
      ]),
    ],
    rootIndex: 4,
  });

  const decoded = decodeRitoRuntimeBundle(bytes);

  assert.equal(decoded.protocolVersion, RUNTIME_BUNDLE_VERSION);
  assert.equal(decoded.byteLength, bytes.byteLength);
  assert.equal(decoded.stringCount, 5);
  assert.equal(decoded.valueCount, 5);
  assert.deepEqual(decoded.payload, {
    kind: 'preview',
    result: { ok: true, count: 2 },
  });
});

test('decodeRitoRuntimeBundle preserves generic scalar JSON payloads', () => {
  const bytes = runtimeBundleBytes({
    strings: [],
    values: [runtimeTrueRecord()],
    rootIndex: 0,
  });

  assert.equal(decodeRitoRuntimeBundle(bytes).payload, true);
});

test('decodeRitoRuntimeBundle rejects forward value references from containers', () => {
  const arrayBytes = runtimeBundleBytes({
    strings: [],
    values: [runtimeArrayRecord([1]), runtimeTrueRecord()],
    rootIndex: 0,
  });
  const objectBytes = runtimeBundleBytes({
    strings: ['value'],
    values: [runtimeObjectRecord([[0, 1]]), runtimeTrueRecord()],
    rootIndex: 0,
  });

  assert.throws(() => decodeRitoRuntimeBundle(arrayBytes), {
    message: /value index is out of bounds/,
  });
  assert.throws(() => decodeRitoRuntimeBundle(objectBytes), {
    message: /value index is out of bounds/,
  });
});

test('decodeRitoRuntimeBundle rejects impossible counts before preallocation', () => {
  const validBytes = runtimeBundleBytes({
    strings: ['value'],
    values: [runtimeTrueRecord()],
    rootIndex: 0,
  });
  const badStringCount = new Uint8Array(validBytes);
  new DataView(badStringCount.buffer).setUint32(20, 0xffffffff, true);
  const badValueCount = new Uint8Array(validBytes);
  new DataView(badValueCount.buffer).setUint32(24, 0xffffffff, true);
  const badArrayCount = runtimeBundleBytes({
    strings: [],
    values: [runtimeArrayRecord([], 0xffffffff)],
    rootIndex: 0,
  });
  const badObjectCount = runtimeBundleBytes({
    strings: [],
    values: [runtimeObjectRecord([], 0xffffffff)],
    rootIndex: 0,
  });

  assert.throws(() => decodeRitoRuntimeBundle(badStringCount), {
    message: /RITORB1 string count range exceeds payload length/,
  });
  assert.throws(() => decodeRitoRuntimeBundle(badValueCount), {
    message: /RITORB1 value count range exceeds payload length/,
  });
  assert.throws(() => decodeRitoRuntimeBundle(badArrayCount), {
    message: /RITORB1 array count range exceeds payload length/,
  });
  assert.throws(() => decodeRitoRuntimeBundle(badObjectCount), {
    message: /RITORB1 object count range exceeds payload length/,
  });
});

test('decodeRitoRuntimeBundle preserves __proto__ as an own data property', () => {
  const bytes = runtimeBundleBytes({
    strings: ['__proto__'],
    values: [runtimeTrueRecord(), runtimeObjectRecord([[0, 0]])],
    rootIndex: 1,
  });

  const payload = decodeRitoRuntimeBundle(bytes).payload;

  assert.equal(Object.getPrototypeOf(payload), Object.prototype);
  assert.equal(Object.hasOwn(payload, '__proto__'), true);
  assert.equal(payload.__proto__, true);
});

test('decodeRitoRuntimeBundle does not invoke inherited property setters', () => {
  const inheritedKey = '__ritoRuntimeBundleInheritedSetter__';
  const bytes = runtimeBundleBytes({
    strings: [inheritedKey],
    values: [runtimeTrueRecord(), runtimeObjectRecord([[0, 0]])],
    rootIndex: 1,
  });
  let setterCalls = 0;
  Object.defineProperty(Object.prototype, inheritedKey, {
    configurable: true,
    set: () => {
      setterCalls += 1;
    },
  });

  try {
    const payload = decodeRitoRuntimeBundle(bytes).payload;

    assert.equal(setterCalls, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(payload, inheritedKey), {
      configurable: true,
      enumerable: true,
      value: true,
      writable: true,
    });
  } finally {
    Reflect.deleteProperty(Object.prototype, inheritedKey);
  }
});

test('decodeRitoRuntimeBundle matches the shared Rust golden vector', async () => {
  const [jsonSource, hexSource] = await Promise.all([
    readFile(new URL('ritorb1-v1.json', RUNTIME_BUNDLE_GOLDEN_ROOT), 'utf8'),
    readFile(new URL('ritorb1-v1.hex', RUNTIME_BUNDLE_GOLDEN_ROOT), 'utf8'),
  ]);
  const expected = JSON.parse(jsonSource);
  const compactHex = hexSource.replaceAll(/\s/g, '');
  assert.match(compactHex, /^(?:[0-9a-f]{2})+$/);

  const decoded = decodeRitoRuntimeBundle(Uint8Array.from(Buffer.from(compactHex, 'hex')));

  assert.deepEqual(decoded.payload, expected);
  assert.equal(Object.getPrototypeOf(decoded.payload), Object.prototype);
  assert.equal(Object.hasOwn(decoded.payload, '__proto__'), true);
  assert.deepEqual(decoded.payload.__proto__, { polluted: true });
  assert.deepEqual(Object.getOwnPropertyDescriptor(decoded.payload, '__proto__'), {
    configurable: true,
    enumerable: true,
    value: { polluted: true },
    writable: true,
  });
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('decodeRitoRuntimeBundle validates a long mixed UTF-8 payload checksum', () => {
  const value = 'ASCII-中文-😀'.repeat(4_096);
  assert.ok(new TextEncoder().encode(value).byteLength > 64 * 1_024);
  const bytes = runtimeBundleBytes({
    strings: ['payload', value],
    values: [runtimeStringRecord(1), runtimeObjectRecord([[0, 0]])],
    rootIndex: 1,
  });

  assert.deepEqual(decodeRitoRuntimeBundle(bytes).payload, { payload: value });
});

test('decodeRitoRuntimeBundle rejects malformed runtime bundles', () => {
  const bytes = runtimeBundleBytes({
    strings: ['ok'],
    values: [runtimeTrueRecord(), runtimeObjectRecord([[0, 0]])],
    rootIndex: 1,
  });
  const badMagic = new Uint8Array(bytes);
  badMagic[0] = 0;
  assert.throws(() => decodeRitoRuntimeBundle(badMagic), {
    message: /Invalid RITORB1 magic/,
  });

  const badVersion = new Uint8Array(bytes);
  new DataView(badVersion.buffer).setUint32(8, 99, true);
  assert.throws(() => decodeRitoRuntimeBundle(badVersion), {
    message: /Unsupported RITORB1 version/,
  });

  const badRange = new Uint8Array(bytes);
  new DataView(badRange.buffer).setUint32(36, RUNTIME_BUNDLE_HEADER_BYTES + 1, true);
  assert.throws(() => decodeRitoRuntimeBundle(badRange), {
    message: /table ranges are not sorted/,
  });

  const badIndex = runtimeBundleBytes({
    strings: ['ok'],
    values: [runtimeObjectRecord([[99, 0]])],
    rootIndex: 0,
  });
  assert.throws(() => decodeRitoRuntimeBundle(badIndex), {
    message: /string index is out of bounds/,
  });

  const badChecksum = new Uint8Array(bytes);
  badChecksum[badChecksum.length - 1] ^= 0xff;
  assert.throws(() => decodeRitoRuntimeBundle(badChecksum), {
    message: /checksum mismatch/,
  });
});

test('decodeRitoFrameCommandBuffer decodes geometry, strings, and payloads', () => {
  const command = {
    kind: 'paintText',
    text: 'Hello',
    rect: { x: 1, y: 2, width: 30, height: 40 },
    paint: completeRunPaint(),
    lineHeightPx: 20,
    href: '#target',
    sourceText: 'Hello',
    sourceTextOffset: 0,
    futureField: { retained: true },
  };
  const payload = JSON.stringify(command);
  const bytes = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, secondary: true, paint: true, payload: true }),
      x: 1,
      y: 2,
      width: 30,
      height: 40,
      primaryIndex: 0,
      secondaryIndex: 1,
      payloadIndex: 0,
    },
  ]);
  const decoded = decodeRitoFrameCommandBuffer(
    metadata(bytes, {
      stringTable: ['Hello', '#target'],
      payloadTable: [payload],
    }),
    bytes,
  );

  assert.equal(decoded.protocolVersion, VERSION);
  assert.equal(decoded.commandCount, 1);
  assert.deepEqual(decoded.commandCounts, { paintText: 1 });
  assert.deepEqual(decoded.recordStats, {
    geometryRecords: 1,
    paintRecords: 1,
    payloadRecords: 1,
    primaryStringRecords: 1,
    secondaryStringRecords: 1,
  });
  assert.equal(decoded.commandHash, 'hash-a');
  assert.equal(decoded.resourceRefCount, 0);
  assert.deepEqual(decoded.resourceTable, []);
  assert.deepEqual(decoded.records[0], {
    opcode: 9,
    kind: 'paintText',
    flags: 31,
    hasGeometry: true,
    hasPrimaryString: true,
    hasSecondaryString: true,
    hasPaint: true,
    hasPayload: true,
    x: 1,
    y: 2,
    width: 30,
    height: 40,
    primaryString: 'Hello',
    secondaryString: '#target',
    payload,
  });
  assert.deepEqual(decoded.commands, [command]);
});

test('decodeRitoFrameCommandBuffer decodes complex paint payload records', () => {
  const commands = [
    {
      kind: 'transform',
      origin: { x: 10, y: 20 },
      box: { width: 100, height: 80 },
      transforms: [
        {
          kind: 'translate',
          x: { unit: 'px', value: 4 },
          y: { unit: 'percent', value: -25 },
        },
        { kind: 'scale', sx: -1, sy: 0.5 },
        { kind: 'rotate', rad: 0.25 },
      ],
    },
    {
      kind: 'clipRect',
      rect: { x: 1, y: 2, width: 3, height: 4 },
      radius: { rx: 0, ry: 2 },
    },
    {
      kind: 'paintPage',
      rect: { x: 0, y: 0, width: 320, height: 480 },
      paint: {},
    },
    {
      kind: 'paintBlock',
      rect: { x: 5, y: 6, width: 7, height: 8 },
      paint: completeBlockPaint(),
      borderBox: { topWidth: 1, rightWidth: 2, bottomWidth: 3, leftWidth: 4 },
    },
    {
      kind: 'paintRuby',
      text: 'ruby',
      rect: { x: 6, y: 7, width: 8, height: 9 },
      paint: completeRunPaint(),
    },
    {
      kind: 'paintImage',
      src: 'images/cover.jpg',
      rect: { x: 9, y: 10, width: 11, height: 12 },
      alt: 'cover',
      href: '',
    },
    {
      kind: 'paintHorizontalRule',
      rect: { x: 13, y: 14, width: 15, height: 16 },
      paint: { color: '#333', style: 'dashed' },
    },
  ];
  const payloads = commands.map((command) => JSON.stringify(command));
  const bytes = commandBufferBytes([
    record({ opcode: 5, flags: flags({ payload: true }), payloadIndex: 0 }),
    record({ opcode: 6, payloadIndex: 1, x: 1, y: 2, width: 3, height: 4 }),
    record({ opcode: 7, flags: flags({ payload: true }), payloadIndex: 2 }),
    record({
      opcode: 8,
      flags: flags({ geometry: true, paint: true, payload: true }),
      payloadIndex: 3,
      x: 5,
      y: 6,
      width: 7,
      height: 8,
    }),
    record({ opcode: 10, flags: flags({ payload: true }), payloadIndex: 4 }),
    record({
      opcode: 11,
      flags: flags({ geometry: true, primary: true, payload: true }),
      payloadIndex: 5,
      primaryIndex: 0,
      x: 9,
      y: 10,
      width: 11,
      height: 12,
    }),
    record({
      opcode: 12,
      flags: flags({ geometry: true, paint: true, payload: true }),
      payloadIndex: 6,
      x: 13,
      y: 14,
      width: 15,
      height: 16,
    }),
  ]);

  const decoded = decodeRitoFrameCommandBuffer(
    metadata(bytes, {
      stringTable: ['images/cover.jpg'],
      payloadTable: payloads,
    }),
    bytes,
  );

  assert.deepEqual(
    decoded.records.map((record) => record.kind),
    [
      'transform',
      'clipRect',
      'paintPage',
      'paintBlock',
      'paintRuby',
      'paintImage',
      'paintHorizontalRule',
    ],
  );
  assert.deepEqual(decoded.commandCounts, {
    transform: 1,
    clipRect: 1,
    paintPage: 1,
    paintBlock: 1,
    paintRuby: 1,
    paintImage: 1,
    paintHorizontalRule: 1,
  });
  assert.deepEqual(decoded.recordStats, {
    geometryRecords: 4,
    paintRecords: 2,
    payloadRecords: 7,
    primaryStringRecords: 1,
    secondaryStringRecords: 0,
  });
  assert.deepEqual(
    decoded.records.map((record) => record.payload),
    payloads,
  );
  assert.equal(decoded.records[5].primaryString, 'images/cover.jpg');
  assert.deepEqual(decoded.commands, commands);
});

test('decodeRitoFrameCommandBuffer reconstructs simple non-payload commands', () => {
  const bytes = commandBufferBytes([
    { opcode: 1, flags: 0 },
    { opcode: 3, flags: flags({ geometry: true }), x: 12, y: 4 },
    { opcode: 4, flags: flags({ geometry: true }), x: 0.5 },
    { opcode: 6, flags: flags({ geometry: true }), x: 2, y: 3, width: 4, height: 5 },
    {
      opcode: 11,
      flags: flags({ geometry: true, primary: true, secondary: true }),
      primaryIndex: 0,
      secondaryIndex: 1,
      x: 9,
      y: 10,
      width: 11,
      height: 12,
    },
    { opcode: 2, flags: 0 },
  ]);

  const decoded = decodeRitoFrameCommandBuffer(
    metadata(bytes, {
      stringTable: ['images/cover.jpg', '#cover'],
    }),
    bytes,
  );

  assert.deepEqual(decoded.commands, [
    { kind: 'pushState' },
    { kind: 'translate', dx: 12, dy: 4 },
    { kind: 'opacity', value: 0.5 },
    { kind: 'clipRect', rect: { x: 2, y: 3, width: 4, height: 5 } },
    {
      kind: 'paintImage',
      src: 'images/cover.jpg',
      rect: { x: 9, y: 10, width: 11, height: 12 },
      href: '#cover',
    },
    { kind: 'popState' },
  ]);
  assert.deepEqual(decoded.commandCounts, {
    pushState: 1,
    translate: 1,
    opacity: 1,
    clipRect: 1,
    paintImage: 1,
    popState: 1,
  });
  assert.deepEqual(decoded.recordStats, {
    geometryRecords: 4,
    paintRecords: 0,
    payloadRecords: 0,
    primaryStringRecords: 1,
    secondaryStringRecords: 1,
  });
});

test('decodeRitoFrameCommandBuffer rejects malformed display commands', () => {
  const malformed = [
    {
      opcode: 7,
      payload: { kind: 'paintPage', paint: {} },
      message: /commands\[0\]\.rect/,
    },
    {
      opcode: 9,
      payload: {
        kind: 'paintText',
        text: 'missing font',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        paint: { color: '#000' },
      },
      message: /commands\[0\]\.paint\.font/,
    },
    {
      opcode: 5,
      payload: {
        kind: 'transform',
        origin: { x: 0, y: 0 },
        box: { width: 10, height: 10 },
        transforms: [
          {
            kind: 'translate',
            x: { unit: 'em', value: 1 },
            y: { unit: 'px', value: 2 },
          },
        ],
      },
      message: /commands\[0\]\.transforms\[0\]\.x\.unit/,
    },
    {
      opcode: 8,
      payload:
        '{"kind":"paintBlock","rect":{"x":0,"y":0,"width":10,"height":10},"paint":{"boxShadow":[{"offsetX":1e400,"offsetY":0,"blur":0,"spread":0,"color":"#000","inset":false}]}}',
      message: /commands\[0\]\.paint\.boxShadow\[0\]\.offsetX/,
    },
    {
      opcode: 11,
      payload: {
        kind: 'paintImage',
        src: '',
        rect: { x: 0, y: 0, width: 0, height: 0 },
        alt: 42,
      },
      message: /commands\[0\]\.alt/,
    },
    {
      opcode: 12,
      payload: {
        kind: 'paintHorizontalRule',
        rect: { x: 0, y: 0, width: 10, height: 1 },
        paint: { color: '#000', style: 'none' },
      },
      message: /commands\[0\]\.paint\.style/,
    },
    {
      opcode: 9,
      payload: {
        kind: 'paintText',
        text: '',
        rect: { x: 0, y: 0, width: 0, height: 0 },
        paint: completeRunPaint(),
        sourceTextOffset: -1,
      },
      message: /commands\[0\]\.sourceTextOffset/,
    },
  ];

  for (const { opcode, payload, message } of malformed) {
    const payloadText = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const bytes = commandBufferBytes([
      { opcode, flags: flags({ payload: true }), payloadIndex: 0 },
    ]);
    assert.throws(
      () => decodeRitoFrameCommandBuffer(metadata(bytes, { payloadTable: [payloadText] }), bytes),
      { message },
    );
  }

  const nonFiniteGeometry = commandBufferBytes([
    {
      opcode: 6,
      flags: flags({ geometry: true }),
      x: Number.POSITIVE_INFINITY,
      y: 0,
      width: 10,
      height: 10,
    },
  ]);
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(nonFiniteGeometry), nonFiniteGeometry),
    { message: /records\[0\]\.x/ },
  );

  for (const opcode of [1, 2]) {
    const unbalancedState = commandBufferBytes([{ opcode, flags: 0 }]);
    assert.throws(() => decodeRitoFrameCommandBuffer(metadata(unbalancedState), unbalancedState), {
      message: /matching pushState|balanced pushState/,
    });
  }
});

test('decodeRitoFrameCommandBuffer rejects malformed metadata and headers', () => {
  const bytes = commandBufferBytes([]);

  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { protocolVersion: 1 }), bytes),
    {
      message: /Unsupported Rito frame command buffer version/,
    },
  );
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { byteLength: bytes.length + 1 }), bytes),
    {
      message: /byte length mismatch/,
    },
  );
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(bytes, { commandCount: 0.5 }), bytes), {
    message: /Invalid Rito frame command buffer command count/,
  });
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(bytes, { byteLength: -1 }), bytes), {
    message: /Invalid Rito frame command buffer byte length/,
  });
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { stringTable: 'not-array' }), bytes),
    {
      message: /string table must be an array/,
    },
  );
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { payloadTable: [123] }), bytes),
    {
      message: /payload table entry 0 must be a string/,
    },
  );
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(new Uint8Array([1, 2, 3]), { commandCount: 0, byteLength: 3 }),
        new Uint8Array([1, 2, 3]),
      ),
    {
      message: /shorter than its header/,
    },
  );
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { resourceRefCount: -1 }), bytes),
    {
      message: /Invalid Rito frame command buffer resource ref count/,
    },
  );
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { resourceTable: [null] }), bytes),
    {
      message: /resource table entry 0 must be a string/,
    },
  );
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadata(bytes, { commandCounts: null }), bytes),
    {
      message: /command counts must be an object/,
    },
  );
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(metadata(bytes, { commandCounts: { paintText: -1 } }), bytes),
    {
      message: /Invalid Rito frame command buffer command count for paintText/,
    },
  );
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(bytes, {
          commandCounts: { paintText: 1 },
        }),
        bytes,
      ),
    {
      message: /command counts total mismatch/,
    },
  );
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(bytes, { recordStats: null }), bytes), {
    message: /record stats must be an object/,
  });
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(bytes, { recordStats: { ...recordStatsFromBytes(bytes, 0), payloadRecords: -1 } }),
        bytes,
      ),
    {
      message: /Invalid Rito frame command buffer record stat for payloadRecords/,
    },
  );
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(bytes, { recordStats: { ...recordStatsFromBytes(bytes, 0), payloadRecords: 1 } }),
        bytes,
      ),
    {
      message: /Invalid Rito frame command buffer record stat for payloadRecords/,
    },
  );

  const badMagic = bytes.slice();
  badMagic[0] = 0;
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(badMagic), badMagic), {
    message: /Invalid Rito frame command buffer magic/,
  });

  const badCount = bytes.slice();
  new DataView(badCount.buffer).setUint32(12, 1, true);
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(badCount), badCount), {
    message: /command count does not match metadata/,
  });

  const trailingRecord = new Uint8Array(bytes.length + RECORD_BYTES);
  trailingRecord.set(bytes);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(trailingRecord, {
          commandCount: 0,
          byteLength: trailingRecord.length,
        }),
        trailingRecord,
      ),
    {
      message: /record length mismatch/,
    },
  );

  const fullRecord = commandBufferBytes([{ opcode: 1, flags: 0 }]);
  const truncatedRecord = fullRecord.subarray(0, fullRecord.length - 1);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(truncatedRecord, {
          commandCount: 1,
          commandCounts: { pushState: 1 },
        }),
        truncatedRecord,
      ),
    {
      message: /record length mismatch/,
    },
  );

  const trailingByte = new Uint8Array(fullRecord.length + 1);
  trailingByte.set(fullRecord);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(trailingByte, {
          commandCount: 1,
        }),
        trailingByte,
      ),
    {
      message: /record length mismatch/,
    },
  );
});

test('decodeRitoFrameCommandBuffer rejects record table mismatches', () => {
  const missingString = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, paint: true, payload: true }),
      primaryIndex: 2,
      payloadIndex: 0,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(missingString, {
          stringTable: ['Hello'],
          payloadTable: ['{"kind":"paintText"}'],
        }),
        missingString,
      ),
    {
      message: /missing string table index 2/,
    },
  );

  const payloadFlagWithoutIndex = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, paint: true, payload: true }),
      primaryIndex: 0,
      payloadIndex: NO_INDEX,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(payloadFlagWithoutIndex, {
          stringTable: ['Hello'],
          payloadTable: ['{"kind":"paintText"}'],
        }),
        payloadFlagWithoutIndex,
      ),
    {
      message: /payload flag without payload table index/,
    },
  );

  const payloadIndexWithoutFlag = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, paint: true }),
      primaryIndex: 0,
      payloadIndex: 0,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(payloadIndexWithoutFlag, {
          stringTable: ['Hello'],
          payloadTable: ['{"kind":"paintText"}'],
        }),
        payloadIndexWithoutFlag,
      ),
    {
      message: /payload table index without payload flag/,
    },
  );

  const invalidPayloadJson = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, paint: true, payload: true }),
      primaryIndex: 0,
      payloadIndex: 0,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(invalidPayloadJson, {
          stringTable: ['Hello'],
          payloadTable: ['not-json'],
        }),
        invalidPayloadJson,
      ),
    {
      message: /payload for paintText is invalid JSON/,
    },
  );

  const payloadKindMismatch = commandBufferBytes([
    {
      opcode: 9,
      flags: flags({ geometry: true, primary: true, paint: true, payload: true }),
      primaryIndex: 0,
      payloadIndex: 0,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(payloadKindMismatch, {
          stringTable: ['Hello'],
          payloadTable: ['{"kind":"paintImage"}'],
        }),
        payloadKindMismatch,
      ),
    {
      message: /payload kind mismatch/,
    },
  );

  const mismatchedCommandCounts = commandBufferBytes([
    { opcode: 1, flags: 0 },
    { opcode: 2, flags: 0 },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(mismatchedCommandCounts, {
          commandCounts: { pushState: 2 },
        }),
        mismatchedCommandCounts,
      ),
    {
      message: /command counts do not match decoded records/,
    },
  );

  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(mismatchedCommandCounts, {
          recordStats: {
            ...recordStatsFromBytes(mismatchedCommandCounts, 2),
            payloadRecords: 1,
          },
        }),
        mismatchedCommandCounts,
      ),
    {
      message: /record stats do not match decoded records/,
    },
  );
});

test('decodeRitoFrameCommandBuffer rejects unsupported record fields', () => {
  const unknownOpcode = commandBufferBytes([
    {
      opcode: 99,
      flags: flags({ payload: true }),
      payloadIndex: 0,
    },
  ]);
  assert.throws(
    () =>
      decodeRitoFrameCommandBuffer(
        metadata(unknownOpcode, {
          payloadTable: ['{"kind":"unknown"}'],
        }),
        unknownOpcode,
      ),
    {
      message: /Unsupported Rito frame command buffer opcode: 99/,
    },
  );

  const reservedFlags = commandBufferBytes([{ opcode: 1, flags: 1 << 5 }]);
  assert.throws(() => decodeRitoFrameCommandBuffer(metadata(reservedFlags), reservedFlags), {
    message: /Unsupported Rito frame command buffer record flags: 0x20/,
  });
});

function completeRunPaint() {
  return {
    color: '#111',
    font: { style: 'italic', weight: 400, sizePx: 16, family: 'Test Serif' },
    wordSpacingPx: 1,
    letterSpacingPx: 0.5,
    backgroundColor: '#eee',
    backgroundRadius: 2,
    textShadow: [{ offsetX: 1, offsetY: 2, blur: 3, color: '#222' }],
    decoration: { kind: 'underline', y: 13, thickness: 1, color: '#333' },
    padding: { top: 1, right: 2, bottom: 3, left: 4 },
    border: {
      top: { widthPx: 1, paint: { color: '#444', style: 'solid' } },
      bottom: { widthPx: 2, paint: { color: '#555', style: 'dotted' } },
      start: { widthPx: 3, paint: { color: '#666', style: 'dashed' } },
      end: { widthPx: 4, paint: { color: '#777', style: 'solid' } },
    },
  };
}

function completeBlockPaint() {
  return {
    background: {
      color: '#fff',
      image: 'images/pattern.png',
      size: 'cover',
      repeat: 'no-repeat',
      position: {
        x: { unit: 'px', value: -2 },
        y: { unit: 'percent', value: 120 },
      },
    },
    border: {
      top: { color: '#111', style: 'solid' },
      right: { color: '#222', style: 'dotted' },
      bottom: { color: '#333', style: 'dashed' },
      left: { color: '#444', style: 'solid' },
    },
    radius: { px: 0, pct: 25 },
    boxShadow: [
      {
        offsetX: -1,
        offsetY: 2,
        blur: 3,
        spread: 4,
        color: '#555',
        inset: true,
      },
    ],
  };
}

function commandBufferBytes(records) {
  const bytes = new Uint8Array(HEADER_BYTES + records.length * RECORD_BYTES);
  bytes.set(new TextEncoder().encode('RITOFCB2'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, VERSION, true);
  view.setUint32(12, records.length, true);
  for (const [index, record] of records.entries()) {
    writeRecord(view, HEADER_BYTES + index * RECORD_BYTES, record);
  }
  return bytes;
}

function writeRecord(view, offset, record) {
  view.setUint16(offset, record.opcode, true);
  view.setUint16(offset + 2, record.flags, true);
  view.setFloat32(offset + 4, record.x ?? 0, true);
  view.setFloat32(offset + 8, record.y ?? 0, true);
  view.setFloat32(offset + 12, record.width ?? 0, true);
  view.setFloat32(offset + 16, record.height ?? 0, true);
  view.setUint32(offset + 20, record.primaryIndex ?? NO_INDEX, true);
  view.setUint32(offset + 24, record.secondaryIndex ?? NO_INDEX, true);
  view.setUint32(offset + 28, record.payloadIndex ?? NO_INDEX, true);
}

function record(overrides) {
  return {
    flags: flags({ geometry: true, payload: true }),
    ...overrides,
  };
}

function flags(input) {
  return (
    (input.geometry ? 1 : 0) |
    (input.primary ? 1 << 1 : 0) |
    (input.secondary ? 1 << 2 : 0) |
    (input.paint ? 1 << 3 : 0) |
    (input.payload ? 1 << 4 : 0)
  );
}

function metadata(bytes, overrides = {}) {
  const commandCount =
    overrides.commandCount ?? Math.max(0, (bytes.length - HEADER_BYTES) / RECORD_BYTES);
  return {
    protocolVersion: VERSION,
    commandCount,
    commandCounts: commandCountsFromBytes(bytes, commandCount),
    recordStats: recordStatsFromBytes(bytes, commandCount),
    byteLength: bytes.length,
    commandHash: 'hash-a',
    resourceRefCount: 0,
    resourceTable: [],
    stringTable: [],
    payloadTable: [],
    ...overrides,
  };
}

function recordStatsFromBytes(bytes, commandCount) {
  const stats = {
    geometryRecords: 0,
    paintRecords: 0,
    payloadRecords: 0,
    primaryStringRecords: 0,
    secondaryStringRecords: 0,
  };
  if (!Number.isSafeInteger(commandCount) || commandCount < 0) {
    return stats;
  }
  if (bytes.length < HEADER_BYTES + commandCount * RECORD_BYTES) {
    return stats;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < commandCount; index += 1) {
    const flagsValue = view.getUint16(HEADER_BYTES + index * RECORD_BYTES + 2, true);
    if ((flagsValue & 1) !== 0) {
      stats.geometryRecords += 1;
    }
    if ((flagsValue & (1 << 1)) !== 0) {
      stats.primaryStringRecords += 1;
    }
    if ((flagsValue & (1 << 2)) !== 0) {
      stats.secondaryStringRecords += 1;
    }
    if ((flagsValue & (1 << 3)) !== 0) {
      stats.paintRecords += 1;
    }
    if ((flagsValue & (1 << 4)) !== 0) {
      stats.payloadRecords += 1;
    }
  }
  return stats;
}

function commandCountsFromBytes(bytes, commandCount) {
  if (!Number.isSafeInteger(commandCount) || commandCount < 0) {
    return {};
  }
  if (bytes.length < HEADER_BYTES + commandCount * RECORD_BYTES) {
    return {};
  }
  const counts = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < commandCount; index += 1) {
    const opcode = view.getUint16(HEADER_BYTES + index * RECORD_BYTES, true);
    const kind = commandKind(opcode);
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function commandKind(opcode) {
  switch (opcode) {
    case 1:
      return 'pushState';
    case 2:
      return 'popState';
    case 3:
      return 'translate';
    case 4:
      return 'opacity';
    case 5:
      return 'transform';
    case 6:
      return 'clipRect';
    case 7:
      return 'paintPage';
    case 8:
      return 'paintBlock';
    case 9:
      return 'paintText';
    case 10:
      return 'paintRuby';
    case 11:
      return 'paintImage';
    case 12:
      return 'paintHorizontalRule';
    default:
      return 'unknown';
  }
}
