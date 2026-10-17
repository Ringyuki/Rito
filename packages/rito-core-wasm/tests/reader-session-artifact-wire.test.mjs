// Decodes the artifact the live Rust encoder wrote (tests/fixtures/*.hex,
// kept in step by crates/rito-core's
// cross_language_artifact_fixture_matches_the_encoder test). A hand-built
// fixture can agree with a stale reading of the wire; these bytes cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeRitoReaderArtifact } from '../src/reader-session-artifact-decoder-runtime.js';

function artifactFixture() {
  const hex = readFileSync(
    new URL('./fixtures/reader-session-artifact.hex', import.meta.url),
    'utf8',
  ).trim();
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

test('decodes the artifact the Rust encoder writes, every hit field included', () => {
  const artifact = decodeRitoReaderArtifact(artifactFixture());

  assert.equal(artifact.protocolVersion, 7);
  assert.equal(artifact.localSpreadIndex, 5);
  assert.deepEqual(artifact.localPageIndexes, [9, 10]);
  assert.equal(artifact.bookPageIndex, 140);
  assert.equal(artifact.bookPageCount, 312);
  assert.equal(artifact.displayList.commandCount, 14);
  assert.equal(artifact.pages.length, 1);
  assert.deepEqual(artifact.pages[0].hits, [
    {
      pageIndex: 9,
      bounds: { x: 11.5, y: 12.5, width: 120, height: 24 },
      kind: 'footnote-pending',
      text: '次へ',
      href: 'chapter-02.xhtml',
      sourcePoint: { nodePath: [1, 2, 3], textOffset: 5n },
      targetLocator: {
        href: 'Text/chapter-02.xhtml',
        anchorId: 'fn7',
        sourcePoint: undefined,
        sourceRange: undefined,
        progression: undefined,
      },
      destinationLabel: '第二章',
      imageSrc: 'images/next.png',
      imageAlt: '次章',
      footnoteKey: 'Text/chapter-02.xhtml#fn7',
    },
  ]);
});

test('an artifact rejects every truncated prefix and an unknown hit kind', () => {
  const bytes = artifactFixture();
  for (const length of [0, 8, 20, 64, 200, bytes.byteLength - 1]) {
    assert.throws(() => decodeRitoReaderArtifact(bytes.subarray(0, length)));
  }
  // The hit's kind byte follows its page index and four f64 bounds.
  const text = new TextEncoder().encode('次へ');
  let at = -1;
  for (let index = 0; index + text.length <= bytes.byteLength; index += 1) {
    if (text.every((byte, offset) => bytes[index + offset] === byte)) {
      at = index;
      break;
    }
  }
  assert.ok(at > 5, 'the fixture holds the hit text');
  const kindOffset = at - 4 - 1;
  assert.equal(bytes[kindOffset], 4);
  const unknown = bytes.slice();
  unknown[kindOffset] = 9;
  assert.throws(() => decodeRitoReaderArtifact(unknown), /hit kind/);
});
