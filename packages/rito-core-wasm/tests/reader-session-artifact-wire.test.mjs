// Decodes the artifact the live Rust encoder wrote (tests/fixtures/*.hex,
// kept in step by crates/rito-core's
// cross_language_artifact_fixture_matches_the_encoder test). A hand-built
// fixture can agree with a stale reading of the wire; these bytes cannot.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodeRitoReaderArtifact,
  decodeRitoReaderPageRecords,
} from '../src/reader-session-artifact-decoder-runtime.js';

function fixture(name) {
  const hex = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').trim();
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
}

const artifactFixture = () => fixture('reader-session-artifact.hex');
const pageRecordsFixture = () => fixture('reader-session-page-records.hex');

test('decodes the artifact the Rust encoder writes, its pages by index and size', () => {
  const artifact = decodeRitoReaderArtifact(artifactFixture());

  assert.equal(artifact.protocolVersion, 7);
  assert.equal(artifact.localSpreadIndex, 5);
  assert.deepEqual(artifact.localPageIndexes, [9, 10]);
  assert.equal(artifact.bookPageIndex, 140);
  assert.equal(artifact.bookPageCount, 312);
  assert.equal(artifact.displayList.commandCount, 14);
  assert.deepEqual(artifact.pages, [{ pageIndex: 9, width: 400.25, height: 1194.25 }]);
});

test('decodes the page records the Rust encoder writes, every hit field included', () => {
  const records = decodeRitoReaderPageRecords(pageRecordsFixture());

  assert.equal(records.artifactId, (1n << 52n) + 11n);
  assert.equal(records.pageIndex, 9);
  assert.equal(records.text, '吾輩は猫である。');
  assert.equal(records.textLength, 9n);
  assert.deepEqual(records.textRuns, [
    { start: 0n, end: 9n, blockIndex: 4294967295, lineIndex: 2, runIndex: 3 },
  ]);
  assert.deepEqual(records.hits, [
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

test('an artifact rejects every truncated prefix', () => {
  const bytes = artifactFixture();
  for (const length of [0, 8, 20, 64, 200, bytes.byteLength - 1]) {
    assert.throws(() => decodeRitoReaderArtifact(bytes.subarray(0, length)));
  }
});

test('page records reject every truncated prefix and an unknown hit kind', () => {
  const bytes = pageRecordsFixture();
  for (let length = 0; length < bytes.byteLength; length += 1) {
    assert.throws(() => decodeRitoReaderPageRecords(bytes.subarray(0, length)));
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
  assert.throws(() => decodeRitoReaderPageRecords(unknown), /hit kind/);
});
