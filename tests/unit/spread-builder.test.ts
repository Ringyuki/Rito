import { describe, expect, it } from 'vitest';
import { buildSpreads } from '../../src/layout/spread-builder';
import { createLayoutConfig } from '../../src/layout/config';
import type { Page } from '../../src/layout/types';

function makePage(index: number): Page {
  return { index, bounds: { x: 0, y: 0, width: 400, height: 600 }, content: [] };
}

const SINGLE = createLayoutConfig({ width: 400, height: 600 });
const DOUBLE = createLayoutConfig({
  width: 400,
  height: 600,
  spread: 'double',
  firstPageAlone: false,
  spreadGap: 20,
});
const DOUBLE_COVER = createLayoutConfig({
  width: 400,
  height: 600,
  spread: 'double',
  firstPageAlone: true,
  spreadGap: 20,
});

describe('buildSpreads', () => {
  describe('single mode', () => {
    it('each page becomes its own spread', () => {
      const pages = [makePage(0), makePage(1), makePage(2)];
      const spreads = buildSpreads(pages, SINGLE);

      expect(spreads).toHaveLength(3);
      expect(spreads[0]?.left?.index).toBe(0);
      expect(spreads[0]?.right).toBeUndefined();
      expect(spreads[1]?.left?.index).toBe(1);
      expect(spreads[2]?.left?.index).toBe(2);
    });

    it('returns empty for no pages', () => {
      expect(buildSpreads([], SINGLE)).toHaveLength(0);
    });
  });

  describe('double mode', () => {
    it('pairs pages left-right', () => {
      const pages = [makePage(0), makePage(1), makePage(2), makePage(3)];
      const spreads = buildSpreads(pages, DOUBLE);

      expect(spreads).toHaveLength(2);
      expect(spreads[0]?.left?.index).toBe(0);
      expect(spreads[0]?.right?.index).toBe(1);
      expect(spreads[1]?.left?.index).toBe(2);
      expect(spreads[1]?.right?.index).toBe(3);
    });

    it('odd trailing page gets its own spread', () => {
      const pages = [makePage(0), makePage(1), makePage(2)];
      const spreads = buildSpreads(pages, DOUBLE);

      expect(spreads).toHaveLength(2);
      expect(spreads[1]?.left?.index).toBe(2);
      expect(spreads[1]?.right).toBeUndefined();
    });

    it('single page produces one spread', () => {
      const spreads = buildSpreads([makePage(0)], DOUBLE);
      expect(spreads).toHaveLength(1);
      expect(spreads[0]?.left?.index).toBe(0);
      expect(spreads[0]?.right).toBeUndefined();
    });
  });

  describe('double mode with firstPageAlone', () => {
    it('first page stands alone, rest pair up', () => {
      const pages = [makePage(0), makePage(1), makePage(2), makePage(3), makePage(4)];
      const spreads = buildSpreads(pages, DOUBLE_COVER);

      expect(spreads).toHaveLength(3);
      expect(spreads[0]?.left?.index).toBe(0);
      expect(spreads[0]?.right).toBeUndefined();
      expect(spreads[1]?.left?.index).toBe(1);
      expect(spreads[1]?.right?.index).toBe(2);
      expect(spreads[2]?.left?.index).toBe(3);
      expect(spreads[2]?.right?.index).toBe(4);
    });

    it('two pages: cover alone + second alone', () => {
      const pages = [makePage(0), makePage(1)];
      const spreads = buildSpreads(pages, DOUBLE_COVER);

      expect(spreads).toHaveLength(2);
      expect(spreads[0]?.left?.index).toBe(0);
      expect(spreads[0]?.right).toBeUndefined();
      expect(spreads[1]?.left?.index).toBe(1);
    });
  });

  describe('spread indices', () => {
    it('spreads have sequential indices', () => {
      const pages = Array.from({ length: 5 }, (_, i) => makePage(i));
      const spreads = buildSpreads(pages, DOUBLE_COVER);

      for (let i = 0; i < spreads.length; i++) {
        expect(spreads[i]?.index).toBe(i);
      }
    });
  });
});
