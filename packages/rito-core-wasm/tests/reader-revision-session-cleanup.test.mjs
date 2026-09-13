import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmReaderRevisionSession } from '../src/reader-revision-session-runtime.js';
import {
  deferred,
  fixtureClient,
  handle,
  revisionNavigation,
  startRequest,
  summary,
  versioned,
} from './reader-revision-session-fixture.mjs';

test('cancel and dispose report cleanup failures after best-effort release', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const client = fixtureClient({
      create: async () => versioned(summary(0, 1)),
      release: async () => {
        throw new Error('release failed');
      },
    });
    const session = createRitoCoreWasmReaderRevisionSession(client);
    await session.start(startRequest(0));
    await assert.rejects(session[operation](), /release failed/);
    if (operation === 'dispose') await assert.rejects(session.dispose(), /release failed/);
  }
});

test('cancel and dispose reject a response that did not release the exact revision', async () => {
  for (const operation of ['cancel', 'dispose']) {
    const client = fixtureClient({
      create: async () => versioned(summary(0, 1)),
      releaseResponse: (value) => ({
        revision: value,
        value: { releasedRevision: false, releasedTransferCount: 0 },
      }),
    });
    const session = createRitoCoreWasmReaderRevisionSession(client);
    await session.start(startRequest(0));
    await assert.rejects(session[operation](), /did not release its exact revision/);
  }
});

test('dispose remains terminal when cancel races the same in-flight create', async () => {
  const created = deferred();
  const createStarted = deferred();
  const client = fixtureClient({
    create: () => {
      createStarted.resolve();
      return created.promise;
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);
  const started = session.start(startRequest(2));
  await createStarted.promise;
  const disposing = session.dispose();
  const cancelling = session.cancel();
  created.resolve(versioned(summary(0, 2)));
  await Promise.all([disposing, cancelling]);
  await assert.rejects(started, /stopped/);
  assert.throws(() => session.ensureSpread(0), /disposed/);
});

test('stop during presentation refresh does not start frame warmup', async () => {
  const presentationStarted = deferred();
  const presentationAllowed = deferred();
  let warmCount = 0;
  const client = fixtureClient({
    create: async () => versioned(summary(0, 1)),
    navigation: async (value, extent) => {
      presentationStarted.resolve();
      await presentationAllowed.promise;
      return { revision: value, value: revisionNavigation(value.revisionId, extent) };
    },
    warm: () => {
      warmCount += 1;
    },
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

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
    let warmCount = 0;
    const client = fixtureClient({
      create: async () => versioned(summary(0, 1)),
      locator: async (revision, locator) => {
        locatorStarted.resolve();
        await locatorAllowed.promise;
        return {
          status: 'pending',
          revisionId: revision.revisionId,
          locator,
          spineIdref: 'chapter',
          reason: 'noPageProjection',
          matchedBy: 'href',
        };
      },
      warm: () => {
        warmCount += 1;
      },
    });
    const session = createRitoCoreWasmReaderRevisionSession(client);
    await session.start(startRequest(0));

    const locating = session.ensureLocator({ href: 'late.xhtml' });
    await locatorStarted.promise;
    const stopping = session[operation]();
    locatorAllowed.resolve();
    await stopping;
    await assert.rejects(locating, /stopped/);

    assert.equal(warmCount, 1);
  }
});

test('forged presentation handles fail the snapshot and release the accepted revision', async () => {
  const released = [];
  let warmCount = 0;
  const client = fixtureClient({
    create: async () => versioned(summary(0, 1)),
    presentation: async (value) => ({
      revision: { ...value, revisionVersion: value.revisionVersion + 1 },
      value: {},
    }),
    warm: () => {
      warmCount += 1;
    },
    release: async (value) => released.push(value),
  });
  const session = createRitoCoreWasmReaderRevisionSession(client);

  await assert.rejects(session.start(startRequest(0)), /mismatched revision handle/);

  assert.deepEqual(released, [handle(0)]);
  assert.equal(warmCount, 0);
  assert.equal(session.currentSnapshot(), undefined);
});
