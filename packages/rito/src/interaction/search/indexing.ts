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
    const haystack = caseSensitive ? pageText.text : pageText.text.toLowerCase();
    const needle = caseSensitive ? query : query.toLowerCase();
    let pos = 0;

    while (pos <= haystack.length - needle.length) {
      const idx = haystack.indexOf(needle, pos);
      if (idx === -1) break;

      if (wholeWord && !isWordBoundary(haystack, idx, needle.length)) {
        pos = idx + 1;
        continue;
      }

      const start = offsetToPosition(pageText.offsets, idx, 'start');
      const end = offsetToPosition(pageText.offsets, idx + needle.length, 'end');
      if (start && end) {
        results.push({
          pageIndex: pageText.pageIndex,
          range: { start, end },
          context: extractContext(pageText.text, idx, needle.length),
        });
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

  walkPageTextRuns(page, ({ run, blockIndex, lineIndex, runIndex }) => {
    offsets.push({
      start: state.offset,
      end: state.offset + run.text.length,
      blockIndex,
      lineIndex,
      runIndex,
    });
    parts.push(run.text);
    state.offset += run.text.length;
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
  const before = start > 0 ? text[start - 1] : ' ';
  const after = start + length < text.length ? text[start + length] : ' ';
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  return /\w/.test(ch);
}
