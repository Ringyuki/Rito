import { describe, expect, it } from 'vitest';
import type { CorePageTargets, CoreVersioned } from '../../src/bindings/browser/core-contracts';
import {
  createBrowserReaderInteractions,
  resetBrowserReaderInteractionCache,
} from '../../src/bindings/browser/reader/interaction';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader interaction races', () => {
  it('coalesces same-page reads for one exact revision', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CorePageTargets>>();
    fixture.getPageTargetsAtRevision.mockReturnValue(deferred.promise);
    const interactions = createBrowserReaderInteractions(fixture.state);

    const first = interactions.getPageTargets(2);
    const second = interactions.getPageTargets(2);

    expect(fixture.getPageTargetsAtRevision).toHaveBeenCalledOnce();
    expect(fixture.getPageTargetsAtRevision).toHaveBeenCalledWith(handle(), 2);
    deferred.resolve(versionedTargets(2, 2, 'shared'));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ pageIndex: 2 }),
      expect.objectContaining({ pageIndex: 2 }),
    ]);
    expect(fixture.state.interaction.pendingPageTargets.size).toBe(0);
  });

  it.each(['worker', 'generation', 'version'] as const)(
    'drops a response after a %s identity change',
    async (change) => {
      const fixture = readyFixture();
      const deferred = createDeferred<CoreVersioned<CorePageTargets>>();
      fixture.getPageTargetsAtRevision.mockReturnValue(deferred.promise);
      const pending = createBrowserReaderInteractions(fixture.state).getPageTargets(0);

      changeIdentity(fixture.state, change);
      deferred.resolve(versionedTargets(0, 0, 'stale'));

      await expect(pending).resolves.toBeUndefined();
      expect(fixture.state.interaction.pageTargets.size).toBe(0);
    },
  );

  it('hides cached targets before dispatch whenever a visual preview is active', async () => {
    const fixture = readyFixture();
    fixture.getPageTargetsAtRevision.mockResolvedValue(versionedTargets(0, 0, 'cached'));
    const interactions = createBrowserReaderInteractions(fixture.state);
    await interactions.getPageTargets(0);
    expect(fixture.getPageTargetsAtRevision).toHaveBeenCalledOnce();

    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;

    await expect(interactions.getPageTargets(0)).resolves.toBeUndefined();
    expect(fixture.getPageTargetsAtRevision).toHaveBeenCalledOnce();
    expect(fixture.state.interaction.pageTargets.size).toBe(1);
  });

  it('drops an in-flight response when a visual preview starts', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CorePageTargets>>();
    fixture.getPageTargetsAtRevision.mockReturnValue(deferred.promise);
    const pending = createBrowserReaderInteractions(fixture.state).getPageTargets(0);

    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;
    deferred.resolve(versionedTargets(0, 0, 'preview-stale'));

    await expect(pending).resolves.toBeUndefined();
    expect(fixture.state.interaction.pageTargets.size).toBe(0);
  });

  it('keeps a new-generation pending task when the old task settles', async () => {
    const fixture = readyFixture();
    const oldRead = createDeferred<CoreVersioned<CorePageTargets>>();
    const newRead = createDeferred<CoreVersioned<CorePageTargets>>();
    fixture.getPageTargetsAtRevision
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(newRead.promise);
    const interactions = createBrowserReaderInteractions(fixture.state);
    const oldTask = interactions.getPageTargets(0);

    resetBrowserReaderInteractionCache(fixture.state);
    setRevisionState(fixture.state, revisionSummary('rev', 20, 20));
    const newTask = interactions.getPageTargets(0);
    const currentPending = fixture.state.interaction.pendingPageTargets.get(0)?.task;

    oldRead.resolve(versionedTargets(0, 0, 'old'));
    await expect(oldTask).resolves.toBeUndefined();
    expect(fixture.state.interaction.pendingPageTargets.get(0)?.task).toBe(currentPending);

    newRead.resolve(versionedTargets(0, 0, 'new'));
    await expect(newTask).resolves.toMatchObject({
      targets: [{ label: 'new' }],
    });
    expect(fixture.state.interaction.pageTargets.get(0)?.value.targets[0]?.label).toBe('new');
  });

  it('turns a rejected disposed read into an unavailable result', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CorePageTargets>>();
    fixture.getPageTargetsAtRevision.mockReturnValue(deferred.promise);
    const pending = createBrowserReaderInteractions(fixture.state).getPageTargets(0);

    fixture.state.disposed = true;
    resetBrowserReaderInteractionCache(fixture.state);
    deferred.reject(new Error('worker disposed'));

    await expect(pending).resolves.toBeUndefined();
    expect(fixture.state.interaction.pageTargets.size).toBe(0);
  });

  it('rejects a mismatched response handle while its request is still current', async () => {
    const fixture = readyFixture();
    fixture.getPageTargetsAtRevision.mockResolvedValue({
      revision: { revisionId: 'rev', revisionVersion: 1 },
      value: pageTargets(0, 0, 'forged'),
    });

    await expect(createBrowserReaderInteractions(fixture.state).getPageTargets(0)).rejects.toThrow(
      'does not match its revision request',
    );
    expect(fixture.state.interaction.pageTargets.size).toBe(0);
  });

  it('bounds page targets with LRU recency', async () => {
    const fixture = readyFixture();
    fixture.getPageTargetsAtRevision.mockImplementation((revision, pageIndex) =>
      Promise.resolve({
        revision,
        value: pageTargets(pageIndex, pageIndex, `page-${String(pageIndex)}`),
      }),
    );
    const interactions = createBrowserReaderInteractions(fixture.state);

    for (let pageIndex = 0; pageIndex <= 12; pageIndex += 1) {
      await interactions.getPageTargets(pageIndex);
    }
    expect([...fixture.state.interaction.pageTargets.keys()]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);

    await interactions.getPageTargets(1);
    await interactions.getPageTargets(13);
    expect([...fixture.state.interaction.pageTargets.keys()]).toEqual([
      3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 13,
    ]);
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'interaction-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 20, 20));
  return { ...fixture, state };
}

function handle() {
  return { revisionId: 'rev', revisionVersion: 0 };
}

function changeIdentity(
  state: BrowserReaderState,
  change: 'worker' | 'generation' | 'version',
): void {
  const current = state.revisionHandle;
  if (!current) throw new Error('test revision is missing');
  if (change === 'worker') {
    state.worker = createWorker(() => undefined, 'replacement-session').worker;
    return;
  }
  state.revisionHandle = {
    ...current,
    ...(change === 'generation'
      ? { commitGeneration: current.commitGeneration + 1 }
      : { revisionVersion: current.revisionVersion + 1 }),
  };
  if (change === 'generation') state.commitGeneration += 1;
}

function versionedTargets(
  pageIndex: number,
  spreadIndex: number,
  label: string,
): CoreVersioned<CorePageTargets> {
  return { revision: handle(), value: pageTargets(pageIndex, spreadIndex, label) };
}

function pageTargets(pageIndex: number, spreadIndex: number, label: string): CorePageTargets {
  return {
    revisionId: 'rev',
    pageIndex,
    spreadIndex,
    entryCount: 1,
    textHash: label,
    entries: [
      {
        kind: 'link',
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        blockIndex: 0,
        lineIndex: 0,
        runIndex: 0,
        label,
        text: { hash: label, length: label.length },
        href: '#target',
        targetLocator: { href: 'chapter.xhtml', anchorId: 'target' },
      },
    ],
  };
}
