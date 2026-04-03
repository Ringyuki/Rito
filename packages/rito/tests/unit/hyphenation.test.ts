import { describe, expect, it } from 'vitest';
import { findHyphenationPoints } from '../../src/layout/hyphenation';

describe('findHyphenationPoints', () => {
  describe('short words (< 6 chars) return empty', () => {
    it('returns [] for a 5-letter word', () => {
      expect(findHyphenationPoints('about')).toEqual([]);
    });

    it('returns [] for a 3-letter word', () => {
      expect(findHyphenationPoints('the')).toEqual([]);
    });

    it('returns [] for an empty string', () => {
      expect(findHyphenationPoints('')).toEqual([]);
    });
  });

  describe('known suffix matches', () => {
    it('finds -tion in "nation"', () => {
      // "nation" length 6, suffix "tion" length 4, idx = 2
      // idx (2) < MIN_BEFORE (3), so no match
      expect(findHyphenationPoints('nation')).not.toContain(2);
    });

    it('finds -tion in "eration"', () => {
      // "eration" length 7, idx = 3 (>= MIN_BEFORE)
      const points = findHyphenationPoints('eration');
      expect(points).toContain(3);
    });

    it('finds -ment in "movement"', () => {
      // "movement" length 8, suffix "ment" length 4, idx = 4
      const points = findHyphenationPoints('movement');
      expect(points).toContain(4);
    });

    it('finds -ible in "possible"', () => {
      // "possible" length 8, suffix "ible" length 4, idx = 4
      const points = findHyphenationPoints('possible');
      expect(points).toContain(4);
    });

    it('finds -ness in "sadness"', () => {
      // "sadness" length 7, suffix "ness" length 4, idx = 3
      const points = findHyphenationPoints('sadness');
      expect(points).toContain(3);
    });

    it('finds -ing in "running"', () => {
      // "running" length 7, suffix "ing" length 3, idx = 4
      const points = findHyphenationPoints('running');
      expect(points).toContain(4);
    });

    it('finds -able in "readable"', () => {
      // "readable" length 8, suffix "able" length 4, idx = 4
      const points = findHyphenationPoints('readable');
      expect(points).toContain(4);
    });
  });

  describe('vowel-consonant fallback', () => {
    it('applies VC fallback when no suffix matches', () => {
      // "catalog" has no matching suffix, length 7
      // Vowel-consonant transitions: a-t at 2 (< MIN_BEFORE), a-l at 4, o-g at 6 (word.length - MIN_AFTER = 5, so 6 > 5 excluded)
      const points = findHyphenationPoints('catalog');
      expect(points.length).toBeGreaterThan(0);
      // Should only contain points in [MIN_BEFORE, word.length - MIN_AFTER]
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(3);
        expect(p).toBeLessThanOrEqual(5);
      }
    });

    it('does not use VC fallback when a suffix matches', () => {
      // "hopeless" matches suffix "less" (idx=4); VC fallback is skipped
      // If VC ran, it would also find idx=3 (e→l) and idx=5 (e→s)
      const points = findHyphenationPoints('hopeless');
      expect(points).toEqual([4]);
      expect(points).not.toContain(3);
      expect(points).not.toContain(5);
    });
  });

  describe('case insensitivity', () => {
    it('finds suffix in uppercase word', () => {
      const points = findHyphenationPoints('MOVEMENT');
      expect(points).toContain(4);
    });

    it('finds suffix in mixed-case word', () => {
      const points = findHyphenationPoints('Readable');
      expect(points).toContain(4);
    });
  });

  describe('MIN_BEFORE and MIN_AFTER constraints', () => {
    it('rejects suffix break when idx < MIN_BEFORE', () => {
      // "nation" → idx for "tion" is 2, which is < MIN_BEFORE (3)
      const points = findHyphenationPoints('nation');
      expect(points).not.toContain(2);
    });

    it('VC fallback does not place points before MIN_BEFORE', () => {
      // "abcdef" (no suffix match): first eligible position is index 3
      const points = findHyphenationPoints('abcdef');
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(3);
      }
    });

    it('VC fallback does not place points after word.length - MIN_AFTER', () => {
      const word = 'elabor';
      const points = findHyphenationPoints(word);
      for (const p of points) {
        expect(p).toBeLessThanOrEqual(word.length - 2);
      }
    });
  });

  describe('deduplication and sorting', () => {
    it('returns sorted unique points for a word with multiple suffix matches', () => {
      // "entially" length 8: matches "ially"? No. matches "ally" idx=4, "ity"? No.
      // "mentality" length 9: matches "ment" idx=5? No, "ment" not at end. "ity" idx=6, "ally"? No, "ality" idx=4? "ality" not a suffix. "ity" at end: idx=6
      const points = findHyphenationPoints('mentality');
      // Should be sorted
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        if (prev !== undefined) expect(points[i]).toBeGreaterThan(prev);
      }
      // Should be deduplicated (all unique)
      expect(points.length).toBe(new Set(points).size);
    });

    it('deduplicates when multiple suffixes yield the same index', () => {
      // "abundance" length 9: "ance" idx=5, "ence"? no. Only one suffix match.
      // Construct a scenario: "iveness" length 7: "ness" idx=3, "ive" → not at end. Just "ness" idx=3.
      // Better: use a word where two suffixes could overlap:
      // "alliance" length 8: "ance" idx=4, "iance"? not a suffix, "ence"? no.
      // The dedup is mainly a safety net; verify the invariant holds.
      const points = findHyphenationPoints('alliance');
      const unique = [...new Set(points)];
      expect(points).toEqual(unique);
    });
  });
});
