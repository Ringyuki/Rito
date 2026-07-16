import { RitoCoreWasmError } from './core-wasm-error-runtime.js';
import { requireRequiredFontFaces } from './required-font-faces-validation-runtime.js';
import { requireFontVerticalMetricDemands } from './font-vertical-metric-validation-runtime.js';

export function requireObjectInput(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RitoCoreWasmError('bad-request', `${operation} input must be an object`);
  }
  return value;
}

export function requireFlatRevisionHandle(value, operation) {
  return requireRevisionHandle(
    { revisionId: value.revisionId, revisionVersion: value.revisionVersion },
    operation,
  );
}

export function requireRevisionHandle(value, operation = 'revision') {
  const handle = requireObjectInput(value, `${operation} revision`);
  if (typeof handle.revisionId !== 'string' || handle.revisionId.length === 0) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} revisionId must be a non-empty string`,
    );
  }
  if (
    !Number.isSafeInteger(handle.revisionVersion) ||
    handle.revisionVersion < 0 ||
    handle.revisionVersion > 0xffff_ffff
  ) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} revisionVersion must be an unsigned 32-bit integer`,
    );
  }
  return { revisionId: handle.revisionId, revisionVersion: handle.revisionVersion };
}

export function requireMatchingHandle(value, expected, operation) {
  const actual = requireRevisionHandle(value, operation);
  if (
    actual.revisionId !== expected.revisionId ||
    actual.revisionVersion !== expected.revisionVersion
  ) {
    throw new Error(`${operation} returned a mismatched revision handle`);
  }
  return actual;
}

export function requireMatchingRevisionSummary(value, expected, operation, expectedStatus) {
  const handle = requireRevisionHandle(expected, `${operation} expected`);
  return requireRevisionSummary(
    value,
    operation,
    handle.revisionId,
    handle.revisionVersion,
    expectedStatus,
  );
}

export function requireRevisionAdvance(value, expected, operation, maxProcessedTopLevelNodes) {
  const advance = requireObjectInput(value, `${operation} result`);
  const revision = requireMatchingRevisionSummary(advance.revision, expected, operation);
  const previous = requireRevisionExtent(
    advance.previousKnownExtent,
    `${operation} previousKnownExtent`,
  );
  const range = requireRevisionPageRange(advance.newlyKnownPages, operation);
  requireAdvanceExtents(previous, range, revision.knownExtent, operation);
  requireProcessedNodeCount(advance.processedTopLevelNodes, maxProcessedTopLevelNodes, operation);
  requireAdvanceStatus(advance, revision, operation);
  return advance;
}

export function requireInitialRevisionAdvance(
  value,
  expected,
  operation,
  maxProcessedTopLevelNodes,
) {
  const advance = requireRevisionAdvance(value, expected, operation, maxProcessedTopLevelNodes);
  if (
    advance.previousKnownExtent.pageCount !== 0 ||
    advance.previousKnownExtent.spreadCount !== 0
  ) {
    throw new Error(`${operation} returned a non-empty previous extent`);
  }
  return advance;
}

