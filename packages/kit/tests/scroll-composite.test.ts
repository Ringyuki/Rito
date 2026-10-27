import { describe, expect, it } from 'vitest';
import type { ReaderGlTarget, ReaderScrollLayout } from '@ritojs/core';
import { createCompositor } from '../src/painter/gl/compositor';
import { compositeWindows, windowRect } from '../src/scroll/composite';
import { createScrollGeometry } from '../src/scroll/geometry';
import { createWindowPool } from '../src/scroll/pool';
import { createFakeGl } from './helpers/fake-gl';

const layout = (axis: ReaderScrollLayout['axis']): ReaderScrollLayout => ({
  axis,
  windowLength: 400,
  chapters: [
    { firstSpread: 0, spreadCount: 2, extent: 600 },
    { firstSpread: 2, spreadCount: 3, extent: 1_000 },
  ],
});

describe('scrolled windows on the view', () => {
  it('stacks windows down the view, or leftwards from its right edge', () => {
    const down = createScrollGeometry(layout('down'), 2);
    const [first, second] = down.windows;
    if (!first || !second) throw new Error('two windows');
    expect(windowRect(down, second, 300, 800, 800)).toEqual({
      x: 0,
      y: 500,
      width: 800,
      height: 400,
    });
    const left = createScrollGeometry(layout('left'), 2);
    const [right, next] = left.windows;
    if (!right || !next) throw new Error('two windows');
    // The first window ends at the view's right edge, where a page is.
    expect(windowRect(left, right, 0, 800, 800)).toEqual({ x: 0, y: 0, width: 800, height: 800 });
    expect(windowRect(left, next, 0, 800, 800)).toEqual({ x: -400, y: 0, width: 400, height: 800 });
  });

  it('draws what is painted at whole pixels and paints a window once', () => {
    const fake = createFakeGl();
    const compositor = createCompositor(fake.gl);
    const geometry = createScrollGeometry(layout('down'), 1);
    const painted: [number, number, number][] = [];
    const loaded = new Set([0]);
    const pool = createWindowPool(fake.gl, (spreadIndex, target: ReaderGlTarget) => {
      painted.push([spreadIndex, target.width, target.height]);
      return loaded.has(spreadIndex);
    });
    const draw = () =>
      compositeWindows(compositor, geometry, 150.4, 400, 400, (window, rect) =>
        pool.picture(window.spreadIndex, rect.width, rect.height),
      );
    expect(draw().map((window) => window.spreadIndex)).toEqual([1]);
    loaded.add(1);
    expect(draw()).toEqual([]);
    expect(draw()).toEqual([]);
    // The chapter's 200-row tail window is painted at its own size, each once.
    expect(painted).toEqual([
      [0, 400, 400],
      [1, 400, 200],
      [1, 400, 200],
    ]);
    pool.invalidate(0);
    draw();
    expect(painted.at(-1)).toEqual([0, 400, 400]);
    pool.keep(new Set([1]));
    pool.dispose();
  });
});
