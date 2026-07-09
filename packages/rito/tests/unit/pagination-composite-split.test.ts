import { describe, expect, it } from 'vitest';
import type { ImageElement, LayoutBlock, LineBox } from '../../src/layout/core/types';
import { createLayoutConfig } from '../../src/layout/core/config';
import { paginateBlocks } from '../../src/layout/pagination';
import { forceSplitBlock, trySplitBlock } from '../../src/layout/pagination/split';

function line(y: number, height = 20): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 100, height }, runs: [] };
}

function row(y: number, label: string): LayoutBlock {
  return {
    type: 'layout-block',
    semanticTag: label,
    bounds: { x: 0, y, width: 100, height: 60 },
    children: [],
  };
}

describe('composite block pagination', () => {
  it('force-splits without discarding non-line children', () => {
    const image: ImageElement = {
      type: 'image',
      src: 'figure.png',
      bounds: { x: 0, y: 20, width: 80, height: 40 },
    };
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 100, height: 60 },
      children: [line(0), image],
    };

    const split = forceSplitBlock(block, 40);

    expect(split?.head.children.map((child) => child.type)).toEqual(['line-box']);
    expect(split?.tail.children.map((child) => child.type)).toEqual(['image']);
    expect(split?.tail.children[0]?.bounds.y).toBe(0);
  });

  it('paginates a tall table-like composite at row boundaries without content loss', () => {
    const table: LayoutBlock = {
      type: 'layout-block',
      semanticTag: 'table',
      bounds: { x: 0, y: 0, width: 100, height: 180 },
      children: [row(0, 'row-1'), row(60, 'row-2'), row(120, 'row-3')],
      paint: { background: { color: '#eee' } },
    };
    const config = createLayoutConfig({ width: 100, height: 100 });

    const pages = paginateBlocks([table], config);
    const labels = pages.flatMap((page) =>
      page.content.flatMap((block) =>
        block.children
          .filter((child): child is LayoutBlock => child.type === 'layout-block')
          .map((child) => child.semanticTag),
      ),
    );

    expect(pages).toHaveLength(3);
    expect(labels).toEqual(['row-1', 'row-2', 'row-3']);
    expect(pages.every((page) => page.content[0]?.paint?.background?.color === '#eee')).toBe(true);
  });

  it('preserves trailing box space and slices block edges across line fragments', () => {
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      children: [line(10), line(30), line(50)],
      borderBox: { topWidth: 2, rightWidth: 2, bottomWidth: 3, leftWidth: 2 },
      paint: {
        background: { color: '#fff' },
        border: {
          top: { color: '#000', style: 'solid' },
          right: { color: '#000', style: 'solid' },
          bottom: { color: '#000', style: 'solid' },
          left: { color: '#000', style: 'solid' },
        },
      },
    };

    const split = trySplitBlock(block, 50, { enabled: false });

    expect(split?.head.bounds.height).toBe(50);
    expect(split?.tail.bounds.height).toBe(50);
    expect(split?.tail.children[0]?.bounds.y).toBe(0);
    expect(split?.head.borderBox?.bottomWidth).toBe(0);
    expect(split?.tail.borderBox?.topWidth).toBe(0);
    expect(split?.head.paint?.border?.bottom).toBeUndefined();
    expect(split?.tail.paint?.border?.top).toBeUndefined();
  });

  it('splits vertical gaps without producing a forced fragment taller than the page', () => {
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      children: [line(0), line(50)],
    };

    const split = forceSplitBlock(block, 30);

    expect(split?.head.bounds.height).toBe(30);
    expect(split?.tail.bounds.height).toBe(70);
    expect(split?.tail.children[0]?.bounds.y).toBe(20);
  });
});
