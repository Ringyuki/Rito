import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  revisionNavigation,
  startRequest,
  versioned,
} from './reader-bounded-session-fixture.mjs';

test('cancel and dispose report cleanup failures after best-effort release', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, false)),
      release: async () => {
        throw new Error('release failed');
      },
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    await session.start(startRequest(0));
    await assert.rejects(session[operation](), /release failed/);
    if (operation === 'dispose') await assert.rejects(session.dispose(), /release failed/);
  }
});

test('cancel and dispose reject a response that did not release the exact revision', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, false)),
      releaseResponse: (value) => ({
        revision: value,
        value: { releasedRevision: false, releasedTransferCount: 0 },
      }),
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    await session.start(startRequest(0));
    await assert.rejects(session[operation](), /did not release its exact revision/);
  }
});

test('dispose remains terminal when cancel races the same in-flight quantum', async () => {
  const continued = deferred();
  const continueStarted = deferred();
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    continue: async () => {
      continueStarted.resolve();
      return continued.promise;
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client, {
    yieldControl: async () => {},
  });
  const started = session.start(startRequest(2));
  await continueStarted.promise;
  const disposing = session.dispose();
  const cancelling = session.cancel();
  continued.resolve(versioned(advance(1, 2, true)));
  await Promise.all([disposing, cancelling]);
  await assert.rejects(started, /stopped/);
  assert.throws(() => session.ensureSpread(0), /disposed/);
});

test('stop during transfer cleanup does not start another layout quantum', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const releaseStarted = deferred();
    const releaseAllowed = deferred();
    let continueCount = 0;
    let transferReleaseCount = 0;
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, true)),
      continue: async () => {
        continueCount += 1;
        return versioned(advance(1, 2, true));
      },
      releaseTransfers: async () => {
        transferReleaseCount += 1;
        releaseStarted.resolve();
        await releaseAllowed.promise;
      },
    });
    const session = createRitoCoreWasmBoundedReaderSession(client, {
      yieldControl: async () => {},
    });

    const started = session.start(startRequest(2));
    await releaseStarted.promise;
    const stopping = session[operation]();
    releaseAllowed.resolve();
    await stopping;
    await assert.rejects(started, /stopped/);

    assert.equal(continueCount, 0);
    assert.equal(transferReleaseCount, 1);
  }
});

test('stop during presentation refresh does not start frame warmup', async () => {
  const presentationStarted = deferred();
  const presentationAllowed = deferred();
  let warmCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    navigation: async (value, extent) => {
      presentationStarted.resolve();
      await presentationAllowed.promise;
      return { revision: value, value: revisionNavigation(value.revisionId, extent) };
    },
    warm: () => {
      warmCount += 1;
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const started = session.start(startRequest(0));
  await presentationStarted.promise;
  const stopping = session.cancel();
  presentationAllowed.resolve();
  await stopping;
  await assert.rejects(started, /stopped/);

  assert.equal(warmCount, 0);
});

test('cancel and dispose drain an in-flight locator probe before exact cleanup', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const locatorStarted = deferred();
    const locatorAllowed = deferred();
    let continueCount = 0;
    let warmCount = 0;
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, true)),
      continue: async () => {
        continueCount += 1;
      },
      locator: async (revision, locator) => {
        locatorStarted.resolve();
        await locatorAllowed.promise;
        return {
          status: 'pending',
          revisionId: revision.revisionId,
          locator,
          spineIdref: 'chapter',
          reason: 'notPaginated',
          matchedBy: 'href',
        };
      },
      warm: () => {
        warmCount += 1;
      },
    });
    const session = createRitoCoreWasmBoundedReaderSession(client, {
      yieldControl: async () => {},
    });
    await session.start(startRequest(0));

    const locating = session.ensureLocator({ href: 'late.xhtml' });
    await locatorStarted.promise;
    const stopping = session[operation]();
    locatorAllowed.resolve();
    await stopping;
    await assert.rejects(locating, /stopped/);

    assert.equal(continueCount, 0);
    assert.equal(warmCount, 1);
  }
});

test('forged presentation handles fail the snapshot and release the accepted revision', async () => {
  const released = [];
  let warmCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    presentation: async (value) => ({
      revision: { ...value, revisionVersion: value.revisionVersion + 1 },
      value: {},
    }),
    warm: () => {
      warmCount += 1;
    },
    release: async (value) => released.push(value),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  await assert.rejects(session.start(startRequest(0)), /mismatched revision handle/);

  assert.deepEqual(released, [{ revisionId: 'rev-1', revisionVersion: 1 }]);
  assert.equal(warmCount, 0);
  assert.equal(session.currentSnapshot(), undefined);
});
