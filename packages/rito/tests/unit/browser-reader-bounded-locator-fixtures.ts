import { expect, vi, type Mock } from 'vitest';
import type { ReaderLocator, ReaderLocatorResolution } from '../../src/reader';
import type {
  BrowserReaderBoundedSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import { copyReaderLocator } from '../../src/bindings/browser/reader/interaction-capture';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  createState,
  createWorker,
  frameBuffer,
  revisionResult,
  setRevisionState,
} from './browser-reader-reflow-fixtures';

export interface BoundedLocatorFixture {
  readonly state: BrowserReaderState;
  readonly worker: BrowserReaderWorkerClient;
  readonly owner: BrowserReaderBoundedSessionOwner;
  readonly initial: BrowserReaderBoundedSnapshot;
  readonly accept: (snapshot: BrowserReaderBoundedSnapshot) => void;
}

export function createBoundedLocatorFixture(): BoundedLocatorFixture {
  const fixture = createWorker(() => undefined, 'current-locator');
  const state = createState(fixture.worker);
  const initial = spreadSnapshot('current', 0);
  setRevisionState(state, initial.revision, initial.navigation);
  const snapshots = { current: initial };
  const currentOwner = boundedOwner(fixture.worker, {
    currentSnapshot: vi.fn(() => snapshots.current),
  });
  recordBrowserReaderAcceptedRevision(currentOwner, initial.revision);
  state.boundedSessions.current = currentOwner;
  mockLocatorAggregates(fixture.worker);
  return {
    state,
    worker: fixture.worker,
    owner: currentOwner,
    initial,
    accept(snapshot) {
      snapshots.current = snapshot;
      recordBrowserReaderAcceptedRevision(currentOwner, snapshot.revision);
    },
  };
}

export function boundedOwner(
  worker: BrowserReaderWorkerClient,
  overrides: Partial<BrowserReaderBoundedSessionOwner['controller']> = {},
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(() => Promise.resolve()),
      ...overrides,
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}

export function readerLocator(name: string): ReaderLocator {
  return { href: `${name}.xhtml`, anchorId: `${name}-anchor` };
}

export function locatorSnapshot(
  revisionId: string,
  locator: ReaderLocator,
  revisionVersion: number,
  spreadIndex: number,
): BrowserReaderBoundedSnapshot {
  const spreadCount = spreadIndex + 1;
  const result = revisionResult(revisionId, spreadCount, spreadCount, spreadIndex);
  const revision = {
    ...result.bundle.revision,
    revisionVersion,
    status: 'ready' as const,
    finalExtent: undefined,
  };
  const navigation = result.bundle.navigation;
  return {
    generation: revisionVersion + 1,
    revision,
    presentation: {
      revision,
      navigation,
      tocTargets: result.bundle.tocTargets,
      fontFamilies: result.bundle.fontFamilies,
    },
    navigation,
    target: {
      kind: 'locator',
      locator,
      resolution: {
        status: 'resolved',
        revisionId,
        locator,
        spineIdref: `${locator.href}-spine`,
        pageIndex: spreadIndex,
        spreadIndex,
        matchedBy: 'anchor',
      },
    },
    presentationSpreadIndex: spreadIndex,
    frameWindow: {
      plan: {
        revisionId,
        centerSpreadIndex: spreadIndex,
        displaySpreadIndex: spreadIndex,
        spreadIndexes: [spreadIndex],
      },
      frames: [frameBuffer(revisionId, spreadIndex)],
      spreads: [{ spreadIndex, resources: [] }],
    },
  };
}

export function publicResolution(snapshot: BrowserReaderBoundedSnapshot): ReaderLocatorResolution {
  if (snapshot.target.kind !== 'locator') throw new Error('Expected a locator snapshot');
  const resolution = snapshot.target.resolution;
  if (resolution.status !== 'resolved') throw new Error('Expected a resolved locator');
  return {
    status: 'resolved',
    locator: copyReaderLocator(resolution.locator),
    spineIdref: resolution.spineIdref,
    pageIndex: resolution.pageIndex,
    spreadIndex: resolution.spreadIndex,
    matchedBy: resolution.matchedBy,
  };
}

export function mockLocatorAggregates(worker: BrowserReaderWorkerClient): {
  readonly footnotes: Mock<BrowserReaderWorkerClient['getFootnotesAtRevision']>;
} {
  const footnotes = vi.fn<BrowserReaderWorkerClient['getFootnotesAtRevision']>((revision) =>
    Promise.resolve({
      revision,
      value: { revisionId: revision.revisionId, entries: {} },
    }),
  );
  Object.assign(worker, {
    getFootnotesAtRevision: footnotes,
    getChapterTextIndicesAtRevision: vi.fn<
      BrowserReaderWorkerClient['getChapterTextIndicesAtRevision']
    >((revision) =>
      Promise.resolve({
        revision,
        value: { revisionId: revision.revisionId, entries: {} },
      }),
    ),
  });
  return { footnotes };
}

export async function waitForCalls(mock: Mock, count: number): Promise<void> {
  for (let attempt = 0; attempt < 64 && mock.mock.calls.length < count; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledTimes(count);
}

function spreadSnapshot(revisionId: string, revisionVersion: number): BrowserReaderBoundedSnapshot {
  const result = revisionResult(revisionId, 1, 1, 0);
  const revision = {
    ...result.bundle.revision,
    revisionVersion,
    status: 'ready' as const,
    finalExtent: undefined,
  };
  const navigation = result.bundle.navigation;
  return {
    generation: revisionVersion + 1,
    revision,
    presentation: {
      revision,
      navigation,
      tocTargets: result.bundle.tocTargets,
      fontFamilies: result.bundle.fontFamilies,
    },
    navigation,
    target: { kind: 'spread', spreadIndex: 0 },
    presentationSpreadIndex: 0,
    frameWindow: {
      plan: {
        revisionId,
        centerSpreadIndex: 0,
        displaySpreadIndex: 0,
        spreadIndexes: [0],
      },
      frames: [frameBuffer(revisionId, 0)],
      spreads: [{ spreadIndex: 0, resources: [] }],
    },
  };
}
