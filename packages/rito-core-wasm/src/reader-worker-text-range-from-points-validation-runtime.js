import {
  equalExactTextCaretAddress,
  requireExactTextCaretAddress,
  requireExactTextRecord,
  requireExactTextRevisionId,
  requireExactTextUnavailableReason,
  requireMatchingExactTextCaretAddress,
  requireTextPointRequest,
  requireUnboundExactTextCaret,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import { requireResolvedRange } from './reader-worker-exact-text-range-validation-runtime.js';

const GRANULARITIES = new Set(['word', 'paragraph']);

export function requireTextRangeFromPointsRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  return {
    anchor: requireTextPointRequest(request.anchor, `${operation} anchor`),
    focus: requireTextPointRequest(request.focus, `${operation} focus`),
    granularity: requireGranularity(request.granularity, operation),
  };
}

export function requireTextRangeFromPointsResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  const resolution = requireResolution(response.resolution, operation);
  return {
    ...response,
    resolution,
  };
}

export function requireTextRangeFromPointsTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireTextRangeFromPointsRequest(transport.request, operation);
  requireMatchingRequest(request, expectedRequest, operation);
  return requireTextRangeFromPointsResponse(transport.response, revision, request, operation);
}

export function requireTextRangeToPointRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  return {
    anchor: requireExactTextCaretAddress(request.anchor, `${operation} anchor`),
    focus: requireTextPointRequest(request.focus, `${operation} focus`),
  };
}

export function requireTextRangeToPointResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  const resolution = requireResolution(response.resolution, operation);
  if (resolution.status === 'resolved') {
    requireMatchingExactTextCaretAddress(
      resolution.anchorCaret.address,
      request.anchor,
      `${operation} anchor caret`,
    );
    requireResolvedCaretPage(resolution, 'focusCaret', request.focus.pageIndex, operation);
  }
  return { ...response, resolution };
}

export function requireTextRangeToPointTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireTextRangeToPointRequest(transport.request, operation);
  requireMatchingExactTextCaretAddress(
    request.anchor,
    expectedRequest.anchor,
    `${operation} request anchor`,
  );
  if (!samePoint(request.focus, expectedRequest.focus)) {
    throw new Error(`${operation} returned a range-to-point for a mismatched normalized request`);
  }
  return requireTextRangeToPointResponse(transport.response, revision, request, operation);
}

function requireResolution(value, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  switch (resolution.status) {
    case 'resolved':
      requireAbsentFields(resolution, ['reason'], operation);
      return requireResolvedResolution(resolution, operation);
    case 'unavailable':
      requireAbsentFields(resolution, ['anchorCaret', 'focusCaret', 'range'], operation);
      return {
        status: 'unavailable',
        reason: requireExactTextUnavailableReason(resolution.reason, operation),
      };
    case 'miss':
      requireAbsentFields(resolution, ['anchorCaret', 'focusCaret', 'range', 'reason'], operation);
      return { status: 'miss' };
    default:
      throw new Error(`${operation} returned an invalid point-range status`);
  }
}

function requireResolvedResolution(resolution, operation) {
  const anchorCaret = requireUnboundExactTextCaret(resolution.anchorCaret, `${operation} anchor`);
  const focusCaret = requireUnboundExactTextCaret(resolution.focusCaret, `${operation} focus`);
  const range = requireResolvedRange(
    resolution.range,
    { anchor: anchorCaret.address, focus: focusCaret.address },
    operation,
  );
  requireRangeSourceIdentity(range, anchorCaret, focusCaret, operation);
  return { status: 'resolved', anchorCaret, focusCaret, range };
}

export function requireRangeSourceIdentity(range, anchorCaret, focusCaret, operation) {
  const startCaret = equalExactTextCaretAddress(range.start, anchorCaret.address)
    ? anchorCaret
    : focusCaret;
  const endCaret = equalExactTextCaretAddress(range.end, focusCaret.address)
    ? focusCaret
    : anchorCaret;
  const sourceRange = range.sourceLocator.sourceRange;
  if (
    range.sourceLocator.href !== startCaret.sourceLocator.href ||
    range.sourceLocator.href !== endCaret.sourceLocator.href ||
    !sameSourcePoint(sourceRange.start, startCaret.sourceLocator.sourcePoint) ||
    !sameSourcePoint(sourceRange.end, endCaret.sourceLocator.sourcePoint)
  ) {
    throw new Error(`${operation} returned source endpoints unrelated to its resolved carets`);
  }
}

function requireResolvedCaretPage(resolution, field, pageIndex, operation) {
  if (resolution.status === 'resolved' && resolution[field].address.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a ${field} for a mismatched pageIndex`);
  }
}

function requireMatchingRequest(actual, expected, operation) {
  if (
    actual.granularity !== expected.granularity ||
    !samePoint(actual.anchor, expected.anchor) ||
    !samePoint(actual.focus, expected.focus)
  ) {
    throw new Error(`${operation} returned a point range for a mismatched normalized request`);
  }
}

function requireGranularity(value, operation) {
  if (!GRANULARITIES.has(value)) {
    throw new Error(`${operation} granularity must be word or paragraph`);
  }
  return value;
}

function samePoint(left, right) {
  return left.pageIndex === right.pageIndex && left.x === right.x && left.y === right.y;
}

function sameSourcePoint(left, right) {
  return (
    left.textOffset === right.textOffset &&
    left.nodePath.length === right.nodePath.length &&
    left.nodePath.every((part, index) => part === right.nodePath[index])
  );
}

function requireAbsentFields(record, fields, operation) {
  for (const field of fields) {
    if (record[field] !== undefined) {
      throw new Error(`${operation} returned ${field} for status ${String(record.status)}`);
    }
  }
}
