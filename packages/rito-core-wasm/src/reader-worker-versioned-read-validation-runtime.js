import { requireRevisionBundle } from './core-wasm-versioned-validation-runtime.js';
import { requireExactSourceRangeRequest } from './reader-worker-exact-source-range-validation-runtime.js';

export function requireReaderRevisionBundle(value, revision, operation) {
  const bundle = requireRevisionBundle(value, revision, operation);
  requireFootnotes(bundle.footnotes, revision, operation);
  requireChapterTextIndices(bundle.chapterTextIndices, revision, operation);
  return bundle;
}

export function requireFootnotes(value, revision, operation) {
  const footnotes = requireRecord(value, `${operation} result`);
  requireRevisionId(footnotes, revision, operation);
  const entries = requireRecord(footnotes.entries, `${operation} entries`);
  for (const [key, entry] of Object.entries(entries)) {
    if (key.length === 0) throw new Error(`${operation} returned an empty footnote key`);
    requireFootnoteEntry(entry, operation);
  }
  return footnotes;
}

export function requireChapterTextIndices(value, revision, operation) {
  const indices = requireRecord(value, `${operation} result`);
  requireRevisionId(indices, revision, operation);
  const entries = requireRecord(indices.entries, `${operation} entries`);
  for (const [key, entryValue] of Object.entries(entries)) {
    const entry = requireRecord(entryValue, `${operation} chapter text entry`);
    if (key.length === 0 || typeof entry.href !== 'string' || entry.href.length === 0) {
      throw new Error(`${operation} returned an invalid chapter text href`);
    }
    if (typeof entry.normalizedText !== 'string' || !Array.isArray(entry.spans)) {
      throw new Error(`${operation} returned malformed chapter text content`);
    }
    for (const span of entry.spans) requireChapterTextSpan(span, operation);
  }
  return indices;
}

export function requireSearchRequest(value, operation) {
  const request = requireRecord(value, `${operation} request`);
  if (typeof request.query !== 'string') {
    throw new TypeError(`${operation} query must be a string`);
  }
  for (const field of ['caseSensitive', 'wholeWord']) {
    if (typeof request[field] !== 'boolean') {
      throw new TypeError(`${operation} ${field} must be a boolean`);
    }
  }
  if (request.limit !== undefined && !isCount(request.limit)) {
    throw new TypeError(`${operation} limit must be a non-negative safe integer`);
  }
  return {
    query: request.query,
    caseSensitive: request.caseSensitive,
    wholeWord: request.wholeWord,
    ...(request.limit !== undefined ? { limit: request.limit } : {}),
  };
}

export function requireSearchResponse(value, revision, request, operation) {
  const response = requireRecord(value, `${operation} result`);
  requireRevisionId(response, revision, operation);
  for (const field of ['query', 'caseSensitive', 'wholeWord']) {
    if (response[field] !== request[field]) {
      throw new Error(`${operation} returned a mismatched ${field}`);
    }
  }
  if (!Array.isArray(response.results) || !isCount(response.resultCount)) {
    throw new Error(`${operation} returned malformed search results`);
  }
  if (response.resultCount !== response.results.length) {
    throw new Error(`${operation} returned an inconsistent resultCount`);
  }
  if (request.limit !== undefined && response.resultCount > request.limit) {
    throw new Error(`${operation} returned more results than requested`);
  }
  for (const result of response.results) requireSearchResult(result, operation);
  return response;
}

function requireFootnoteEntry(value, operation) {
  const entry = requireRecord(value, `${operation} footnote entry`);
  if (!['footnote', 'endnote', 'rearnote', 'note'].includes(entry.kind)) {
    throw new Error(`${operation} returned an invalid footnote kind`);
  }
  if (typeof entry.text !== 'string' || typeof entry.html !== 'string') {
    throw new Error(`${operation} returned invalid footnote content`);
  }
}

function requireChapterTextSpan(value, operation) {
  const span = requireRecord(value, `${operation} chapter text span`);
  if (!Array.isArray(span.nodePath) || span.nodePath.some((part) => !isCount(part))) {
    throw new Error(`${operation} returned an invalid chapter text node path`);
  }
  for (const field of ['sourceStart', 'sourceEnd', 'normalizedStart', 'normalizedEnd']) {
    if (!isCount(span[field])) {
      throw new Error(`${operation} returned an invalid chapter text ${field}`);
    }
  }
  if (span.sourceStart > span.sourceEnd || span.normalizedStart > span.normalizedEnd) {
    throw new Error(`${operation} returned an inverted chapter text span`);
  }
}

function requireSearchResult(value, operation) {
  const result = requireRecord(value, `${operation} search result`);
  requireCount(result.pageIndex, `${operation} pageIndex`);
  requireCount(result.spreadIndex, `${operation} spreadIndex`);
  const range = requireRecord(result.matchRange, `${operation} match range`);
  if (range.pageIndex !== result.pageIndex || typeof range.context !== 'string') {
    throw new Error(`${operation} returned a malformed match range`);
  }
  requireTextPosition(range.start, operation);
  requireTextPosition(range.end, operation);
  requireSearchSource(result.source, operation);
}

function requireSearchSource(value, operation) {
  const source = requireRecord(value, `${operation} search source`);
  if (source.status === 'resolved') {
    requireExactSourceRangeRequest(
      { href: source.href, sourceRange: source.sourceRange },
      `${operation} search source`,
    );
    return;
  }
  if (source.status === 'unavailable' && source.reason === 'sourceUnavailable') return;
  throw new Error(`${operation} returned an invalid search source`);
}

function requireTextPosition(value, operation) {
  const position = requireRecord(value, `${operation} text position`);
  for (const field of ['blockIndex', 'lineIndex', 'runIndex', 'charIndex']) {
    requireCount(position[field], `${operation} ${field}`);
  }
}

function requireRevisionId(value, revision, operation) {
  if (value.revisionId !== revision.revisionId) {
    throw new Error(`${operation} returned a mismatched revisionId`);
  }
}

function requireRecord(value, operation) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${operation} must be an object`);
  }
  return value;
}

function requireCount(value, operation) {
  if (!isCount(value)) throw new Error(`${operation} must be a non-negative safe integer`);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}
