import assert from 'node:assert/strict';
import { test } from 'node:test';

import { versionedReaderWorkerPayload } from '../dist/reader-worker-versioned-payload-runtime.js';

test('page target destination labels require an internal link destination', () => {
  const accepted = dispatch(pageTarget());
  assert.equal(accepted.result.entries[0].destinationLabel, 'Introduction');

  for (const target of [
    pageTarget({ kind: 'text', href: undefined, targetLocator: undefined }),
    pageTarget({ targetLocator: undefined }),
    pageTarget({ href: 'https://example.test/chapter' }),
    pageTarget({ href: '//example.test/chapter' }),
  ]) {
    assert.throws(() => dispatch(target), /destination label for a non-internal link target/);
  }
});

function dispatch(target) {
  const revision = { revisionId: 'rev-1', revisionVersion: 1 };
  return versionedReaderWorkerPayload(
    {
      getPageTargetsAtRevision: () => ({
        revision,
        value: {
          revisionId: revision.revisionId,
          pageIndex: 0,
          spreadIndex: 0,
          entryCount: 1,
          textHash: 'page-hash',
          entries: [target],
        },
      }),
    },
    { kind: 'getPageTargetsAtRevision', revision, pageIndex: 0 },
  );
}

function pageTarget(overrides = {}) {
  return {
    kind: 'link',
    bounds: { x: 1, y: 2, width: 20, height: 10 },
    blockIndex: 0,
    lineIndex: 0,
    runIndex: 0,
    label: 'intro',
    destinationLabel: 'Introduction',
    text: { hash: 'text-hash', length: 5 },
    href: '#intro',
    targetLocator: { href: 'Text/chapter.xhtml', anchorId: 'intro' },
    ...overrides,
  };
}
