import {
  requirePageIndex,
  requireSourceLocatorRequest,
} from './reader-worker-interaction-validation-runtime.js';

const UNAVAILABLE_REASONS = new Set([
  'shapeUnavailable',
  'sourceUnavailable',
  'unsupportedTransform',
  'visualGeometryUnavailable',
  'invalidCaret',
  'differentChapter',
]);

export function requireTextPointRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  return {
    pageIndex: requirePageIndex(request.pageIndex, operation),
    x: requireExactTextFinite(request.x, `${operation} x`),
    y: requireExactTextFinite(request.y, `${operation} y`),
  };
}

export function requireTextCaretResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  if (response.pageIndex !== request.pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireExactTextCount(response.spreadIndex, `${operation} spreadIndex`);
  const resolution = requireCaretResolution(response.resolution, response.pageIndex, operation);
  return { ...response, resolution };
}

export function requireTextCaretTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireTextPointRequest(transport.request, operation);
  if (
    request.pageIndex !== expectedRequest.pageIndex ||
    request.x !== expectedRequest.x ||
    request.y !== expectedRequest.y
  ) {
    throw new Error(`${operation} returned a caret for a mismatched normalized request`);
  }
  return requireTextCaretResponse(transport.response, revision, request, operation);
}

function requireCaretResolution(value, pageIndex, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  switch (resolution.status) {
    case 'resolved':
      requireAbsent(resolution, 'reason', operation);
      return {
        status: 'resolved',
        caret: requireExactTextCaret(resolution.caret, pageIndex, operation),
      };
    case 'unavailable':
      requireAbsent(resolution, 'caret', operation);
      return {
        status: 'unavailable',
        reason: requirePointUnavailableReason(resolution.reason, operation),
      };
    case 'miss':
      requireAbsent(resolution, 'caret', operation);
      requireAbsent(resolution, 'reason', operation);
      return { status: 'miss' };
    default:
      throw new Error(`${operation} returned an invalid text caret status`);
  }
}

function requirePointUnavailableReason(value, operation) {
  const reason = requireExactTextUnavailableReason(value, operation);
  if (reason === 'differentChapter') {
    throw new Error(`${operation} returned a range-only unavailable reason for a point`);
  }
  return reason;
}

export function requireExactTextCaret(value, pageIndex, operation) {
  const caret = requireUnboundExactTextCaret(value, operation);
  if (caret.address.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a caret for a mismatched pageIndex`);
  }
  return caret;
}

export function requireUnboundExactTextCaret(value, operation) {
  const caret = requireExactTextRecord(value, `${operation} caret`);
  const address = requireExactTextCaretAddress(caret.address, `${operation} caret address`);
  const geometry = requireExactTextRecord(caret.geometry, `${operation} caret geometry`);
  const normalizedGeometry = {
    x: requireExactTextFinite(geometry.x, `${operation} caret geometry x`),
    y: requireExactTextFinite(geometry.y, `${operation} caret geometry y`),
    height: requirePositiveFinite(geometry.height, `${operation} caret geometry height`),
  };
  const sourceLocator = requireSourceLocatorRequest(caret.sourceLocator, `${operation} caret`);
  if (
    sourceLocator.sourcePoint === undefined ||
    sourceLocator.sourceRange !== undefined ||
    sourceLocator.anchorId !== undefined ||
    sourceLocator.progression !== undefined
  ) {
    throw new Error(`${operation} returned a caret without one exact source point`);
  }
  return { address, geometry: normalizedGeometry, sourceLocator };
}

export function requireExactTextCaretAddress(value, operation) {
  const address = requireExactTextRecord(value, operation);
  const normalized = {};
  for (const field of ['pageIndex', 'blockIndex', 'lineIndex', 'runIndex', 'charIndex']) {
    normalized[field] = requireExactTextCount(address[field], `${operation} ${field}`);
  }
  if (address.affinity !== 'upstream' && address.affinity !== 'downstream') {
    throw new Error(`${operation} affinity must be upstream or downstream`);
  }
  normalized.affinity = address.affinity;
  return normalized;
}

export function requireMatchingExactTextCaretAddress(actual, expected, operation) {
  if (!equalExactTextCaretAddress(actual, expected)) {
    throw new Error(`${operation} does not match its request`);
  }
}

export function equalExactTextCaretAddress(left, right) {
  return (
    left.pageIndex === right.pageIndex &&
    left.blockIndex === right.blockIndex &&
    left.lineIndex === right.lineIndex &&
    left.runIndex === right.runIndex &&
    left.charIndex === right.charIndex &&
    left.affinity === right.affinity
  );
}

export function requireExactTextUnavailableReason(value, operation) {
  if (!UNAVAILABLE_REASONS.has(value)) {
    throw new Error(`${operation} returned an invalid text interaction unavailable reason`);
  }
  return value;
}

export function requireExactTextRevisionId(value, revision, operation) {
  if (value.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

export function requireExactTextFinite(value, operation) {
  if (!Number.isFinite(value)) throw new Error(`${operation} must be finite`);
  return value;
}

export function requireExactTextCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
  return value;
}

export function requireExactTextRecord(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${operation} must be an object`);
  }
  return value;
}

function requirePositiveFinite(value, operation) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${operation} must be positive`);
  return value;
}

function requireAbsent(record, field, operation) {
  if (record[field] !== undefined) {
    throw new Error(`${operation} returned ${field} for status ${String(record.status)}`);
  }
}
