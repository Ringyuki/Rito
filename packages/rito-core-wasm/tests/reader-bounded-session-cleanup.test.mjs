import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  startRequest,
  versioned,
} from './reader-bounded-session-fixture.mjs';

test('cancel reports cleanup failures while dispose remains best effort', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const client = fixtureClient({
      create: async () => versioned(advance(0, 1, false)),
      release: async () => {
        throw new Error('release failed');
      },
    });
    const session = createRitoCoreWasmBoundedReaderSession(client);
    await session.start(startRequest(0));
    if (operation === 'cancel') {
      await assert.rejects(session.cancel(), /release failed/);
    } else {
      await session.dispose();
    }
  }
});

test('cancel rejects a response that did not release the exact revision', async () => {
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, false)),
    releaseResponse: (value) => ({
      revision: value,
      value: { releasedRevision: false, releasedTransferCount: 0 },
    }),
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));
  await assert.rejects(session.cancel(), /did not release its exact revision/);
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

test('stop during navigation refresh does not start frame warmup', async () => {
  const navigationStarted = deferred();
  const navigationAllowed = deferred();
  let warmCount = 0;
  const client = fixtureClient({
    create: async () => versioned(advance(0, 1, true)),
    navigation: async (value, extent) => {
      navigationStarted.resolve();
      await navigationAllowed.promise;
      return { revision: value, value: { revisionId: value.revisionId, ...extent } };
    },
    warm: () => {
      warmCount += 1;
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);

  const started = session.start(startRequest(0));
  await navigationStarted.promise;
  const stopping = session.cancel();
  navigationAllowed.resolve();
  await stopping;
  await assert.rejects(started, /stopped/);

  assert.equal(warmCount, 0);
});
