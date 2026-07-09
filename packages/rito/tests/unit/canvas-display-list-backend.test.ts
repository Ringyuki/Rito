import { describe, expect, it } from 'vitest';
import type { DisplayList } from '../../src/render/display-list';
import { canvasDisplayListRenderer } from '../../src/render/backends/canvas';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';

describe('canvas display-list backend', () => {
  it('executes page, clip, and text commands', () => {
    const mock = createMockCanvasContext();
    const displayList: DisplayList = {
      width: 400,
      height: 600,
      commands: [
        {
          kind: 'paintPage',
          rect: { x: 0, y: 0, width: 400, height: 600 },
          paint: { backgroundColor: '#fff' },
        },
        { kind: 'pushState' },
        { kind: 'clipRect', rect: { x: 0, y: 0, width: 400, height: 600 } },
        {
          kind: 'paintText',
          text: 'Hello',
          rect: { x: 20, y: 30, width: 50, height: 20 },
          paint: DEFAULT_RUN_PAINT,
        },
        { kind: 'popState' },
      ],
    };

    canvasDisplayListRenderer.render(displayList, mock.ctx, { pixelRatio: 2 });

    expect(mock.getCalls('scale')[0]?.args).toEqual([2, 2]);
    expect(mock.getCalls('fillRect')[0]?.args).toEqual([0, 0, 400, 600]);
    expect(mock.getCalls('rect')[0]?.args).toEqual([0, 0, 400, 600]);
    expect(mock.getCalls('clip')).toHaveLength(1);
    expect(mock.getCalls('fillText')[0]?.args).toEqual(['Hello', 20, 30]);
  });

  it('resolves image hrefs before drawing', () => {
    const mock = createMockCanvasContext();
    const bitmap = { width: 100, height: 200 } as ImageBitmap;
    const images = new Map<string, ImageBitmap>([['Images/cover.jpg', bitmap]]);
    const displayList: DisplayList = {
      width: 400,
      height: 600,
      commands: [
        {
          kind: 'paintImage',
          src: '../Images/cover.jpg',
          rect: { x: 10, y: 20, width: 30, height: 40 },
        },
      ],
    };

    canvasDisplayListRenderer.render(displayList, mock.ctx, { images });

    expect(mock.getCalls('drawImage')[0]?.args).toEqual([bitmap, 10, 20, 30, 40]);
  });

  it('executes transform and opacity commands without canvas-specific display-list data', () => {
    const mock = createMockCanvasContext();
    const displayList: DisplayList = {
      width: 400,
      height: 600,
      commands: [
        { kind: 'pushState' },
        { kind: 'opacity', value: 0.5 },
        {
          kind: 'transform',
          origin: { x: 50, y: 60 },
          box: { width: 100, height: 80 },
          transforms: [
            { kind: 'translate', x: { unit: 'px', value: 10 }, y: { unit: 'px', value: 5 } },
          ],
        },
        { kind: 'popState' },
      ],
    };

    canvasDisplayListRenderer.render(displayList, mock.ctx);

    expect(mock.getPropertySets('globalAlpha')[0]?.value).toBe(0.5);
    expect(mock.getCalls('translate').map((call) => call.args)).toEqual([
      [50, 60],
      [10, 5],
      [-50, -60],
    ]);
  });

  it('multiplies nested opacity instead of replacing the parent alpha', () => {
    const mock = createMockCanvasContext();
    mock.ctx.globalAlpha = 1;
    const displayList: DisplayList = {
      width: 100,
      height: 100,
      commands: [
        { kind: 'pushState' },
        { kind: 'opacity', value: 0.5 },
        { kind: 'pushState' },
        { kind: 'opacity', value: 0.5 },
        { kind: 'popState' },
        { kind: 'popState' },
      ],
    };

    canvasDisplayListRenderer.render(displayList, mock.ctx);

    expect(mock.getPropertySets('globalAlpha').map((record) => record.value)).toEqual([
      1, 0.5, 0.25,
    ]);
  });
});
