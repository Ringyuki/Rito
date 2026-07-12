import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  handle,
  revisionBundle,
  startRequest,
  summary,
  versioned,
  versionedSummary,
} from './reader-bounded-session-fixture.mjs';

test('bounded snapshots include the exact partial revision bundle with TOC targets', async () => {
  const includeTocTargets = [];
  const partialEntries = {
    'chapter.xhtml': {
      href: 'chapter.xhtml',
      normalizedText: 'partial',
      spans: [
        {
          nodePath: [0],
          sourceStart: 0,
          sourceEnd: 7,
          normalizedStart: 0,
          normalizedEnd: 7,
        },
      ],
    },
  };
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    bundle: async (value, extent, includeTargets) => {
      includeTocTargets.push(includeTargets);
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      const navigation = { revisionId: value.revisionId, ...extent };
      return {
        revision: value,
        value: revisionBundle(revision, navigation, partialEntries),
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const snapshot = await session.start(startRequest(0));

  assert.deepEqual(snapshot.bundle.revision, snapshot.revision);
  assert.equal(snapshot.navigation, snapshot.bundle.navigation);
  assert.deepEqual(snapshot.bundle.chapterTextIndices.entries, partialEntries);
  assert.deepEqual(includeTocTargets, [true]);
  await session.dispose();
});

test('a target race publishes one exact bundle only for the latest snapshot request', async () => {
  const bundleStarted = deferred();
  const bundleAllowed = deferred();
  let bundleCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    bundle: async (value, extent) => {
      bundleCount += 1;
      bundleStarted.resolve();
      await bundleAllowed.promise;
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      return {
        revision: value,
        value: revisionBundle(revision, { revisionId: value.revisionId, ...extent }),
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const first = session.start(startRequest(0));
  await bundleStarted.promise;
  const latest = session.ensureSpread(2);
  bundleAllowed.resolve();
  const [firstSnapshot, latestSnapshot] = await Promise.all([first, latest]);

  assert.equal(bundleCount, 1);
  assert.equal(firstSnapshot.requestedSpreadIndex, 2);
  assert.equal(latestSnapshot.requestedSpreadIndex, 2);
  assert.deepEqual(firstSnapshot.bundle.revision, firstSnapshot.revision);
  await session.dispose();
});

test('bounded session coalesces concurrent targets around the latest request', async () => {
  const created = deferred();
  const accepted = [];
  const calls = [];
  let activeContinuations = 0;
  let maximumActiveContinuations = 0;
  let yieldCount = 0;
  const client = fixtureClient({
    create: () => created.promise,
    continue: async (request) => {
      activeContinuations += 1;
      maximumActiveContinuations = Math.max(maximumActiveContinuations, activeContinuations);
      calls.push(['continue', request.revisionVersion]);
      try {
        const version = request.revisionVersion + 1;
        return versioned(advance(version, version + 1, version < 2));
      } finally {
        activeContinuations -= 1;
      }
    },
    warm: (_handle, spreadIndex) => {
      calls.push(['warm', spreadIndex]);
      return { spreadIndex };
    },
    releaseTransfers: (value) => calls.push(['releaseTransfers', value.revisionVersion]),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {
      yieldCount += 1;
    },
    onAcceptedRevision: (event) => accepted.push(event.revision.revisionVersion),
  });

  const started = session.start(startRequest(0));
  const second = session.ensureSpread(2);
  const first = session.ensureSpread(1);
  created.resolve(versioned(advance(0, 1, true)));
  const snapshots = await Promise.all([started, first, second]);

  assert.ok(snapshots.every((snapshot) => snapshot.requestedSpreadIndex === 1));
  assert.ok(snapshots.every((snapshot) => snapshot.frameWindow.spreadIndex === 1));
  assert.deepEqual(accepted, [0, 1]);
  assert.equal(maximumActiveContinuations, 1);
  assert.equal(yieldCount, 1);
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'warm'),
    [['warm', 1]],
  );
  assert.deepEqual(
    calls.filter(([kind]) => kind === 'releaseTransfers' || kind === 'continue'),
    [
      ['releaseTransfers', 0],
      ['continue', 0],
    ],
  );
});

test('a far target reads one final bundle and a later lower target reuses it', async () => {
  const warmed = [];
  let continueCount = 0;
  let bundleCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    continue: async (request) => {
      continueCount += 1;
      const version = request.revisionVersion + 1;
      return versioned(advance(version, version === 1 ? 6 : 11, true));
    },
    warm: (_handle, spreadIndex) => {
      warmed.push(spreadIndex);
      return { spreadIndex };
    },
    bundle: async (value, extent) => {
      bundleCount += 1;
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      return {
        revision: value,
        value: revisionBundle(revision, { revisionId: value.revisionId, ...extent }),
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  const high = await session.start(startRequest(10));
  const low = await session.ensureSpread(2);

  assert.equal(high.requestedSpreadIndex, 10);
  assert.equal(high.frameWindow.spreadIndex, 10);
  assert.equal(low.requestedSpreadIndex, 2);
  assert.equal(low.frameWindow.spreadIndex, 2);
  assert.equal(low.revision.revisionVersion, high.revision.revisionVersion);
  assert.equal(continueCount, 2);
  assert.equal(bundleCount, 1);
  assert.deepEqual(warmed, [10, 2]);
  await session.dispose();
});

test('a pending far target yields to a latest near target without another layout quantum', async () => {
  const releaseStarted = deferred();
  const releaseAllowed = deferred();
  let continueCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    continue: async () => {
      continueCount += 1;
      return versioned(advance(1, 11, true));
    },
    releaseTransfers: async () => {
      releaseStarted.resolve();
      await releaseAllowed.promise;
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  const far = session.start(startRequest(10));
  await releaseStarted.promise;
  const near = session.ensureSpread(2);
  releaseAllowed.resolve();
  const [farSnapshot, nearSnapshot] = await Promise.all([far, near]);

  assert.equal(continueCount, 0);
  assert.equal(farSnapshot.requestedSpreadIndex, 2);
  assert.equal(nearSnapshot.requestedSpreadIndex, 2);
  assert.equal(nearSnapshot.frameWindow.spreadIndex, 2);
  await session.dispose();
});

test('cancel and dispose drain an in-flight quantum before exact cleanup', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const continued = deferred();
    const continueStarted = deferred();
    const accepted = [];
    const cancelled = [];
    const released = [];
    const releasedTransfers = [];
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, true)),
      continue: async () => {
        continueStarted.resolve();
        return continued.promise;
      },
      cancel: async (value) => {
        cancelled.push(value);
        return versionedSummary(summary(value.revisionVersion + 1, 'cancelled', 2));
      },
      release: async (value) => released.push(value),
      releaseTransfers: async (value) => releasedTransfers.push(value),
    });
    const session = createRitoCoreWasmBoundedReaderSession(client, {
      yieldControl: async () => {},
      onAcceptedRevision: (event) => accepted.push(event.revision.revisionVersion),
    });

    const started = session.start(startRequest(3));
    await continueStarted.promise;
    const stopping = session[operation]();
    continued.resolve(versioned(advance(1, 2, true)));
    await stopping;
    await assert.rejects(started, /stopped/);

    assert.deepEqual(accepted, [0, 1, 2]);
    assert.deepEqual(cancelled, [handle(1)]);
    assert.deepEqual(released, [handle(2)]);
    assert.deepEqual(releasedTransfers, [handle(0), handle(1)]);
    assert.equal(session.currentSnapshot(), undefined);
  }
});

