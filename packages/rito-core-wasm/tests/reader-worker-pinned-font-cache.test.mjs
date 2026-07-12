import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmInProcessReaderClient } from '../dist/reader-worker-client-runtime.js';

const HASH_A = 'ab'.repeat(32);
const HASH_B = 'cd'.repeat(32);
const POLICY_A = '12'.repeat(32);
const POLICY_B = '34'.repeat(32);

test('shared reader cache identity includes the Rust pinned-font policyId', async () => {
  const cache = {};
  const first = fixture(POLICY_A, HASH_A);
  const firstClient = createRitoCoreWasmInProcessReaderClient(first.module, cache);
  const firstResult = await firstClient.open(publication(), options(font(), HASH_A));
  firstClient.dispose();

  const same = fixture(POLICY_A, HASH_A);
  const sameClient = createRitoCoreWasmInProcessReaderClient(same.module, cache);
  const sameResult = await sameClient.open(publication(), options(font(), HASH_A));
  sameClient.dispose();

  assert.deepEqual(sameResult.pinnedFontPolicy, firstResult.pinnedFontPolicy);
  assert.equal(JSON.stringify(firstResult).includes('bytes'), false);
  assert.equal(first.state.freeCalls, 1);
  assert.equal(same.state.freeCalls, 1);

  const different = fixture(POLICY_B, HASH_B);
  const differentClient = createRitoCoreWasmInProcessReaderClient(different.module, cache);
  await assert.rejects(
    differentClient.open(publication(), options(font(), HASH_B)),
    /different pinned font policy/,
  );
  assert.equal(different.state.freeCalls, 1);
  await assert.rejects(differentClient.open(publication()), /disposed/);
});

function fixture(policyId, sha256) {
  const state = { freeCalls: 0 };
  const module = {
    initRitoCoreWasmEngine: async () => ({
      openDocument: (_bytes, directOptions) => {
        const face = directOptions.pinnedFontPolicy.faces[0];
        assert.equal(face.expectedSha256, sha256);
        return {
          publication: () => ({ title: 'Fixture' }),
          pinnedFontPolicy: () => policySummary(policyId, sha256, face.bytes.byteLength),
          free: () => {
            state.freeCalls += 1;
          },
        };
      },
    }),
  };
  return { module, state };
}

function publication() {
  return Uint8Array.of(80, 75, 3, 4).buffer;
}

function font() {
  return Uint8Array.of(1, 2, 3).buffer;
}

function options(bytes, expectedSha256) {
  return {
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes, expectedSha256, genericRole: 'serif', language: 'ja' }],
    },
  };
}

function policySummary(policyId, sha256, byteLength) {
  return {
    schemaVersion: 1,
    policyId,
    faces: [
      {
        sha256,
        shapeFingerprint: sha256.slice(0, 16),
        familyAlias: `__RitoPinned_${sha256}`,
        byteLength,
        genericRole: 'serif',
        language: 'ja',
        style: 'normal',
        weight: 400,
      },
    ],
  };
}
