import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  locatorStartRequest,
  revisionNavigation,
  revisionPresentation,
  sourceResolution,
  startRequest,
  versioned,
} from './reader-bounded-session-fixture.mjs';

test('bounded startup targets a locator before publishing or warming any spread', async () => {
  const locatorReads = [];
  const budgets = [];
  const warmed = [];
  let presentationCount = 0;
  const locator = { href: 'late.xhtml', progression: 0.5 };
  const client = fixtureClient({
    create: async (request) => {
      budgets.push(request.budget.maxTopLevelNodes);
      return versioned(advance(0, 1, true));
    },
    continue: async (request) => {
      budgets.push(request.budget.maxTopLevelNodes);
      const version = request.revisionVersion + 1;
      return versioned(advance(version, version === 1 ? 2 : 4, true));
    },
    locator: (revision, request, extent) => {
      locatorReads.push(revision.revisionVersion);
      return revision.revisionVersion < 2
        ? pending(revision, request, 'notPaginated')
        : sourceResolution(revision, request, extent, 3);
    },
    presentation: (revision, extent, accepted) => {
      presentationCount += 1;
      return presentationEnvelope(revision, extent, accepted);
    },
    warm: (_revision, spreadIndex) => {
      warmed.push(spreadIndex);
      return { spreadIndex };
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  let standaloneLocatorRequests = 0;
  let atomicLocatorContinues = 0;
  const resolveSourceLocator = client.resolveSourceLocatorAtRevision;
  const continueTowardLocator = client.continueRevisionTowardSourceLocator;
  client.resolveSourceLocatorAtRevision = async (...args) => {
    standaloneLocatorRequests += 1;
    return resolveSourceLocator(...args);
  };
  client.continueRevisionTowardSourceLocator = async (...args) => {
    atomicLocatorContinues += 1;
    return continueTowardLocator(...args);
  };

  const snapshot = await session.start(locatorStartRequest(locator));

  assert.equal(snapshot.target.kind, 'locator');
  assert.equal(snapshot.target.resolution.status, 'resolved');
  assert.equal(snapshot.presentationSpreadIndex, 3);
  assert.deepEqual(locatorReads, [0, 1, 2]);
  assert.deepEqual(budgets, [32, 32, 32]);
  assert.deepEqual(warmed, [3]);
  assert.equal(presentationCount, 1);
  assert.equal(standaloneLocatorRequests, 1);
  assert.equal(atomicLocatorContinues, 2);
  await session.dispose();
});

test('ensureLocator advances exact revisions until its source target resolves', async () => {
  const locatorReads = [];
  const releasedTransfers = [];
  const warmed = [];
  let presentationCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async (request) => {
      const version = request.revisionVersion + 1;
      return versioned(advance(version, version === 1 ? 2 : 4, true));
    },
    locator: (revision, locator, extent) => {
      locatorReads.push(revision);
      if (revision.revisionVersion < 2) return pending(revision, locator, 'notPaginated');
      return sourceResolution(revision, locator, extent, 3);
    },
    presentation: (revision, extent, accepted) => {
      presentationCount += 1;
      return presentationEnvelope(revision, extent, accepted);
    },
    warm: (_revision, spreadIndex) => {
      warmed.push(spreadIndex);
      return { spreadIndex };
    },
    releaseTransfers: (revision) => releasedTransfers.push(revision),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  await session.start(startRequest(0));

  const snapshot = await session.ensureLocator({ href: 'late.xhtml', progression: 0.5 });

  assert.equal(snapshot.revision.revisionVersion, 2);
  assert.equal(snapshot.presentationSpreadIndex, 3);
  assert.equal(snapshot.frameWindow.spreadIndex, 3);
  assert.equal(snapshot.target.kind, 'locator');
  assert.equal(snapshot.target.resolution.status, 'resolved');
  assert.deepEqual(
    locatorReads.map(({ revisionVersion }) => revisionVersion),
    [0, 1, 2],
  );
  assert.deepEqual(
    releasedTransfers.map(({ revisionVersion }) => revisionVersion),
    [0, 1],
  );
  assert.equal(presentationCount, 2);
  assert.deepEqual(warmed, [0, 3]);
  await session.dispose();
});

test('313-quantum far locator protocol drops worker requests from 940 to 314', async () => {
  const growthQuanta = 313;
  const legacy = await farLocatorProtocolCounts(growthQuanta, false);
  const atomic = await farLocatorProtocolCounts(growthQuanta, true);

  assert.deepEqual(legacy, {
    standaloneLocator: growthQuanta + 1,
    directRelease: growthQuanta,
    directContinue: growthQuanta,
    atomicLocatorContinue: 0,
    total: growthQuanta * 3 + 1,
  });
  assert.deepEqual(atomic, {
    standaloneLocator: 1,
    directRelease: 0,
    directContinue: 0,
    atomicLocatorContinue: growthQuanta,
    total: growthQuanta + 1,
  });
});

test('ensureLocator settles a typed no-page projection without continuing', async () => {
  let continueCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async () => {
      continueCount += 1;
    },
    locator: (revision, locator) => pending(revision, locator, 'noPageProjection'),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const snapshot = await session.ensureLocator({ href: 'empty.xhtml' });

  assert.equal(snapshot.target.kind, 'locator');
  assert.equal(snapshot.target.resolution.status, 'pending');
  assert.equal(snapshot.target.resolution.reason, 'noPageProjection');
  assert.equal(snapshot.presentationSpreadIndex, 0);
  assert.equal(continueCount, 0);
  await session.dispose();
});

test('ensureLocator accepts and publishes a canonicalized Rust locator', async () => {
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    locator: (revision, _locator, extent) =>
      sourceResolution(revision, { href: 'chapter.xhtml', anchorId: 'target' }, extent),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const snapshot = await session.ensureLocator({ href: 'chapter.xhtml#target' });

  assert.equal(snapshot.target.kind, 'locator');
  assert.deepEqual(snapshot.target.locator, {
    href: 'chapter.xhtml',
    anchorId: 'target',
  });
  assert.deepEqual(snapshot.target.resolution.locator, snapshot.target.locator);
  await session.dispose();
});

test('complete coalesces startup and publishes only the terminal presentation', async () => {
  const created = deferred();
  let continueCount = 0;
  let presentationCount = 0;
  const client = fixtureClient({
    create: () => created.promise,
    continue: async (request) => {
      continueCount += 1;
      const version = request.revisionVersion + 1;
      return versioned(advance(version, version + 1, version < 2));
    },
    presentation: (revision, extent, accepted) => {
      presentationCount += 1;
      return presentationEnvelope(revision, extent, accepted);
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });

  const started = session.start(startRequest(0));
  const completed = session.complete();
  created.resolve(versioned(advance(0, 1, true)));
  const [startSnapshot, completeSnapshot] = await Promise.all([started, completed]);

  assert.equal(startSnapshot.target.kind, 'complete');
  assert.equal(completeSnapshot.revision.status, 'complete');
  assert.equal(completeSnapshot.revision.revisionVersion, 2);
  assert.equal(continueCount, 2);
  assert.equal(presentationCount, 1);
  await session.dispose();
});

test('a blocked locator probe yields to a known spread without another quantum', async () => {
  const locatorStarted = deferred();
  const locatorAllowed = deferred();
  let continueCount = 0;
  const callerLocator = { href: 'late.xhtml', sourcePoint: { nodePath: [1], textOffset: 2 } };
  const seenLocators = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    continue: async () => {
      continueCount += 1;
    },
    locator: async (revision, locator) => {
      seenLocators.push(locator);
      locatorStarted.resolve();
      await locatorAllowed.promise;
      return pending(revision, locator, 'notPaginated');
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  await session.start(startRequest(0));

  const locating = session.ensureLocator(callerLocator);
  await locatorStarted.promise;
  callerLocator.href = 'mutated.xhtml';
  callerLocator.sourcePoint.nodePath[0] = 9;
  const spreading = session.ensureSpread(2);
  locatorAllowed.resolve();
  const [locatorSnapshot, spreadSnapshot] = await Promise.all([locating, spreading]);

  assert.equal(locatorSnapshot.target.kind, 'spread');
  assert.equal(spreadSnapshot.presentationSpreadIndex, 2);
  assert.equal(continueCount, 0);
  assert.deepEqual(seenLocators, [
    { href: 'late.xhtml', sourcePoint: { nodePath: [1], textOffset: 2 } },
  ]);
  await session.dispose();
});

test('a rejected superseded locator probe cannot cancel the latest spread target', async () => {
  const locatorStarted = deferred();
  const locatorResult = deferred();
  const released = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 2, true)),
    locator: async () => {
      locatorStarted.resolve();
      return locatorResult.promise;
    },
    release: (revision) => released.push(revision),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const locating = session.ensureLocator({ href: 'missing.xhtml' });
  await locatorStarted.promise;
  const spreading = session.ensureSpread(1);
  locatorResult.reject(new Error('stale locator failed'));
  const [locatorSnapshot, spreadSnapshot] = await Promise.all([locating, spreading]);

  assert.equal(locatorSnapshot.target.kind, 'spread');
  assert.equal(spreadSnapshot.presentationSpreadIndex, 1);
  assert.deepEqual(released, []);
  await session.dispose();
});

test('recoverable locator and frame reads fail only their target', async () => {
  for (const kind of ['locator', 'frame']) {
    const released = [];
    const client = fixtureClient({
      create: async () => versioned(advance(0, 2, true)),
      locator: () => {
        throw engineReadError('invalid locator');
      },
      warm: (_revision, spreadIndex) => {
        if (kind === 'frame' && spreadIndex === 1) throw engineReadError('frame unavailable');
        return { spreadIndex };
      },
      release: (revision) => released.push(revision),
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    const initial = await session.start(startRequest(0));

    const failed =
      kind === 'locator'
        ? session.ensureLocator({ href: 'missing.xhtml' })
        : session.ensureSpread(1);
    await assert.rejects(failed, kind === 'locator' ? /invalid locator/ : /frame unavailable/);

    assert.equal(session.currentSnapshot(), initial);
    const recovered = await session.ensureSpread(0);
    assert.equal(recovered.presentationSpreadIndex, 0);
    assert.deepEqual(released, []);
    await session.dispose();
  }
});

test('a locator failure after growth can recover the latest accepted revision', async () => {
  const released = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async () => versioned(advance(1, 2, true)),
    locator: (revision, locator) => {
      if (revision.revisionVersion === 0) return pending(revision, locator, 'notPaginated');
      throw engineReadError('invalid locator after growth');
    },
    release: (revision) => released.push(revision),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  await session.start(startRequest(0));

  await assert.rejects(
    session.ensureLocator({ href: 'missing.xhtml' }),
    /invalid locator after growth/,
  );
  assert.equal(session.currentSnapshot(), undefined);

  const recovered = await session.ensureSpread(0);
  assert.equal(recovered.revision.revisionVersion, 1);
  assert.equal(recovered.presentationSpreadIndex, 0);
  assert.deepEqual(released, []);
  await session.dispose();
});

test('a retarget during atomic growth accepts at most one quantum and publishes the latest target', async () => {
  const releaseStarted = deferred();
  const releaseAllowed = deferred();
  let continueCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async (request) => {
      continueCount += 1;
      return versioned(advance(request.revisionVersion + 1, 2, true));
    },
    releaseTransfers: async () => {
      releaseStarted.resolve();
      await releaseAllowed.promise;
    },
    locator: (revision, locator) => pending(revision, locator, 'noPageProjection'),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  await session.start(startRequest(0));

  const far = session.ensureSpread(10);
  await releaseStarted.promise;
  const locating = session.ensureLocator({ href: 'empty.xhtml' });
  releaseAllowed.resolve();
  const [farSnapshot, locatorSnapshot] = await Promise.all([far, locating]);

  assert.equal(farSnapshot.target.kind, 'locator');
  assert.equal(farSnapshot.revision.revisionVersion, 1);
  assert.equal(locatorSnapshot.presentationSpreadIndex, 0);
  assert.equal(locatorSnapshot.frameWindow.spreadIndex, 0);
  assert.equal(continueCount, 1);
  await session.dispose();
});

test('locator invariants fail instead of looping a complete or out-of-range revision', async () => {
  for (const fixture of [
    {
      create: async () => versioned(advance(0, 1, false)),
      locator: (revision, locator) => pending(revision, locator, 'notPaginated'),
      pattern: /complete revision left a source locator unpaginated/,
    },
    {
      create: async () => versioned(advance(0, 1, true)),
      locator: (revision, locator) => ({
        ...sourceResolution(revision, locator, { pageCount: 2, spreadCount: 2 }, 1),
        pageIndex: 1,
      }),
      pattern: /outside the known extent/,
    },
  ]) {
    const released = [];
    const client = fixtureClient({
      ...fixture,
      release: (revision) => released.push(revision),
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    await session.start(startRequest(0));

    await assert.rejects(session.ensureLocator({ href: 'late.xhtml' }), fixture.pattern);

    assert.equal(released.length, 1);
    assert.equal(session.currentSnapshot(), undefined);
  }
});

async function farLocatorProtocolCounts(growthQuanta, atomic) {
  const target = { href: 'far.xhtml' };
  const client = fixtureClient({
    atomic,
    create: async () => versioned(advance(0, 1, true)),
    continue: async (request) => {
      const version = request.revisionVersion + 1;
      return versioned(advance(version, version + 1, true));
    },
    locator: (revision, locator, extent) =>
      revision.revisionVersion < growthQuanta
        ? pending(revision, locator, 'notPaginated')
        : sourceResolution(revision, locator, extent, 0),
  });
  const counts = {
    standaloneLocator: 0,
    directRelease: 0,
    directContinue: 0,
    atomicLocatorContinue: 0,
  };
  wrapCount(client, 'resolveSourceLocatorAtRevision', counts, 'standaloneLocator');
  wrapCount(client, 'releaseRevisionTransfersAtRevision', counts, 'directRelease');
  wrapCount(client, 'continueRevision', counts, 'directContinue');
  wrapCount(client, 'continueRevisionTowardSourceLocator', counts, 'atomicLocatorContinue');
  const session = createRitoCoreWasmBoundedReaderSession(client, { yieldControl: async () => {} });

  const snapshot = await session.start(locatorStartRequest(target));
  assert.equal(snapshot.revision.revisionVersion, growthQuanta);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const result = { ...counts, total };
  await session.dispose();
  return result;
}

function wrapCount(client, method, counts, field) {
  const operation = client[method];
  if (operation === undefined) return;
  client[method] = async (...args) => {
    counts[field] += 1;
    return operation(...args);
  };
}

function pending(revision, locator, reason) {
  return {
    status: 'pending',
    revisionId: revision.revisionId,
    locator,
    spineIdref: 'chapter',
    reason,
    matchedBy: 'href',
  };
}

function engineReadError(message) {
  return Object.assign(new Error(message), { code: 'engine-error' });
}

function presentationEnvelope(revision, extent, accepted) {
  return {
    revision,
    value: revisionPresentation(accepted, revisionNavigation(revision.revisionId, extent)),
  };
}