test('failed continuation metadata becomes the exact handle released by the session', async () => {
  const failed = summary(1, 'failed', 1);
  const released = [];
  const cancelled = [];
  const accepted = [];
  const failure = Object.assign(new Error('layout failed'), {
    code: 'engine-error',
    revision: failed,
  });
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async () => {
      throw failure;
    },
    cancel: async (value) => cancelled.push(value),
    release: async (value) => released.push(value),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
    onAcceptedRevision: (event) => accepted.push(event.revision.revisionVersion),
  });

  await assert.rejects(session.start(startRequest(2)), /layout failed/);
  assert.deepEqual(accepted, [0, 1]);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(released, [handle(1)]);
});

test('failed revision cleanup survives an accepted-revision observer failure', async () => {
  const failed = summary(1, 'failed', 1);
  const released = [];
  const failure = Object.assign(new Error('layout failed'), {
    code: 'engine-error',
    revision: failed,
  });
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async () => {
      throw failure;
    },
    release: async (value) => released.push(value),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
    onAcceptedRevision: ({ revision }) => {
      if (revision.status === 'failed') throw new Error('observer failed');
    },
  });

  await assert.rejects(session.start(startRequest(2)), /layout failed/);
  assert.deepEqual(released, [handle(1)]);
});

test('complete short and empty revisions settle out-of-range targets without a frame', async () => {
  for (const spreadCount of [1, 0]) {
    let warmCount = 0;
    let continueCount = 0;
    const client = fixtureClient({
      create: async () => versioned(advance(0, spreadCount, false)),
      continue: async () => {
        continueCount += 1;
      },
      warm: () => {
        warmCount += 1;
      },
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    const snapshot = await session.start(startRequest(10));

    assert.equal(snapshot.revision.status, 'complete');
    assert.equal(snapshot.requestedSpreadIndex, 10);
    assert.equal(snapshot.frameWindow, undefined);
    assert.equal(warmCount, 0);
    assert.equal(continueCount, 0);
    await session.dispose();
  }
});
