import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  handle,
  revisionNavigation,
  revisionPresentation,
  startRequest,
  summary,
  versioned,
  versionedSummary,
} from './reader-bounded-session-fixture.mjs';

test('bounded snapshots include exact slim presentation metadata', async () => {
  let presentationCount = 0;
  const fontVerticalMetricDemands = [
    { fontFamily: 'serif', fontStyle: 'normal', fontWeight: 400, fontSizePx: 32 },
  ];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    presentation: async (value, extent) => {
      presentationCount += 1;
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      const navigation = revisionNavigation(value.revisionId, extent);
      return {
        revision: value,
        value: {
          ...revisionPresentation(revision, navigation),
          fontVerticalMetricDemands,
        },
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const snapshot = await session.start(startRequest(0));

  assert.deepEqual(snapshot.presentation.revision, snapshot.revision);
  assert.equal(snapshot.navigation, snapshot.presentation.navigation);
  assert.equal('footnotes' in snapshot.presentation, false);
  assert.equal('chapterTextIndices' in snapshot.presentation, false);
  assert.deepEqual(snapshot.presentation.fontVerticalMetricDemands, fontVerticalMetricDemands);
  assert.equal(presentationCount, 1);
  await session.dispose();
});

test('vertical calibration advances the owner and refreshes its current target snapshot', async () => {
  const accepted = [];
  const requests = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
  });
  const calibrate = client.calibrateRevisionFontVerticalMetrics;
  client.calibrateRevisionFontVerticalMetrics = async (request) => {
    requests.push(request);
    return calibrate(request);
  };
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    onAcceptedRevision: ({ revision }) => accepted.push(revision.revisionVersion),
  });
  const initial = await session.start(startRequest(0));

  const calibrated = await session.calibrateFontVerticalMetrics([
    {
      fontFamily: 'Book',
      fontStyle: 'normal',
      fontWeight: 400,
      fontSizePx: 16,
      topBaselineAscentPx: 3,
      topBaselineDescentPx: 14,
    },
  ]);

  assert.equal(initial.revision.revisionVersion, 0);
  assert.equal(calibrated.revision.revisionVersion, 1);
  assert.deepEqual(calibrated.target, initial.target);
  assert.equal(session.currentSnapshot(), calibrated);
  assert.deepEqual(accepted, [0, 1]);
  assert.deepEqual(requests[0].continuation, {
    ...handle(0),
    cursor: 'cursor-1',
  });
  await session.dispose();
});

test('bounded startup keeps its small budget until the first snapshot then uses its growth budget', async () => {
  const calls = [];
  const client = fixtureClient({
    create: async (request) => {
      calls.push(['create', request.budget.maxTopLevelNodes, 'growthBudget' in request]);
      return versioned(advance(0, 0, true));
    },
    continue: async (request) => {
      calls.push(['continue', request.budget.maxTopLevelNodes]);
      const version = request.revisionVersion + 1;
      const spreadCount = version < 2 ? 0 : version === 2 ? 1 : 3;
      return versioned(advance(version, spreadCount, true));
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  const initial = await session.start(startRequest(0, 1, 32));
  const grown = await session.ensureSpread(2);

  assert.equal(initial.revision.revisionVersion, 2);
  assert.equal(grown.revision.revisionVersion, 3);
  assert.deepEqual(calls, [
    ['create', 1, false],
    ['continue', 1],
    ['continue', 1],
    ['continue', 32],
  ]);
  await session.dispose();
});

test('bounded session opts atomic worker growth into a validated continuation batch', async () => {
  const requests = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    presentation: async (value) => {
      const revision = summary(value.revisionVersion, 'ready', value.revisionVersion + 1);
      return {
        revision: value,
        value: revisionPresentation(
          revision,
          revisionNavigation(value.revisionId, revision.knownExtent),
        ),
      };
    },
  });
  client.continueRevisionAfterTransferRelease = async (request) => {
    requests.push(request);
    const advancedQuanta = request.maxQuanta;
    const revisionVersion = request.revisionVersion + advancedQuanta;
    const value = advance(revisionVersion, revisionVersion + 1, true);
    value.previousKnownExtent = { pageCount: 1, spreadCount: 1 };
    value.newlyKnownPages = { startPage: 1, endPageExclusive: revisionVersion + 1 };
    value.processedTopLevelNodes = advancedQuanta;
    return {
      revision: handle(revisionVersion),
      value: {
        advance: value,
        releasedRevision: handle(request.revisionVersion),
        releasedTransferCount: advancedQuanta,
        advancedQuanta,
      },
    };
  };
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    continuationBatchQuanta: 8,
    yieldControl: async () => {},
  });

  const snapshot = await session.start(startRequest(8));

  assert.equal(snapshot.revision.revisionVersion, 8);
  assert.equal(snapshot.presentationSpreadIndex, 8);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].maxQuanta, 8);
  assert.equal(requests[0].targetSpreadIndex, 8);
  await session.dispose();
});

