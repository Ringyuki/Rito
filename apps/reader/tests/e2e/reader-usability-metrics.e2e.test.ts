import { expect, test } from '@playwright/test';
import { buildTocSupersedeTransition, copyFreshFarGeneration } from './reader-profile-toc-model';
import {
  requireChapterLocalPreviewOperations,
  requireTocSupersedeTimeline,
} from './reader-profile-protocol';
import { evaluateReaderUsabilityCase } from './reader-usability-gate';
import { readerChapterLocalPreviewModeFromEnv } from './reader-chapter-local-preview-mode';
import { readerProfileExecutionIdentity } from './reader-profile-artifact';
import {
  readerWorkerResponseHoldCategory,
  readerWorkerTocResponseHoldPlan,
  type ReaderWorkerOperationObservation,
} from './reader-worker-probe';
import {
  READER_GATE_TEST_SHA256 as SHA256,
  readerGateTestMetrics as metrics,
  readerGateTestProfile as profile,
} from './reader-usability-gate-test-data';

test('keeps chapter-local preview on by default and disables it only for explicit cold A/B runs', () => {
  expect(readerChapterLocalPreviewModeFromEnv({})).toBe('enabled');
  expect(
    readerChapterLocalPreviewModeFromEnv({ RITO_READER_DISABLE_CHAPTER_LOCAL_PREVIEW: '1' }),
  ).toBe('disabled');
  expect(
    readerChapterLocalPreviewModeFromEnv({ RITO_READER_DISABLE_CHAPTER_LOCAL_PREVIEW: '0' }),
  ).toBe('enabled');
});

test('requires strict no-rebuild execution for identified A/B pairs', () => {
  expect(() =>
    readerProfileExecutionIdentity({
      RITO_READER_PROFILE_AB_PAIR_ID: 'pair-1',
      RITO_READER_PROFILE_AB_ORDER: '0',
    }),
  ).toThrow(/strict server and skipped E2E rebuild/);
  expect(
    readerProfileExecutionIdentity({
      RITO_READER_PROFILE_AB_PAIR_ID: 'pair-1',
      RITO_READER_PROFILE_AB_ORDER: '1',
      RITO_READER_SKIP_E2E_BUILD: '1',
      RITO_READER_STRICT_SERVER: '1',
    }),
  ).toMatchObject({ abPairId: 'pair-1', abOrder: 1 });
});

test('arms exact dual response categories only when chapter-local preview is enabled', () => {
  expect(readerWorkerTocResponseHoldPlan(true)).toEqual({
    mainContinuation: true,
    chapterLocalMutation: true,
  });
  expect(readerWorkerTocResponseHoldPlan(false)).toEqual({
    mainContinuation: true,
    chapterLocalMutation: false,
  });
  expect(readerWorkerResponseHoldCategory('continueRevisionTowardSourceLocator')).toBe(
    'mainContinuation',
  );
  expect(readerWorkerResponseHoldCategory('createBoundedChapterLocalRevision')).toBe(
    'chapterLocalMutation',
  );
  expect(readerWorkerResponseHoldCategory('releaseChapterLocalRevision')).toBeUndefined();
});

test('proves the configured preview mode from observed chapter-local worker traffic', () => {
  const operation = chapterLocalOperation();
  expect(() => {
    requireChapterLocalPreviewOperations('enabled', 'chapter.xhtml#target', 20, [operation]);
  }).not.toThrow();
  expect(() => {
    requireChapterLocalPreviewOperations('disabled', 'chapter.xhtml', 20, [operation]);
  }).toThrow(/unexpectedly ran/);
  expect(() => {
    requireChapterLocalPreviewOperations('enabled', 'other.xhtml', 20, [operation]);
  }).toThrow(/did not observe target/);
});

test('maps cached-turn first-frame and stable timings from separate stage durations', () => {
  const report = profile(1);
  const summary = evaluateReaderUsabilityCase(
    { id: 'fixture', epub: '/fixture.epub', sha256: SHA256, thresholds: metrics(400) },
    [
      {
        ...report,
        stages: {
          ...report.stages,
          cachedTurn: {
            ...report.stages.cachedTurn,
            durationMs: 17,
            observedDurationMs: 321,
          },
        },
      },
    ],
    1,
  );

  expect(summary.p95.cachedTurnFirstFrameMs).toBe(17);
  expect(summary.p95.cachedTurnStableMs).toBe(321);
});

