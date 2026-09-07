// The frame command buffer a reader worker hands the host: RITODL1 format-2
// bytes beside the metadata that names the semantic frame they were
// lowered from. The decoder refuses any pair whose header and metadata
// disagree, so a buffer never paints under another frame's name.
import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeRitoFrameCommandBuffer } from '../src/frame-command-buffer-decoder-runtime.js';
import { primitiveListFixture } from './reader-v1-primitive-list-wire.test.mjs';

function metadataFor(bytes, overrides = {}) {
  return {
    protocolVersion: 2,
    ratio: 2,
    commandCount: 4,
    commandCounts: { pushState: 1, paintBlock: 1, paintText: 1, paintImage: 1 },
    primitiveCount: 13,
    byteLength: bytes.byteLength,
    commandHash: 'semantic-hash',
    resourceRefCount: 2,
    resourceTable: ['images/background.png', 'images/cover.jpg'],
    fontFamilies: ['Rito Serif'],
    imageDominated: false,
    ...overrides,
  };
}

test('decodes the primitive list behind matching metadata', () => {
  const bytes = primitiveListFixture();
  const decoded = decodeRitoFrameCommandBuffer(metadataFor(bytes), bytes);
  assert.equal(decoded.protocolVersion, 2);
  assert.equal(decoded.ratio, 2);
  assert.equal(decoded.commandCount, 4);
  assert.equal(decoded.primitiveCount, 13);
  assert.equal(decoded.commandHash, 'semantic-hash');
  assert.deepEqual(decoded.resourceTable, ['images/background.png', 'images/cover.jpg']);
  assert.equal(decoded.commands.length, 13);
  assert.equal(decoded.commands[11].kind, 'text');
});

test('refuses metadata that disagrees with the bytes', () => {
  const bytes = primitiveListFixture();
  const cases = [
    [{ protocolVersion: 1 }, /Unsupported Rito frame command buffer version: 1/],
    [{ ratio: 1 }, /header ratio does not match/],
    [{ ratio: 0 }, /Invalid Rito frame command buffer ratio/],
    [{ primitiveCount: 12 }, /primitive count does not match/],
    [{ byteLength: bytes.byteLength - 1 }, /byte length mismatch/],
    [{ commandCounts: { pushState: 1 } }, /command counts total mismatch/],
    [{ resourceTable: [1] }, /resource table entry 0 must be a string/],
  ];
  for (const [overrides, message] of cases) {
    assert.throws(
      () => decodeRitoFrameCommandBuffer(metadataFor(bytes, overrides), bytes),
      message,
    );
  }
  const wrongMagic = Uint8Array.from(bytes);
  wrongMagic[0] = 0x58;
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadataFor(wrongMagic), wrongMagic),
    /Invalid Rito frame command buffer magic/,
  );
  const short = bytes.subarray(0, 12);
  assert.throws(
    () => decodeRitoFrameCommandBuffer(metadataFor(short), short),
    /shorter than its header/,
  );
});
