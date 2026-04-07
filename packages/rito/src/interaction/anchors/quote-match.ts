/**
 * TextQuoteSelector creation and resolution.
 * Aligned with W3C Web Annotation text quote matching.
 */

import type { TextQuoteSelector } from './model';
import type { ChapterTextIndex } from './chapter-text-index';

const CONTEXT_LENGTH = 32;

/** Create a TextQuoteSelector from a range in the normalized chapter text. */
export function createTextQuoteSelector(
  index: ChapterTextIndex,
  start: number,
  end: number,
): TextQuoteSelector {
  const exact = index.normalizedText.slice(start, end);
  const result: TextQuoteSelector = { type: 'TextQuoteSelector', exact };
  if (start > 0) {
    (result as { prefix: string }).prefix = index.normalizedText.slice(
      Math.max(0, start - CONTEXT_LENGTH),
      start,
    );
  }
  if (end < index.normalizedText.length) {
    (result as { suffix: string }).suffix = index.normalizedText.slice(
      end,
      Math.min(index.normalizedText.length, end + CONTEXT_LENGTH),
    );
  }
  return result;
}

/**
 * Resolve a TextQuoteSelector against a chapter text index.
 * Returns the character range or undefined if no match.
 * Uses prefix/suffix to disambiguate when multiple matches exist.
 */
export function resolveTextQuoteSelector(
  index: ChapterTextIndex,
  selector: TextQuoteSelector,
): { start: number; end: number } | undefined {
  const { exact, prefix, suffix } = selector;
  const text = index.normalizedText;
  if (exact.length === 0) return undefined;

  const matches = collectExactMatches(text, exact);
  if (matches.length === 0) return undefined;
  if (matches.length === 1) {
    const single = matches[0];
    if (single === undefined) return undefined;
    return { start: single, end: single + exact.length };
  }

  const bestMatch = disambiguate(matches, text, exact, prefix, suffix);
  return { start: bestMatch, end: bestMatch + exact.length };
}

function collectExactMatches(text: string, exact: string): number[] {
  const matches: number[] = [];
  let pos = 0;
  while (pos <= text.length - exact.length) {
    const idx = text.indexOf(exact, pos);
    if (idx === -1) break;
    matches.push(idx);
    pos = idx + 1;
  }
  return matches;
}

function disambiguate(
  matches: readonly number[],
  text: string,
  exact: string,
  prefix?: string,
  suffix?: string,
): number {
  let bestMatch = matches[0] ?? 0;
  let bestScore = -1;
  for (const matchStart of matches) {
    const score = scoreMatch(matchStart, text, exact, prefix, suffix);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = matchStart;
    }
  }
  return bestMatch;
}

function scoreMatch(
  matchStart: number,
  text: string,
  exact: string,
  prefix?: string,
  suffix?: string,
): number {
  let score = 0;
  if (prefix) {
    const before = text.slice(Math.max(0, matchStart - prefix.length), matchStart);
    score += before.endsWith(prefix) ? prefix.length : commonSuffixLength(before, prefix);
  }
  if (suffix) {
    const after = text.slice(matchStart + exact.length, matchStart + exact.length + suffix.length);
    score += after.startsWith(suffix) ? suffix.length : commonPrefixLength(after, suffix);
  }
  return score;
}

function commonPrefixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[i] === b[i]) i++;
  return i;
}

function commonSuffixLength(a: string, b: string): number {
  const len = Math.min(a.length, b.length);
  let i = 0;
  while (i < len && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}
