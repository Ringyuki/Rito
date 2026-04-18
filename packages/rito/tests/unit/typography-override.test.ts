// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createLayoutConfig, type LayoutConfigInput } from '../../src/layout/core/config';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { paginateChapterNodes, preparePaginationContext } from '../../src/runtime/pagination-core';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>T</title></head>
  <body>${body}</body>
</html>`;
}

interface Bounded {
  readonly bounds?: { readonly height?: number };
  readonly children?: readonly Bounded[];
}

function paragraphLineHeight(stylesheetCss: string, overrides: Partial<LayoutConfigInput> = {}) {
  const config = createLayoutConfig({
    width: 400,
    height: 800,
    margin: 20,
    ...overrides,
  });
  const measurer = createMockTextMeasurer(0.6);
  const stylesheets = new Map([['main.css', stylesheetCss]]);
  const context = preparePaginationContext(config, measurer, stylesheets);
  const { nodes } = parseXhtml(xhtml(`<p>hello</p>`));
  const result = paginateChapterNodes(nodes, config, context, 0);
  const block = result.pages[0]?.content[0] as Bounded | undefined;
  const lineBox = block?.children?.[0];
  return lineBox?.bounds?.height ?? -1;
}

describe('lineHeight typography override', () => {
  describe('coarse mode (default — body cascade)', () => {
    it('uses default lineHeight (1.2) when neither CSS nor override sets it', () => {
      const h = paragraphLineHeight('body { font-size: 16px; }');
      expect(h).toBeCloseTo(16 * 1.2, 1);
    });

    it('applies override when EPUB has no line-height rule', () => {
      const h = paragraphLineHeight('body { font-size: 16px; }', { lineHeightOverride: 2.5 });
      expect(h).toBeCloseTo(16 * 2.5, 1);
    });

    it('overrides body line-height even when EPUB sets `body { line-height: 1.5em }`', () => {
      const baseline = paragraphLineHeight('body { font-size: 16px; line-height: 1.5em; }');
      const overridden = paragraphLineHeight('body { font-size: 16px; line-height: 1.5em; }', {
        lineHeightOverride: 3.0,
      });
      expect(overridden).toBeGreaterThan(baseline);
      expect(overridden).toBeCloseTo(16 * 3.0, 1);
    });

    it('does NOT override an element-level rule (coarse semantics)', () => {
      const baseline = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }');
      const overridden = paragraphLineHeight(
        'body { font-size: 16px; } p { line-height: 1.2em; }',
        { lineHeightOverride: 3.0 },
      );
      expect(overridden).toBe(baseline);
    });
  });

  describe('force mode', () => {
    it('overrides element-level rules when lineHeightForce is true', () => {
      const baseline = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }');
      const forced = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }', {
        lineHeightOverride: 3.0,
        lineHeightForce: true,
      });
      expect(forced).toBeGreaterThan(baseline);
      expect(forced).toBeCloseTo(16 * 3.0, 1);
    });

    it('force has no effect when no override value is set', () => {
      const a = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }');
      const b = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }', {
        lineHeightForce: true,
      });
      expect(b).toBe(a);
    });

    it('force=false matches coarse behavior even with override set', () => {
      const coarse = paragraphLineHeight('body { font-size: 16px; } p { line-height: 1.2em; }', {
        lineHeightOverride: 3.0,
      });
      const explicitOff = paragraphLineHeight(
        'body { font-size: 16px; } p { line-height: 1.2em; }',
        { lineHeightOverride: 3.0, lineHeightForce: false },
      );
      expect(explicitOff).toBe(coarse);
    });
  });
});
