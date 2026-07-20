import { describe, expect, it, vi } from 'vitest';
import {
  ensureBrowserReaderBoundedLocator,
  startBrowserReaderBoundedCandidate,
} from '../../src/bindings/browser/bounded-session-runtime';
import { commitBrowserReaderBoundedSnapshot } from '../../src/bindings/browser/bounded-revision-commit';
import type { ReaderLocator } from '../../src/reader';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  suspendBrowserReaderExactReads,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { copyReaderLocator } from '../../src/bindings/browser/reader/interaction-capture';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { BrowserReaderFrame } from '../../src/bindings/browser/reader/types';
import {
  boundedOwner,
  createBoundedLocatorFixture,
  locatorSnapshot,
  mockLocatorAggregates,
  publicResolution,
  readerLocator,
  waitForCalls,
} from './browser-reader-bounded-locator-fixtures';
import { createDeferred, createWorker, setRevisionState } from './browser-reader-reflow-fixtures';

describe('Browser bounded locator mutation coordinator', () => {
  it('reuses a cached same-revision locator frame without republishing aggregates', async () => {
    const fixture = createBoundedLocatorFixture();
    const locator = readerLocator('same-revision');
    const snapshot = withImageResource(
      locatorSnapshot('current', locator, 0, 2),
      'same-revision-cover.png',
    );
    setRevisionState(fixture.state, snapshot.revision, snapshot.navigation);
    const publishedBundle = fixture.state.revisionBundle;
    const publishedFootnotes = fixture.state.footnotes;
    const publishedChapterTextIndices = fixture.state.chapterTextIndices;
    const publishedFrames = fixture.state.frames;
    const publishedRevisionHandle = fixture.state.revisionHandle;
    if (!publishedRevisionHandle) throw new Error('Expected an exact revision handle');
    const cachedFrame: BrowserReaderFrame = {
      revisionId: 'current',
      spreadIndex: 2,
      width: 800,
      height: 600,
      commands: [],
      commandHash: 'cached-same-revision-frame',
      resourceRefs: { images: ['same-revision-cover.png'] },
      fontFamilies: [],
      imageDominated: true,
    };
    fixture.state.frames.set(2, cachedFrame);
    const cachedTargets = { pageIndex: 0, spreadIndex: 0, targets: [] };
    fixture.state.interaction.pageTargets.set(0, {
      revision: publishedRevisionHandle,
      value: cachedTargets,
    });
    const image = { close: vi.fn() } as unknown as ImageBitmap;
    const imageReady = createDeferred<ImageBitmap>();
    const createImageBitmap = vi.fn(() => imageReady.promise);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      () => {
        fixture.accept(snapshot);
        return Promise.resolve(snapshot);
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;
    let settled = false;

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator);
    void task.then(() => {
      settled = true;
    });
    await waitForCalls(createImageBitmap, 1);

    expect(settled).toBe(false);
    expect(fixture.state.decodeFrameCommandBuffer).not.toHaveBeenCalled();
    expect(fixture.state.frames.get(2)).toBe(cachedFrame);
    expect(vi.mocked(fixture.worker).getFootnotesAtRevision.mock.calls).toHaveLength(0);
    expect(vi.mocked(fixture.worker).getChapterTextIndicesAtRevision.mock.calls).toHaveLength(0);

    imageReady.resolve(image);
    await expect(task).resolves.toEqual(publicResolution(snapshot));

    expect(fixture.state.revisionBundle).toBe(publishedBundle);
    expect(fixture.state.footnotes).toBe(publishedFootnotes);
    expect(fixture.state.chapterTextIndices).toBe(publishedChapterTextIndices);
    expect(fixture.state.frames).toBe(publishedFrames);
    expect(fixture.state.frames.get(2)).toBe(cachedFrame);
    expect(fixture.state.images.get('same-revision-cover.png')).toBe(image);
    expect(fixture.state.interaction.pageTargets.get(0)?.value).toBe(cachedTargets);
    await expect(createBrowserReaderInteractions(fixture.state).getPageTargets(0)).resolves.toBe(
      cachedTargets,
    );
    expect(vi.mocked(fixture.worker).getPageTargetsAtRevision.mock.calls).toHaveLength(0);
    expect(fixture.state.revisionHandle?.publicationGeneration).toBe(
      publishedRevisionHandle.publicationGeneration,
    );
    expect(fixture.state.revisionHandle?.commitGeneration).toBeGreaterThan(
      publishedRevisionHandle.commitGeneration,
    );
    expect(fixture.owner.readsSuspended).toBe(false);
    expect(fixture.state.activeSpreadIndex).toBe(2);
    vi.unstubAllGlobals();
  });

  it('restores the exact gate without moving when a same-revision frame commit is aborted', async () => {
    const fixture = createBoundedLocatorFixture();
    const locator = readerLocator('same-revision-abort');
    const snapshot = withImageResource(
      locatorSnapshot('current', locator, 0, 2),
      'same-revision-abort.png',
    );
    setRevisionState(fixture.state, snapshot.revision, snapshot.navigation);
    const publishedBundle = fixture.state.revisionBundle;
    const imageReady = createDeferred<ImageBitmap>();
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => imageReady.promise),
    );
    fixture.owner.controller.ensureLocator = vi.fn(() => {
      fixture.accept(snapshot);
      return Promise.resolve(snapshot);
    });
    const controller = new AbortController();

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator, controller.signal);
    await waitForCalls(vi.mocked(globalThis.createImageBitmap), 1);
    controller.abort();
    await expect(task).resolves.toBeUndefined();
    await waitForGateRestore(fixture.owner);
    expect(fixture.owner.readsSuspended).toBe(false);

    imageReady.resolve({ close: vi.fn() } as unknown as ImageBitmap);
    await waitForGateRestore(fixture.owner);

    expect(fixture.state.revisionBundle).toBe(publishedBundle);
    expect(fixture.state.activeSpreadIndex).toBe(0);
    expect(fixture.state.revisionHandle?.revisionVersion).toBe(0);
    expect(vi.mocked(fixture.worker).getFootnotesAtRevision.mock.calls).toHaveLength(0);
    expect(vi.mocked(fixture.worker).getChapterTextIndicesAtRevision.mock.calls).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('keeps exact reads closed when a same-revision preserve predicate throws', async () => {
    const fixture = createBoundedLocatorFixture();
    const snapshot = locatorSnapshot('current', readerLocator('predicate'), 0, 0);
    setRevisionState(fixture.state, snapshot.revision, snapshot.navigation);
    fixture.accept(snapshot);
    const gate = suspendBrowserReaderExactReads(fixture.state);
    if (!gate) throw new Error('test exact-read gate is missing');
    const failure = new Error('preserve predicate failed');

    await expect(
      commitBrowserReaderBoundedSnapshot(fixture.state, {
        owner: fixture.owner,
        snapshot,
        config: fixture.state.config,
        spreadMode: fixture.state.spreadMode,
        lineBreaking: fixture.state.lineBreaking,
        baseCommitGeneration: fixture.state.commitGeneration,
        exactReadGate: gate,
        preserveActiveSpread: () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);

    expect(fixture.state.revisionHandle).toBeUndefined();
    expect(fixture.owner.readsSuspended).toBe(true);
  });

  it('lets a newer locator commit without waiting for a superseded image decode', async () => {
    const fixture = createBoundedLocatorFixture();
    const first = readerLocator('slow-image-target');
    const latest = readerLocator('latest-text-target');
    const firstSnapshot = withImageResource(
      locatorSnapshot('current', first, 0, 1),
      'slow-target.png',
    );
    const latestSnapshot = locatorSnapshot('current', latest, 0, 1);
    setRevisionState(fixture.state, firstSnapshot.revision, firstSnapshot.navigation);
    const imageReady = createDeferred<ImageBitmap>();
    const createImageBitmap = vi.fn(() => imageReady.promise);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      (locator) => {
        const snapshot = locator.href === first.href ? firstSnapshot : latestSnapshot;
        fixture.accept(snapshot);
        return Promise.resolve(snapshot);
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;

    const firstTask = ensureBrowserReaderBoundedLocator(fixture.state, first);
    await waitForCalls(createImageBitmap, 1);
    const latestTask = ensureBrowserReaderBoundedLocator(fixture.state, latest);

    await expect(firstTask).resolves.toBeUndefined();
    await expect(latestTask).resolves.toEqual(publicResolution(latestSnapshot));
    expect(ensureLocator.mock.calls.map(([locator]) => locator.href)).toEqual([
      first.href,
      latest.href,
    ]);
    expect(fixture.owner.readsSuspended).toBe(false);
    expect(fixture.state.activeSpreadIndex).toBe(1);

    imageReady.resolve({ close: vi.fn() } as unknown as ImageBitmap);
    await vi.waitFor(() => {
      expect(fixture.state.pendingImageLoads.size).toBe(0);
    });
    vi.unstubAllGlobals();
  });

  it('degrades a stale exact selector to its durable progression before committing', async () => {
    const fixture = createBoundedLocatorFixture();
    const locator: ReaderLocator = {
      href: 'legacy.xhtml',
      sourcePoint: { nodePath: [99], textOffset: 4 },
      progression: 0.6,
    };
    const fallback: ReaderLocator = { href: locator.href, progression: 0.6 };
    const snapshot = locatorSnapshot('current', fallback, 0, 2);
    const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
      (target) => {
        if (target.sourcePoint) {
          return Promise.reject(new Error('source point is outside the parsed chapter'));
        }
        fixture.accept(snapshot);
        return Promise.resolve(snapshot);
      },
    );
    fixture.owner.controller.ensureLocator = ensureLocator;

    await expect(ensureBrowserReaderBoundedLocator(fixture.state, locator)).resolves.toEqual(
      publicResolution(snapshot),
    );

    expect(ensureLocator.mock.calls.map(([target]) => target)).toEqual([locator, fallback]);
    expect(fixture.state.activeSpreadIndex).toBe(2);
    expect(fixture.state.frames.has(0)).toBe(false);
  });

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

  it('coalesces ten seeks issued within one second and only publishes the latest locator', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(0);
      const fixture = createBoundedLocatorFixture();
      const locators = Array.from({ length: 10 }, (_, index) =>
        readerLocator(`rapid-seek-${String(index)}`),
      );
      const snapshots = locators.map((locator, index) =>
        locatorSnapshot('current', locator, index + 1, index + 1),
      );
      const targets = snapshots.map(() => createDeferred<BrowserReaderBoundedSnapshot>());
      const ensureLocator = vi.fn<BrowserReaderBoundedSessionOwner['controller']['ensureLocator']>(
        (locator) => {
          const index = locators.findIndex((candidate) => candidate.href === locator.href);
          const target = targets[index];
          if (!target) throw new Error(`Unexpected rapid locator ${locator.href}`);
          return target.promise;
        },
      );
      fixture.owner.controller.ensureLocator = ensureLocator;
      const publishedSpreads: number[] = [];
      fixture.state.layoutCommittedListeners.add((spreadIndex) => {
        publishedSpreads.push(spreadIndex);
      });

      const tasks: Array<ReturnType<typeof ensureBrowserReaderBoundedLocator>> = [];
      const observedOwnerCounts: number[] = [];
      for (const [index, locator] of locators.entries()) {
        vi.setSystemTime(index * 90);
        tasks.push(ensureBrowserReaderBoundedLocator(fixture.state, locator));
        await waitForCalls(ensureLocator, index + 1);
        observedOwnerCounts.push(
          new Set(
            [fixture.state.boundedSessions.current, fixture.state.boundedSessions.candidate].filter(
              (owner) => owner !== undefined,
            ),
          ).size,
        );
      }

      expect(Date.now()).toBeLessThan(1_000);
      await expect(Promise.all(tasks.slice(0, -1))).resolves.toEqual(
        Array.from({ length: 9 }, () => undefined),
      );
      expect(ensureLocator.mock.calls.map(([locator]) => locator.href)).toEqual(
        locators.map(({ href }) => href),
      );
      expect(Math.max(...observedOwnerCounts)).toBe(1);
      expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
      expect(fixture.state.boundedSessions.candidate).toBeUndefined();

      for (const [index, target] of targets.slice(0, 4).entries()) {
        const snapshot = snapshots[index];
        if (!snapshot) throw new Error('Missing stale rapid-seek snapshot');
        target.resolve(snapshot);
      }
      await Promise.all(targets.slice(0, 4).map(({ promise }) => promise));
      await Promise.resolve();
      expect(fixture.state.revisionBundle.revision).toBe(fixture.initial.revision);
      expect(publishedSpreads).toEqual([]);

      const latestSnapshot = snapshots.at(-1);
      const latestTarget = targets.at(-1);
      const latestTask = tasks.at(-1);
      if (!latestSnapshot || !latestTarget || !latestTask) {
        throw new Error('Missing latest rapid-seek fixture');
      }
      fixture.accept(latestSnapshot);
      latestTarget.resolve(latestSnapshot);
      await expect(latestTask).resolves.toEqual(publicResolution(latestSnapshot));

      for (const [offset, target] of targets.slice(4, -1).entries()) {
        const snapshot = snapshots[offset + 4];
        if (!snapshot) throw new Error('Missing late stale rapid-seek snapshot');
        target.resolve(snapshot);
      }
      await Promise.all(targets.slice(4, -1).map(({ promise }) => promise));
      await Promise.resolve();

      expect(fixture.state.revisionBundle.revision).toBe(latestSnapshot.revision);
      expect(fixture.state.activeSpreadIndex).toBe(latestSnapshot.presentationSpreadIndex);
      expect(publishedSpreads).toEqual([latestSnapshot.presentationSpreadIndex]);
      expect(fixture.owner.gateGeneration).toBe(1);
      expect(fixture.owner.readsSuspended).toBe(false);
      expect(fixture.state.boundedSessions.current).toBe(fixture.owner);
      expect(fixture.state.boundedSessions.candidate).toBeUndefined();
      expect(vi.mocked(fixture.worker).getFootnotesAtRevision.mock.calls).toHaveLength(1);
      expect(vi.mocked(fixture.worker).getChapterTextIndicesAtRevision.mock.calls).toHaveLength(1);
      expect(vi.mocked(fixture.worker).getFootnotesAtRevision.mock.calls[0]?.[0]).toEqual(
        revisionHandle(latestSnapshot),
      );
    } finally {
      vi.useRealTimers();
    }
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
            value: {
              revisionId: revision.revisionId,
              complete: true,
              pendingKeys: [],
              entries: {},
            },
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
      value: { revisionId: 'current', complete: true, pendingKeys: [], entries: {} },
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
    const committed = vi.fn();
    fixture.state.layoutCommittedListeners.add(committed);

    const task = ensureBrowserReaderBoundedLocator(fixture.state, locator, controller.signal);
    await waitForCalls(readFootnotes, 1);
    controller.abort();
    await expect(task).resolves.toBeUndefined();
    footnotes.resolve({
      revision: revisionHandle(snapshot),
      value: { revisionId: 'current', complete: true, pendingKeys: [], entries: {} },
    });
    await waitForGateRestore(fixture.owner);

    expect(fixture.state.revisionBundle.revision).toBe(snapshot.revision);
    expect(fixture.state.activeSpreadIndex).toBe(0);
    expect(committed).not.toHaveBeenCalled();
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
    expect(ensureLocator.mock.calls.map(([locator]) => locator)).toEqual([
      failed,
      { href: failed.href },
      recovered,
    ]);
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

function withImageResource(
  snapshot: BrowserReaderBoundedSnapshot,
  href: string,
): BrowserReaderBoundedSnapshot {
  const frameWindow = snapshot.frameWindow;
  const frame = frameWindow?.frames[0];
  if (!frameWindow || !frame) throw new Error('Expected a locator frame');
  return {
    ...snapshot,
    frameWindow: {
      ...frameWindow,
      frames: [
        {
          ...frame,
          metadata: {
            ...frame.metadata,
            resourceRefCount: 1,
            resourceTable: [href],
            imageDominated: true,
          },
        },
      ],
      spreads: [
        {
          spreadIndex: snapshot.presentationSpreadIndex,
          missingResources: [],
          resources: [
            {
              payload: {
                revisionId: snapshot.revision.revisionId,
                transferId: `${href}-transfer`,
                kind: 'image',
                href,
                mediaType: 'image/png',
                byteLength: 4,
              },
              bytes: new Uint8Array([1, 2, 3, 4]),
            },
          ],
        },
      ],
    },
  };
}
