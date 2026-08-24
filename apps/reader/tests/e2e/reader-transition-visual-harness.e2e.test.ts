import { expect, test } from '@playwright/test';
import {
  measureAtomicReaderTurn,
  measureVisualReaderTurn,
  requireAtomicReaderTurn,
  requireVisualReaderTurn,
  type ReaderVisualTransitionSnapshot,
} from './reader-transition-visual-harness';

test('accepts a multi-frame visual turn with preview-to-final handoff and no old-frame flash', () => {
  expect(() => {
    requireVisualReaderTurn(
      visualSnapshot(),
      { startedAt: 1, endedAt: 4 },
      'old.xhtml',
      'new.xhtml',
    );
  }).not.toThrow();
});

test('rejects animation metadata that completes without an intervening rAF sample', () => {
  expect(() => {
    requireVisualReaderTurn(
      visualSnapshot(),
      { startedAt: 2.5, endedAt: 2.75 },
      'old.xhtml',
      'new.xhtml',
    );
  }).toThrow(/one animation-frame interval/);
});

test('rejects preview handoff that flashes back to the old visual', () => {
  const snapshot = visualSnapshot();
  const samples = [...snapshot.samples];
  samples.splice(3, 0, {
    observedAt: 3.5,
    checksum: 'old',
    nonBlank: true,
    activeHref: 'new.xhtml',
    transitioning: 'true',
  });
  expect(() => {
    requireVisualReaderTurn(
      { ...snapshot, samples },
      { startedAt: 1, endedAt: 4 },
      'old.xhtml',
      'new.xhtml',
    );
  }).toThrow(/flashed back/);
});

test('measures calibrated rAF gaps and first visual/target response separately', () => {
  const snapshot = measuredVisualSnapshot();
  const lifecycle = { startedAt: 125, endedAt: 400 };
  requireVisualReaderTurn(snapshot, lifecycle, 'old.xhtml', 'new.xhtml');

  const measured = measureVisualReaderTurn(snapshot, lifecycle, 120, 'new.xhtml');

  expect(measured.firstVisualChangeAt).toBe(128);
  expect(measured.firstTargetFrameAt).toBe(144);
  expect(measured.animation).toMatchObject({
    durationMs: 52,
    nominalFrameIntervalMs: 16,
    maxFrameIntervalMs: 33,
    overBudgetFrameIntervalCount: 1,
    estimatedDroppedFrameCount: 1,
    blankFrameCount: 0,
  });
});

test('measures an exact-only atomic control without inventing animation metrics', () => {
  const snapshot = atomicVisualSnapshot();

  requireAtomicReaderTurn(snapshot, 'old.xhtml', 'new.xhtml');
  expect(measureAtomicReaderTurn(snapshot, 120, 'new.xhtml')).toEqual({
    firstVisualChangeAt: 144,
    firstTargetFrameAt: 144,
  });
});

function visualSnapshot(): ReaderVisualTransitionSnapshot {
  return {
    samples: [
      {
        observedAt: 0,
        checksum: 'old',
        nonBlank: true,
        activeHref: 'old.xhtml',
        transitioning: 'false',
      },
      {
        observedAt: 2,
        checksum: 'mixed',
        nonBlank: true,
        activeHref: 'old.xhtml',
        transitioning: 'true',
      },
      {
        observedAt: 3,
        checksum: 'preview',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'true',
      },
      {
        observedAt: 5,
        checksum: 'final',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'false',
      },
    ],
    overflowed: false,
    sampleSize: 32,
    maxSamples: 12_000,
    storedSampleBudgetBytes: 2 * 1024 * 1024,
  };
}

function measuredVisualSnapshot(): ReaderVisualTransitionSnapshot {
  const calibration = Array.from({ length: 8 }, (_, index) => ({
    observedAt: index * 16,
    checksum: 'old',
    nonBlank: true,
    activeHref: 'old.xhtml',
    transitioning: 'false' as const,
  }));
  return {
    samples: [
      ...calibration,
      {
        observedAt: 128,
        checksum: 'mixed',
        nonBlank: true,
        activeHref: 'old.xhtml',
        transitioning: 'true',
      },
      {
        observedAt: 144,
        checksum: 'target-a',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'true',
      },
      {
        observedAt: 177,
        checksum: 'target-b',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'true',
      },
      ...[193, 209, 225, 241, 257, 273].map((observedAt) => ({
        observedAt,
        checksum: 'target-b',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'true' as const,
      })),
      {
        observedAt: 401,
        checksum: 'final',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'false',
      },
    ],
    overflowed: false,
    sampleSize: 32,
    maxSamples: 12_000,
    storedSampleBudgetBytes: 2 * 1024 * 1024,
  };
}

function atomicVisualSnapshot(): ReaderVisualTransitionSnapshot {
  return {
    samples: [
      {
        observedAt: 112,
        checksum: 'old',
        nonBlank: true,
        activeHref: 'old.xhtml',
        transitioning: 'false',
      },
      {
        observedAt: 128,
        checksum: 'old',
        nonBlank: true,
        activeHref: 'old.xhtml',
        transitioning: 'false',
      },
      {
        observedAt: 144,
        checksum: 'target',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'false',
      },
      {
        observedAt: 160,
        checksum: 'target',
        nonBlank: true,
        activeHref: 'new.xhtml',
        transitioning: 'false',
      },
    ],
    overflowed: false,
    sampleSize: 32,
    maxSamples: 12_000,
    storedSampleBudgetBytes: 2 * 1024 * 1024,
  };
}
