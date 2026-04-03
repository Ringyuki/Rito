/**
 * Basic rule-based hyphenation for English text.
 *
 * Uses simple heuristics without a dictionary:
 * - Minimum 3 characters before the break point
 * - Minimum 2 characters after the break point
 * - Breaks at common suffix boundaries
 * - Does not hyphenate short words (< 6 chars)
 */

const MIN_WORD_LENGTH = 6;
const MIN_BEFORE = 3;
const MIN_AFTER = 2;

/** Common suffixes where hyphenation is natural. */
const SUFFIX_BREAKS = [
  'tion',
  'sion',
  'ment',
  'ness',
  'able',
  'ible',
  'ful',
  'less',
  'ous',
  'ive',
  'ing',
  'ent',
  'ant',
  'ence',
  'ance',
  'ity',
  'ally',
  'ical',
];

/**
 * Find possible hyphenation points in a word.
 * Returns an array of character indices where a hyphen break is acceptable.
 * Empty array means the word cannot be hyphenated.
 */
export function findHyphenationPoints(word: string): readonly number[] {
  if (word.length < MIN_WORD_LENGTH) return [];

  const points: number[] = [];
  const lower = word.toLowerCase();

  // Check suffix-based breaks
  for (const suffix of SUFFIX_BREAKS) {
    const idx = lower.length - suffix.length;
    if (idx >= MIN_BEFORE && lower.endsWith(suffix)) {
      points.push(idx);
    }
  }

  // If no suffix match, try breaking at vowel-consonant boundaries
  if (points.length === 0) {
    for (let i = MIN_BEFORE; i <= word.length - MIN_AFTER; i++) {
      const prev = lower[i - 1];
      const curr = lower[i];
      if (prev && curr && isVowel(prev) && !isVowel(curr)) {
        points.push(i);
      }
    }
  }

  // Deduplicate and sort
  return [...new Set(points)].sort((a, b) => a - b);
}

function isVowel(ch: string): boolean {
  return 'aeiou'.includes(ch);
}