export function requireRevisionWorkBudget(value, operation) {
  const budget = requireObjectInput(value, `${operation} budget`);
  if (!isSafeCount(budget.maxTopLevelNodes) || budget.maxTopLevelNodes === 0) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} budget maxTopLevelNodes must be a positive safe integer`,
    );
  }
  return budget.maxTopLevelNodes;
}

export function requireVersionedValueIdentity(value, revision, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  if (Object.prototype.hasOwnProperty.call(value, 'revision')) {
    requireMatchingHandle(value.revision, revision, `${operation} value revision`);
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'revisionId')) return;
  requireMatchingRevisionId(value, revision, `${operation} value`);
  if (Object.prototype.hasOwnProperty.call(value, 'revisionVersion')) {
    requireMatchingHandle(value, revision, `${operation} value`);
  }
}

export function requireRevisionBundle(value, revision, operation) {
  const bundle = requireObjectInput(value, `${operation} value`);
  requireMatchingRevisionSummary(bundle.revision, revision, `${operation} bundle`);
  for (const field of ['navigation', 'tocTargets', 'footnotes', 'chapterTextIndices']) {
    requireMatchingRevisionId(bundle[field], revision, `${operation} ${field}`);
  }
  requireFontVerticalMetricDemands(bundle.fontVerticalMetricDemands, operation);
  requireRequiredFontFaces(bundle.requiredFontFaces, revision.revisionId, operation);
  return bundle;
}

export function requireRevisionSummary(
  value,
  operation,
  expectedRevisionId,
  expectedRevisionVersion,
  expectedStatus,
) {
  const summary = requireObjectInput(value, `${operation} result revision`);
  const handle = requireRevisionHandle(summary, `${operation} result`);
  if (expectedRevisionId !== undefined && handle.revisionId !== expectedRevisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
  if (expectedRevisionVersion !== undefined && handle.revisionVersion !== expectedRevisionVersion) {
    throw new Error(`${operation} returned a non-sequential revisionVersion`);
  }
  const statuses = new Set(['warming', 'ready', 'complete', 'cancelled', 'failed']);
  if (
    !statuses.has(summary.status) ||
    (expectedStatus !== undefined && summary.status !== expectedStatus)
  ) {
    throw new Error(`${operation} returned an invalid revision status`);
  }
  if (typeof summary.layoutKey !== 'string' || summary.layoutKey.length === 0) {
    throw new Error(`${operation} returned an invalid revision layoutKey`);
  }
  const knownExtent = requireRevisionExtent(summary.knownExtent, `${operation} knownExtent`);
  if (
    summary.pageCount !== knownExtent.pageCount ||
    summary.spreadCount !== knownExtent.spreadCount
  ) {
    throw new Error(`${operation} returned inconsistent revision extent aliases`);
  }
  if (summary.status === 'complete') {
    const finalExtent = requireRevisionExtent(summary.finalExtent, `${operation} finalExtent`);
    if (
      finalExtent.pageCount !== knownExtent.pageCount ||
      finalExtent.spreadCount !== knownExtent.spreadCount
    ) {
      throw new Error(`${operation} returned a mismatched final revision extent`);
    }
  } else if (summary.finalExtent !== undefined) {
    throw new Error(`${operation} returned a final extent before completion`);
  }
  return summary;
}

export function parseObject(payload, operation) {
  let value;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw new Error(
      `${operation} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} returned a non-object JSON payload`);
  }
  return value;
}

export function encodeJson(value, operation) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    throw new RitoCoreWasmError(
      'bad-request',
      `${operation} input is not JSON-serializable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function requireRevisionExtent(value, operation) {
  const extent = requireObjectInput(value, operation);
  for (const field of ['pageCount', 'spreadCount']) {
    if (!Number.isSafeInteger(extent[field]) || extent[field] < 0) {
      throw new Error(`${operation} returned an invalid ${field}`);
    }
  }
  if (extent.spreadCount > extent.pageCount) {
    throw new Error(`${operation} returned more spreads than pages`);
  }
  return extent;
}

function requireRevisionPageRange(value, operation) {
  const range = requireObjectInput(value, `${operation} newlyKnownPages`);
  if (!isSafeCount(range.startPage) || !isSafeCount(range.endPageExclusive)) {
    throw new Error(`${operation} returned an invalid newly known page range`);
  }
  if (range.endPageExclusive < range.startPage) {
    throw new Error(`${operation} returned a reversed newly known page range`);
  }
  return range;
}

function requireAdvanceExtents(previous, range, known, operation) {
  if (known.pageCount < previous.pageCount || known.spreadCount < previous.spreadCount) {
    throw new Error(`${operation} returned a shrinking known extent`);
  }
  if (range.startPage !== previous.pageCount || range.endPageExclusive !== known.pageCount) {
    throw new Error(`${operation} returned a page range inconsistent with its extents`);
  }
}

function requireProcessedNodeCount(value, maximum, operation) {
  if (!isSafeCount(value)) {
    throw new Error(`${operation} returned an invalid processedTopLevelNodes count`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new Error(`${operation} exceeded its top-level node budget`);
  }
}

function requireAdvanceStatus(advance, revision, operation) {
  const active = revision.status === 'warming' || revision.status === 'ready';
  if (!active && revision.status !== 'complete') {
    throw new Error(`${operation} returned a terminal non-complete advance status`);
  }
  if (revision.status === 'warming' && revision.knownExtent.spreadCount !== 0) {
    throw new Error(`${operation} returned a warming revision with known spreads`);
  }
  if (revision.status === 'ready' && revision.knownExtent.spreadCount === 0) {
    throw new Error(`${operation} returned a ready revision without known spreads`);
  }
  if (active) {
    const continuation = requireObjectInput(advance.continuation, `${operation} continuation`);
    requireMatchingHandle(continuation, revision, `${operation} continuation`);
    if (typeof continuation.cursor !== 'string' || continuation.cursor.length === 0) {
      throw new Error(`${operation} returned an invalid continuation cursor`);
    }
  } else if (advance.continuation !== undefined) {
    throw new Error(`${operation} returned a continuation for a complete revision`);
  }
}

function requireMatchingRevisionId(value, revision, operation) {
  const record = requireObjectInput(value, operation);
  if (record.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function isSafeCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
