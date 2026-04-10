import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css/property-parser';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import { POSITIONS } from '../../src/style/core/types';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { NODE_TYPES } from '../../src/parser/xhtml/types';
import type { DocumentNode, ElementAttributes } from '../../src/parser/xhtml/types';
import { renderPage } from '../../src/render/page';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { createLayoutConfig } from '../../src/layout/core/config';
import type { Page } from '../../src/layout/core/types';

const BASE_FONT_SIZE = 16;
const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 300;
const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(
  tag: string,
  children: DocumentNode[],
  attributes?: ElementAttributes,
): DocumentNode {
  return attributes
    ? { type: NODE_TYPES.Block, tag, children, attributes }
    : { type: NODE_TYPES.Block, tag, children };
}

describe('position:relative', () => {
  describe('CSS parsing', () => {
    it('parses position: static', () => {
      const result = parseCssDeclarations('position: static', BASE_FONT_SIZE);
      expect(result.position).toBe('static');
    });

    it('parses position: relative', () => {
      const result = parseCssDeclarations('position: relative', BASE_FONT_SIZE);
      expect(result.position).toBe('relative');
    });

    it('parses position: absolute', () => {
      const result = parseCssDeclarations('position: absolute', BASE_FONT_SIZE);
      expect(result.position).toBe('absolute');
    });

    it('ignores position: fixed', () => {
      const result = parseCssDeclarations('position: fixed', BASE_FONT_SIZE);
      expect(result.position).toBeUndefined();
    });

    it('parses top in px', () => {
      const result = parseCssDeclarations('top: 10px', BASE_FONT_SIZE);
      expect(result.top).toBe(10);
    });

    it('parses left in px', () => {
      const result = parseCssDeclarations('left: 20px', BASE_FONT_SIZE);
      expect(result.left).toBe(20);
    });

    it('parses bottom in em', () => {
      const result = parseCssDeclarations('bottom: 1em', BASE_FONT_SIZE);
      expect(result.bottom).toBe(16);
    });

    it('parses right in rem', () => {
      const result = parseCssDeclarations('right: 2rem', BASE_FONT_SIZE, 10);
      expect(result.right).toBe(20);
    });

    it('parses negative top', () => {
      const result = parseCssDeclarations('top: -5px', BASE_FONT_SIZE);
      expect(result.top).toBe(-5);
    });

    it('parses all position properties together', () => {
      const result = parseCssDeclarations(
        'position: relative; top: 10px; left: 5px',
        BASE_FONT_SIZE,
      );
      expect(result.position).toBe('relative');
      expect(result.top).toBe(10);
      expect(result.left).toBe(5);
    });
  });

  describe('defaults', () => {
    it('defaults position to static', () => {
      expect(DEFAULT_STYLE.position).toBe(POSITIONS.Static);
    });

    it('defaults top to 0', () => {
      expect(DEFAULT_STYLE.top).toBe(0);
    });

    it('defaults left to 0', () => {
      expect(DEFAULT_STYLE.left).toBe(0);
    });

    it('defaults bottom to 0', () => {
      expect(DEFAULT_STYLE.bottom).toBe(0);
    });

    it('defaults right to 0', () => {
      expect(DEFAULT_STYLE.right).toBe(0);
    });
  });

  describe('layout', () => {
    it('does not affect sibling positions with position:relative', () => {
      const styled = resolveStyles([
        block('p', [text('First')], { style: 'position: relative; top: 50px' }),
        block('p', [text('Second')]),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // The second block position should be the same as if position:relative was not set
      const styledWithout = resolveStyles([
        block('p', [text('First')]),
        block('p', [text('Second')]),
      ]);
      const blocksWithout = layoutBlocks(styledWithout, CONTENT_WIDTH, layouter);

      expect(blocks[1]?.bounds.y).toBe(blocksWithout[1]?.bounds.y);
    });

    it('attaches relativeOffset with top', () => {
      const styled = resolveStyles([
        block('p', [text('Offset')], { style: 'position: relative; top: 10px' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks[0]?.relativeOffset).toEqual({ dx: 0, dy: 10 });
    });

    it('attaches relativeOffset with left', () => {
      const styled = resolveStyles([
        block('p', [text('Offset')], { style: 'position: relative; left: 20px' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks[0]?.relativeOffset).toEqual({ dx: 20, dy: 0 });
    });

    it('top wins over bottom per CSS spec', () => {
      const styled = resolveStyles([
        block('p', [text('Both')], {
          style: 'position: relative; top: 10px; bottom: 30px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // top wins, so dy = 10 (not -30)
      expect(blocks[0]?.relativeOffset).toEqual({ dx: 0, dy: 10 });
    });

    it('left wins over right per CSS spec', () => {
      const styled = resolveStyles([
        block('p', [text('Both')], {
          style: 'position: relative; left: 15px; right: 25px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // left wins, so dx = 15 (not -25)
      expect(blocks[0]?.relativeOffset).toEqual({ dx: 15, dy: 0 });
    });

    it('uses bottom when top is 0', () => {
      const styled = resolveStyles([
        block('p', [text('Bottom')], { style: 'position: relative; bottom: 5px' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // bottom: 5px means dy = -5
      expect(blocks[0]?.relativeOffset).toEqual({ dx: 0, dy: -5 });
    });

    it('uses right when left is 0', () => {
      const styled = resolveStyles([
        block('p', [text('Right')], { style: 'position: relative; right: 8px' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // right: 8px means dx = -8
      expect(blocks[0]?.relativeOffset).toEqual({ dx: -8, dy: 0 });
    });

    it('does not attach relativeOffset for position:static', () => {
      const styled = resolveStyles([block('p', [text('Static')], { style: 'position: static' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks[0]?.relativeOffset).toBeUndefined();
    });

    it('does not attach relativeOffset when all offsets are zero', () => {
      const styled = resolveStyles([
        block('p', [text('NoOffset')], { style: 'position: relative' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks[0]?.relativeOffset).toBeUndefined();
    });
  });

  describe('rendering', () => {
    function makePage(content: Page['content']): Page {
      return {
        index: 0,
        bounds: { x: 0, y: 0, width: CONFIG.pageWidth, height: CONFIG.pageHeight },
        content,
      };
    }

    it('translates context for blocks with relativeOffset', () => {
      const mock = createMockCanvasContext();
      const page = makePage([
        {
          type: 'layout-block',
          bounds: { x: 0, y: 0, width: 360, height: 24 },
          relativeOffset: { dx: 10, dy: 5 },
          children: [
            {
              type: 'line-box',
              bounds: { x: 0, y: 0, width: 100, height: 24 },
              runs: [
                {
                  type: 'text-run',
                  text: 'Shifted',
                  bounds: { x: 0, y: 0, width: 70, height: 24 },
                  style: DEFAULT_STYLE,
                },
              ],
            },
          ],
        },
      ]);
      renderPage(page, mock.ctx, CONFIG);

      const translateCalls = mock.getCalls('translate');
      expect(translateCalls).toHaveLength(1);
      expect(translateCalls[0]?.args).toEqual([10, 5]);
    });

    it('wraps translate in save/restore pair', () => {
      const mock = createMockCanvasContext();
      const page = makePage([
        {
          type: 'layout-block',
          bounds: { x: 0, y: 0, width: 360, height: 24 },
          relativeOffset: { dx: 10, dy: 5 },
          children: [
            {
              type: 'line-box',
              bounds: { x: 0, y: 0, width: 100, height: 24 },
              runs: [
                {
                  type: 'text-run',
                  text: 'Shifted',
                  bounds: { x: 0, y: 0, width: 70, height: 24 },
                  style: DEFAULT_STYLE,
                },
              ],
            },
          ],
        },
      ]);
      renderPage(page, mock.ctx, CONFIG);

      const allMethods = mock.records
        .filter((r) => 'method' in r)
        .map((r) => (r as { method: string }).method);

      const translateIdx = allMethods.indexOf('translate');
      // There should be a save before translate and a restore after fillText
      const saveBeforeTranslate = allMethods.lastIndexOf('save', translateIdx);
      const restoreAfterText = allMethods.indexOf('restore', translateIdx);
      expect(saveBeforeTranslate).toBeGreaterThanOrEqual(0);
      expect(restoreAfterText).toBeGreaterThan(translateIdx);
    });

    it('does not translate for blocks without relativeOffset', () => {
      const mock = createMockCanvasContext();
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
                  text: 'Normal',
                  bounds: { x: 0, y: 0, width: 60, height: 24 },
                  style: DEFAULT_STYLE,
                },
              ],
            },
          ],
        },
      ]);
      renderPage(page, mock.ctx, CONFIG);

      const translateCalls = mock.getCalls('translate');
      expect(translateCalls).toHaveLength(0);
    });
  });
});