test('a dynamic continuation batch is sampled once for each atomic dispatch', async () => {
  const requests = [];
  const resolvedBatchQuanta = [2, 4];
  let resolutionCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    presentation: async (value) => {
      const revision = summary(value.revisionVersion, 'ready', value.revisionVersion + 1);
      return {
        revision: value,
        value: revisionPresentation(
          revision,
          revisionNavigation(value.revisionId, revision.knownExtent),
        ),
      };
    },
  });
  client.continueRevisionAfterTransferRelease = async (request) => {
    requests.push(request);
    const revisionVersion = request.revisionVersion + request.maxQuanta;
    const value = advance(revisionVersion, revisionVersion + 1, true);
    value.previousKnownExtent = {
      pageCount: request.revisionVersion + 1,
      spreadCount: request.revisionVersion + 1,
    };
    value.newlyKnownPages = {
      startPage: request.revisionVersion + 1,
      endPageExclusive: revisionVersion + 1,
    };
    value.processedTopLevelNodes = request.maxQuanta;
    return {
      revision: handle(revisionVersion),
      value: {
        advance: value,
        releasedRevision: handle(request.revisionVersion),
        releasedTransferCount: request.maxQuanta,
        advancedQuanta: request.maxQuanta,
      },
    };
  };
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    continuationBatchQuanta: () => resolvedBatchQuanta[resolutionCount++],
    yieldControl: async () => {},
  });

  const snapshot = await session.start(startRequest(6));

  assert.equal(snapshot.revision.revisionVersion, 6);
  assert.equal(resolutionCount, 2);
  assert.deepEqual(
    requests.map(({ revisionVersion, maxQuanta }) => ({ revisionVersion, maxQuanta })),
    [
      { revisionVersion: 0, maxQuanta: 2 },
      { revisionVersion: 2, maxQuanta: 4 },
    ],
  );
  await session.dispose();
});

test('a dynamic continuation batch is not sampled when no continuation is dispatched', async () => {
  let resolutionCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    continuationBatchQuanta: () => {
      resolutionCount += 1;
      return 17;
    },
  });

  const snapshot = await session.start(startRequest(0));

  assert.equal(snapshot.revision.revisionVersion, 0);
  assert.equal(resolutionCount, 0);
  await session.dispose();
});

test('a dynamic continuation batch fails closed before dispatch when it resolves out of bounds', async () => {
  for (const invalidBatchQuanta of [0, 17, 1.5]) {
    let dispatchCount = 0;
    let resolutionCount = 0;
    const released = [];
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, true)),
      release: async (value) => released.push(value),
    });
    client.continueRevisionAfterTransferRelease = async () => {
      dispatchCount += 1;
    };
    const session = createRitoCoreWasmBoundedReaderSession(client, {
      continuationBatchQuanta: () => {
        resolutionCount += 1;
        return invalidBatchQuanta;
      },
      yieldControl: async () => {},
    });

    await assert.rejects(
      session.start(startRequest(2)),
      /maxQuanta must be an integer from 1 to 16/,
    );

    assert.equal(resolutionCount, 1);
    assert.equal(dispatchCount, 0);
    assert.deepEqual(released, [handle(1)]);
  }
});

