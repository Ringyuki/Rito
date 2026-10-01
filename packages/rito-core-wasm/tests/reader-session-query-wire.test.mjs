import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodeRitoReaderAnnotationResponse,
  decodeRitoReaderExactSourceRangeResolution,
  decodeRitoReaderFootnote,
  decodeRitoReaderNavigationResult,
  decodeRitoReaderSearchResponse,
  decodeRitoReaderTextInteractionResponse,
  decodeRitoReaderTextRangeGeometry,
} from '../src/reader-session-query-decoder-runtime.js';
import {
  encodeRitoReaderAnnotationRequest,
  encodeRitoReaderExactSourceRangeRequest,
  encodeRitoReaderNavigationRequest,
  encodeRitoReaderSearchRequest,
  encodeRitoReaderTextInteractionRequest,
  encodeRitoReaderTextRangeRequest,
} from '../src/reader-session-query-request-runtime.js';

// The bytes are the Rust encoder's output, read from the Rust tests that
// pin them, so this mirror can never drift onto bytes only it produces.
const SESSION = new URL('../../../crates/rito-core/src/runtime/reader_session/', import.meta.url);
const RUST_FIXTURES = [
  readFileSync(new URL('interaction_tests.rs', SESSION), 'utf8'),
  readFileSync(new URL('wire/query_tests.rs', SESSION), 'utf8'),
].join('\n');

