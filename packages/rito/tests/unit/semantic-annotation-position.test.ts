import { describe, expect, it } from 'vitest';
import { resolveAnnotationRects } from '../../src/reference/ts-core/interaction/annotations';
import type { Annotation } from '../../src/reference/ts-core/interaction/annotations';
import { buildHitMap, buildSemanticTree } from '../../src/reference/ts-core/interaction/core';
import {
  createReadingPosition,
  projectReadingPosition,
  resolveReadingPosition,
} from '../../src/reference/ts-core/interaction/position';
import type {
  ImageElement,
  LayoutBlock,
  LineBox,
  Page,
  Spread,
  TextRun,
} from '../../src/reference/ts-core/layout/core/types';
import type { TextMeasurer } from '../../src/reference/ts-core/layout/text/text-measurer';
import { DEFAULT_RUN_PAINT } from '../../src/reference/ts-core/layout/text/run-paint-from-style';

const mockMeasurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 10, height: 20 }),
};

function makeRun(text: string, x: number, href?: string): TextRun {
  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    paint: DEFAULT_RUN_PAINT,
  };
  return href ? { ...run, href } : run;
}

function makeSourceRun(text: string, nodePath: readonly number[], sourceTextOffset = 0): TextRun {
  return {
    ...makeRun(text, 0),
    sourceRef: { nodePath },
    sourceText: text,
    sourceTextOffset,
  };
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[], tag?: string): LayoutBlock {
  const block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 300, height: 100 },
    children: lines,
  };
  return tag ? { ...block, semanticTag: tag } : block;
}

function makePage(blocks: LayoutBlock[], index = 0): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: blocks };
}

describe('buildSemanticTree', () => {
  it('maps semantic tags to roles', () => {
    const page = makePage([
      makeBlock([makeLine([makeRun('Title', 0)], 0)], 'h1'),
      makeBlock([makeLine([makeRun('Body text', 0)], 0)], 'p'),
    ]);
    const tree = buildSemanticTree(page);
    expect(tree).toHaveLength(2);
    expect(tree[0]?.role).toBe('heading');
    expect(tree[0]?.level).toBe(1);
    expect(tree[0]?.text).toBe('Title');
    expect(tree[1]?.role).toBe('paragraph');
    expect(tree[1]?.text).toBe('Body text');
  });

  it('extracts link children from text runs with href', () => {
    const page = makePage([
      makeBlock([makeLine([makeRun('click here', 0, 'target.html')], 0)], 'p'),
    ]);
    const tree = buildSemanticTree(page);
    const links = tree[0]?.children.filter((c) => c.role === 'link');
    expect(links).toHaveLength(1);
    expect(links?.[0]?.href).toBe('target.html');
    expect(links?.[0]?.text).toBe('click here');
  });

  it('extracts image nodes with alt text', () => {
    const img: ImageElement = {
      type: 'image',
      src: 'cover.jpg',
      alt: 'Book cover',
      bounds: { x: 0, y: 0, width: 200, height: 300 },
    };
    const block: LayoutBlock = {
      type: 'layout-block',
      bounds: { x: 0, y: 0, width: 300, height: 300 },
      children: [img],
    };
    const page = makePage([block]);
    const tree = buildSemanticTree(page);
    const images = tree[0]?.children.filter((c) => c.role === 'image');
    expect(images).toHaveLength(1);
    expect(images?.[0]?.alt).toBe('Book cover');
  });

  it('handles blocks without semantic tags as generic', () => {
    const page = makePage([makeBlock([makeLine([makeRun('text', 0)], 0)])]);
    const tree = buildSemanticTree(page);
    expect(tree[0]?.role).toBe('generic');
  });

  it('uses visual geometry for semantic bounds', () => {
    const block: LayoutBlock = {
      ...makeBlock([makeLine([makeRun('shifted', 0, 'target.html')], 0)], 'p'),
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      paint: { visualOffset: { dx: 15, dy: 8 }, clipToBounds: true },
    };
    const tree = buildSemanticTree(makePage([block]));
    expect(tree[0]?.bounds).toEqual({ x: 15, y: 8, width: 40, height: 20 });
    expect(tree[0]?.children[0]?.bounds).toEqual({ x: 15, y: 8, width: 40, height: 20 });
  });

  it('handles heading levels 1-6', () => {
    const levels = [1, 2, 3, 4, 5, 6];
    for (const l of levels) {
      const page = makePage([makeBlock([makeLine([makeRun('H', 0)], 0)], `h${String(l)}`)]);
      const tree = buildSemanticTree(page);
      expect(tree[0]?.level).toBe(l);
    }
  });
});

