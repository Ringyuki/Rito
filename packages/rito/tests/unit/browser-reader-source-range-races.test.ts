import { describe, expect, it } from 'vitest';
import type {
  CoreExactSourceRangeResponse,
  CoreVersioned,
} from '../../src/bindings/browser/core-contracts';
import { createBrowserReaderInteractions } from '../../src/bindings/browser/reader/interaction';
import type { ReaderInteractions } from '../../src/reader';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createDeferred,
  createState,
  createWorker,
  revisionSummary,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

describe('Browser reader exact source-range races', () => {
  it('does not dispatch while a visual preview is active', async () => {
    const fixture = readyFixture();
    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));

    await expect(interactions.resolveExactSourceRange(request())).resolves.toBeUndefined();
    expect(fixture.resolveExactSourceRangeAtRevision).not.toHaveBeenCalled();
  });

  it('does not dispatch after the reader is disposed', async () => {
    const fixture = readyFixture();
    fixture.state.disposed = true;
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));

    await expect(interactions.resolveExactSourceRange(request())).resolves.toBeUndefined();
    expect(fixture.resolveExactSourceRangeAtRevision).not.toHaveBeenCalled();
  });

  it.each(['worker', 'generation', 'version'] as const)(
    'drops an in-flight response after a %s identity change',
    async (change) => {
      const fixture = readyFixture();
      const deferred = createDeferred<CoreVersioned<CoreExactSourceRangeResponse>>();
      fixture.resolveExactSourceRangeAtRevision.mockReturnValue(deferred.promise);
      const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));
      const pending = interactions.resolveExactSourceRange(request());

      changeIdentity(fixture.state, change);
      deferred.resolve(pendingResponse());

      await expect(pending).resolves.toBeUndefined();
    },
  );

  it('drops an in-flight response when a visual preview starts', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CoreExactSourceRangeResponse>>();
    fixture.resolveExactSourceRangeAtRevision.mockReturnValue(deferred.promise);
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));
    const pending = interactions.resolveExactSourceRange(request());

    fixture.state.visualPreview = {} as typeof fixture.state.visualPreview;
    deferred.resolve(pendingResponse());

    await expect(pending).resolves.toBeUndefined();
  });

  it('turns a rejected disposed read into an unavailable result', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CoreExactSourceRangeResponse>>();
    fixture.resolveExactSourceRangeAtRevision.mockReturnValue(deferred.promise);
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));
    const pending = interactions.resolveExactSourceRange(request());

    fixture.state.disposed = true;
    deferred.reject(new Error('worker disposed'));

    await expect(pending).resolves.toBeUndefined();
  });

  it('isolates the worker request from caller mutation', async () => {
    const fixture = readyFixture();
    const deferred = createDeferred<CoreVersioned<CoreExactSourceRangeResponse>>();
    fixture.resolveExactSourceRangeAtRevision.mockReturnValue(deferred.promise);
    const interactions = requireCapability(createBrowserReaderInteractions(fixture.state));
    const input = request();
    const pending = interactions.resolveExactSourceRange(input);
    const mutablePath = input.sourceRange.start.nodePath;

    mutablePath[0] = 99;

    expect(fixture.resolveExactSourceRangeAtRevision.mock.calls[0]?.[1]).toEqual(request());
    deferred.resolve(pendingResponse());
    await expect(pending).resolves.toEqual({ status: 'pending', reason: 'notPaginated' });
  });
});

function readyFixture() {
  const fixture = createWorker(() => undefined, 'source-range-race-session');
  const state = createState(fixture.worker);
  setRevisionState(state, revisionSummary('rev', 1, 1));
  return { ...fixture, state };
}

function requireCapability(
  interactions: ReaderInteractions,
): Required<Pick<ReaderInteractions, 'resolveExactSourceRange'>> {
  if (!interactions.resolveExactSourceRange) {
    throw new Error('missing exact source-range capability');
  }
  return interactions as Required<Pick<ReaderInteractions, 'resolveExactSourceRange'>>;
}

function request() {
  return {
    href: 'Text/chapter.xhtml',
    sourceRange: {
      start: { nodePath: [0, 1], textOffset: 2 },
      end: { nodePath: [0, 1], textOffset: 7 },
    },
  };
}

function pendingResponse(): CoreVersioned<CoreExactSourceRangeResponse> {
  return {
    revision: { revisionId: 'rev', revisionVersion: 0 },
    value: { revisionId: 'rev', resolution: { status: 'pending', reason: 'notPaginated' } },
  };
}

function changeIdentity(
  state: BrowserReaderState,
  change: 'worker' | 'generation' | 'version',
): void {
  const current = state.revisionHandle;
  if (!current) throw new Error('test revision is missing');
  if (change === 'worker') {
    state.worker = createWorker(() => undefined, 'replacement-source-range-session').worker;
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
