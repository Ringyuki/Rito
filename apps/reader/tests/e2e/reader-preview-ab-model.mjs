export function previewAbMetrics(report) {
  requirePreviewAbPresentationContract(report);
  const transition = report.transitions.farToc;
  const continuations = report.stages.farToc.operations.filter((operation) =>
    operation.kind.startsWith('continueRevision'),
  );
  return {
    acceptedToFirstVisualChangeMs: transition.latency.acceptedToFirstVisualChangeMs,
    acceptedToFirstTargetFrameMs: transition.latency.acceptedToFirstTargetFrameMs,
    acceptedToStableIdleObservationMs: transition.latency.acceptedToStableIdleObservationMs,
    firstTargetToStableIdleMs:
      transition.latency.acceptedToStableIdleObservationMs -
      transition.latency.acceptedToFirstTargetFrameMs,
    workerRequestsToFirstFrame: report.stages.farToc.workerRequestsToFirstFrame,
    totalWorkerRequestCount: report.stages.farToc.operations.length,
    continuationRequestCount: continuations.length,
    continuationNativeQuantumCount: continuations.reduce(
      (total, operation) => total + (operation.advancedQuanta ?? 1),
      0,
    ),
    continuationRoundTripTotalMs: continuations.reduce(
      (total, operation) => total + (operation.durationMs ?? 0),
      0,
    ),
  };
}

export function previewAbDescriptiveMetrics(report) {
  requirePreviewAbPresentationContract(report);
  const transition = report.transitions.farToc;
  return {
    animatedPresentation: transition.presentation === 'animated' ? 1 : 0,
    perceptibleMotionDurationMs: transition.animation?.durationMs ?? null,
    sampledMotionFrameCount: transition.animation?.sampledFrameCount ?? null,
    nominalFrameIntervalMs: transition.animation?.nominalFrameIntervalMs ?? null,
    p95MotionFrameIntervalMs: transition.animation?.p95FrameIntervalMs ?? null,
    maxMotionFrameIntervalMs: transition.animation?.maxFrameIntervalMs ?? null,
    estimatedDroppedMotionFrameCount: transition.animation?.estimatedDroppedFrameCount ?? null,
    distinctMotionVisualCount: transition.animation?.distinctVisualCount ?? null,
    logicalTransitionDurationMs: transition.latency.acceptedToTransitionEndMs,
    firstTargetFrameRelativeToTransitionEndMs:
      transition.latency.firstTargetFrameRelativeToTransitionEndMs,
  };
}

const LOGICAL_TRANSITION_LATENCY_NAMES = [
  'acceptedToTransitionStartMs',
  'firstTargetFrameRelativeToTransitionEndMs',
  'acceptedToTransitionEndMs',
];

const ANIMATION_METRIC_NAMES = [
  'durationMs',
  'sampledFrameCount',
  'nominalFrameIntervalMs',
  'p50FrameIntervalMs',
  'p95FrameIntervalMs',
  'maxFrameIntervalMs',
  'overBudgetFrameIntervalCount',
  'estimatedDroppedFrameCount',
  'distinctVisualCount',
  'blankFrameCount',
];

export function requirePreviewAbPresentationContract(report) {
  const transition = report.transitions.farToc;
  if (transition.presentation === 'animated') {
    requireFiniteFields(transition.latency, LOGICAL_TRANSITION_LATENCY_NAMES, 'animated latency');
    requireFiniteFields(transition.animation, ANIMATION_METRIC_NAMES, 'animated animation');
    return;
  }
  if (transition.presentation === 'atomic') {
    if (transition.animation !== null) {
      throw new Error('Reader preview A/B atomic presentation must not include animation metrics');
    }
    for (const name of LOGICAL_TRANSITION_LATENCY_NAMES) {
      if (transition.latency[name] !== null) {
        throw new Error(`Reader preview A/B atomic latency ${name} must be null`);
      }
    }
    return;
  }
  throw new Error('Reader preview A/B presentation must be animated or atomic');
}

export function ratioMetrics(numerator, denominator) {
  return Object.fromEntries(
    Object.keys(numerator).map((key) => [key, finiteRatio(numerator[key], denominator[key])]),
  );
}

export function medianMetrics(values) {
  if (values.length === 0) throw new Error('Cannot summarize an empty metric set');
  return Object.fromEntries(
    Object.keys(values[0]).map((key) => [key, finiteMedian(values.map((entry) => entry[key]))]),
  );
}

export function finiteMedian(values) {
  if (values.length === 0 || values.some((value) => !Number.isFinite(value))) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const result =
    sorted.length % 2 === 0
      ? sorted[middle - 1] + (sorted[middle] - sorted[middle - 1]) / 2
      : sorted[middle];
  return Number.isFinite(result) ? result : null;
}

function finiteRatio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

function requireFiniteFields(value, names, label) {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Reader preview A/B ${label} is missing`);
  }
  for (const name of names) {
    if (!Number.isFinite(value[name])) {
      throw new Error(`Reader preview A/B ${label} ${name} must be finite`);
    }
  }
}
