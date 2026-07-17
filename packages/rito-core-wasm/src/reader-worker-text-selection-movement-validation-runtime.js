import {
  requireExactTextCaretAddress,
  requireExactTextFinite,
  requireExactTextRecord,
  requireExactTextRevisionId,
  requireExactTextUnavailableReason,
  requireMatchingExactTextCaretAddress,
  requireUnboundExactTextCaret,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import { requireResolvedRange } from './reader-worker-exact-text-range-validation-runtime.js';
import { requireRangeSourceIdentity } from './reader-worker-text-range-from-points-validation-runtime.js';

const MOVEMENTS = new Set([
  'characterLeft',
  'characterRight',
  'wordLeft',
  'wordRight',
  'wordStartRight',
  'lineUp',
  'lineDown',
  'lineStart',
  'lineEnd',
  'paragraphBackward',
  'paragraphForward',
  'paragraphPreviousStart',
  'paragraphNextStart',
  'chapterStart',
  'chapterEnd',
]);

const LINE_MOVEMENTS = new Set(['lineUp', 'lineDown']);

export function requireTextSelectionMovementRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  const movement = requireMovement(request.movement, operation);
  requireRequestStickyPolicy(movement, request.preferredInlinePosition, operation);
  const preferredInlinePosition =
    request.preferredInlinePosition === undefined
      ? undefined
      : requireExactTextFinite(
          request.preferredInlinePosition,
          `${operation} preferredInlinePosition`,
        );
  return {
    anchor: requireExactTextCaretAddress(request.anchor, `${operation} anchor`),
    focus: requireExactTextCaretAddress(request.focus, `${operation} focus`),
    movement,
    ...(preferredInlinePosition === undefined ? {} : { preferredInlinePosition }),
  };
}

export function requireTextSelectionMovementResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  return {
    ...response,
    resolution: requireMovementResolution(response.resolution, request, operation),
  };
}

export function requireTextSelectionMovementTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireTextSelectionMovementRequest(transport.request, operation);
  requireMatchingMovementRequest(request, expectedRequest, operation);
  return requireTextSelectionMovementResponse(transport.response, revision, request, operation);
}

function requireMovementResolution(value, request, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  switch (resolution.status) {
    case 'resolved':
      requireAbsentFields(resolution, ['reason', 'boundary'], operation);
      return requireResolvedMovement(resolution, request, operation);
    case 'boundary':
    case 'pending':
      requireAbsentFields(
        resolution,
        ['anchorCaret', 'focusCaret', 'range', 'preferredInlinePosition', 'reason'],
        operation,
      );
      return {
        status: resolution.status,
        boundary: requireBoundary(resolution.boundary, operation),
      };
    case 'unavailable':
      requireAbsentFields(
        resolution,
        ['anchorCaret', 'focusCaret', 'range', 'preferredInlinePosition', 'boundary'],
        operation,
      );
      return {
        status: 'unavailable',
        reason: requireExactTextUnavailableReason(resolution.reason, operation),
      };
    default:
      throw new Error(`${operation} returned an invalid text selection movement status`);
  }
}

function requireResolvedMovement(resolution, request, operation) {
  const anchorCaret = requireUnboundExactTextCaret(resolution.anchorCaret, `${operation} anchor`);
  const focusCaret = requireUnboundExactTextCaret(resolution.focusCaret, `${operation} focus`);
  requireMatchingExactTextCaretAddress(
    anchorCaret.address,
    request.anchor,
    `${operation} anchor caret`,
  );
  const range = requireResolvedRange(
    resolution.range,
    { anchor: anchorCaret.address, focus: focusCaret.address },
    operation,
  );
  requireRangeSourceIdentity(range, anchorCaret, focusCaret, operation);
  requireResolvedStickyPolicy(request.movement, resolution.preferredInlinePosition, operation);
  const preferredInlinePosition =
    resolution.preferredInlinePosition === undefined
      ? undefined
      : requireExactTextFinite(
          resolution.preferredInlinePosition,
          `${operation} preferredInlinePosition`,
        );
  return {
    status: 'resolved',
    anchorCaret,
    focusCaret,
    range,
    ...(preferredInlinePosition === undefined ? {} : { preferredInlinePosition }),
  };
}

function requireMatchingMovementRequest(actual, expected, operation) {
  requireMatchingExactTextCaretAddress(
    actual.anchor,
    expected.anchor,
    `${operation} request anchor`,
  );
  requireMatchingExactTextCaretAddress(actual.focus, expected.focus, `${operation} request focus`);
  if (
    actual.movement !== expected.movement ||
    actual.preferredInlinePosition !== expected.preferredInlinePosition
  ) {
    throw new Error(`${operation} returned a movement for a mismatched normalized request`);
  }
}

function requireMovement(value, operation) {
  if (!MOVEMENTS.has(value)) throw new Error(`${operation} returned an invalid movement`);
  return value;
}

function requireRequestStickyPolicy(movement, preferredInlinePosition, operation) {
  if (preferredInlinePosition !== undefined && !LINE_MOVEMENTS.has(movement)) {
    throw new Error(`${operation} preferredInlinePosition is only valid for line movements`);
  }
}

function requireResolvedStickyPolicy(movement, preferredInlinePosition, operation) {
  if (LINE_MOVEMENTS.has(movement)) {
    if (preferredInlinePosition === undefined) {
      throw new Error(`${operation} line movement did not return preferredInlinePosition`);
    }
    return;
  }
  if (preferredInlinePosition !== undefined) {
    throw new Error(`${operation} returned preferredInlinePosition for a non-line movement`);
  }
}

function requireBoundary(value, operation) {
  if (value !== 'start' && value !== 'end') {
    throw new Error(`${operation} returned an invalid text selection boundary`);
  }
  return value;
}

function requireAbsentFields(record, fields, operation) {
  for (const field of fields) {
    if (record[field] !== undefined) {
      throw new Error(`${operation} returned ${field} for status ${String(record.status)}`);
    }
  }
}