describe('resolveAnnotationRects', () => {
  it('returns rectangles for an annotation range', () => {
    const page = makePage([makeBlock([makeLine([makeRun('Hello world', 0)], 0)])]);
    const hitMap = buildHitMap(page);
    const annotation: Annotation = {
      id: '1',
      type: 'highlight',
      range: {
        start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
        end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 5 },
      },
      pageIndex: 0,
      color: '#ff0',
      createdAt: Date.now(),
    };
    const result = resolveAnnotationRects(annotation, hitMap, mockMeasurer);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]?.width).toBe(50); // 5 chars * 10px
    expect(result.annotation.id).toBe('1');
  });
});

describe('createReadingPosition', () => {
  const p0 = makePage([], 0);
  const p1 = makePage([], 1);
  const p2 = makePage([], 2);
  const p3 = makePage([], 3);
  const pages: Page[] = [p0, p1, p2, p3];
  const spreads: Spread[] = [
    { index: 0, left: p0 },
    { index: 1, left: p1, right: p2 },
    { index: 2, left: p3 },
  ];
  const chapterMap = new Map([
    ['ch1.xhtml', { startPage: 0, endPage: 1 }],
    ['ch2.xhtml', { startPage: 2, endPage: 3 }],
  ]);
  const layout = { spreads, pages, chapterMap };

  it('creates a position with progress', () => {
    const pos = createReadingPosition(layout, 1);
    expect(pos.projection.spreadIndex).toBe(1);
    expect(pos.projection.pageIndex).toBe(1);
    expect(pos.progress).toBeCloseTo(0.25);
    expect(pos.locator?.spineIdref).toBe('ch1.xhtml');
  });

  it('clamps to valid spread range', () => {
    const pos = createReadingPosition(layout, 99);
    expect(pos.projection.spreadIndex).toBe(2);
  });

  it('finds correct chapter', () => {
    const pos = createReadingPosition(layout, 2);
    expect(pos.locator?.spineIdref).toBe('ch2.xhtml');
  });
});

