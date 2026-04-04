import { describe, expect, it } from 'vitest';
import { findHyphenationPoints } from '../../src/layout/text/hyphenation';

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

  describe('known words match TeX hyphenation', () => {
    it('hyphenates "hyphenation" correctly', () => {
      // TeX: hy-phen-ation or hyph-en-ation
      const points = findHyphenationPoints('hyphenation');
      expect(points.length).toBeGreaterThan(0);
      // All points must be within valid range
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(2);
        expect(p).toBeLessThanOrEqual(8); // word.length - MIN_AFTER
      }
    });

    it('hyphenates "algorithm" correctly', () => {
      const points = findHyphenationPoints('algorithm');
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(2);
        expect(p).toBeLessThanOrEqual(6);
      }
    });

    it('hyphenates "computer" correctly', () => {
      const points = findHyphenationPoints('computer');
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(2);
        expect(p).toBeLessThanOrEqual(5);
      }
    });

    it('hyphenates "programming" correctly', () => {
      const points = findHyphenationPoints('programming');
      expect(points.length).toBeGreaterThan(0);
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(2);
        expect(p).toBeLessThanOrEqual(8);
      }
    });

    it('hyphenates "possible" to pos-si-ble', () => {
      const points = findHyphenationPoints('possible');
      expect(points).toContain(3); // pos-sible
      expect(points).toContain(5); // possi-ble
    });

    it('hyphenates "running" to run-ning', () => {
      const points = findHyphenationPoints('running');
      expect(points).toContain(3);
    });

    it('hyphenates "movement" with at least one break', () => {
      const points = findHyphenationPoints('movement');
      expect(points.length).toBeGreaterThan(0);
    });

    it('hyphenates "readable" with at least one break', () => {
      const points = findHyphenationPoints('readable');
      expect(points.length).toBeGreaterThan(0);
    });
  });

  describe('exceptions are handled', () => {
    it('hyphenates "associate" per exception list', () => {
      // Exception: as-so-ciate
      const points = findHyphenationPoints('associate');
      expect(points).toEqual([2, 4]);
    });

    it('does not hyphenate "present" (exception with no hyphens)', () => {
      const points = findHyphenationPoints('present');
      expect(points).toEqual([]);
    });

    it('does not hyphenate "project" (exception with no hyphens)', () => {
      const points = findHyphenationPoints('project');
      expect(points).toEqual([]);
    });
  });

  describe('case insensitivity', () => {
    it('gives same results for uppercase word', () => {
      const lower = findHyphenationPoints('movement');
      const upper = findHyphenationPoints('MOVEMENT');
      expect(upper).toEqual(lower);
    });

    it('gives same results for mixed-case word', () => {
      const lower = findHyphenationPoints('readable');
      const mixed = findHyphenationPoints('Readable');
      expect(mixed).toEqual(lower);
    });
  });

  describe('MIN_BEFORE and MIN_AFTER constraints', () => {
    it('no point at index 0 or 1', () => {
      const points = findHyphenationPoints('operation');
      for (const p of points) {
        expect(p).toBeGreaterThanOrEqual(2);
      }
    });

    it('no point in the last 2 characters', () => {
      const word = 'elaborate';
      const points = findHyphenationPoints(word);
      for (const p of points) {
        expect(p).toBeLessThanOrEqual(word.length - 3);
      }
    });
  });

  describe('sorting and uniqueness', () => {
    it('returns sorted unique points', () => {
      const points = findHyphenationPoints('hyphenation');
      for (let i = 1; i < points.length; i++) {
        const prev = points[i - 1];
        if (prev !== undefined) expect(points[i]).toBeGreaterThan(prev);
      }
      expect(points.length).toBe(new Set(points).size);
    });
  });

  describe('performance', () => {
    it('processes 1000 words under 50ms', () => {
      const words = [
        'hyphenation',
        'algorithm',
        'computer',
        'programming',
        'dictionary',
        'typography',
        'operation',
        'international',
        'understanding',
        'application',
      ];
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        for (const word of words) {
          findHyphenationPoints(word);
        }
      }
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(50);
    });
  });
});
