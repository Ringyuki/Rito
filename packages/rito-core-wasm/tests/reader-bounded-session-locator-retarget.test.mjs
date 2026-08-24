import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRitoCoreWasmBoundedReaderSession } from '../src/reader-bounded-session-runtime.js';
import {
  advance,
  deferred,
  fixtureClient,
  sourceResolution,
  startRequest,
  versioned,
} from './reader-bounded-session-fixture.mjs';

test('superseded locator waiters all settle with the latest locator snapshot', async () => {
  const firstStarted = deferred();
  const firstAllowed = deferred();
  const seenLocators = [];
  const client = fixtureClient({
    create: async () => versioned(advance(0, 3, true)),
    locator: async (revision, locator, extent) => {
      seenLocators.push(locator.href);
      if (locator.href === 'a.xhtml') {
        firstStarted.resolve();
        await firstAllowed.promise;
        return pending(revision, locator);
      }
      return sourceResolution(revision, locator, extent, 2);
    },
  });
  const session = createRitoCoreWasmBoundedReaderSession(client);
  await session.start(startRequest(0));

  const first = session.ensureLocator({ href: 'a.xhtml' });
  await firstStarted.promise;
  const second = session.ensureLocator({ href: 'b.xhtml' });
  const latest = session.ensureLocator({ href: 'c.xhtml' });
  firstAllowed.resolve();
  const snapshots = await Promise.all([first, second, latest]);

  assert.deepEqual(seenLocators, ['a.xhtml', 'c.xhtml']);
  assert.ok(snapshots.every(({ target }) => target.kind === 'locator'));
  assert.ok(snapshots.every(({ target }) => target.locator.href === 'c.xhtml'));
  assert.ok(snapshots.every(({ target }) => target.resolution.locator.href === 'c.xhtml'));
  await session.dispose();
});

function pending(revision, locator) {
  return {
    status: 'pending',
    revisionId: revision.revisionId,
    locator,
    spineIdref: 'chapter',
    reason: 'notPaginated',
    matchedBy: 'href',
  };
}
