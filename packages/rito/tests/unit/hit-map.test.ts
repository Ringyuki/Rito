import { describe, expect, it } from 'vitest';
import { buildHitMap, buildLinkMap, hitTest, hitTestLink } from '../../src/interaction/core';
import type { LayoutBlock, LineBox, Page, TextRun } from '../../src/layout/core/types';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

function makeRun(text: string, x: number, w: number, href?: string): TextRun {
  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: w, height: 20 },
    style: DEFAULT_STYLE,
  };
  return href ? { ...run, href } : run;
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[], x = 0, y = 0): LayoutBlock {
  return { type: 'layout-block', bounds: { x, y, width: 300, height: 100 }, children: lines };
}

function makeNestedBlock(children: LayoutBlock[], x = 0, y = 0): LayoutBlock {
  return { type: 'layout-block', bounds: { x, y, width: 300, height: 100 }, children };
}

function makePage(blocks: LayoutBlock[], index = 0): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: blocks };
}

describe('buildHitMap', () => {
  it('collects text runs with absolute bounds', () => {
    const page = makePage([
      makeBlock([makeLine([makeRun('Hello', 0, 50), makeRun(' world', 50, 60)], 10)], 0, 20),
    ]);
    const hitMap = buildHitMap(page);
    expect(hitMap.entries).toHaveLength(2);
    expect(hitMap.entries[0]?.text).toBe('Hello');
    expect(hitMap.entries[0]?.bounds.y).toBe(30); // block.y(20) + line.y(10)
    expect(hitMap.entries[1]?.text).toBe(' world');
  });

  it('propagates href from TextRun to HitEntry', () => {
    const page = makePage([
      makeBlock([makeLine([makeRun('click me', 0, 80, 'https://example.com')], 0)]),
    ]);
    const hitMap = buildHitMap(page);
    expect(hitMap.entries[0]?.href).toBe('https://example.com');
  });

  it('returns empty entries for page with no text', () => {
    const page = makePage([]);
    const hitMap = buildHitMap(page);
    expect(hitMap.entries).toHaveLength(0);
  });

  it('assigns nested line boxes traversal-order positions', () => {
    const page = makePage([
      makeNestedBlock(
        [
          makeBlock([makeLine([makeRun('Outer', 0, 50)], 0)]),
          makeBlock([makeLine([makeRun('Inner', 0, 50)], 15)]),
        ],
        0,
        10,
      ),
    ]);
    const hitMap = buildHitMap(page);
    expect(hitMap.entries).toHaveLength(2);
    expect(hitMap.entries[0]?.lineIndex).toBe(0);
    expect(hitMap.entries[1]?.lineIndex).toBe(1);
    expect(hitMap.entries[1]?.bounds.y).toBe(25);
  });
});

describe('hitTest', () => {
  const page = makePage([
    makeBlock([
      makeLine([makeRun('First', 0, 50), makeRun('Second', 60, 60)], 0),
      makeLine([makeRun('Third', 0, 50)], 25),
    ]),
  ]);
  const hitMap = buildHitMap(page);

  it('finds exact match by coordinates', () => {
    const entry = hitTest(hitMap, 30, 10);
    expect(entry?.text).toBe('First');
  });

  it('finds second run on same line', () => {
    const entry = hitTest(hitMap, 80, 10);
    expect(entry?.text).toBe('Second');
  });

  it('finds run on second line', () => {
    const entry = hitTest(hitMap, 20, 30);
    expect(entry?.text).toBe('Third');
  });

  it('returns closest run when x is between runs', () => {
    const entry = hitTest(hitMap, 55, 10);
    expect(entry).toBeDefined();
  });

  it('returns undefined for y outside all entries', () => {
    const entry = hitTest(hitMap, 30, 200);
    expect(entry).toBeUndefined();
  });
});

describe('buildLinkMap', () => {
  it('collects link regions from text runs with href', () => {
    const page = makePage([
      makeBlock([
        makeLine([makeRun('normal', 0, 50), makeRun('link', 50, 40, 'ch1.html#sec2')], 0),
      ]),
    ]);
    const links = buildLinkMap(page);
    expect(links).toHaveLength(1);
    expect(links[0]?.href).toBe('ch1.html#sec2');
    expect(links[0]?.text).toBe('link');
  });

  it('merges adjacent runs with same href on same line', () => {
    const page = makePage([
      makeBlock([
        makeLine(
          [makeRun('click', 0, 40, 'target.html'), makeRun(' here', 40, 40, 'target.html')],
          0,
        ),
      ]),
    ]);
    const links = buildLinkMap(page);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe('click here');
    expect(links[0]?.bounds.width).toBe(80);
  });

  it('does not merge runs with different hrefs', () => {
    const page = makePage([
      makeBlock([makeLine([makeRun('a', 0, 20, 'a.html'), makeRun('b', 20, 20, 'b.html')], 0)]),
    ]);
    const links = buildLinkMap(page);
    expect(links).toHaveLength(2);
  });

  it('returns empty for pages with no links', () => {
    const page = makePage([makeBlock([makeLine([makeRun('plain', 0, 50)], 0)])]);
    const links = buildLinkMap(page);
    expect(links).toHaveLength(0);
  });
});

describe('hitTestLink', () => {
  it('returns matching link region', () => {
    const regions = [
      { bounds: { x: 10, y: 10, width: 50, height: 20 }, href: 'target.html', text: 'link' },
    ];
    expect(hitTestLink(regions, 30, 20)?.href).toBe('target.html');
  });

  it('returns undefined when no link is hit', () => {
    const regions = [
      { bounds: { x: 10, y: 10, width: 50, height: 20 }, href: 'target.html', text: 'link' },
    ];
    expect(hitTestLink(regions, 100, 100)).toBeUndefined();
  });
});