test('maps TOC first frames and the far-target worker request count independently', () => {
  const report = profile(1);
  const summary = evaluateReaderUsabilityCase(
    { id: 'fixture', epub: '/fixture.epub', sha256: SHA256, thresholds: metrics(400) },
    [
      {
        ...report,
        stages: {
          ...report.stages,
          tocSupersede: { ...report.stages.tocSupersede, durationMs: 23 },
          farToc: {
            ...report.stages.farToc,
            durationMs: 89,
            workerRequestsToFirstFrame: 11,
          },
        },
      },
    ],
    1,
  );

  expect(summary.p95.tocSupersedeFirstFrameMs).toBe(23);
  expect(summary.p95.farTocFirstFrameMs).toBe(89);
  expect(summary.p95.farTocWorkerRequestsToFirstFrame).toBe(11);
});

test('does not count a pending far commit synchronously flushed before near acceptance', () => {
  const transition = buildTocSupersedeTransition({
    fromHref: 'chapter-2.xhtml',
    toHref: 'chapter-1.xhtml',
    supersededHref: 'chapter-99.xhtml',
    observedHrefs: ['chapter-99.xhtml', 'chapter-1.xhtml'],
    observedHrefObservations: [
      { href: 'chapter-99.xhtml', observedAt: 9 },
      { href: 'chapter-1.xhtml', observedAt: 11 },
    ],
    supersededAt: 10,
    heldContinuationRequestId: 41,
    heldResponses: [
      {
        workerId: 1,
        category: 'mainContinuation',
        kind: 'continueRevision',
        requestId: 41,
        heldAt: 5,
        releasedAt: 6,
      },
    ],
    checksumBefore: 'before',
    checksumAfter: 'after',
  });

  expect(transition.toHref).toBe('chapter-1.xhtml');
  expect(transition.supersededHref).toBe('chapter-99.xhtml');
  expect(transition.staleCommitCount).toBe(0);
  expect(() => {
    requireTocSupersedeTimeline(transition);
  }).not.toThrow();
});

test('counts a far TOC commit observed at or after supersede acceptance as stale', () => {
  const transition = buildTocSupersedeTransition({
    fromHref: 'chapter-2.xhtml',
    toHref: 'chapter-1.xhtml',
    supersededHref: 'chapter-99.xhtml',
    observedHrefs: ['chapter-99.xhtml', 'chapter-1.xhtml'],
    observedHrefObservations: [
      { href: 'chapter-99.xhtml', observedAt: 10 },
      { href: 'chapter-1.xhtml', observedAt: 11 },
    ],
    supersededAt: 10,
    heldContinuationRequestId: 41,
    heldResponses: [
      {
        workerId: 1,
        category: 'mainContinuation',
        kind: 'continueRevision',
        requestId: 41,
        heldAt: 5,
        releasedAt: 6,
      },
    ],
    checksumBefore: 'before',
    checksumAfter: 'after',
  });

  expect(transition.staleCommitCount).toBe(1);
  expect(() => {
    requireTocSupersedeTimeline(transition);
  }).toThrow(/stale far target/);
});

test('keeps worker-generation evidence independent from locally scoped revision ids', () => {
  const previousRevisionIds = ['rev-1'];
  const freshRevisionIds = ['rev-1'];
  const generation = copyFreshFarGeneration({
    previousRevisionIds,
    freshRevisionIds,
    previousWorkerCount: 1,
    closedWorkerCount: 1,
    workersBeforeOpen: 0,
    freshWorkerCount: 1,
    positionStorageKey: 'rito-position',
    positionClearedBeforeOpen: true,
    freshProbeOperationIndex: 0,
    freshOpenRequestId: 1,
    freshRevisionRequestId: 2,
    checksumAfter: 'fresh',
  });
  previousRevisionIds.push('rev-2');
  freshRevisionIds.push('rev-2');

  expect(generation.previousRevisionIds).toEqual(['rev-1']);
  expect(generation.freshRevisionIds).toEqual(['rev-1']);
});

function chapterLocalOperation(): ReaderWorkerOperationObservation {
  return {
    workerId: 1,
    requestId: 7,
    kind: 'createBoundedChapterLocalRevision',
    startedAt: 10,
    requestBytes: 128,
    maxTopLevelNodes: 32,
    maxQuanta: null,
    processedTopLevelNodes: 4,
    advancedQuanta: null,
    spreadIndex: null,
    completedAt: 15,
    durationMs: 5,
    ok: true,
    responseKind: 'createBoundedChapterLocalRevision',
    releasedDocument: null,
    requestedRevision: null,
    revision: null,
    chapterLocalRevision: {
      revisionId: 'local-1',
      revisionVersion: 0,
      chapterIndex: 3,
      href: 'chapter.xhtml',
      status: 'ready',
      knownLocalPageCount: 1,
      knownLocalSpreadCount: 1,
    },
    error: null,
  };
}
