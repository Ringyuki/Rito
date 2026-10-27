import { describe, expect, it } from 'vitest';
import { createScrollGeometry } from '../src/scroll/geometry';
import { viewRects, windowLayers } from '../src/scroll/highlights';
import { edgeSpeed } from '../src/scroll/selection-input';

const MARGINS = { marginLeft: 30, marginTop: 40 };

describe('scrolled highlights', () => {
  it("draws a page's rects over the window showing it, the page's margins in", () => {
    const layers = windowLayers(3, MARGINS, [
      {
        id: 'search',
        color: 'yellow',
        rects: [
          { pageIndex: 3, x: 5, y: 6, width: 50, height: 18 },
          { pageIndex: 4, x: 5, y: 6, width: 50, height: 18 },
        ],
      },
      { id: 'note', color: 'orange', zIndex: 2, mark: 'underline', rects: [] },
    ]);
    expect(layers).toEqual([
      {
        id: 'search',
        color: 'yellow',
        zIndex: 0,
        mark: undefined,
        rects: [{ x: 35, y: 46, width: 50, height: 18 }],
      },
      { id: 'note', color: 'orange', zIndex: 2, mark: 'underline', rects: [] },
    ]);
  });

  it("places a page's rects where a downward view shows its window", () => {
    // Windows 600 CSS pixels long at ratio 2: the second starts 1200 device
    // pixels in, 200 below the top of a view scrolled 1000 down.
    const geometry = createScrollGeometry(
      {
        axis: 'down',
        windowLength: 600,
        chapters: [{ firstSpread: 0, spreadCount: 3, extent: 1_800 }],
      },
      2,
    );
    const rects = viewRects(
      geometry,
      (window) => window.spreadIndex + 10,
      MARGINS,
      1_000,
      800,
      1_200,
      [
        { pageIndex: 11, x: 5, y: 6, width: 50, height: 18 },
        { pageIndex: 14, x: 5, y: 6, width: 50, height: 18 },
      ],
    );
    expect(rects).toEqual([{ x: 35, y: 100 + 46, width: 50, height: 18 }]);
  });

  it("places a page's rects where a leftward view shows its window", () => {
    // A view 400 wide scrolled 100 leftwards: the first window's left edge
    // is 100 in from the view's, the second's 300 out past it.
    const geometry = createScrollGeometry(
      {
        axis: 'left',
        windowLength: 400,
        chapters: [{ firstSpread: 0, spreadCount: 3, extent: 1_200 }],
      },
      1,
    );
    const rects = viewRects(geometry, (window) => window.spreadIndex, MARGINS, 100, 400, 600, [
      { pageIndex: 0, x: 300, y: 10, width: 23, height: 64 },
      { pageIndex: 1, x: 340, y: 10, width: 23, height: 64 },
    ]);
    expect(rects).toEqual([
      { x: 100 + 30 + 300, y: 50, width: 23, height: 64 },
      { x: -300 + 30 + 340, y: 50, width: 23, height: 64 },
    ]);
  });

  it('scrolls the strip on near either end of a drag, faster nearer the end', () => {
    const view = { clientWidth: 400, clientHeight: 600 };
    const down = { axis: 'down' as const };
    expect(edgeSpeed(view, down, { x: 200, y: 10 })).toBe(-18);
    expect(edgeSpeed(view, down, { x: 200, y: -50 })).toBe(-24);
    expect(edgeSpeed(view, down, { x: 200, y: 300 })).toBe(0);
    expect(edgeSpeed(view, down, { x: 200, y: 590 })).toBe(18);
    // Leftwards the block start is the right edge.
    const left = { axis: 'left' as const };
    expect(edgeSpeed(view, left, { x: 395, y: 300 })).toBe(-21);
    expect(edgeSpeed(view, left, { x: 5, y: 300 })).toBe(21);
  });
});
