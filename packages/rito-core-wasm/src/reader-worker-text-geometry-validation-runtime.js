import { requirePageIndex } from './reader-worker-interaction-validation-runtime.js';

// Format validation only. The legacy short hash is diagnostic metadata, not an
// independent trust identity. Request identity is carried by the exact
// revision envelope and the normalized range echo below.
const TEXT_HASH_RE = /^[0-9a-f]{16}$/;

export function requirePageTextPositions(value, revision, pageIndex, operation) {
  const positions = requireRecord(value, `${operation} result`);
  requireRevisionId(positions, revision, operation);
  if (positions.pageIndex !== pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireCount(positions.spreadIndex, `${operation} spreadIndex`);
  if (typeof positions.text !== 'string') {
    throw new Error(`${operation} returned invalid page text`);
  }
  requireWellFormedUtf16(positions.text, operation);
  requireCount(positions.textLength, `${operation} textLength`);
  if (positions.textLength !== positions.text.length) {
    throw new Error(`${operation} returned an inconsistent UTF-16 textLength`);
  }
  if (typeof positions.textHash !== 'string' || !TEXT_HASH_RE.test(positions.textHash)) {
    throw new Error(`${operation} returned an invalid textHash`);
  }
  if (!Array.isArray(positions.offsets)) {
    throw new Error(`${operation} returned malformed text offsets`);
  }
  requireTextOffsets(positions.offsets, positions.text, operation);
  return positions;
}

export function requireTextRangeGeometryRequest(value, operation) {
  const request = requireRecord(value, `${operation} request`);
  const start = requireTextPosition(request.start, `${operation} start`);
  const end = requireTextPosition(request.end, `${operation} end`);
  const [normalizedStart, normalizedEnd] = normalizeRange(start, end);
  return {
    pageIndex: requirePageIndex(request.pageIndex, operation),
    start: normalizedStart,
    end: normalizedEnd,
  };
}

export function requireTextRangeGeometryDiagnostic(value, revision, expectedRequest, operation) {
  const diagnostic = requireRecord(value, `${operation} diagnostic`);
  const request = requireTextRangeGeometryRequest(diagnostic.request, operation);
  requireMatchingRangeRequest(request, expectedRequest, operation);
  return {
    request,
    geometry: requireTextRangeGeometry(diagnostic.geometry, revision, request, operation),
  };
}

export function requireTextRangeGeometry(value, revision, request, operation) {
  const geometry = requireRecord(value, `${operation} result`);
  requireRevisionId(geometry, revision, operation);
  if (geometry.pageIndex !== request.pageIndex) {
    throw new Error(`${operation} returned a mismatched pageIndex`);
  }
  requireCount(geometry.spreadIndex, `${operation} spreadIndex`);
  requireCount(geometry.rectCount, `${operation} rectCount`);
  if (!Array.isArray(geometry.rects)) {
    throw new Error(`${operation} returned malformed range rects`);
  }
  if (geometry.rectCount !== geometry.rects.length) {
    throw new Error(`${operation} returned an inconsistent rectCount`);
  }
  if (geometry.rects.length === 0) {
    throw new Error(`${operation} returned empty range geometry`);
  }
  requireRangeRects(geometry.rects, request, operation);
  return geometry;
}

function requireTextOffsets(offsets, text, operation) {
  let previous;
  for (const [index, value] of offsets.entries()) {
    const offset = requireRecord(value, `${operation} text offset`);
    requireCount(offset.start, `${operation} text offset start`);
    requireCount(offset.end, `${operation} text offset end`);
    if (offset.end < offset.start || offset.end > text.length) {
      throw new Error(`${operation} returned an invalid text offset range`);
    }
    if (!isUtf16Boundary(text, offset.start) || !isUtf16Boundary(text, offset.end)) {
      throw new Error(`${operation} returned a text offset inside a surrogate pair`);
    }
    requireRunTuple(offset, `${operation} text offset`);
    if (index === 0 && offset.start !== 0) {
      throw new Error(`${operation} returned text offsets that do not start at zero`);
    }
    if (previous) requireFollowingOffset(previous, offset, text, operation);
    previous = offset;
  }
  if (!previous) {
    if (text.length !== 0) throw new Error(`${operation} returned text without offsets`);
    return;
  }
  if (previous.end !== text.length) {
    throw new Error(`${operation} returned text offsets that do not cover page text`);
  }
}

function requireFollowingOffset(previous, current, text, operation) {
  if (compareRunTuple(previous, current) >= 0) {
    throw new Error(`${operation} returned text offsets outside layout order`);
  }
  const sameLine =
    previous.blockIndex === current.blockIndex && previous.lineIndex === current.lineIndex;
  if (sameLine) {
    if (current.start !== previous.end) {
      throw new Error(`${operation} returned a non-contiguous same-line text offset`);
    }
    return;
  }
  if (current.start !== previous.end + 1 || text.charCodeAt(previous.end) !== 10) {
    throw new Error(`${operation} returned text offsets without one cross-line LF`);
  }
}

function requireRangeRects(rects, request, operation) {
  const rangeStart = request.start;
  const rangeEnd = request.end;
  let previousEnd;
  let previousRect;
  for (const value of rects) {
    const rect = requireRecord(value, `${operation} range rect`);
    requireRectBounds(rect, operation);
    requireRunTuple(rect, `${operation} range rect`);
    requireCount(rect.startCharIndex, `${operation} range rect startCharIndex`);
    requireCount(rect.endCharIndex, `${operation} range rect endCharIndex`);
    const start = rectPosition(rect, rect.startCharIndex);
    const end = rectPosition(rect, rect.endCharIndex);
    if (comparePosition(start, end) >= 0) {
      throw new Error(`${operation} returned an empty or reversed range rect`);
    }
    if (comparePosition(start, rangeStart) < 0 || comparePosition(end, rangeEnd) > 0) {
      throw new Error(`${operation} returned a rect outside the requested text range`);
    }
    if (previousRect && compareRunTuple(previousRect, rect) >= 0) {
      throw new Error(`${operation} returned multiple or unordered rects for one text run`);
    }
    if (previousEnd && comparePosition(start, previousEnd) < 0) {
      throw new Error(`${operation} returned overlapping range rects`);
    }
    previousRect = rect;
    previousEnd = end;
  }
  const first = rects[0];
  const last = rects.at(-1);
  if (
    comparePosition(rectPosition(first, first.startCharIndex), rangeStart) !== 0 ||
    comparePosition(rectPosition(last, last.endCharIndex), rangeEnd) !== 0
  ) {
    throw new Error(`${operation} returned range geometry that does not cover both endpoints`);
  }
}

function requireMatchingRangeRequest(actual, expected, operation) {
  if (
    actual.pageIndex !== expected.pageIndex ||
    comparePosition(actual.start, expected.start) !== 0 ||
    comparePosition(actual.end, expected.end) !== 0
  ) {
    throw new Error(`${operation} returned geometry for a mismatched normalized request`);
  }
}

function requireWellFormedUtf16(text, operation) {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (isHighSurrogate(code)) {
      if (index + 1 >= text.length || !isLowSurrogate(text.charCodeAt(index + 1))) {
        throw new Error(`${operation} returned malformed UTF-16 page text`);
      }
      index += 1;
    } else if (isLowSurrogate(code)) {
      throw new Error(`${operation} returned malformed UTF-16 page text`);
    }
  }
}

