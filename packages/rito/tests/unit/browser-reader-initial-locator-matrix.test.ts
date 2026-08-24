import { describe, expect, it, vi } from 'vitest';
import type { ReaderLocator } from '../../src/reader';
import { startBrowserReaderBoundedCandidate } from '../../src/bindings/browser/bounded-session-runtime';
import { makeBrowserReaderLayoutConfig } from '../../src/bindings/browser/reader-layout';
import {
  recordBrowserReaderAcceptedRevision,
  type BrowserReaderBoundedSessionOwner,
} from '../../src/bindings/browser/reader-session-host';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import {
  boundedOwner,
  locatorSnapshot,
  mockLocatorAggregates,
} from './browser-reader-bounded-locator-fixtures';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

type PositionName = 'start' | 'middle' | 'tail';
type CacheState = 'cold' | 'stale';

interface InitialLocatorMatrixCase {
  readonly cache: CacheState;
  readonly height: number;
  readonly name: string;
  readonly position: PositionName;
  readonly spreadIndex: number;
  readonly spreadMode: 'single' | 'double';
  readonly width: number;
}

const POSITIONS = [
  {
    name: 'start' as const,
    singleViewport: { width: 390, height: 844 },
    doubleViewport: { width: 844, height: 390 },
    singleSpread: 2,
    doubleSpread: 1,
  },
  {
    name: 'middle' as const,
    singleViewport: { width: 768, height: 1024 },
    doubleViewport: { width: 1024, height: 768 },
    singleSpread: 5,
    doubleSpread: 3,
  },
  {
    name: 'tail' as const,
    singleViewport: { width: 900, height: 1440 },
    doubleViewport: { width: 1440, height: 900 },
    singleSpread: 8,
    doubleSpread: 5,
  },
] as const;

const INITIAL_LOCATOR_MATRIX: readonly InitialLocatorMatrixCase[] = POSITIONS.flatMap((position) =>
  (['single', 'double'] as const).flatMap((spreadMode) =>
    (['cold', 'stale'] as const).map((cache) => ({
      cache,
      height:
        spreadMode === 'single' ? position.singleViewport.height : position.doubleViewport.height,
      name: `${position.name}/${spreadMode}/${cache}`,
      position: position.name,
      spreadIndex: spreadMode === 'single' ? position.singleSpread : position.doubleSpread,
      spreadMode,
      width:
        spreadMode === 'single' ? position.singleViewport.width : position.doubleViewport.width,
    })),
  ),
);

describe('Browser reader initial exact-locator matrix', () => {
  it.each(INITIAL_LOCATOR_MATRIX)(
    '$name publishes only the exact nonzero target as its first accepted artifact',
    async ({ cache, height, position, spreadIndex, spreadMode, width }) => {
      const fixture = createWorker(() => undefined, `initial-${position}-${spreadMode}-${cache}`);
      const state = createState(fixture.worker);
      state.config = makeBrowserReaderLayoutConfig(
        { width, height, margin: 24, spread: spreadMode },
        spreadMode,
      );
      state.spreadMode = spreadMode;
      if (cache === 'stale') seedStaleFrames(state, spreadIndex);

      const locator = exactLocator(position);
      const snapshot = exactLocatorSnapshot(fixture.worker.sessionId, locator, spreadIndex);
      const start = vi.fn<BrowserReaderBoundedSessionOwner['controller']['start']>(() =>
        Promise.resolve(snapshot),
      );
      const ensureLocator = vi.fn();
      const owner = boundedOwner(fixture.worker, { start, ensureLocator });
      recordBrowserReaderAcceptedRevision(owner, snapshot.revision);
      mockLocatorAggregates(fixture.worker);
      const publications: Array<{
        readonly frameRevision: string | undefined;
        readonly revisionId: string;
        readonly spreadIndex: number;
      }> = [];
      state.layoutCommittedListeners.add((committedSpreadIndex) => {
        publications.push({
          frameRevision: state.frames.get(committedSpreadIndex)?.revisionId,
          revisionId: state.revisionBundle.revision.revisionId,
          spreadIndex: committedSpreadIndex,
        });
      });

      await expect(startInitialCandidate(state, owner, locator)).resolves.toBe(snapshot);

      const request = start.mock.calls[0]?.[0];
      expect(request).toMatchObject({
        layoutConfig: { viewportWidth: width, viewportHeight: height, spreadMode },
        targetLocator: locator,
      });
      expect(request).not.toHaveProperty('targetSpreadIndex');
      expect(ensureLocator).not.toHaveBeenCalled();
      expect(publications).toEqual([
        {
          frameRevision: snapshot.revision.revisionId,
          revisionId: snapshot.revision.revisionId,
          spreadIndex,
        },
      ]);
      expect(state.activeSpreadIndex).toBe(spreadIndex);
      expect([...state.frames.keys()]).toEqual([spreadIndex]);
      expect(state.frames.has(0)).toBe(false);
      expect(state.decodeFrameCommandBuffer).toHaveBeenCalledOnce();
    },
  );
});

function startInitialCandidate(
  state: BrowserReaderState,
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

function exactLocator(position: PositionName): ReaderLocator {
  const sourcePoint =
    position === 'start'
      ? { nodePath: [0], textOffset: 0 }
      : position === 'middle'
        ? { nodePath: [3, 1], textOffset: 17 }
        : { nodePath: [9, 2], textOffset: 98 };
  return {
    href: 'Text/Section001.xhtml',
    sourcePoint,
    progression: position === 'start' ? 0 : position === 'middle' ? 0.5 : 0.99,
  };
}

function exactLocatorSnapshot(revisionId: string, locator: ReaderLocator, spreadIndex: number) {
  const snapshot = locatorSnapshot(revisionId, locator, 1, spreadIndex);
  if (snapshot.target.kind !== 'locator' || snapshot.target.resolution.status !== 'resolved') {
    throw new Error('Expected a resolved locator snapshot fixture');
  }
  return {
    ...snapshot,
    target: {
      ...snapshot.target,
      resolution: { ...snapshot.target.resolution, matchedBy: 'sourcePoint' as const },
    },
  };
}

function seedStaleFrames(state: BrowserReaderState, targetSpreadIndex: number): void {
  for (const spreadIndex of [0, targetSpreadIndex]) {
    state.frames.set(spreadIndex, {
      revisionId: 'stale-revision',
      spreadIndex,
      width: state.config.viewportWidth,
      height: state.config.viewportHeight,
      commands: [],
      commandHash: 'stale',
      resourceRefs: { images: [] },
      fontFamilies: [],
      imageDominated: false,
    });
  }
}
