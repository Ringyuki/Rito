import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  prepareHostFontFaces,
  preparePinnedFontPolicyOpen,
} from '../src/pinned-font-policy-runtime.js';

const SERIF = 'ab'.repeat(32);
const SANS = 'cd'.repeat(32);
const CJK = 'ef'.repeat(32);

function face(extra = {}) {
  return { bytes: Uint8Array.of(1, 2, 3), expectedSha256: SERIF, genericRole: 'serif', ...extra };
}

function invalid(run, pattern) {
  assert.throws(
    run,
    (error) =>
      error?.name === 'RitoReaderError' &&
      error.code === 'invalid-request' &&
      pattern.test(error.message),
  );
}

test('an open without a policy prepares nothing', () => {
  assert.equal(preparePinnedFontPolicyOpen(undefined), undefined);
  assert.equal(preparePinnedFontPolicyOpen({}), undefined);
  assert.equal(preparePinnedFontPolicyOpen({ pinnedFontPolicy: undefined }), undefined);
});

test('a policy keeps its bytes outside its metadata and names what the engine must report', () => {
  const sans = face({ expectedSha256: SANS.toUpperCase(), genericRole: 'sansSerif' });
  const cjk = face({ bytes: Uint8Array.of(9, 9), expectedSha256: CJK, language: 'zh-Hans' });
  const prepared = preparePinnedFontPolicyOpen({
    pinnedFontPolicy: { schemaVersion: 1, faces: [sans, cjk, face({ language: 'und' })] },
  });

  // The metadata is what the caller wrote, in the caller's order.
  assert.deepEqual(prepared.metadata, {
    schemaVersion: 1,
    faces: [
      { expectedSha256: SANS.toUpperCase(), genericRole: 'sansSerif' },
      { expectedSha256: CJK, genericRole: 'serif', language: 'zh-Hans' },
      { expectedSha256: SERIF, genericRole: 'serif', language: 'und' },
    ],
  });
  assert.deepEqual(prepared.faceBytes, [sans.bytes, cjk.bytes, face().bytes]);
  // The expectation is canonical: by role, then language, then digest.
  assert.deepEqual(prepared.expectedFaces, [
    { sha256: SERIF, byteLength: 3, genericRole: 'serif', language: 'und' },
    { sha256: CJK, byteLength: 2, genericRole: 'serif', language: 'zh-hans' },
    { sha256: SANS, byteLength: 3, genericRole: 'sansSerif', language: 'und' },
  ]);
});

test('a malformed policy is an invalid request before anything reaches the engine', () => {
  const open = (pinnedFontPolicy) => () => preparePinnedFontPolicyOpen({ pinnedFontPolicy });
  invalid(() => preparePinnedFontPolicyOpen({ fonts: [] }), /unknown field fonts/);
  invalid(open(null), /must be an object/);
  invalid(open({ schemaVersion: 2, faces: [face()] }), /schemaVersion must be 1/);
  invalid(open({ schemaVersion: 1, faces: [] }), /non-empty array/);
  invalid(open({ schemaVersion: 1, faces: [face()], extra: 1 }), /unknown field extra/);
  invalid(open({ schemaVersion: 1, faces: [face({ bytes: new Uint8Array() })] }), /Uint8Array/);
  invalid(open({ schemaVersion: 1, faces: [face({ bytes: new ArrayBuffer(4) })] }), /Uint8Array/);
  invalid(open({ schemaVersion: 1, faces: [face({ expectedSha256: 'abc' })] }), /64 hexadecimal/);
  invalid(open({ schemaVersion: 1, faces: [face({ genericRole: 'cursive' })] }), /unsupported/);
  invalid(
    open({ schemaVersion: 1, faces: [{ ...face(), style: 'italic' }] }),
    /unknown field style/,
  );
  invalid(open({ schemaVersion: 1, faces: [face(), face({ language: 'ja' })] }), /duplicate/);
});

test('faces added to an open session keep their order and may share a role', () => {
  const second = face({ expectedSha256: SANS });
  const prepared = prepareHostFontFaces([second, face()]);
  assert.deepEqual(
    prepared.expectedFaces.map((expected) => expected.sha256),
    [SANS, SERIF],
  );
  assert.deepEqual(prepared.faceBytes, [second.bytes, face().bytes]);

  const transferred = prepareHostFontFaces([face({ bytes: new ArrayBuffer(4) })], 'arrayBuffer');
  assert.equal(transferred.faceBytes[0].byteLength, 4);
});

test('added faces are refused when empty, repeated or malformed', () => {
  invalid(() => prepareHostFontFaces([]), /non-empty array/);
  invalid(() => prepareHostFontFaces('face'), /non-empty array/);
  invalid(() => prepareHostFontFaces([face(), face()]), /repeat a SHA-256/);
  invalid(() => prepareHostFontFaces([face()], 'arrayBuffer'), /ArrayBuffer/);
});
