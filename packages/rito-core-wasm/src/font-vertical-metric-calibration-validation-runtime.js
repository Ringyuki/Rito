import {
  requireFlatRevisionHandle,
  requireMatchingHandle,
  requireObjectInput,
  requireRevisionSummary,
  requireRevisionTransferCount,
} from './core-wasm-versioned-validation-runtime.js';
import { requireFontVerticalMetricSamples } from './font-vertical-metric-validation-runtime.js';

export function requireFontVerticalMetricCalibrationRequest(value, operation) {
  const input = requireObjectInput(value, operation);
  const revision = requireFlatRevisionHandle(input, operation);
  const continuation = requireCalibrationContinuation(
    input.continuation,
    revision,
    operation,
    'optional',
  );
  return {
    ...revision,
    ...(continuation === undefined ? {} : { continuation }),
    fontVerticalMetrics: requireFontVerticalMetricSamples(input.fontVerticalMetrics, operation),
  };
}

export function requireFontVerticalMetricCalibrationResult(value, revision, operation) {
  const result = requireObjectInput(value, `${operation} result`);
  const summary = requireRevisionSummary(
    result.revision,
    operation,
    revision.revisionId,
    revision.revisionVersion,
  );
  if (summary.status !== 'warming' && summary.status !== 'ready' && summary.status !== 'complete') {
    throw new Error(`${operation} returned an invalid calibrated revision status`);
  }
  const continuation = requireCalibrationContinuation(
    result.continuation,
    revision,
    operation,
    summary.status === 'complete' ? 'forbidden' : 'required',
  );
  return {
    revision: summary,
    ...(continuation === undefined ? {} : { continuation }),
    calibratedPublishedRunCount: requireCalibrationCount(
      result.calibratedPublishedRunCount,
      `${operation} calibrated published run count`,
    ),
    calibratedUnpublishedRunCount: requireCalibrationCount(
      result.calibratedUnpublishedRunCount,
      `${operation} calibrated unpublished run count`,
    ),
  };
}

export function requireFontVerticalMetricCalibrationTransferResult(
  value,
  previous,
  revision,
  operation,
) {
  const result = requireObjectInput(value, `${operation} result`);
  return {
    ...requireFontVerticalMetricCalibrationResult(result, revision, operation),
    releasedRevision: requireMatchingHandle(
      result.releasedRevision,
      previous,
      `${operation} released revision`,
    ),
    releasedTransferCount: requireRevisionTransferCount(result.releasedTransferCount, operation),
  };
}

function requireCalibrationContinuation(value, revision, operation, mode) {
  if (value === undefined) {
    if (mode === 'required') {
      throw new Error(`${operation} returned no active revision continuation`);
    }
    return undefined;
  }
  if (mode === 'forbidden') {
    throw new Error(`${operation} returned a continuation for a complete revision`);
  }
  const continuation = requireObjectInput(value, `${operation} continuation`);
  const handle = requireMatchingHandle(continuation, revision, `${operation} continuation`);
  if (typeof continuation.cursor !== 'string' || continuation.cursor.length === 0) {
    throw new Error(`${operation} received an invalid continuation cursor`);
  }
  return { ...handle, cursor: continuation.cursor };
}

function requireCalibrationCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} was invalid`);
  }
  return value;
}