test('bounded startup validates its growth budget before opening a revision', () => {
  let createCount = 0;
  const client = fixtureClient({
    create: async () => {
      createCount += 1;
      return versioned(advance(0, 1, true));
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  assert.throws(
    () => session.start(startRequest(0, 1, 0)),
    /bounded reader growth budget maxTopLevelNodes must be a positive safe integer/,
  );
  assert.equal(createCount, 0);
});

test('bounded startup rejects simultaneous locator and spread targets before opening a revision', () => {
  let createCount = 0;
  const client = fixtureClient({
    create: async () => {
      createCount += 1;
      return versioned(advance(0, 1, true));
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  assert.throws(
    () =>
      session.start({
        ...startRequest(0),
        targetLocator: { href: 'chapter.xhtml' },
      }),
    /targetLocator and targetSpreadIndex are mutually exclusive/,
  );
  assert.equal(createCount, 0);
});

test('bounded startup defaults an omitted growth budget to its validated startup budget', async () => {
  const calls = [];
  const client = fixtureClient({
    create: async (request) => {
      calls.push(['create', request.budget.maxTopLevelNodes, 'growthBudget' in request]);
      return versioned(advance(0, 1, true));
    },
    continue: async (request) => {
      calls.push(['continue', request.budget.maxTopLevelNodes]);
      return versioned(advance(request.revisionVersion + 1, 2, true));
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  await session.start({
    layoutConfig: {},
    budget: { maxTopLevelNodes: 3 },
    targetSpreadIndex: 0,
  });
  await session.ensureSpread(1);

  assert.deepEqual(calls, [
    ['create', 3, false],
    ['continue', 3],
  ]);
  await session.dispose();
});

test('a target race publishes one exact presentation only for the latest snapshot request', async () => {
  const presentationStarted = deferred();
  const presentationAllowed = deferred();
  let presentationCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    presentation: async (value, extent) => {
      presentationCount += 1;
      presentationStarted.resolve();
      await presentationAllowed.promise;
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      return {
        revision: value,
        value: revisionPresentation(revision, revisionNavigation(value.revisionId, extent)),
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const first = session.start(startRequest(0));
  await presentationStarted.promise;
  const latest = session.ensureSpread(2);
  presentationAllowed.resolve();
  const [firstSnapshot, latestSnapshot] = await Promise.all([first, latest]);

  assert.equal(presentationCount, 1);
  assert.equal(firstSnapshot.presentationSpreadIndex, 2);
  assert.equal(latestSnapshot.presentationSpreadIndex, 2);
  assert.deepEqual(firstSnapshot.presentation.revision, firstSnapshot.revision);
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

  assert.ok(snapshots.every((snapshot) => snapshot.presentationSpreadIndex === 1));
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
      ['continue', 0],
      ['releaseTransfers', 0],
    ],
  );
});

test('a far target reads one final presentation and a later lower target reuses it', async () => {
  const warmed = [];
  let continueCount = 0;
  let presentationCount = 0;
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
    presentation: async (value, extent) => {
      presentationCount += 1;
      const revision = summary(value.revisionVersion, 'ready', extent.spreadCount);
      return {
        revision: value,
        value: revisionPresentation(revision, revisionNavigation(value.revisionId, extent)),
      };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  const high = await session.start(startRequest(10));
  const low = await session.ensureSpread(2);

  assert.equal(high.presentationSpreadIndex, 10);
  assert.equal(high.frameWindow.spreadIndex, 10);
  assert.equal(low.presentationSpreadIndex, 2);
  assert.equal(low.frameWindow.spreadIndex, 2);
  assert.equal(low.revision.revisionVersion, high.revision.revisionVersion);
  assert.equal(continueCount, 2);
  assert.equal(presentationCount, 1);
  assert.deepEqual(warmed, [10, 2]);
  await session.dispose();
});

test('a pending far target yields to a latest near target without another layout quantum', async () => {
  const releaseStarted = deferred();
  const releaseAllowed = deferred();
  let continueCount = 0;
  const client = fixtureClient({
    atomic: false,
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
  assert.equal(farSnapshot.presentationSpreadIndex, 2);
  assert.equal(nearSnapshot.presentationSpreadIndex, 2);
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

test('a committed failure inside a continuation batch releases its exact final revision', async () => {
  const failed = summary(8, 'failed', 1);
  const accepted = [];
  const released = [];
  const failure = Object.assign(new Error('batched layout failed'), {
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
    continuationBatchQuanta: 8,
    yieldControl: async () => {},
    onAcceptedRevision: ({ revision }) => accepted.push(revision.revisionVersion),
  });

  await assert.rejects(session.start(startRequest(2)), /batched layout failed/);

  assert.deepEqual(accepted, [0, 8]);
  assert.deepEqual(released, [handle(8)]);
});

test('a dynamic continuation batch reuses its single sample as the failure stride', async () => {
  const failed = summary(8, 'failed', 1);
  const accepted = [];
  const released = [];
  let resolutionCount = 0;
  const failure = Object.assign(new Error('dynamic batched layout failed'), {
    code: 'engine-error',
    revision: failed,
  });
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    release: async (value) => released.push(value),
  });
  client.continueRevisionAfterTransferRelease = async (request) => {
    assert.equal(request.maxQuanta, 8);
    throw failure;
  };
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    continuationBatchQuanta: () => {
      resolutionCount += 1;
      return resolutionCount === 1 ? 8 : 1;
    },
    yieldControl: async () => {},
    onAcceptedRevision: ({ revision }) => accepted.push(revision.revisionVersion),
  });

  await assert.rejects(session.start(startRequest(2)), /dynamic batched layout failed/);

  assert.equal(resolutionCount, 1);
  assert.deepEqual(accepted, [0, 8]);
  assert.deepEqual(released, [handle(8)]);
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
    assert.equal(snapshot.presentationSpreadIndex, 10);
    assert.equal(snapshot.frameWindow, undefined);
    assert.equal(warmCount, 0);
    assert.equal(continueCount, 0);
    await session.dispose();
  }
});
