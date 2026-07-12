import assert from 'node:assert/strict';
import { test } from 'node:test';

import { requireRequiredFontFaces } from '../dist/required-font-faces-validation-runtime.js';

const FACE = {
  family: 'Book',
  href: 'fonts/book.ttf',
  style: 'normal',
  weight: 400,
  shapeFingerprint: '0123456789abcdef',
  byteLength: 4,
  sourceOrder: 1,
};

test('required font manifests validate their exact revision-bound contract', () => {
  const manifest = { schemaVersion: 1, revisionId: 'rev-1', faces: [FACE] };
  assert.equal(requireRequiredFontFaces(undefined, 'rev-1', 'revision'), undefined);
  assert.equal(requireRequiredFontFaces(manifest, 'rev-1', 'revision'), manifest);
});

test('required font manifests reject malformed identity, fields, descriptors, and order', () => {
  const malformed = [
    { schemaVersion: 2, revisionId: 'rev-1', faces: [FACE] },
    { schemaVersion: 1, revisionId: 'rev-other', faces: [FACE] },
    { schemaVersion: 1, revisionId: 'rev-1', faces: {}, extra: true },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, extra: true }] },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, family: '' }] },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, href: '' }] },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, style: 'auto' }] },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, weight: 0 }] },
    {
      schemaVersion: 1,
      revisionId: 'rev-1',
      faces: [{ ...FACE, shapeFingerprint: 'ABCDEF0123456789' }],
    },
    { schemaVersion: 1, revisionId: 'rev-1', faces: [{ ...FACE, byteLength: 0 }] },
    {
      schemaVersion: 1,
      revisionId: 'rev-1',
      faces: [FACE, { ...FACE, sourceOrder: 1 }],
    },
  ];
  for (const manifest of malformed) {
    assert.throws(() => requireRequiredFontFaces(manifest, 'rev-1', 'revision'));
  }
});
