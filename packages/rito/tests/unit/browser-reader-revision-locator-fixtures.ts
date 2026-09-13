import { expect, vi, type Mock } from 'vitest';
import type { ReaderLocator, ReaderLocatorResolution } from '../../src/reader';
import type {
  BrowserReaderRevisionSnapshot,
  BrowserReaderWorkerClient,
} from '../../src/bindings/browser/core-contracts';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderRevisionSessionOwner,
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

export interface RevisionLocatorFixture {
  readonly state: BrowserReaderState;
  readonly worker: BrowserReaderWorkerClient;
  readonly owner: BrowserReaderRevisionSessionOwner;
  readonly initial: BrowserReaderRevisionSnapshot;
  readonly accept: (snapshot: BrowserReaderRevisionSnapshot) => void;
}

export function createRevisionLocatorFixture(): RevisionLocatorFixture {
  const fixture = createWorker(() => undefined, 'current-locator');
  const state = createState(fixture.worker);
  const initial = spreadSnapshot('current', 0);
  setRevisionState(state, initial.revision, initial.navigation);
  const snapshots = { current: initial };
  const currentOwner = revisionOwner(fixture.worker, {
    currentSnapshot: vi.fn(() => snapshots.current),
  });
  recordBrowserReaderAcceptedRevision(currentOwner, initial.revision);
  state.revisionSessions.current = currentOwner;
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

export function revisionOwner(
  worker: BrowserReaderWorkerClient,
  overrides: Partial<BrowserReaderRevisionSessionOwner['controller']> = {},
): BrowserReaderRevisionSessionOwner {
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
): BrowserReaderRevisionSnapshot {
  const spreadCount = spreadIndex + 1;
  const result = revisionResult(revisionId, spreadCount, spreadCount, spreadIndex);
  const revision = { ...result.bundle.revision, revisionVersion };
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
      spreads: [{ spreadIndex, resources: [], missingResources: [] }],
    },
  };
}

export function publicResolution(snapshot: BrowserReaderRevisionSnapshot): ReaderLocatorResolution {
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
      value: {
        revisionId: revision.revisionId,
        complete: true,
        pendingKeys: [],
        entries: {},
      },
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

export function spreadSnapshot(
  revisionId: string,
  revisionVersion: number,
  spreadIndex = 0,
  spreadCount = spreadIndex + 1,
): BrowserReaderRevisionSnapshot {
  const result = revisionResult(revisionId, spreadCount, spreadCount, spreadIndex);
  const revision = { ...result.bundle.revision, revisionVersion };
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
    target: { kind: 'spread', spreadIndex },
    presentationSpreadIndex: spreadIndex,
    frameWindow: {
      plan: {
        revisionId,
        centerSpreadIndex: spreadIndex,
        displaySpreadIndex: spreadIndex,
        spreadIndexes: [spreadIndex],
      },
      frames: [frameBuffer(revisionId, spreadIndex)],
      spreads: [{ spreadIndex, resources: [], missingResources: [] }],
    },
  };
}