describe('resolveReadingPosition', () => {
  const p0 = makePage([], 0);
  const p1 = makePage([], 1);
  const spreads: Spread[] = [
    { index: 0, left: p0 },
    { index: 1, left: p1 },
  ];
  const layout = {
    spreads,
    pages: [p0, p1],
    chapterMap: new Map<string, { startPage: number; endPage: number }>(),
  };

  it('returns the saved spread index if valid', () => {
    const idx = resolveReadingPosition(
      { projection: { spreadIndex: 1, pageIndex: 1 }, progress: 0.5, timestamp: 0 },
      layout,
    );
    expect(idx).toBe(1);
  });

  it('clamps out-of-range index', () => {
    const idx = resolveReadingPosition(
      { projection: { spreadIndex: 99, pageIndex: 99 }, progress: 1, timestamp: 0 },
      layout,
    );
    expect(idx).toBe(1);
  });

  it('returns 0 for empty spreads', () => {
    const idx = resolveReadingPosition(
      { projection: { spreadIndex: 5, pageIndex: 5 }, progress: 1, timestamp: 0 },
      { spreads: [], pages: [], chapterMap: new Map() },
    );
    expect(idx).toBe(0);
  });

  it('resolves source locator against the current layout', () => {
    const oldP0 = makePage([makeBlock([makeLine([makeSourceRun('alpha', [0])], 0)])], 0);
    const oldP1 = makePage([makeBlock([makeLine([makeSourceRun('bravo', [1])], 0)])], 1);
    const oldP2 = makePage([makeBlock([makeLine([makeSourceRun('charlie', [2])], 0)])], 2);
    const oldSpreads: Spread[] = [
      { index: 0, left: oldP0 },
      { index: 1, left: oldP1 },
      { index: 2, left: oldP2 },
    ];
    const chapterTextIndex = {
      href: 'ch1',
      normalizedText: 'alphabravocharlie',
      spans: [
        { nodePath: [0], sourceStart: 0, sourceEnd: 5, normalizedStart: 0, normalizedEnd: 5 },
        { nodePath: [1], sourceStart: 0, sourceEnd: 5, normalizedStart: 5, normalizedEnd: 10 },
        { nodePath: [2], sourceStart: 0, sourceEnd: 7, normalizedStart: 10, normalizedEnd: 17 },
      ],
    };
    const oldLayout = {
      spreads: oldSpreads,
      pages: [oldP0, oldP1, oldP2],
      chapterMap: new Map([['ch1', { startPage: 0, endPage: 2 }]]),
      chapterTextIndices: new Map([['ch1', chapterTextIndex]]),
    };
    const position = createReadingPosition(oldLayout, 1);

    const newP0 = makePage([
      makeBlock([makeLine([makeSourceRun('alpha', [0]), makeSourceRun('bravo', [1])], 0)]),
    ]);
    const newP1 = makePage([makeBlock([makeLine([makeSourceRun('charlie', [2])], 0)])], 1);
    const newLayout = {
      spreads: [
        { index: 0, left: newP0 },
        { index: 1, left: newP1 },
      ],
      pages: [newP0, newP1],
      chapterMap: new Map([['ch1', { startPage: 0, endPage: 1 }]]),
      chapterTextIndices: new Map([['ch1', chapterTextIndex]]),
    };

    expect(position.locator?.sourcePoint?.nodePath).toEqual([1]);
    expect(resolveReadingPosition(position, newLayout)).toBe(0);
  });

  it('projects a saved locator without rewriting it to the new page start', () => {
    const oldP0 = makePage([makeBlock([makeLine([makeSourceRun('alpha', [0])], 0)])], 0);
    const oldP1 = makePage([makeBlock([makeLine([makeSourceRun('bravo', [1])], 0)])], 1);
    const oldLayout = {
      spreads: [
        { index: 0, left: oldP0 },
        { index: 1, left: oldP1 },
      ],
      pages: [oldP0, oldP1],
      chapterMap: new Map([['ch1', { startPage: 0, endPage: 1 }]]),
      chapterTextIndices: new Map([
        [
          'ch1',
          {
            href: 'ch1',
            normalizedText: 'alphabravo',
            spans: [
              { nodePath: [0], sourceStart: 0, sourceEnd: 5, normalizedStart: 0, normalizedEnd: 5 },
              {
                nodePath: [1],
                sourceStart: 0,
                sourceEnd: 5,
                normalizedStart: 5,
                normalizedEnd: 10,
              },
            ],
          },
        ],
      ]),
    };
    const position = createReadingPosition(oldLayout, 1);

    const newP0 = makePage([
      makeBlock([makeLine([makeSourceRun('alpha', [0]), makeSourceRun('bravo', [1])], 0)]),
    ]);
    const newLayout = {
      spreads: [{ index: 0, left: newP0 }],
      pages: [newP0],
      chapterMap: new Map([['ch1', { startPage: 0, endPage: 0 }]]),
      chapterTextIndices: oldLayout.chapterTextIndices,
    };

    const projected = projectReadingPosition(position, newLayout);
    const projectedAgain = projectReadingPosition(projected, newLayout);

    expect(position.locator?.sourcePoint?.nodePath).toEqual([1]);
    expect(projected.projection.spreadIndex).toBe(0);
    expect(projected.projection.pageIndex).toBe(0);
    expect(projected.locator).toEqual(position.locator);
    expect(projectedAgain.locator).toEqual(position.locator);
  });
});
