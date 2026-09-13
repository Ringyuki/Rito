import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  deferred,
  fixtureClient,
  locatorStartRequest,
  revisionNavigation,
  revisionPresentation,
  sourceResolution,
  startRequest,
  summary,
  versioned,
} from './reader-bounded-session-fixture.mjs';

test('bounded startup targets a locator before publishing or warming any spread', async () => {
  const locatorReads = [];
  const warmed = [];
  let presentationCount = 0;
  const locator = { href: 'late.xhtml', progression: 0.5 };
  const client = fixtureClient({
    create: async () => versioned(summary(0, 4)),
    locator: (revision, request, extent) => {
      locatorReads.push(revision.revisionVersion);
      return sourceResolution(revision, request, extent, 3);
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
  const session = createRitoCoreWasmBoundedReaderSession(client);
  let standaloneLocatorRequests = 0;
  const resolveSourceLocator = client.resolveSourceLocatorAtRevision;
  client.resolveSourceLocatorAtRevision = async (...args) => {
    standaloneLocatorRequests += 1;
    return resolveSourceLocator(...args);
  };

  const snapshot = await session.start(locatorStartRequest(locator));

  assert.equal(snapshot.target.kind, 'locator');
  assert.equal(snapshot.target.resolution.status, 'resolved');
  assert.equal(snapshot.presentationSpreadIndex, 3);
  assert.deepEqual(locatorReads, [0]);
  assert.deepEqual(warmed, [3]);
  assert.equal(presentationCount, 1);
  assert.equal(standaloneLocatorRequests, 1);
  await session.dispose();
});

test('ensureLocator settles a typed no-page projection', async () => {
  const client = fixtureClient({
    create: async () => versioned(summary(0, 1)),
    locator: (revision, locator) => pending(revision, locator, 'noPageProjection'),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const snapshot = await session.ensureLocator({ href: 'empty.xhtml' });

  assert.equal(snapshot.target.kind, 'locator');
  assert.equal(snapshot.target.resolution.status, 'pending');
  assert.equal(snapshot.target.resolution.reason, 'noPageProjection');
  assert.equal(snapshot.presentationSpreadIndex, 0);
  await session.dispose();
});

test('ensureLocator accepts and publishes a canonicalized Rust locator', async () => {
  const client = fixtureClient({
    create: async () => versioned(summary(0, 1)),
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

test('complete coalesces with startup on the one complete revision', async () => {
  const created = deferred();
  let presentationCount = 0;
  const client = fixtureClient({
    create: () => created.promise,
    presentation: (revision, extent, accepted) => {
      presentationCount += 1;
      return presentationEnvelope(revision, extent, accepted);
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const started = session.start(startRequest(0));
  const completed = session.complete();
  created.resolve(versioned(summary(0, 1)));
  const [startSnapshot, completeSnapshot] = await Promise.all([started, completed]);

  assert.equal(startSnapshot.target.kind, 'complete');
  assert.equal(completeSnapshot.revision.revisionVersion, 0);
  assert.equal(presentationCount, 1);
  await session.dispose();
});

test('a blocked locator probe yields to the latest spread target', async () => {
  const locatorStarted = deferred();
  const locatorAllowed = deferred();
  const callerLocator = { href: 'late.xhtml', sourcePoint: { nodePath: [1], textOffset: 2 } };
  const seenLocators = [];
  const client = fixtureClient({
    create: async () => versioned(summary(0, 3)),
    locator: async (revision, locator) => {
      seenLocators.push(locator);
      locatorStarted.resolve();
      await locatorAllowed.promise;
      return pending(revision, locator, 'noPageProjection');
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const locating = session.ensureLocator(callerLocator);
  await locatorStarted.promise;
  callerLocator.href = 'mutated.xhtml';
  callerLocator.sourcePoint.nodePath[0] = 9;
  const spreading = session.ensureSpread(2);
  locatorAllowed.resolve();
  const [locatorSnapshot, spreadSnapshot] = await Promise.all([locating, spreading]);

  assert.equal(locatorSnapshot.target.kind, 'spread');
  assert.equal(locatorSnapshot, spreadSnapshot);
  assert.equal(spreadSnapshot.presentationSpreadIndex, 2);
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
    create: async () => versioned(summary(0, 2)),
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
      create: async () => versioned(summary(0, 2)),
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

test('locator invariants fail on an unpaginated or out-of-range resolution', async () => {
  for (const fixture of [
    {
      locator: (revision, locator) => pending(revision, locator, 'notPaginated'),
      pattern: /left a source locator unpaginated/,
    },
    {
      locator: (revision, locator) => ({
        ...sourceResolution(revision, locator, { pageCount: 2, spreadCount: 2 }, 1),
        pageIndex: 1,
      }),
      pattern: /outside the revision extent/,
    },
  ]) {
    const released = [];
    const client = fixtureClient({
      create: async () => versioned(summary(0, 1)),
      locator: fixture.locator,
      release: (revision) => released.push(revision),
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    await session.start(startRequest(0));

    await assert.rejects(session.ensureLocator({ href: 'late.xhtml' }), fixture.pattern);

    assert.equal(released.length, 1);
    assert.equal(session.currentSnapshot(), undefined);
  }
});

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
