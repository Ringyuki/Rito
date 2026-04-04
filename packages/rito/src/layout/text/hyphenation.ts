/**
 * Dictionary-based hyphenation using Liang's algorithm with TeX en-US patterns.
 */

import { buildTrie, findPointsWithTrie } from './hyphenation-trie';
import type { HyphenationTrie } from './hyphenation-trie';
import { EN_US_EXCEPTIONS_RAW, EN_US_PATTERNS_RAW } from './patterns/en-us';

const MIN_WORD_LENGTH = 6;
const MIN_BEFORE = 2;
const MIN_AFTER = 3;

interface LangData {
  trie: HyphenationTrie;
  exceptions: Map<string, readonly number[]>;
}

const cache = new Map<string, LangData>();

function getLangData(lang: string): LangData | undefined {
  const cached = cache.get(lang);
  if (cached) return cached;

  // Currently only en-US patterns are bundled.
  // Future: dynamic import() for de, fr, es, pt, nl, it, ru, etc.
  if (lang !== 'en-us') return undefined;

  const trie = buildTrie(EN_US_PATTERNS_RAW.split(' '));
  const exceptions = new Map<string, readonly number[]>();
  for (const entry of EN_US_EXCEPTIONS_RAW.split(' ')) {
    const word = entry.replace(/-/g, '');
    const points: number[] = [];
    let pos = 0;
    for (const part of entry.split('-')) {
      pos += part.length;
      if (pos < word.length) points.push(pos);
    }
    exceptions.set(word, points);
  }

  const data: LangData = { trie, exceptions };
  cache.set(lang, data);
  return data;
}

/**
 * Find possible hyphenation points in a word.
 * Returns an array of character indices where a hyphen break is acceptable.
 * Empty array means the word cannot be hyphenated.
 *
 * @param lang BCP-47 language tag (default `'en-us'`). Unsupported languages
 *             return an empty array (no hyphenation) rather than failing.
 */
export function findHyphenationPoints(word: string, lang = 'en-us'): readonly number[] {
  if (word.length < MIN_WORD_LENGTH) return [];

  const data = getLangData(lang);
  if (!data) return [];

  const lower = word.toLowerCase();
  const exception = data.exceptions.get(lower);
  if (exception) return exception;

  return findPointsWithTrie(lower, data.trie, MIN_BEFORE, MIN_AFTER);
}