function rustHex(name) {
  const match = new RegExp(`const ${name}: &str =\\s*(concat!\\(([^)]*)\\)|"([0-9a-f]*)")`).exec(
    RUST_FIXTURES,
  );
  if (!match) throw new Error(`Rust fixture ${name} is missing`);
  const hex = match[3] ?? [...match[2].matchAll(/"([0-9a-f]*)"/g)].map((part) => part[1]).join('');
  return Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

const point = (textOffset) => ({ nodePath: [1, 0, 4], textOffset: BigInt(textOffset) });
const position = (charIndex) => ({ blockIndex: 3, lineIndex: 2, runIndex: 1, charIndex });

test('search and text range requests encode to the Rust bytes', () => {
  assert.deepEqual(
    encodeRitoReaderSearchRequest({
      sessionId: 7n,
      artifactId: 9n,
      query: '雪',
      caseSensitive: true,
      wholeWord: false,
      limit: 5,
    }),
    rustHex('SEARCH_REQUEST_HEX'),
  );
  assert.deepEqual(
    encodeRitoReaderTextRangeRequest({
      sessionId: 7n,
      artifactId: 9n,
      pageIndex: 4,
      start: position(6),
      end: position(20),
    }),
    rustHex('TEXT_RANGE_REQUEST_HEX'),
  );
  assert.deepEqual(
    encodeRitoReaderExactSourceRangeRequest({
      sessionId: 7n,
      artifactId: 9n,
      href: 'OEBPS/chapter-2.xhtml',
      range: { start: point(12), end: point(31) },
    }),
    rustHex('EXACT_SOURCE_RANGE_REQUEST_HEX'),
  );
});

test('search, geometry, footnote and exact range responses decode from the Rust bytes', () => {
  const search = decodeRitoReaderSearchResponse(rustHex('SEARCH_RESPONSE_HEX'));
  assert.equal(search.artifactId, 9n);
  assert.equal(search.query, '雪');
  assert.equal(search.truncated, true);
  assert.equal(search.searchedPageCount, 42);
  assert.deepEqual(search.results[0], {
    pageIndex: 4,
    spreadIndex: 2,
    start: position(6),
    end: position(7),
    context: '…初雪が…',
    locator: {
      href: 'OEBPS/chapter-2.xhtml',
      anchorId: undefined,
      sourcePoint: point(12),
      sourceRange: undefined,
      progression: undefined,
    },
  });

  assert.deepEqual(decodeRitoReaderTextRangeGeometry(rustHex('TEXT_RANGE_GEOMETRY_HEX')), {
    artifactId: 9n,
    pageIndex: 4,
    rects: [
      {
        bounds: { x: 12.5, y: 40, width: 96.25, height: 18 },
        blockIndex: 3,
        lineIndex: 2,
        runIndex: 1,
        startCharIndex: 6,
        endCharIndex: 20,
      },
    ],
  });

  assert.deepEqual(decodeRitoReaderFootnote(rustHex('FOOTNOTE_HEX')), {
    artifactId: 9n,
    key: 'OEBPS/notes.xhtml#n1',
    kind: 'endnote',
    text: 'A note.',
    html: '<p>A note.</p>',
  });

  const exact = decodeRitoReaderExactSourceRangeResolution(
    rustHex('EXACT_SOURCE_RANGE_RESOLUTION_HEX'),
  );
  assert.equal(exact.status, 'resolved');
  assert.equal(exact.firstPageIndex, 3);
  assert.equal(exact.selectedText, 'the quoted words');
  assert.deepEqual(exact.rects[0], {
    pageIndex: 3,
    bounds: { x: 12.5, y: 40, width: 88.25, height: 18 },
    blockIndex: 2,
    lineIndex: 1,
    runIndex: 0,
    startCharIndex: 4,
    endCharIndex: 20,
  });
  assert.equal(exact.rects[1].pageIndex, 4);
  assert.equal(exact.rects[1].endCharIndex, 6);
});

test('text interaction messages match the Rust bytes', () => {
  assert.deepEqual(
    encodeRitoReaderTextInteractionRequest({
      sessionId: 7n,
      artifactId: 9n,
      query: {
        kind: 'movement',
        anchor: {
          pageIndex: 3,
          position: { blockIndex: 2, lineIndex: 1, runIndex: 0, charIndex: 4 },
          affinity: 'downstream',
        },
        focus: {
          pageIndex: 4,
          position: { blockIndex: 0, lineIndex: 0, runIndex: 1, charIndex: 6 },
          affinity: 'upstream',
        },
        movement: 'line-down',
        preferredInlinePosition: 120.5,
      },
    }),
    rustHex('MOVEMENT_HEX'),
  );
  assert.deepEqual(
    encodeRitoReaderTextInteractionRequest({
      sessionId: 7n,
      artifactId: 9n,
      query: {
        kind: 'range-from-points',
        anchor: { pageIndex: 3, x: 12.5, y: 40 },
        focus: { pageIndex: 3, x: 20, y: 41 },
        granularity: 'paragraph',
      },
    }),
    rustHex('POINTS_HEX'),
  );

  const response = decodeRitoReaderTextInteractionResponse(rustHex('SELECTION_HEX'));
  assert.equal(response.artifactId, 9n);
  assert.equal(response.result.kind, 'selection');
  const { anchorCaret, focusCaret, selection } = response.result;
  assert.deepEqual(anchorCaret, {
    address: {
      pageIndex: 3,
      position: { blockIndex: 2, lineIndex: 1, runIndex: 0, charIndex: 4 },
      affinity: 'downstream',
    },
    geometry: { x: 12.5, y: 40, height: 18 },
    href: 'OEBPS/chapter-2.xhtml',
    sourcePoint: point(12),
  });
  assert.equal(focusCaret, undefined);
  assert.equal(selection.selectedText, 'the quoted words');
  assert.equal(selection.focus.affinity, 'upstream');
  assert.deepEqual(selection.sourceEnd, point(28));
  assert.equal(selection.rects[0].bounds.width, 88.25);
  assert.equal(response.result.preferredInlinePosition, 120.5);
  assert.equal(response.result.preferredBlockPosition, 300.25);
});

test('annotation messages match the Rust bytes', () => {
  assert.deepEqual(
    encodeRitoReaderAnnotationRequest({
      sessionId: 7n,
      query: {
        kind: 'create',
        href: 'OEBPS/chapter-2.xhtml',
        range: { start: point(12), end: point(28) },
      },
    }),
    rustHex('CREATE_HEX'),
  );
  const response = decodeRitoReaderAnnotationResponse(rustHex('QUOTE_HEX'));
  assert.equal(response.level, 'quote');
  assert.equal(
    response.target.json,
    '{"version":1,"href":"OEBPS/chapter-2.xhtml","sourceRange":{"start":{"nodePath":[1,0,4],"textOffset":12},"end":{"nodePath":[1,0,4],"textOffset":28}},"quote":{"exact":"the quoted words","prefix":"Before ","suffix":" after"},"position":{"start":12,"end":28,"chapterLength":34}}',
  );
  assert.deepEqual(response.target.sourceRange, { start: point(12), end: point(28) });
  assert.equal(response.target.prefix, 'Before ');
  assert.equal(response.target.chapterLength, 34n);
});

test('navigation messages match the Rust bytes', () => {
  assert.deepEqual(
    encodeRitoReaderNavigationRequest({
      sessionId: 7n,
      query: {
        kind: 'locate',
        artifactId: 9n,
        locator: { href: 'OEBPS/chapter-2.xhtml', anchorId: 'note-4', progression: 0.25 },
      },
    }),
    rustHex('LOCATE_HEX'),
  );
  assert.deepEqual(
    encodeRitoReaderNavigationRequest({
      sessionId: 7n,
      query: {
        kind: 'compare',
        firstHref: 'OEBPS/chapter-2.xhtml',
        first: point(12),
        secondHref: 'OEBPS/chapter-3.xhtml',
        second: { nodePath: [0], textOffset: 0n },
      },
    }),
    rustHex('COMPARE_HEX'),
  );
  assert.deepEqual(decodeRitoReaderNavigationResult(rustHex('LOCATION_HEX')), {
    kind: 'location',
    location: { kind: 'page', pageIndex: 5, drawn: true, matchedBy: 'anchor' },
  });
  assert.deepEqual(decodeRitoReaderNavigationResult(rustHex('TOC_HEX')), {
    kind: 'toc-entry',
    tocId: 3,
  });
});

test('query decoders reject truncation and trailing bytes', () => {
  const decoders = [
    [decodeRitoReaderSearchResponse, 'SEARCH_RESPONSE_HEX'],
    [decodeRitoReaderTextRangeGeometry, 'TEXT_RANGE_GEOMETRY_HEX'],
    [decodeRitoReaderFootnote, 'FOOTNOTE_HEX'],
    [decodeRitoReaderTextInteractionResponse, 'SELECTION_HEX'],
    [decodeRitoReaderAnnotationResponse, 'QUOTE_HEX'],
    [decodeRitoReaderNavigationResult, 'LOCATION_HEX'],
  ];
  for (const [decode, name] of decoders) {
    const bytes = rustHex(name);
    assert.throws(() => decode(bytes.subarray(0, bytes.length - 1)), /total length|truncated/);
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes);
    new DataView(padded.buffer).setBigUint64(12, BigInt(padded.length), true);
    assert.throws(() => decode(padded), /trailing bytes/);
  }
});
