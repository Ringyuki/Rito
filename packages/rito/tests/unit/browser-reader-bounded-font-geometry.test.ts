import { describe, expect, it, vi } from 'vitest';
import {
  captureBrowserReaderCandidateHostFontMetrics,
  replaceBrowserReaderFontGeometryMutation,
  type BrowserReaderBoundedReplacementTarget,
} from '../../src/bindings/browser/bounded-font-geometry';
import type { BrowserReaderBoundedSnapshot } from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderBoundedSessionOwner } from '../../src/bindings/browser/reader-session-host';
import type { BrowserReaderBoundedLayoutRequest } from '../../src/bindings/browser/bounded-session-runtime';
import type { BrowserReaderState } from '../../src/bindings/browser/reader/types';
import { createState, createWorker } from './browser-reader-reflow-fixtures';

const TARGETS: readonly {
  readonly name: string;
  readonly target: BrowserReaderBoundedReplacementTarget;
  readonly notifyLayoutCommitted: boolean;
}[] = [
  { name: 'spread', target: { targetSpreadIndex: 4 }, notifyLayoutCommitted: false },
  {
    name: 'locator',
    target: { targetSpreadIndex: 1, preserveLocator: { href: 'chapter.xhtml' } },
    notifyLayoutCommitted: false,
  },
  {
    name: 'completion',
    target: { targetSpreadIndex: 1, complete: true },
    notifyLayoutCommitted: true,
  },
];

describe('Browser bounded font geometry replacement', () => {
  it('captures generic advances once when a publication font is unavailable', () => {
    const worker = createWorker(() => undefined, 'generic-fallback');
    const state = createState(worker.worker);
    state.fontMetrics.genericSerif = undefined;
    Object.assign(state.ctx, {
      save: vi.fn(),
      restore: vi.fn(),
      measureText: vi.fn(() => ({ width: 16 })),
      font: '',
      wordSpacing: '',
      letterSpacing: '',
    });
    const demands = [
      { fontFamily: 'missing', fontStyle: 'normal' as const, fontWeight: 400, fontSizePx: 16 },
    ];

    expect(captureBrowserReaderCandidateHostFontMetrics(state, demands, false, false)).toBe(true);
    expect(state.fontMetrics.genericSerif).toBeDefined();
    expect(state.fontMetrics.verticalMetrics).toEqual({});
    expect(captureBrowserReaderCandidateHostFontMetrics(state, demands, false, false)).toBe(false);
  });

  for (const { name, target, notifyLayoutCommitted } of TARGETS) {
    it(`preserves the ${name} target without an intermediate publication`, async () => {
      const current = createWorker(() => undefined, `current-${name}`);
      const candidate = createWorker(() => undefined, `candidate-${name}`);
      const state = createState(current.worker);
      const currentOwner = owner(current.worker);
      state.boundedSessions.current = currentOwner;
      Object.assign(state, { workerFactory: () => candidate.worker });
      candidate.open.mockResolvedValue({
        publication: state.publication,
        pinnedFontPolicy: state.pinnedFonts.summary,
      });
      const snapshot = {} as BrowserReaderBoundedSnapshot;
      const startCandidate = vi.fn(
        (
          _state: BrowserReaderState,
          _owner: BrowserReaderBoundedSessionOwner,
          _request: BrowserReaderBoundedLayoutRequest,
        ) => Promise.resolve(snapshot),
      );

      await expect(
        replaceBrowserReaderFontGeometryMutation(
          state,
          currentOwner,
          target,
          notifyLayoutCommitted,
          startCandidate,
        ),
      ).resolves.toBe(snapshot);

      expect(startCandidate).toHaveBeenCalledOnce();
      expect(startCandidate.mock.calls[0]?.[2]).toEqual({
        config: state.config,
        spreadMode: state.spreadMode,
        lineBreaking: state.lineBreaking,
        notifyLayoutCommitted,
        ...target,
      });
    });
  }

  it('retries only when a candidate captures another exact metric sample', async () => {
    const current = createWorker(() => undefined, 'current-retry');
    const candidates = [
      createWorker(() => undefined, 'candidate-retry-1'),
      createWorker(() => undefined, 'candidate-retry-2'),
    ];
    const state = createState(current.worker);
    const currentOwner = owner(current.worker);
    state.boundedSessions.current = currentOwner;
    let candidateIndex = 0;
    Object.assign(state, {
      workerFactory: () => candidates[candidateIndex++]?.worker ?? candidates[1]?.worker,
    });
    for (const candidate of candidates) {
      candidate.open.mockResolvedValue({
        publication: state.publication,
        pinnedFontPolicy: state.pinnedFonts.summary,
      });
    }
    const snapshot = {} as BrowserReaderBoundedSnapshot;
    const startCandidate = vi
      .fn<
        (
          state: BrowserReaderState,
          owner: BrowserReaderBoundedSessionOwner,
          request: BrowserReaderBoundedLayoutRequest,
        ) => Promise<BrowserReaderBoundedSnapshot | undefined>
      >()
      .mockImplementationOnce(() => {
        state.fontMetrics.verticalMetrics['new'] = {
          fontFamily: 'body',
          fontStyle: 'normal',
          fontWeight: 400,
          fontSizePx: 16,
          topBaselineAscentPx: 3,
          topBaselineDescentPx: 14,
        };
        return Promise.resolve(undefined);
      })
      .mockResolvedValueOnce(snapshot);

    await expect(
      replaceBrowserReaderFontGeometryMutation(
        state,
        currentOwner,
        { targetSpreadIndex: 2 },
        false,
        startCandidate,
      ),
    ).resolves.toBe(snapshot);

    expect(startCandidate).toHaveBeenCalledTimes(2);
  });
});

function owner(
  worker: ReturnType<typeof createWorker>['worker'],
): BrowserReaderBoundedSessionOwner {
  return {
    controller: {
      start: vi.fn(),
      ensureSpread: vi.fn(),
      ensureLocator: vi.fn(),
      complete: vi.fn(),
      currentSnapshot: vi.fn(),
      cancel: vi.fn(),
      dispose: vi.fn(),
    },
    worker,
    acceptedRevision: undefined,
    gateGeneration: 0,
    readsSuspended: false,
  };
}
