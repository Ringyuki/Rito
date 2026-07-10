import type { Page } from '../../layout/core/types';
import type { TextPosition, TextRange } from '../core/types';
import { walkPageTextRuns } from '../core/text-traversal';

/** A prebuilt search index for all pages. */
export interface SearchIndex {
  readonly pages: readonly PageText[];
}

/** Extracted text from a single page with run-level offset mapping. */
export interface PageText {
  readonly pageIndex: number;
  readonly text: string;
  readonly offsets: readonly RunOffset[];
}

/** Maps a character offset range in PageText.text to a run position. */
interface RunOffset {
  readonly start: number;
  readonly end: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
}

/** A single search match. */
export interface SearchResult {
  readonly pageIndex: number;
  readonly range: TextRange;
  readonly context: string;
}

/** Search options. */
export interface SearchOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
}

/** Build a search index from all pages. Pure computation. */
export function buildSearchIndex(pages: readonly Page[]): SearchIndex {
  return { pages: pages.map(extractPageText) };
}

/** Search the index for a query string. Returns all matches across all pages. */
export function search(
  index: SearchIndex,
  query: string,
  options?: SearchOptions,
): readonly SearchResult[] {
  if (query.length === 0) return [];
  const caseSensitive = options?.caseSensitive ?? false;
  const wholeWord = options?.wholeWord ?? false;
  const results: SearchResult[] = [];

  for (const pageText of index.pages) {
    const folded = caseSensitive ? identityFold(pageText.text) : foldCaseWithOffsets(pageText.text);
    const haystack = folded.text;
    const needle = caseSensitive ? query : foldCaseWithOffsets(query).text;
    if (needle.length === 0) continue;
    let pos = 0;
    let lastSourceMatch: string | undefined;

    while (pos <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;

      const originalStart = folded.startOffsets[idx];
      const originalEnd = folded.endOffsets[idx + needle.length - 1];
      if (originalStart === undefined || originalEnd === undefined) break;

      if (wholeWord && !isWordBoundary(pageText.text, originalStart, originalEnd - originalStart)) {
        pos = idx + 1;
        continue;
      }

      const start = offsetToPosition(pageText.offsets, originalStart, 'start');
      const end = offsetToPosition(pageText.offsets, originalEnd, 'end');
      const sourceMatch = `${String(originalStart)}:${String(originalEnd)}`;
      if (start && end && sourceMatch !== lastSourceMatch) {
        results.push({
          pageIndex: pageText.pageIndex,
          range: { start, end },
          context: extractContext(pageText.text, originalStart, originalEnd - originalStart),
        });
        lastSourceMatch = sourceMatch;
      }
      pos = idx + needle.length;
    }
  }

  return results;
}

function extractPageText(page: Page): PageText {
  const parts: string[] = [];
  const offsets: RunOffset[] = [];
  const state = { offset: 0 };

  let previousLine: { readonly blockIndex: number; readonly lineIndex: number } | undefined;
  walkPageTextRuns(page, ({ run, blockIndex, lineIndex, runIndex }) => {
    if (
      previousLine &&
      (previousLine.blockIndex !== blockIndex || previousLine.lineIndex !== lineIndex)
    ) {
      parts.push('\n');
      state.offset++;
    }
    offsets.push({
      start: state.offset,
      end: state.offset + run.text.length,
      blockIndex,
      lineIndex,
      runIndex,
    });
    parts.push(run.text);
    state.offset += run.text.length;
    previousLine = { blockIndex, lineIndex };
    return false;
  });

  return { pageIndex: page.index, text: parts.join(''), offsets };
}

function offsetToPosition(
  offsets: readonly RunOffset[],
  offset: number,
  bias: 'start' | 'end',
): TextPosition | undefined {
  for (const entry of offsets) {
    const inEntry =
      bias === 'start'
        ? offset >= entry.start && offset < entry.end
        : offset > entry.start && offset <= entry.end;
    if (inEntry) {
      return {
        blockIndex: entry.blockIndex,
        lineIndex: entry.lineIndex,
        runIndex: entry.runIndex,
        charIndex: offset - entry.start,
      };
    }
  }
  if (bias === 'end' && offset === 0) {
    const first = offsets[0];
    if (!first) return undefined;
    return {
      blockIndex: first.blockIndex,
      lineIndex: first.lineIndex,
      runIndex: first.runIndex,
      charIndex: 0,
    };
  }
  return undefined;
}

const CONTEXT_CHARS = 30;

function extractContext(text: string, matchStart: number, matchLength: number): string {
  const start = Math.max(0, matchStart - CONTEXT_CHARS);
  const end = Math.min(text.length, matchStart + matchLength + CONTEXT_CHARS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < text.length ? '...' : '';
  return prefix + text.slice(start, end) + suffix;
}

function isWordBoundary(text: string, start: number, length: number): boolean {
  const before = codePointBefore(text, start);
  const after = codePointAt(text, start + length);
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[\p{L}\p{M}\p{N}\p{Pc}]/u.test(ch);
}

interface FoldedText {
  readonly text: string;
  readonly startOffsets: readonly number[];
  readonly endOffsets: readonly number[];
}

function identityFold(text: string): FoldedText {
  return {
    text,
    startOffsets: Array.from({ length: text.length }, (_, index) => index),
    endOffsets: Array.from({ length: text.length }, (_, index) => index + 1),
  };
}

/** Preserve UTF-16 source ranges when lowercase folding expands a code point. */
function foldCaseWithOffsets(text: string): FoldedText {
  const parts: string[] = [];
  const startOffsets: number[] = [];
  const endOffsets: number[] = [];
  let sourceOffset = 0;
  for (const codePoint of text) {
    // Upper-then-lower approximates Unicode default case folding with the JS
    // casing tables, including expansions such as ß → ss and ς → σ.
    const folded = codePoint.toUpperCase().toLowerCase();
    parts.push(folded);
    for (let index = 0; index < folded.length; index++) {
      startOffsets.push(sourceOffset);
      endOffsets.push(sourceOffset + codePoint.length);
    }
    sourceOffset += codePoint.length;
  }
  return { text: parts.join(''), startOffsets, endOffsets };
}

function codePointBefore(text: string, offset: number): string | undefined {
  if (offset <= 0) return undefined;
  const trailing = text.charCodeAt(offset - 1);
  const length = trailing >= 0xdc00 && trailing <= 0xdfff ? 2 : 1;
  return text.slice(Math.max(0, offset - length), offset);
}

function codePointAt(text: string, offset: number): string | undefined {
  if (offset >= text.length) return undefined;
  const value = text.codePointAt(offset);
  return value === undefined ? undefined : String.fromCodePoint(value);
}
