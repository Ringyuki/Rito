import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/render/page-renderer';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { Page } from '../../src/layout/types';
import { createLayoutConfig } from '../../src/layout/config';

const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function makePage(content: Page['content']): Page {
  return {
    index: 0,
    bounds: { x: 0, y: 0, width: CONFIG.pageWidth, height: CONFIG.pageHeight },
    content,
  };
}

function makeSimplePage(texts: string[]): Page {
  let y = 0;

  const lineBoxes = texts.map((text) => {
    const run = {
      type: 'text-run' as const,
      text,
      bounds: { x: 0, y: 0, width: text.length * 10, height: 24 },
      style: DEFAULT_STYLE,
    };
    const lb = {
      type: 'line-box' as const,
      bounds: { x: 0, y, width: run.bounds.width, height: 24 },
      runs: [run],
    };
    y += 24;
    return lb;
  });

  return makePage([
    {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 360, height: y },
      children: lineBoxes,
    },
  ]);
}

describe('renderPage', () => {
  describe('basic rendering', () => {
    it('renders a single text line', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello world']);
      renderPage(page, mock.ctx, CONFIG);

      const fillTextCalls = mock.getCalls('fillText');
      expect(fillTextCalls).toHaveLength(1);
      expect(fillTextCalls[0]?.args[0]).toBe('Hello world');
    });

    it('renders multiple text lines', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Line one', 'Line two', 'Line three']);
      renderPage(page, mock.ctx, CONFIG);

      const fillTextCalls = mock.getCalls('fillText');
      expect(fillTextCalls).toHaveLength(3);
      expect(fillTextCalls.map((c) => c.args[0])).toEqual(['Line one', 'Line two', 'Line three']);
    });

    it('offsets text by page margins', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const fillTextCalls = mock.getCalls('fillText');
      // x = marginLeft(20) + block.x(0) + lineBox.x(0) + run.x(0) = 20
      // y = marginTop(20) + block.y(0) + lineBox.y(0) + run.y(0) = 20
      expect(fillTextCalls[0]?.args[1]).toBe(20);
      expect(fillTextCalls[0]?.args[2]).toBe(20);
    });
  });

  describe('text styling', () => {
    it('sets font from ComputedStyle', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const fontSets = mock.getPropertySets('font');
      // Should set font at least once (for the text run)
      expect(fontSets.length).toBeGreaterThan(0);
      // Default style font
      expect(fontSets.some((f) => f.value === '16px serif')).toBe(true);
    });

    it('sets fillStyle to text color', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const fillStyleSets = mock.getPropertySets('fillStyle');
      expect(fillStyleSets.some((f) => f.value === '#000000')).toBe(true);
    });

    it('sets textBaseline to top', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const baselineSets = mock.getPropertySets('textBaseline');
      expect(baselineSets.some((f) => f.value === 'top')).toBe(true);
    });

    it('uses bold font for bold styled runs', () => {
      const mock = createMockCanvasContext();
      const boldStyle = { ...DEFAULT_STYLE, fontWeight: 'bold' as const };
      const page = makePage([
        {
          type: 'layout-block',
          bounds: { x: 0, y: 0, width: 360, height: 24 },
          children: [
            {
              type: 'line-box',
              bounds: { x: 0, y: 0, width: 100, height: 24 },
              runs: [
                {
                  type: 'text-run',
                  text: 'Bold text',
                  bounds: { x: 0, y: 0, width: 100, height: 24 },
                  style: boldStyle,
                },
              ],
            },
          ],
        },
      ]);
      renderPage(page, mock.ctx, CONFIG);

      const fontSets = mock.getPropertySets('font');
      expect(fontSets.some((f) => f.value === 'bold 16px serif')).toBe(true);
    });
  });

  describe('background', () => {
    it('fills background when backgroundColor is set', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG, { backgroundColor: '#ffffff' });

      const fillRectCalls = mock.getCalls('fillRect');
      expect(fillRectCalls).toHaveLength(1);
      expect(fillRectCalls[0]?.args).toEqual([0, 0, 400, 600]);

      const fillStyleSets = mock.getPropertySets('fillStyle');
      expect(fillStyleSets[0]?.value).toBe('#ffffff');
    });

    it('does not fill background when backgroundColor is not set', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const fillRectCalls = mock.getCalls('fillRect');
      expect(fillRectCalls).toHaveLength(0);
    });
  });

  describe('pixel ratio', () => {
    it('scales context by pixelRatio', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG, { pixelRatio: 2 });

      const scaleCalls = mock.getCalls('scale');
      expect(scaleCalls).toHaveLength(1);
      expect(scaleCalls[0]?.args).toEqual([2, 2]);
    });

    it('defaults to pixelRatio 1', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const scaleCalls = mock.getCalls('scale');
      expect(scaleCalls).toHaveLength(1);
      expect(scaleCalls[0]?.args).toEqual([1, 1]);
    });
  });

  describe('content clipping', () => {
    it('clips to page bounds', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG);

      const rectCalls = mock.getCalls('rect');
      expect(rectCalls).toHaveLength(1);
      // Clip to full page bounds (not content area) to allow ink overhang into margin
      expect(rectCalls[0]?.args).toEqual([0, 0, 400, 600]);

      const clipCalls = mock.getCalls('clip');
      expect(clipCalls).toHaveLength(1);
    });

    it('clips after background fill but before text', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG, { backgroundColor: '#fff' });

      const allMethods = mock.records
        .filter((r) => 'method' in r)
        .map((r) => (r as { method: string }).method);
      const fillRectIndex = allMethods.indexOf('fillRect');
      const clipIndex = allMethods.indexOf('clip');
      const fillTextIndex = allMethods.indexOf('fillText');
      expect(fillRectIndex).toBeLessThan(clipIndex);
      expect(clipIndex).toBeLessThan(fillTextIndex);
    });
  });

  describe('draw call order', () => {
    it('calls save, scale, render, restore in order', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG, { backgroundColor: '#fff' });

      const calls = mock.getCalls('save');
      const restores = mock.getCalls('restore');
      expect(calls).toHaveLength(1);
      expect(restores).toHaveLength(1);

      // save should be first call, restore should be last
      const allMethods = mock.records
        .filter((r) => 'method' in r)
        .map((r) => (r as { method: string }).method);
      expect(allMethods[0]).toBe('save');
      expect(allMethods[allMethods.length - 1]).toBe('restore');
    });

    it('draws background before text', () => {
      const mock = createMockCanvasContext();
      const page = makeSimplePage(['Hello']);
      renderPage(page, mock.ctx, CONFIG, { backgroundColor: '#fff' });

      const allMethods = mock.records
        .filter((r) => 'method' in r)
        .map((r) => (r as { method: string }).method);
      const fillRectIndex = allMethods.indexOf('fillRect');
      const fillTextIndex = allMethods.indexOf('fillText');
      expect(fillRectIndex).toBeLessThan(fillTextIndex);
    });
  });

  describe('nested blocks', () => {
    it('renders text inside nested layout blocks', () => {
      const mock = createMockCanvasContext();
      const page = makePage([
        {
          type: 'layout-block',
          bounds: { x: 0, y: 0, width: 360, height: 48 },
          children: [
            {
              type: 'layout-block',
              bounds: { x: 0, y: 0, width: 360, height: 24 },
              children: [
                {
                  type: 'line-box',
                  bounds: { x: 0, y: 0, width: 100, height: 24 },
                  runs: [
                    {
                      type: 'text-run',
                      text: 'Nested',
                      bounds: { x: 0, y: 0, width: 60, height: 24 },
                      style: DEFAULT_STYLE,
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]);
      renderPage(page, mock.ctx, CONFIG);

      const fillTextCalls = mock.getCalls('fillText');
      expect(fillTextCalls).toHaveLength(1);
      expect(fillTextCalls[0]?.args[0]).toBe('Nested');
    });
  });

  describe('empty page', () => {
    it('handles a page with no content', () => {
      const mock = createMockCanvasContext();
      const page = makePage([]);
      renderPage(page, mock.ctx, CONFIG);

      const fillTextCalls = mock.getCalls('fillText');
      expect(fillTextCalls).toHaveLength(0);
    });
  });
});
