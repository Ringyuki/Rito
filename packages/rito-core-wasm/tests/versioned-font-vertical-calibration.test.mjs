import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createVersionedReaderClientMethods } from '../src/reader-worker-versioned-client-runtime.js';
import { versionedReaderWorkerPayload } from '../src/reader-worker-versioned-payload-runtime.js';

const SAMPLE = {
  fontFamily: 'Book',
  fontStyle: 'normal',
  fontWeight: 400,
  fontSizePx: 16,
  topBaselineAscentPx: 3,
  topBaselineDescentPx: 14,
};

test('versioned vertical calibration advances once and releases predecessor transfers', async () => {
  const calls = [];
  let transferReleaseCount = 0;
  const previous = handle(0);
  const next = handle(1);
  const document = {
    calibrateRevisionFontVerticalMetrics(request) {
      calls.push(['calibrate', request]);
      transferReleaseCount += 1;
      return {
        revision: summary(1),
        continuation: { ...next, cursor: 'cursor-2' },
        calibratedPublishedRunCount: 2,
        calibratedUnpublishedRunCount: 3,
        releasedRevision: previous,
        releasedTransferCount: 4,
      };
    },
    releaseRevisionTransfersAtRevision() {
      transferReleaseCount += 1;
      return { revision: previous, value: 0 };
    },
    releaseRevisionAtRevision() {
      throw new Error('valid calibration must not roll back');
    },
  };
  const send = async (request) => versionedReaderWorkerPayload(document, request);
  const client = createVersionedReaderClientMethods(send, () => undefined);

  const calibrated = await client.calibrateRevisionFontVerticalMetrics({
    ...previous,
    continuation: { ...previous, cursor: 'cursor-1' },
    fontVerticalMetrics: [SAMPLE],
  });

  assert.deepEqual(calibrated, {
    revision: next,
    value: {
      revision: summary(1),
      continuation: { ...next, cursor: 'cursor-2' },
      calibratedPublishedRunCount: 2,
      calibratedUnpublishedRunCount: 3,
      releasedRevision: previous,
      releasedTransferCount: 4,
    },
  });
  assert.equal(calls[0][0], 'calibrate');
  assert.deepEqual(calls[0][1].continuation, { ...previous, cursor: 'cursor-1' });
  assert.equal(calls.length, 1);
  assert.equal(transferReleaseCount, 1);
});

function handle(revisionVersion) {
  return { revisionId: 'revision', revisionVersion };
}

function summary(revisionVersion) {
  const knownExtent = { pageCount: 1, spreadCount: 1 };
  return {
    ...handle(revisionVersion),
    layoutKey: 'layout',
    status: 'ready',
    knownExtent,
    pageCount: 1,
    spreadCount: 1,
  };
}
