import {
  requireAdvancedRevisionHandle,
  requireContinuationBatchCount,
  requireMatchingHandle,
  requireRevisionAdvance,
  requireRevisionSummary,
  requireRevisionTransferCount,
} from './core-wasm-versioned-validation-runtime.js';
import {
  requireMatchingSourceLocatorRequest,
  requireSourceLocatorRequest,
  requireSourceLocatorResolution,
} from './reader-worker-interaction-validation-runtime.js';

const ERROR_CODES = new Set([
  'bad-request',
  'engine-error',
  'internal-error',
  'unknown-revision',
  'stale-revision-version',
]);

export function requireSourceLocatorContinuationResult(
  value,
  previous,
  revision,
  locator,
  operation,
  maximum,
  maximumQuanta = 1,
) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned an invalid result`);
  }
  const advancedQuanta = requireContinuationBatchCount(
    value.advancedQuanta,
    maximumQuanta,
    operation,
  );
  requireAdvancedRevisionHandle(previous, revision, advancedQuanta, operation);
  const advance = requireRevisionAdvance(
    value.advance,
    revision,
    operation,
    processedNodeMaximum(maximum, advancedQuanta),
  );
  const canonicalRequest = requireSourceLocatorRequest(
    value.canonicalRequest,
    `${operation} canonical request`,
  );
  return {
    advance,
    releasedTransferCount: requireRevisionTransferCount(value.releasedTransferCount, operation),
    releasedRevision: requireMatchingHandle(
      value.releasedRevision,
      previous,
      `${operation} released revision`,
    ),
    request: requireMatchingSourceLocatorRequest(value.request, locator, operation),
    canonicalRequest,
    locatorOutcome: requireLocatorOutcome(
      value.locatorOutcome,
      revision,
      canonicalRequest,
      operation,
    ),
    advancedQuanta,
  };
}

function processedNodeMaximum(perQuantumMaximum, advancedQuanta) {
  const product = perQuantumMaximum * advancedQuanta;
  return Number.isSafeInteger(product) ? product : Number.MAX_SAFE_INTEGER;
}

function requireLocatorOutcome(value, revision, canonicalRequest, operation) {
  if (value?.kind === 'resolved') {
    const resolution = requireSourceLocatorResolution(value.resolution, revision, operation);
    requireMatchingSourceLocatorRequest(
      resolution.locator,
      canonicalRequest,
      `${operation} canonical resolution`,
    );
    return {
      kind: 'resolved',
      resolution,
    };
  }
  if (
    value?.kind !== 'failed' ||
    !ERROR_CODES.has(value.code) ||
    typeof value.message !== 'string' ||
    value.message.length === 0
  ) {
    throw new Error(`${operation} returned an invalid locator outcome`);
  }
  return {
    kind: 'failed',
    code: value.code,
    message: value.message,
    ...(value.revision !== undefined
      ? {
          revision: requireRevisionSummary(
            value.revision,
            `${operation} locator failure`,
            revision.revisionId,
            revision.revisionVersion,
            'failed',
          ),
        }
      : {}),
  };
}
