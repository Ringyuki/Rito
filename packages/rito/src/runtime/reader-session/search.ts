import type { SpineItem } from '../../parser/epub/types';
import { createReaderSessionError } from './errors';
import type { ReaderRevisionRecord } from './revision';
import type {
  ReaderLocator,
  ReaderSearchResult,
  ReaderSessionId,
  SearchBatch,
  SearchRequest,
} from './types';

const DEFAULT_SEARCH_LIMIT = 50;
const CONTEXT_CHARS = 32;

export interface SearchReaderRevisionInput {
  readonly sessionId: ReaderSessionId;
  readonly record: ReaderRevisionRecord;
  readonly request: SearchRequest;
  readonly spine: readonly SpineItem[];
  readonly manifestHrefs: ReadonlyMap<string, string>;
  readonly manifestMediaTypes: ReadonlyMap<string, string>;
}

interface SearchState {
  readonly input: SearchReaderRevisionInput;
  readonly limit: number;
  readonly needle: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly results: ReaderSearchResult[];
  hasMore: boolean;
}

interface SearchText {
  readonly text: string;
  readonly originalStartOffsets: readonly number[];
  readonly originalEndOffsets: readonly number[];
}

interface SearchRange {
  readonly start: number;
  readonly end: number;
}

export function searchReaderRevision(input: SearchReaderRevisionInput): SearchBatch {
  const pagination = input.record.pagination;
  if (!pagination) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'internal-error',
      `Revision ${input.record.revision.id} has no pagination metadata`,
    );
  }

  const state = createSearchState(input);
  if (state.needle.length === 0) return searchBatch(state);

  for (let spineIndex = 0; spineIndex < input.spine.length; spineIndex++) {
    const spineItem = input.spine[spineIndex];
    if (!spineItem) continue;
    const chapterIndex = pagination.chapterTextIndices.get(spineItem.idref);
    if (!chapterIndex) continue;
    searchChapter(state, spineItem, spineIndex, chapterIndex.normalizedText);
    if (state.hasMore) break;
  }

  return searchBatch(state);
}

function createSearchState(input: SearchReaderRevisionInput): SearchState {
  const limit = input.request.limit ?? DEFAULT_SEARCH_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw createReaderSessionError(
      input.sessionId,
      input.record.revision.id,
      'bad-request',
      'Search limit must be a positive integer',
    );
  }
  return {
    input,
    limit,
    needle: searchNeedle(input.request.query, input.request.caseSensitive ?? false),
    caseSensitive: input.request.caseSensitive ?? false,
    wholeWord: input.request.wholeWord ?? false,
    results: [],
    hasMore: false,
  };
}

function searchChapter(
  state: SearchState,
  spineItem: SpineItem,
  spineIndex: number,
  text: string,
): void {
  const searchable = createSearchText(text, state.caseSensitive);
  const haystack = searchable.text;
  let position = 0;
  while (position <= haystack.length - state.needle.length) {
    const matchStart = haystack.indexOf(state.needle, position);
    if (matchStart === -1) return;
    const matchEnd = matchStart + state.needle.length;
    if (!state.wholeWord || isWholeWordMatch(haystack, matchStart, matchEnd)) {
      const range = originalRangeForMatch(searchable, matchStart, matchEnd);
      if (range) appendSearchResult(state, spineItem, spineIndex, text, range);
      if (state.hasMore) return;
    }
    position = Math.max(matchStart + state.needle.length, matchStart + 1);
  }
}

function appendSearchResult(
  state: SearchState,
  spineItem: SpineItem,
  spineIndex: number,
  text: string,
  range: SearchRange,
): void {
  if (state.results.length >= state.limit) {
    state.hasMore = true;
    return;
  }
  state.results.push({
    locator: searchLocator(state, spineItem, spineIndex, text, range),
    snippet: snippet(text, range.start, range.end),
  });
}

function searchLocator(
  state: SearchState,
  spineItem: SpineItem,
  spineIndex: number,
  text: string,
  range: SearchRange,
): ReaderLocator {
  const href = state.input.manifestHrefs.get(spineItem.idref) ?? spineItem.idref;
  const mediaType = state.input.manifestMediaTypes.get(spineItem.idref) ?? 'application/xhtml+xml';
  const progression = text.length > 0 ? range.start / text.length : 0;
  return {
    href,
    mediaType,
    progression,
    totalProgression: totalProgression(state.input.spine.length, spineIndex, progression),
    sourceRange: range,
    text: {
      highlight: text.slice(range.start, range.end),
      ...(range.start > 0
        ? { before: text.slice(Math.max(0, range.start - CONTEXT_CHARS), range.start) }
        : {}),
      ...(range.end < text.length
        ? { after: text.slice(range.end, Math.min(text.length, range.end + CONTEXT_CHARS)) }
        : {}),
    },
  };
}

function totalProgression(
  spineLength: number,
  spineIndex: number,
  chapterProgression: number,
): number {
  if (spineLength <= 0) return chapterProgression;
  return (spineIndex + chapterProgression) / spineLength;
}

function snippet(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  const prefix = from > 0 ? '...' : '';
  const suffix = to < text.length ? '...' : '';
  return `${prefix}${text.slice(from, to)}${suffix}`;
}

function searchBatch(state: SearchState): SearchBatch {
  return {
    results: state.results,
    hasMore: state.hasMore,
  };
}

function searchNeedle(query: string, caseSensitive: boolean): string {
  return caseSensitive ? query : createSearchText(query, false).text;
}

function createSearchText(text: string, caseSensitive: boolean): SearchText {
  return caseSensitive ? identitySearchText(text) : foldedSearchText(text);
}

function identitySearchText(text: string): SearchText {
  const originalStartOffsets: number[] = [];
  const originalEndOffsets: number[] = [];
  for (let index = 0; index < text.length; index++) {
    originalStartOffsets.push(index);
    originalEndOffsets.push(index + 1);
  }
  return { text, originalStartOffsets, originalEndOffsets };
}

function foldedSearchText(text: string): SearchText {
  const parts: string[] = [];
  const originalStartOffsets: number[] = [];
  const originalEndOffsets: number[] = [];
  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    const source = String.fromCodePoint(codePoint);
    const sourceEnd = index + source.length;
    const folded = source.toLowerCase();
    parts.push(folded);
    for (let foldedIndex = 0; foldedIndex < folded.length; foldedIndex++) {
      originalStartOffsets.push(index);
      originalEndOffsets.push(sourceEnd);
    }
    index = sourceEnd;
  }
  return { text: parts.join(''), originalStartOffsets, originalEndOffsets };
}

function originalRangeForMatch(
  searchText: SearchText,
  start: number,
  end: number,
): SearchRange | undefined {
  if (end <= start) return undefined;
  const originalStart = searchText.originalStartOffsets[start];
  const originalEnd = searchText.originalEndOffsets[end - 1];
  if (originalStart === undefined || originalEnd === undefined) return undefined;
  return { start: originalStart, end: originalEnd };
}

function isWholeWordMatch(text: string, start: number, end: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[end]);
}

function isWordChar(value: string | undefined): boolean {
  if (value === undefined) return false;
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 95
  );
}
