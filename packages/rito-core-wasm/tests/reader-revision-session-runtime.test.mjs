import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmReaderRevisionSession } from '../src/reader-revision-session-runtime.js';
import {
  deferred,
  fixtureClient,
  handle,
  revisionNavigation,
  revisionPresentation,
  startRequest,
  summary,
  versioned,
} from './reader-revision-session-fixture.mjs';

test('revision snapshots include exact slim presentation metadata', async () => {
  let presentationCount = 0;
  const client = fixtureClient({
    create: async () => versioned(summary(0, 1)),
    presentation: async (value, extent) => {
      presentationCount += 1;
      const revision = summary(value.revisionVersion, extent.spreadCount);
      const navigation = revisionNavigation(value.revisionId, extent);
      return {
        revision: value,
        value: revisionPresentation(revision, navigation),
      };
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

  const snapshot = await session.start(startRequest(0));

  assert.deepEqual(snapshot.presentation.revision, snapshot.revision);
  assert.equal(snapshot.navigation, snapshot.presentation.navigation);
  assert.equal('footnotes' in snapshot.presentation, false);
  assert.equal('chapterTextIndices' in snapshot.presentation, false);
  assert.equal(presentationCount, 1);
  await session.dispose();
});

test('startup rejects simultaneous locator and spread targets before opening a revision', () => {
  let createCount = 0;
  const client = fixtureClient({
    create: async () => {
      createCount += 1;
      return versioned(summary(0, 1));
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

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

test('a target race publishes one exact presentation only for the latest snapshot request', async () => {
  const presentationStarted = deferred();
  const presentationAllowed = deferred();
  let presentationCount = 0;
  const client = fixtureClient({
    create: async () => versioned(summary(0, 3)),
    presentation: async (value, extent) => {
      presentationCount += 1;
      presentationStarted.resolve();
      await presentationAllowed.promise;
      const revision = summary(value.revisionVersion, extent.spreadCount);
      return {
        revision: value,
        value: revisionPresentation(revision, revisionNavigation(value.revisionId, extent)),
      };
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

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

test('the revision session coalesces concurrent targets around the latest request', async () => {
  const created = deferred();
  const accepted = [];
  const warmed = [];
  const client = fixtureClient({
    create: () => created.promise,
    warm: (_handle, spreadIndex) => {
      warmed.push(spreadIndex);
      return { spreadIndex };
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client, {
    onAcceptedRevision: (event) => accepted.push(event.revision.revisionVersion),
  });

  const started = session.start(startRequest(0));
  const second = session.ensureSpread(2);
  const first = session.ensureSpread(1);
  created.resolve(versioned(summary(0, 3)));
  const snapshots = await Promise.all([started, first, second]);

  assert.ok(snapshots.every((snapshot) => snapshot.presentationSpreadIndex === 1));
  assert.ok(snapshots.every((snapshot) => snapshot.frameWindow.spreadIndex === 1));
  assert.deepEqual(accepted, [0]);
  assert.deepEqual(warmed, [1]);
  await session.dispose();
});

test('a far target reads one presentation and a later lower target reuses it', async () => {
  const warmed = [];
  let presentationCount = 0;
  const client = fixtureClient({
    create: async () => versioned(summary(0, 11)),
    warm: (_handle, spreadIndex) => {
      warmed.push(spreadIndex);
      return { spreadIndex };
    },
    presentation: async (value, extent) => {
      presentationCount += 1;
      const revision = summary(value.revisionVersion, extent.spreadCount);
      return {
        revision: value,
        value: revisionPresentation(revision, revisionNavigation(value.revisionId, extent)),
      };
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

  const high = await session.start(startRequest(10));
  const low = await session.ensureSpread(2);

  assert.equal(high.presentationSpreadIndex, 10);
  assert.equal(high.frameWindow.spreadIndex, 10);
  assert.equal(low.presentationSpreadIndex, 2);
  assert.equal(low.frameWindow.spreadIndex, 2);
  assert.equal(low.revision.revisionVersion, high.revision.revisionVersion);
  assert.equal(low.presentation, high.presentation);
  assert.equal(presentationCount, 1);
  assert.deepEqual(warmed, [10, 2]);
  await session.dispose();
});

test('cancel and dispose drain an in-flight create before exact cleanup', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const created = deferred();
    const createStarted = deferred();
    const accepted = [];
    const released = [];
    const releasedTransfers = [];
    const client = fixtureClient({
      create: () => {
        createStarted.resolve();
        return created.promise;
      },
      release: async (value) => released.push(value),
      releaseTransfers: async (value) => releasedTransfers.push(value),
    });
    const session = createRitoCoreWasmReaderRevisionSession(client, {
      onAcceptedRevision: (event) => accepted.push(event.revision.revisionVersion),
    });

    const started = session.start(startRequest(3));
    await createStarted.promise;
    const stopping = session[operation]();
    created.resolve(versioned(summary(0, 2)));
    await stopping;
    await assert.rejects(started, /stopped/);

    // A complete revision has no layout left to cancel: cleanup releases the
    // created revision itself, without a transfer release or a cancel round trip.
    assert.deepEqual(accepted, [0]);
    assert.deepEqual(releasedTransfers, []);
    assert.deepEqual(released, [handle(0)]);
    assert.equal(session.currentSnapshot(), undefined);
  }
});

test('complete short and empty revisions settle out-of-range targets without a frame', async () => {
  for (const spreadCount of [1, 0]) {
    let warmCount = 0;
    const client = fixtureClient({
      create: async () => versioned(summary(0, spreadCount)),
      warm: () => {
        warmCount += 1;
      },
    });
    const session = createRitoCoreWasmReaderRevisionSession(client);
    const snapshot = await session.start(startRequest(10));

    assert.equal(snapshot.revision.spreadCount, spreadCount);
    assert.equal(snapshot.presentationSpreadIndex, 10);
    assert.equal(snapshot.frameWindow, undefined);
    assert.equal(warmCount, 0);
    await session.dispose();
  }
});
