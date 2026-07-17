import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import { startBrowserReaderBoundedCandidate } from '../../src/bindings/browser/bounded-session-runtime';
import { recordBrowserReaderAcceptedRevision } from '../../src/bindings/browser/reader-session-host';
import type { BrowserReaderBoundedSessionOwner } from '../../src/bindings/browser/reader-session-host';
import {
  boundedOwner,
  locatorSnapshot,
  mockLocatorAggregates,
  spreadSnapshot,
} from './browser-reader-bounded-locator-fixtures';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

describe('Browser reader initial locator', () => {
  it('starts with the locator and commits its active spread', async () => {
    const fixture = createWorker(() => undefined, 'initial-locator');
    const state = createState(fixture.worker);
    const locator: ReaderLocator = {
      href: 'late.xhtml',
      sourcePoint: { nodePath: [1], textOffset: 4 },
    };
    const snapshot = locatorSnapshot('initial-locator', locator, 1, 3);
    const start = vi.fn<BrowserReaderBoundedSessionOwner['controller']['start']>(() =>
      Promise.resolve(snapshot),
    );
    const ensureLocator = vi.fn();
    const owner = boundedOwner(fixture.worker, { start, ensureLocator });
    recordBrowserReaderAcceptedRevision(owner, snapshot.revision);
    mockLocatorAggregates(fixture.worker);
    const committed = vi.fn();
    state.layoutCommittedListeners.add(committed);

    await expect(startInitialCandidate(state, owner, locator)).resolves.toBe(snapshot);

    const request = start.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      targetLocator: locator,
      budget: { maxTopLevelNodes: 32 },
      growthBudget: { maxTopLevelNodes: 32 },
    });
    expect(request).not.toHaveProperty('targetSpreadIndex');
    expect(request?.targetLocator).not.toBe(locator);
    expect(ensureLocator).not.toHaveBeenCalled();
    expect(state.activeSpreadIndex).toBe(3);
    expect(committed).toHaveBeenCalledWith(3);
  });

  it.each(['invalid', 'noPage'] as const)(
    'falls back through one public commit when the locator is %s',
    async (failure) => {
      const revisionId = `initial-${failure}`;
      const fixture = createWorker(() => undefined, revisionId);
      const state = createState(fixture.worker);
      const locator: ReaderLocator = { href: 'missing.xhtml' };
      const fallback = spreadSnapshot(revisionId, 1);
      const noPage = noPageSnapshot(revisionId, locator);
      const locatorError = new Error('initial locator is invalid');
      const start = vi.fn(() =>
        failure === 'invalid' ? Promise.reject(locatorError) : Promise.resolve(noPage),
      );
      const ensureSpread = vi.fn(() => Promise.resolve(fallback));
      const owner = boundedOwner(fixture.worker, { start, ensureSpread });
      recordBrowserReaderAcceptedRevision(owner, fallback.revision);
      mockLocatorAggregates(fixture.worker);
      const committed = vi.fn();
      state.layoutCommittedListeners.add(committed);

      await expect(startInitialCandidate(state, owner, locator)).resolves.toBe(fallback);

      expect(ensureSpread).toHaveBeenCalledWith(0);
      expect(state.activeSpreadIndex).toBe(0);
      expect(committed).toHaveBeenCalledOnce();
      expect(committed).toHaveBeenCalledWith(0);
    },
  );

  it('does not hide a locator failure for a non-initial candidate', async () => {
    const fixture = createWorker(() => undefined, 'reflow-locator-failure');
    const state = createState(fixture.worker);
    const locatorError = new Error('reflow locator failed');
    const ensureSpread = vi.fn();
    const owner = boundedOwner(fixture.worker, {
      start: vi.fn(() => Promise.reject(locatorError)),
      ensureSpread,
    });

    await expect(
      startBrowserReaderBoundedCandidate(state, owner, {
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        targetSpreadIndex: 2,
        preserveLocator: { href: 'chapter.xhtml' },
      }),
    ).rejects.toBe(locatorError);
    expect(ensureSpread).not.toHaveBeenCalled();
  });
});

function startInitialCandidate(
  state: ReturnType<typeof createState>,
  owner: BrowserReaderBoundedSessionOwner,
  locator: ReaderLocator,
) {
  return startBrowserReaderBoundedCandidate(state, owner, {
    config: state.config,
    spreadMode: state.spreadMode,
    lineBreaking: state.lineBreaking,
    targetSpreadIndex: 0,
    preserveLocator: locator,
    fallbackOnLocatorFailure: true,
  });
}

function noPageSnapshot(revisionId: string, locator: ReaderLocator) {
  const snapshot = locatorSnapshot(revisionId, locator, 1, 0);
  return {
    ...snapshot,
    target: {
      kind: 'locator' as const,
      locator,
      resolution: {
        status: 'pending' as const,
        revisionId,
        locator,
        spineIdref: 'missing',
        reason: 'noPageProjection' as const,
        matchedBy: 'href' as const,
      },
    },
  };
}
