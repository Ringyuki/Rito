import { describe, expect, it, vi } from 'vitest';
import type { ReaderExactSourceRangeResolution, ReaderExactTextRangeRect } from '@ritojs/core';
import { buildRangeGeometry } from '../src/controller/facade/range-geometry';
import type { Internals } from '../src/controller/facade/types';
import type { CoordinateMapper } from '../src/controller/geometry/coordinate-mapper';

const range = {
  href: 'ch1.xhtml',
  sourceRange: {
    start: { nodePath: [0, 1], textOffset: 2 },
    end: { nodePath: [0, 1], textOffset: 9 },
  },
};

describe('rangeRects', () => {
  it("answers the range's rects on the pages shown, in screen coordinates", async () => {
    const fixture = createFixture(() =>
      Promise.resolve(resolved([rect(3, 10), rect(3, 30), rect(4, 50)])),
    );

    const rects = await fixture.actions.rangeRects(range);

    expect(rects).toEqual([
      { x: 110, y: 60, width: 20, height: 8 },
      { x: 130, y: 60, width: 20, height: 8 },
    ]);
    expect(fixture.resolve).toHaveBeenCalledWith(range);
  });

  it('reads the range again when the layout changes under the read', async () => {
    let reads = 0;
    const fixture = createFixture(() => {
      reads += 1;
      if (reads === 1) fixture.internals.coordState.nativeTargetLoadGeneration += 1;
      return Promise.resolve(resolved([rect(3, reads)]));
    });

    const rects = await fixture.actions.rangeRects(range);

    expect(reads).toBe(2);
    expect(rects).toEqual([{ x: 102, y: 60, width: 20, height: 8 }]);
  });

  it('answers nothing for a range the engine cannot place', async () => {
    const fixture = createFixture(() =>
      Promise.resolve({ status: 'pending', reason: 'notPaginated' } as const),
    );
    expect(await fixture.actions.rangeRects(range)).toEqual([]);
  });

  it('asks the engine nothing while interactions are disabled', async () => {
    const fixture = createFixture(() => Promise.resolve(resolved([rect(3, 0)])), false);
    expect(await fixture.actions.rangeRects(range)).toEqual([]);
    expect(fixture.resolve).not.toHaveBeenCalled();
  });
});

function createFixture(
  read: () => Promise<ReaderExactSourceRangeResolution | undefined>,
  enabled = true,
) {
  const resolve = vi.fn(read);
  const mapper = {
    isPageVisible: (pageIndex: number) => pageIndex === 3,
    pageContentToScreen: (
      _pageIndex: number,
      r: ReaderExactTextRangeRect,
      canvas: { left: number; top: number },
    ) => ({ x: r.x + canvas.left, y: r.y + canvas.top, width: r.width, height: r.height }),
  } as unknown as CoordinateMapper;
  const internals = {
    reader: { interactions: { enabled, resolveExactSourceRange: resolve } },
    coordState: { nativeInteractionsAlive: true, nativeTargetLoadGeneration: 0, mapper },
  } as unknown as Internals;
  const canvas = {
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
  } as unknown as HTMLCanvasElement;
  return { actions: buildRangeGeometry(internals, canvas), internals, resolve };
}

function rect(pageIndex: number, x: number): ReaderExactTextRangeRect {
  return { pageIndex, spreadIndex: 1, x, y: 10, width: 20, height: 8 };
}

function resolved(rects: readonly ReaderExactTextRangeRect[]): ReaderExactSourceRangeResolution {
  return {
    status: 'resolved',
    range: { selectedText: 'text', sourceLocator: { href: range.href }, rects },
  };
}
