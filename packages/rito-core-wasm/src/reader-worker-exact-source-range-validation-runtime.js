import {
  requireExactTextRecord,
  requireExactTextRevisionId,
  requireExactTextUnavailableReason,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import {
  requireExactTextRangeRects,
  requireWellFormedExactTextUtf16,
} from './reader-worker-exact-text-range-validation-runtime.js';
import { requireSourceLocatorRequest } from './reader-worker-interaction-validation-runtime.js';

const PENDING_REASONS = new Set(['notPaginated', 'noPageProjection']);

export function requireExactSourceRangeRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  if (typeof request.href !== 'string' || request.href.length === 0) {
    throw new TypeError(`${operation} href must be a non-empty string`);
  }
  return {
    href: request.href,
    sourceRange: requireSourceRange(request.sourceRange, `${operation} sourceRange`),
  };
}

export function requireExactSourceRangeResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  return {
    ...response,
    resolution: requireResolution(response.resolution, request, operation),
  };
}

export function requireExactSourceRangeTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireExactSourceRangeRequest(transport.request, operation);
  requireMatchingRequest(request, expectedRequest, operation);
  return requireExactSourceRangeResponse(transport.response, revision, request, operation);
}

function requireResolution(value, request, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  switch (resolution.status) {
    case 'resolved':
      requireAbsent(resolution, 'reason', operation);
      return {
        status: 'resolved',
        range: requireResolvedRange(resolution.range, request, operation),
      };
    case 'pending':
      requireAbsent(resolution, 'range', operation);
      return { status: 'pending', reason: requirePendingReason(resolution.reason, operation) };
    case 'unavailable':
      requireAbsent(resolution, 'range', operation);
      return {
        status: 'unavailable',
        reason: requireExactTextUnavailableReason(resolution.reason, operation),
      };
    default:
      throw new Error(`${operation} returned an invalid exact source range status`);
  }
}

function requireResolvedRange(value, request, operation) {
  const range = requireExactTextRecord(value, `${operation} range`);
  if (typeof range.selectedText !== 'string') {
    throw new Error(`${operation} returned invalid selectedText`);
  }
  requireWellFormedExactTextUtf16(range.selectedText, `${operation} selectedText`);
  const sourceLocator = requireSourceLocatorRequest(range.sourceLocator, `${operation} range`);
  if (sourceLocator.href !== request.href) {
    throw new Error(`${operation} returned a projection for a mismatched href`);
  }
  if (
    sourceLocator.sourceRange === undefined ||
    sourceLocator.sourcePoint !== undefined ||
    sourceLocator.anchorId !== undefined ||
    sourceLocator.progression !== undefined
  ) {
    throw new Error(`${operation} returned a projection without one exact source range`);
  }
  const projectedRange = requireSourceRange(
    sourceLocator.sourceRange,
    `${operation} projected sourceRange`,
  );
  requireMatchingSourceRange(projectedRange, request.sourceRange, operation);
  const rects = requireExactTextRangeRects(range.rects, operation);
  if (
    equalSourcePoint(request.sourceRange.start, request.sourceRange.end) &&
    (range.selectedText.length !== 0 || rects.length !== 0)
  ) {
    throw new Error(`${operation} returned content for a collapsed exact source range`);
  }
  return { selectedText: range.selectedText, sourceLocator, rects };
}

function requireSourceRange(value, operation) {
  const range = requireExactTextRecord(value, operation);
  return {
    start: requireSourcePoint(range.start, `${operation} start`),
    end: requireSourcePoint(range.end, `${operation} end`),
  };
}

function requireSourcePoint(value, operation) {
  const point = requireExactTextRecord(value, operation);
  if (!Array.isArray(point.nodePath)) {
    throw new TypeError(`${operation} nodePath must be an array`);
  }
  const nodePath = point.nodePath.map((part) => requireCount(part, `${operation} nodePath`));
  return { nodePath, textOffset: requireCount(point.textOffset, `${operation} textOffset`) };
}

function requireMatchingRequest(actual, expected, operation) {
  if (actual.href !== expected.href) {
    throw new Error(`${operation} returned an exact range for a mismatched href request`);
  }
  requireMatchingSourceRange(actual.sourceRange, expected.sourceRange, `${operation} request`);
}

function requireMatchingSourceRange(actual, expected, operation) {
  if (
    !equalSourcePoint(actual.start, expected.start) ||
    !equalSourcePoint(actual.end, expected.end)
  ) {
    throw new Error(`${operation} sourceRange does not match its request`);
  }
}

function equalSourcePoint(left, right) {
  return (
    left.textOffset === right.textOffset &&
    left.nodePath.length === right.nodePath.length &&
    left.nodePath.every((part, index) => part === right.nodePath[index])
  );
}

function requirePendingReason(value, operation) {
  if (!PENDING_REASONS.has(value)) {
    throw new Error(`${operation} returned an invalid exact source range pending reason`);
  }
  return value;
}

function requireCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${operation} must contain non-negative safe integers`);
  }
  return value;
}

function requireAbsent(record, field, operation) {
  if (record[field] !== undefined) {
    throw new Error(`${operation} returned ${field} for status ${String(record.status)}`);
  }
}
