import { describe, expect, it, vi } from 'vitest';
import {
  ensureBrowserReaderBoundedLocator,
  startBrowserReaderBoundedCandidate,
} from '../../src/bindings/browser/bounded-session-runtime';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { copyReaderLocator } from '../../src/bindings/browser/reader/interaction-capture';
import {
  boundedOwner,
  createBoundedLocatorFixture,
  locatorSnapshot,
  mockLocatorAggregates,
  publicResolution,
  readerLocator,
  waitForCalls,
} from './browser-reader-bounded-locator-fixtures';
import { createDeferred, createWorker } from './browser-reader-reflow-fixtures';

describe('Browser bounded locator mutation coordinator', () => {
  it('retargets A to B to C in one targeting mutation and only resolves C', async () => {
    const fixture = createBoundedLocatorFixture();
    const a = readerLocator('a');
    const b = readerLocator('b');
    const c = readerLocator('c');
    const cSnapshot = locatorSnapshot('current', c, 1, 1);
    const targets = [
      createDeferred<BrowserReaderBoundedSnapshot>(),
      createDeferred<BrowserReaderBoundedSnapshot>(),
      createDeferred<BrowserReaderBoundedSnapshot>(),
    ];
    let targetIndex = 0;
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => {
        const target = targets[targetIndex];
        targetIndex += 1;
        if (!target) throw new Error('Unexpected locator target');
        return target.promise;
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;

    const aTask = ensureBrowserReaderBoundedLocator(fixture.state, a);
    await waitForCalls(ensureLocator, 1);
    const bTask = ensureBrowserReaderBoundedLocator(fixture.state, b);
    const cTask = ensureBrowserReaderBoundedLocator(fixture.state, c);
    await waitForCalls(ensureLocator, 3);

    await expect(aTask).resolves.toBeUndefined();
    await expect(bTask).resolves.toBeUndefined();
    expect(ensureLocator.mock.calls.map(([locator]) => locator.href)).toEqual([
      a.href,
      b.href,
      c.href,
    ]);

    fixture.accept(cSnapshot);
    targets[2]?.resolve(cSnapshot);
    await expect(cTask).resolves.toEqual(publicResolution(cSnapshot));
    targets[0]?.reject(new Error('stale A target'));
    targets[1]?.reject(new Error('stale B target'));
    expect(fixture.state.revisionBundle.revision).toBe(cSnapshot.revision);
    expect(fixture.owner.gateGeneration).toBe(1);
  });

  it('queues a commit-phase replacement for a second serial gate', async () => {
    const fixture = createBoundedLocatorFixture();
    const a = readerLocator('commit-a');
    const b = readerLocator('commit-b');
    const aSnapshot = locatorSnapshot('current', a, 1, 1);
    const bSnapshot = locatorSnapshot('current', b, 2, 2);
    const firstFootnotes =
      createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['getFootnotesAtRevision']>>>();
    const readFootnotes = vi.fn<BrowserReaderWorkerClient['getFootnotesAtRevision']>((revision) =>
      revision.revisionVersion === 1
        ? firstFootnotes.promise
        : Promise.resolve({
            revision,
            value: { revisionId: revision.revisionId, entries: {} },
          }),
    );
    Object.assign(fixture.worker, { getFootnotesAtRevision: readFootnotes });
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      (locator) => {
        const snapshot = locator.href === a.href ? aSnapshot : bSnapshot;
        fixture.accept(snapshot);
        return Promise.resolve(snapshot);
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;

    const aTask = ensureBrowserReaderBoundedLocator(fixture.state, a);
    await waitForCalls(readFootnotes, 1);
    const bTask = ensureBrowserReaderBoundedLocator(fixture.state, b);

    await expect(aTask).resolves.toBeUndefined();
    expect(ensureLocator).toHaveBeenCalledOnce();
    firstFootnotes.resolve({
      revision: revisionHandle(aSnapshot),
      value: { revisionId: 'current', entries: {} },
    });

    await waitForCalls(ensureLocator, 2);
    await expect(bTask).resolves.toEqual(publicResolution(bSnapshot));
    expect(fixture.owner.gateGeneration).toBe(2);
    expect(fixture.state.revisionBundle.revision).toBe(bSnapshot.revision);
  });

  it('returns undefined for an aborted targeting waiter without stopping a later target', async () => {
    const fixture = createBoundedLocatorFixture();
    const aborted = readerLocator('aborted');
    const latest = readerLocator('after-abort');
    const latestSnapshot = locatorSnapshot('current', latest, 1, 1);
    const target = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => target.promise,
    );
    fixture.owner.controller.ensureLocator = ensureLocator;
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.resolve(fixture.initial));
    const controller = new AbortController();

    const abortedTask = ensureBrowserReaderBoundedLocator(
      fixture.state,
      aborted,
      controller.signal,
    );
    await waitForCalls(ensureLocator, 1);
    controller.abort();
    await expect(abortedTask).resolves.toBeUndefined();

    const latestTask = ensureBrowserReaderBoundedLocator(fixture.state, latest);
    await waitForCalls(ensureLocator, 2);
    fixture.accept(latestSnapshot);
    target.resolve(latestSnapshot);

    await expect(latestTask).resolves.toEqual(publicResolution(latestSnapshot));
    expect(fixture.state.revisionBundle.revision).toBe(latestSnapshot.revision);
  });

  it('abandons an aborted targeting mutation when no locator replaces it', async () => {
    const fixture = createBoundedLocatorFixture();
    const locator = readerLocator('aborted-only');
    const staleSnapshot = locatorSnapshot('current', locator, 1, 1);
    const target = createDeferred<BrowserReaderBoundedSnapshot>();
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => target.promise,
    );
    fixture.owner.controller.ensureLocator = ensureLocator;
    fixture.owner.controller.ensureSpread = vi.fn(() => Promise.resolve(fixture.initial));
    const controller = new AbortController();

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator, controller.signal);
    await waitForCalls(ensureLocator, 1);
    expect(fixture.owner.readsSuspended).toBe(true);

    controller.abort();
    await expect(task).resolves.toBeUndefined();
    await waitForGateRestore(fixture.owner);
    target.resolve(staleSnapshot);
    await Promise.resolve();

    expect(fixture.state.revisionBundle.revision).toBe(fixture.initial.revision);
    expect(fixture.state.activeSpreadIndex).toBe(0);
  });

  it('preserves the active spread when a locator is aborted during commit preparation', async () => {
    const fixture = createBoundedLocatorFixture();
    const locator = readerLocator('abort-during-commit');
    const snapshot = locatorSnapshot('current', locator, 1, 1);
    const footnotes =
      createDeferred<Awaited<ReturnType<BrowserReaderWorkerClient['getFootnotesAtRevision']>>>();
    const readFootnotes = vi.fn<BrowserReaderWorkerClient['getFootnotesAtRevision']>(
      () => footnotes.promise,
    );
    Object.assign(fixture.worker, { getFootnotesAtRevision: readFootnotes });
    fixture.owner.controller.ensureLocator = vi.fn(() => {
      fixture.accept(snapshot);
      return Promise.resolve(snapshot);
    });
    const controller = new AbortController();

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator, controller.signal);
    await waitForCalls(readFootnotes, 1);
    controller.abort();
    await expect(task).resolves.toBeUndefined();
    footnotes.resolve({
      revision: revisionHandle(snapshot),
      value: { revisionId: 'current', entries: {} },
    });
    await waitForGateRestore(fixture.owner);

    expect(fixture.state.revisionBundle.revision).toBe(snapshot.revision);
    expect(fixture.state.activeSpreadIndex).toBe(0);
  });

  it('restores the gate after a locator failure and accepts the next request', async () => {
    const fixture = createBoundedLocatorFixture();
    const failed = readerLocator('failed');
    const recovered = readerLocator('recovered');
    const recoveredSnapshot = locatorSnapshot('current', recovered, 1, 1);
    const failure = new Error('locator failed');
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      (locator) => {
        if (locator.href === failed.href) return Promise.reject(failure);
        fixture.accept(recoveredSnapshot);
        return Promise.resolve(recoveredSnapshot);
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;

    await expect(ensureBrowserReaderBoundedLocator(fixture.state, failed)).rejects.toBe(failure);
    expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
    expect(fixture.owner.readsSuspended).toBe(false);
    expect(fixture.state.revisionHandle?.revisionVersion).toBe(0);

    await expect(ensureBrowserReaderBoundedLocator(fixture.state, recovered)).resolves.toEqual(
      publicResolution(recoveredSnapshot),
    );
    expect(ensureLocator).toHaveBeenCalledTimes(2);
    expect(fixture.state.revisionBundle.revision).toBe(recoveredSnapshot.revision);
  });

  it('treats owner replacement as supersession and targets the replacement owner next', async () => {
    const fixture = createBoundedLocatorFixture();
    const stale = readerLocator('stale-owner');
    const staleTarget = createDeferred<BrowserReaderBoundedSnapshot>();
    const staleEnsure = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => staleTarget.promise,
    );
    fixture.owner.controller.ensureLocator = staleEnsure;
    const staleTask = ensureBrowserReaderBoundedLocator(fixture.state, stale);
    await waitForCalls(staleEnsure, 1);

    const candidate = createWorker(() => undefined, 'replacement-owner');
    const installed = readerLocator('installed');
    const installedSnapshot = locatorSnapshot('replacement', installed, 0, 0);
    const snapshots = { current: installedSnapshot };
    const replacementEnsure = vi.fn<
      BrowserReaderBoundedSessionOwner['controller']['ensureLocator']
    >((locator) => {
      const snapshot = locatorSnapshot('replacement', copyReaderLocator(locator), 1, 1);
      snapshots.current = snapshot;
      recordBrowserReaderAcceptedRevision(replacementOwner, snapshot.revision);
      return Promise.resolve(snapshot);
    });
    const replacementOwner = boundedOwner(candidate.worker, {
      start: vi.fn(() => Promise.resolve(installedSnapshot)),
      ensureLocator: replacementEnsure,
      currentSnapshot: vi.fn(() => snapshots.current),
    });
    recordBrowserReaderAcceptedRevision(replacementOwner, installedSnapshot.revision);
    mockLocatorAggregates(candidate.worker);

    await expect(
      startBrowserReaderBoundedCandidate(fixture.state, replacementOwner, {
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        targetSpreadIndex: 0,
      }),
    ).resolves.toBe(installedSnapshot);
    staleTarget.reject(new Error('bounded reader session stopped'));
    await expect(staleTask).resolves.toBeUndefined();
    expect(fixture.state.boundedSessions.current).toBe(replacementOwner);

    const latest = readerLocator('replacement-latest');
    const latestResolution = await ensureBrowserReaderBoundedLocator(fixture.state, latest);
    expect(latestResolution?.locator.href).toBe(latest.href);
    expect(replacementEnsure).toHaveBeenCalledOnce();
    expect(fixture.state.boundedSessions.current).toBe(replacementOwner);
  });
});

function revisionHandle(snapshot: BrowserReaderBoundedSnapshot) {
  return {
    revisionId: snapshot.revision.revisionId,
    revisionVersion: snapshot.revision.revisionVersion,
  };
}

async function waitForGateRestore(owner: BrowserReaderBoundedSessionOwner): Promise<void> {
  for (let attempt = 0; attempt < 64 && owner.readsSuspended; attempt += 1) {
    await Promise.resolve();
  }
  expect(owner.readsSuspended).toBe(false);
}
