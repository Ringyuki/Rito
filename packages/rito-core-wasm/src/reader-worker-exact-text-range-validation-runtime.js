import {
  equalExactTextCaretAddress,
  requireExactTextCaretAddress,
  requireExactTextCount,
  requireExactTextFinite,
  requireExactTextRecord,
  requireExactTextRevisionId,
  requireExactTextUnavailableReason,
  requireMatchingExactTextCaretAddress,
} from './reader-worker-exact-text-interaction-validation-runtime.js';
import { requireSourceLocatorRequest } from './reader-worker-interaction-validation-runtime.js';

export function requireTextRangeRequest(value, operation) {
  const request = requireExactTextRecord(value, `${operation} request`);
  return {
    anchor: requireExactTextCaretAddress(request.anchor, `${operation} anchor`),
    focus: requireExactTextCaretAddress(request.focus, `${operation} focus`),
  };
}

export function requireTextRangeResponse(value, revision, request, operation) {
  const response = requireExactTextRecord(value, `${operation} result`);
  requireExactTextRevisionId(response, revision, operation);
  const resolution = requireRangeResolution(response.resolution, request, operation);
  return { ...response, resolution };
}

export function requireTextRangeTransport(value, revision, expectedRequest, operation) {
  const transport = requireExactTextRecord(value, `${operation} transport`);
  const request = requireTextRangeRequest(transport.request, operation);
  requireMatchingExactTextCaretAddress(
    request.anchor,
    expectedRequest.anchor,
    `${operation} request anchor`,
  );
  requireMatchingExactTextCaretAddress(
    request.focus,
    expectedRequest.focus,
    `${operation} request focus`,
  );
  return requireTextRangeResponse(transport.response, revision, request, operation);
}

function requireRangeResolution(value, request, operation) {
  const resolution = requireExactTextRecord(value, `${operation} resolution`);
  switch (resolution.status) {
    case 'resolved':
      requireAbsent(resolution, 'reason', operation);
      return {
        status: 'resolved',
        range: requireResolvedRange(resolution.range, request, operation),
      };
    case 'unavailable':
      requireAbsent(resolution, 'range', operation);
      return {
        status: 'unavailable',
        reason: requireExactTextUnavailableReason(resolution.reason, operation),
      };
    default:
      throw new Error(`${operation} returned an invalid text range status`);
  }
}

function requireResolvedRange(value, request, operation) {
  const range = requireExactTextRecord(value, `${operation} range`);
  const anchor = requireExactTextCaretAddress(range.anchor, `${operation} range anchor`);
  const focus = requireExactTextCaretAddress(range.focus, `${operation} range focus`);
  requireMatchingExactTextCaretAddress(anchor, request.anchor, `${operation} range anchor`);
  requireMatchingExactTextCaretAddress(focus, request.focus, `${operation} range focus`);
  const start = requireExactTextCaretAddress(range.start, `${operation} range start`);
  const end = requireExactTextCaretAddress(range.end, `${operation} range end`);
  requireEndpointPair(start, end, anchor, focus, operation);
  if (typeof range.selectedText !== 'string') {
    throw new Error(`${operation} returned invalid selectedText`);
  }
  requireWellFormedExactTextUtf16(range.selectedText, `${operation} selectedText`);
  const sourceLocator = requireSourceLocatorRequest(range.sourceLocator, `${operation} range`);
  if (
    sourceLocator.sourceRange === undefined ||
    sourceLocator.sourcePoint !== undefined ||
    sourceLocator.anchorId !== undefined ||
    sourceLocator.progression !== undefined
  ) {
    throw new Error(`${operation} returned a range without one exact source range`);
  }
  if (!Array.isArray(range.rects)) {
    throw new Error(`${operation} returned malformed exact range rects`);
  }
  if (
    equalExactTextCaretAddress(start, end) &&
    (range.selectedText.length !== 0 || range.rects.length !== 0)
  ) {
    throw new Error(`${operation} returned content for a collapsed exact range`);
  }
  const rects = requireRangeRects(range.rects, start, end, operation);
  return { anchor, focus, start, end, selectedText: range.selectedText, sourceLocator, rects };
}

function requireRangeRects(values, start, end, operation) {
  const rects = requireExactTextRangeRects(values, operation);
  const firstPage = Math.min(start.pageIndex, end.pageIndex);
  const lastPage = Math.max(start.pageIndex, end.pageIndex);
  for (const rect of rects) {
    if (rect.pageIndex < firstPage || rect.pageIndex > lastPage) {
      throw new Error(`${operation} returned an exact range rect outside its endpoint pages`);
    }
  }
  return rects;
}

export function requireExactTextRangeRects(values, operation) {
  if (!Array.isArray(values)) {
    throw new Error(`${operation} returned malformed exact range rects`);
  }
  const rects = values.map((value) => requireRangeRect(value, operation));
  let previous;
  for (const rect of rects) {
    if (previous && compareRectPosition(previous, rect) >= 0) {
      throw new Error(`${operation} returned unordered exact range rects`);
    }
    previous = rect;
  }
  return rects;
}

function requireRangeRect(value, operation) {
  const rect = requireExactTextRecord(value, `${operation} exact range rect`);
  const normalized = {};
  for (const field of ['pageIndex', 'spreadIndex', 'blockIndex', 'lineIndex', 'runIndex']) {
    normalized[field] = requireExactTextCount(
      rect[field],
      `${operation} exact range rect ${field}`,
    );
  }
  for (const field of ['x', 'y']) {
    normalized[field] = requireExactTextFinite(
      rect[field],
      `${operation} exact range rect ${field}`,
    );
  }
  for (const field of ['width', 'height']) {
    normalized[field] = requireNonNegativeFinite(
      rect[field],
      `${operation} exact range rect ${field}`,
    );
  }
  normalized.startCharIndex = requireExactTextCount(
    rect.startCharIndex,
    `${operation} exact range rect startCharIndex`,
  );
  normalized.endCharIndex = requireExactTextCount(
    rect.endCharIndex,
    `${operation} exact range rect endCharIndex`,
  );
  if (normalized.endCharIndex <= normalized.startCharIndex) {
    throw new Error(`${operation} returned an empty or reversed exact range rect`);
  }
  return normalized;
}

function requireEndpointPair(start, end, anchor, focus, operation) {
  const direct =
    equalExactTextCaretAddress(start, anchor) && equalExactTextCaretAddress(end, focus);
  const reversed =
    equalExactTextCaretAddress(start, focus) && equalExactTextCaretAddress(end, anchor);
  if (!direct && !reversed) {
    throw new Error(`${operation} returned normalized endpoints unrelated to anchor and focus`);
  }
}

function compareRectPosition(left, right) {
  for (const field of ['pageIndex', 'blockIndex', 'lineIndex', 'runIndex', 'startCharIndex']) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

export function requireWellFormedExactTextUtf16(text, operation) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (index + 1 >= text.length || next < 0xdc00 || next > 0xdfff) {
        throw new Error(`${operation} is malformed UTF-16`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(`${operation} is malformed UTF-16`);
    }
  }
}

function requireNonNegativeFinite(value, operation) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${operation} must be non-negative`);
  return value;
}

function requireAbsent(record, field, operation) {
  if (record[field] !== undefined) {
    throw new Error(`${operation} returned ${field} for status ${String(record.status)}`);
  }
}