function isUtf16Boundary(text, index) {
  return (
    index === 0 ||
    index === text.length ||
    !(isHighSurrogate(text.charCodeAt(index - 1)) && isLowSurrogate(text.charCodeAt(index)))
  );
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

function requireRectBounds(rect, operation) {
  for (const field of ['x', 'y']) {
    if (!Number.isFinite(rect[field])) {
      throw new Error(`${operation} returned an invalid range rect ${field}`);
    }
  }
  for (const field of ['width', 'height']) {
    if (!Number.isFinite(rect[field]) || rect[field] < 0) {
      throw new Error(`${operation} returned an invalid range rect ${field}`);
    }
  }
}

function requireTextPosition(value, operation) {
  const position = requireRecord(value, operation);
  requireRunTuple(position, operation);
  requireCount(position.charIndex, `${operation} charIndex`);
  return {
    blockIndex: position.blockIndex,
    lineIndex: position.lineIndex,
    runIndex: position.runIndex,
    charIndex: position.charIndex,
  };
}

function requireRunTuple(value, operation) {
  for (const field of ['blockIndex', 'lineIndex', 'runIndex']) {
    requireCount(value[field], `${operation} ${field}`);
  }
}

function normalizeRange(start, end) {
  return comparePosition(start, end) <= 0 ? [start, end] : [end, start];
}

function rectPosition(rect, charIndex) {
  return {
    blockIndex: rect.blockIndex,
    lineIndex: rect.lineIndex,
    runIndex: rect.runIndex,
    charIndex,
  };
}

function compareRunTuple(left, right) {
  return compareTuple(left, right, ['blockIndex', 'lineIndex', 'runIndex']);
}

function comparePosition(left, right) {
  return compareTuple(left, right, ['blockIndex', 'lineIndex', 'runIndex', 'charIndex']);
}

function compareTuple(left, right, fields) {
  for (const field of fields) {
    if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  }
  return 0;
}

function requireRevisionId(value, revision, operation) {
  if (value.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function requireCount(value, operation) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${operation} must be a non-negative safe integer`);
  }
}

function requireRecord(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${operation} must be an object`);
  }
  return value;
}
