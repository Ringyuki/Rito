import assert from 'node:assert/strict';
import test from 'node:test';
import {
  finiteMedian,
  medianMetrics,
  previewAbDescriptiveMetrics,
  previewAbMetrics,
  ratioMetrics,
} from './reader-preview-ab-model.mjs';

const commonLatency = {
  acceptedToFirstVisualChangeMs: 12,
  acceptedToFirstTargetFrameMs: 28,
  acceptedToStableIdleObservationMs: 72,
};

const animatedLatency = {
  ...commonLatency,
  acceptedToTransitionStartMs: 4,
  firstTargetFrameRelativeToTransitionEndMs: -8,
  acceptedToTransitionEndMs: 36,
};

const animation = {
  durationMs: 32,
  sampledFrameCount: 3,
  nominalFrameIntervalMs: 16,
  p50FrameIntervalMs: 16,
  p95FrameIntervalMs: 17,
  maxFrameIntervalMs: 18,
  overBudgetFrameIntervalCount: 0,
  estimatedDroppedFrameCount: 0,
  distinctVisualCount: 3,
  blankFrameCount: 0,
};

test('finiteMedian returns the ordinary median for finite samples', () => {
  assert.equal(finiteMedian([9, 1, 5]), 5);
  assert.equal(finiteMedian([9, 1, 5, 3]), 4);
});

test('finiteMedian fails closed for empty or nullable samples', () => {
  assert.equal(finiteMedian([]), null);
  assert.equal(finiteMedian([1, null]), null);
  assert.equal(finiteMedian([1, Number.NaN]), null);
});

test('ratioMetrics preserves zero denominators as null', () => {
  assert.deepEqual(
    ratioMetrics({ latencyMs: 12, droppedCount: 0 }, { latencyMs: 6, droppedCount: 0 }),
    { latencyMs: 2, droppedCount: null },
  );
});

test('medianMetrics does not coerce a null ratio to zero', () => {
  assert.deepEqual(
    medianMetrics([
      { latencyMs: 2, droppedCount: null },
      { latencyMs: 4, droppedCount: 3 },
    ]),
    { latencyMs: 3, droppedCount: null },
  );
});

test('ratioMetrics and finiteMedian fail closed on overflow', () => {
  assert.deepEqual(ratioMetrics({ value: Number.MAX_VALUE }, { value: Number.MIN_VALUE }), {
    value: null,
  });
  assert.equal(finiteMedian([-Number.MAX_VALUE, Number.MAX_VALUE]), null);
});

test('schema-v5 animated reports expose motion and logical-transition descriptors', () => {
  const report = reportWithFarToc({
    presentation: 'animated',
    latency: animatedLatency,
    animation,
  });

  assert.deepEqual(previewAbMetrics(report), {
    acceptedToFirstVisualChangeMs: 12,
    acceptedToFirstTargetFrameMs: 28,
    acceptedToStableIdleObservationMs: 72,
    firstTargetToStableIdleMs: 44,
    workerRequestsToFirstFrame: 2,
    totalWorkerRequestCount: 3,
    continuationRequestCount: 2,
    continuationNativeQuantumCount: 9,
    continuationRoundTripTotalMs: 7,
  });
  assert.deepEqual(previewAbDescriptiveMetrics(report), {
    animatedPresentation: 1,
    perceptibleMotionDurationMs: 32,
    sampledMotionFrameCount: 3,
    nominalFrameIntervalMs: 16,
    p95MotionFrameIntervalMs: 17,
    maxMotionFrameIntervalMs: 18,
    estimatedDroppedMotionFrameCount: 0,
    distinctMotionVisualCount: 3,
    logicalTransitionDurationMs: 36,
    firstTargetFrameRelativeToTransitionEndMs: -8,
  });
});

test('schema-v5 atomic reports preserve common metrics and use null descriptive metrics', () => {
  const report = reportWithFarToc({
    presentation: 'atomic',
    latency: {
      ...commonLatency,
      acceptedToTransitionStartMs: null,
      firstTargetFrameRelativeToTransitionEndMs: null,
      acceptedToTransitionEndMs: null,
    },
    animation: null,
  });

  assert.equal(previewAbMetrics(report).firstTargetToStableIdleMs, 44);
  assert.deepEqual(previewAbDescriptiveMetrics(report), {
    animatedPresentation: 0,
    perceptibleMotionDurationMs: null,
    sampledMotionFrameCount: null,
    nominalFrameIntervalMs: null,
    p95MotionFrameIntervalMs: null,
    maxMotionFrameIntervalMs: null,
    estimatedDroppedMotionFrameCount: null,
    distinctMotionVisualCount: null,
    logicalTransitionDurationMs: null,
    firstTargetFrameRelativeToTransitionEndMs: null,
  });
});

test('schema-v5 report extraction rejects mixed presentation contracts', () => {
  assert.throws(
    () =>
      previewAbDescriptiveMetrics(
        reportWithFarToc({ presentation: 'animated', latency: animatedLatency, animation: null }),
      ),
    /animated animation is missing/,
  );
  assert.throws(
    () =>
      previewAbMetrics(
        reportWithFarToc({
          presentation: 'atomic',
          latency: animatedLatency,
          animation: null,
        }),
      ),
    /atomic latency acceptedToTransitionStartMs must be null/,
  );
  assert.throws(
    () =>
      previewAbMetrics(
        reportWithFarToc({
          presentation: 'atomic',
          latency: {
            ...commonLatency,
            acceptedToTransitionStartMs: null,
            firstTargetFrameRelativeToTransitionEndMs: null,
            acceptedToTransitionEndMs: null,
          },
          animation,
        }),
      ),
    /atomic presentation must not include animation metrics/,
  );
});

function reportWithFarToc(transition) {
  return {
    transitions: { farToc: transition },
    stages: {
      farToc: {
        workerRequestsToFirstFrame: 2,
        operations: [
          { kind: 'continueRevision', durationMs: 3, advancedQuanta: 8 },
          { kind: 'warmFrameWindowAtRevision', durationMs: 11 },
          { kind: 'continueRevisionTowardSourceLocator', durationMs: 4 },
        ],
      },
    },
  };
}
