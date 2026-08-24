import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';

const EPUB = Uint8Array.of(80, 75, 3, 4);
const HASH = 'ab'.repeat(32);

test('legacy open remains constructor-based and reports Rust empty policy metadata', async () => {
  const { engine, RawDocument } = await fixture();

  const first = engine.openDocument(EPUB);
  const second = engine.openDocument(EPUB, {});

  assert.equal(RawDocument.constructorCalls.length, 2);
  assert.equal(RawDocument.pinnedCalls.length, 0);
  assert.deepEqual(first.pinnedFontPolicy(), emptySummary());
  assert.deepEqual(second.pinnedFontPolicy(), emptySummary());
});

test('pinned open sends bytes outside JSON and returns canonical Rust summary', async () => {
  const { engine, RawDocument } = await fixture();
  const font = Uint8Array.of(1, 2, 3, 4);
  RawDocument.nextSummary = policySummary(font.byteLength);

  const document = engine.openDocument(EPUB, {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [
        {
          bytes: font,
          expectedSha256: HASH.toUpperCase(),
          genericRole: 'serif',
          language: 'JA',
        },
      ],
    },
  });

  assert.equal(RawDocument.constructorCalls.length, 0);
  assert.equal(RawDocument.pinnedCalls.length, 1);
  const call = RawDocument.pinnedCalls[0];
  assert.equal(call.bytes, EPUB);
  assert.equal(call.faceBytes[0], font);
  assert.deepEqual(JSON.parse(call.metadataJson), {
    schemaVersion: 1,
    faces: [
      {
        expectedSha256: HASH.toUpperCase(),
        genericRole: 'serif',
        language: 'JA',
      },
    ],
  });
  assert.equal(call.metadataJson.includes('bytes'), false);
  assert.deepEqual(document.pinnedFontPolicy(), policySummary(font.byteLength));
  assert.equal(Object.hasOwn(document.pinnedFontPolicy().faces[0], 'bytes'), false);
});

test('pinned open rejects malformed caller input before invoking raw WASM', async () => {
  const { engine, RawDocument } = await fixture();
  const baseFace = {
    bytes: Uint8Array.of(1),
    expectedSha256: HASH,
    genericRole: 'serif',
  };
  const cases = [
    null,
    { unknown: true },
    { pinnedFontPolicy: {} },
    { pinnedFontPolicy: { schemaVersion: 2, faces: [baseFace] } },
    { pinnedFontPolicy: { schemaVersion: 1, faces: [] } },
    {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [{ ...baseFace, bytes: [1] }],
      },
    },
    {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [{ ...baseFace, expectedSha256: '0'.repeat(63) }],
      },
    },
    {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [{ ...baseFace, language: 'zh--Hant' }],
      },
    },
    {
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [{ ...baseFace, bytesInJson: [1] }],
      },
    },
    { pinnedFontPolicy: { schemaVersion: 1, faces: [baseFace, baseFace] } },
  ];

  for (const options of cases) {
    assert.throws(
      () => engine.openDocument(EPUB, options),
      (error) => error?.code === 'bad-request',
    );
  }
  assert.throws(
    () => engine.openDocument([1, 2, 3]),
    (error) => error?.code === 'bad-request' && /Uint8Array/.test(error.message),
  );
  assert.equal(RawDocument.constructorCalls.length, 0);
  assert.equal(RawDocument.pinnedCalls.length, 0);
});

test('document binds Rust summary faces to the exact open request', async () => {
  const { engine, RawDocument } = await fixture();
  const font = Uint8Array.of(1, 2, 3, 4);
  RawDocument.nextSummary = policySummary(font.byteLength + 1);
  const document = engine.openDocument(EPUB, {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [
        {
          bytes: font,
          expectedSha256: HASH,
          genericRole: 'serif',
          language: 'ja',
        },
      ],
    },
  });

  assert.throws(
    () => document.pinnedFontPolicy(),
    (error) => error?.code === 'internal-error' && /does not match its request/.test(error.message),
  );
});

test('document rejects malformed or non-canonical Rust summaries', async () => {
  const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
    async () => {},
    unusedRawDocument,
  );
  const valid = policySummary(4);
  const malformed = [
    { ...valid, schemaVersion: 2 },
    { ...valid, policyId: HASH.toUpperCase() },
    { ...valid, bytes: [1] },
    { ...valid, faces: [{ ...valid.faces[0], shapeFingerprint: '0'.repeat(16) }] },
    { ...valid, faces: [{ ...valid.faces[0], familyAlias: 'serif' }] },
    { ...valid, faces: [{ ...valid.faces[0], language: 'JA' }] },
    { ...valid, faces: [{ ...valid.faces[0], byteLength: 0 }] },
    { ...valid, faces: [valid.faces[0], valid.faces[0]] },
  ];

  for (const summary of malformed) {
    const document = new RitoCoreWasmDocument({
      pinnedFontPolicyJson: () => JSON.stringify(summary),
    });
    assert.throws(
      () => document.pinnedFontPolicy(),
      (error) => error?.code === 'internal-error',
    );
  }
});

async function fixture() {
  class RawDocument {
    static constructorCalls = [];
    static pinnedCalls = [];
    static nextSummary = emptySummary();

    constructor(bytes) {
      RawDocument.constructorCalls.push(bytes);
      this.summary = emptySummary();
    }

    static openWithPinnedFontPolicy(bytes, metadataJson, faceBytes) {
      RawDocument.pinnedCalls.push({ bytes, metadataJson, faceBytes });
      const document = Object.create(RawDocument.prototype);
      document.summary = RawDocument.nextSummary;
      return document;
    }

    pinnedFontPolicyJson() {
      return JSON.stringify(this.summary);
    }
  }
  const runtime = createRitoCoreWasmDocumentRuntime(async () => {}, RawDocument);
  return { engine: await runtime.initRitoCoreWasmEngine(), RawDocument };
}

function emptySummary() {
  return { schemaVersion: 1, policyId: '00'.repeat(32), faces: [] };
}

function policySummary(byteLength) {
  return {
    schemaVersion: 1,
    policyId: 'cd'.repeat(32),
    faces: [
      {
        sha256: HASH,
        shapeFingerprint: HASH.slice(0, 16),
        familyAlias: `__RitoPinned_${HASH}`,
        byteLength,
        genericRole: 'serif',
        language: 'ja',
        style: 'normal',
        weight: 400,
      },
    ],
  };
}

function unusedRawDocument() {
  throw new Error('fixture constructs the wrapped document directly');
}
