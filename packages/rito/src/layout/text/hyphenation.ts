/**
 * Dictionary-based hyphenation using Liang's algorithm with TeX en-US patterns.
 */

import { buildTrie, findPointsWithTrie } from './hyphenation-trie';
import type { HyphenationTrie } from './hyphenation-trie';
import { EN_US_EXCEPTIONS_RAW, EN_US_PATTERNS_RAW } from './patterns/en-us';

const MIN_WORD_LENGTH = 6;
const MIN_BEFORE = 2;
const MIN_AFTER = 3;

let cachedTrie: HyphenationTrie | undefined;
let cachedExceptions: Map<string, readonly number[]> | undefined;

function getTrie(): HyphenationTrie {
  cachedTrie ??= buildTrie(EN_US_PATTERNS_RAW.split(' '));
  return cachedTrie;
}

function getExceptions(): Map<string, readonly number[]> {
  if (!cachedExceptions) {
    cachedExceptions = new Map();
    for (const entry of EN_US_EXCEPTIONS_RAW.split(' ')) {
      const word = entry.replace(/-/g, '');
      const points: number[] = [];
      let pos = 0;
      for (const part of entry.split('-')) {
        pos += part.length;
        if (pos < word.length) points.push(pos);
      }
      cachedExceptions.set(word, points);
    }
  }
  return cachedExceptions;
}

/**
 * Find possible hyphenation points in a word.
 * Returns an array of character indices where a hyphen break is acceptable.
 * Empty array means the word cannot be hyphenated.
 */
export function findHyphenationPoints(word: string): readonly number[] {
  if (word.length < MIN_WORD_LENGTH) return [];

  const lower = word.toLowerCase();
  const exception = getExceptions().get(lower);
  if (exception) return exception;

  return findPointsWithTrie(lower, getTrie(), MIN_BEFORE, MIN_AFTER);
}
