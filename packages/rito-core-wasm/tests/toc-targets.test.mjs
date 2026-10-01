import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmDocumentRuntime } from '../dist/core-wasm-document-runtime.js';
import { findRitoCoreWasmReaderActiveTocEntry } from '../dist/reader-navigation-runtime.js';

const { RitoCoreWasmDocument } = createRitoCoreWasmDocumentRuntime(
  async () => {},
  () => {
    throw new Error('fixture constructs the wrapped document directly');
  },
);

const entry = (label) => ({ label, href: `${label}.xhtml`, children: [] });

function tocTargets(activeEntryByPage) {
  return {
    revisionId: 'rev-1',
    targets: [
      { tocIndex: 0, entry: entry('one'), pageIndex: 0, spreadIndex: 0 },
      { tocIndex: 2, entry: entry('two'), pageIndex: 1, spreadIndex: 0 },
    ],
    activeEntryByPage,
  };
}

test('the active entry is looked up, never re-derived', () => {
  // The engine names entry 2 for page 0 here; a re-derived "last target at
  // or before the page" would have said entry 0.
  const targets = tocTargets([2, null]);
  assert.equal(findRitoCoreWasmReaderActiveTocEntry(targets, 0)?.label, 'two');
  assert.equal(findRitoCoreWasmReaderActiveTocEntry(targets, 1), undefined);
  assert.equal(findRitoCoreWasmReaderActiveTocEntry(targets, 7), undefined);
});

test('presentations reject TOC tables the engine could not have written', () => {
  const read = (tocTargetsValue) =>
    new RitoCoreWasmDocument({
      getRevisionPresentationAtRevisionJson: () =>
        JSON.stringify({ revision: handle(), value: presentation(tocTargetsValue) }),
    }).getRevisionPresentationAtRevision(handle());

  assert.doesNotThrow(() => read(tocTargets([0, 2])));
  assert.doesNotThrow(() => read({ ...tocTargets([]), targets: [] }));
  assert.throws(() => read(tocTargets([0])), /malformed active TOC entries/);
  assert.throws(() => read(tocTargets([0, 1])), /did not place/);
  const unordered = tocTargets([0, 2]);
  assert.throws(
    () => read({ ...unordered, targets: [...unordered.targets].reverse() }),
    /out of TOC order/,
  );
});

function handle() {
  return { revisionId: 'rev-1', revisionVersion: 1 };
}

function presentation(tocTargetsValue) {
  return {
    revision: {
      revisionId: 'rev-1',
      revisionVersion: 1,
      layoutKey: 'layout',
      pageCount: 2,
      spreadCount: 1,
    },
    navigation: {
      revisionId: 'rev-1',
      pageCount: 2,
      spreadCount: 1,
      spreads: [{ spreadIndex: 0, pageIndexes: [0, 1], leftPageIndex: 0, rightPageIndex: 1 }],
      chapters: [],
      chapterMap: {},
    },
    tocTargets: tocTargetsValue,
    fontFamilies: [],
  };
}
