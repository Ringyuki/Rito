import { describe, expect, it, vi } from 'vitest';
import type {
  RitoReaderColorV1,
  RitoReaderPrimitiveListV1,
  RitoReaderPrimitiveV1,
} from '@ritojs/core-wasm';

import { renderReaderPrimitivesToCanvas } from '../../src/bindings/browser/primitive-renderer';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';

function srgb(r: number, g: number, b: number, alpha = 1): RitoReaderColorV1 {
  return {
    space: 'srgb',
    component0: r,
    component1: g,
    component2: b,
    alpha,
    none: { component0: false, component1: false, component2: false, alpha: false },
  };
}

const INK = srgb(0, 0, 0);
const PAPER = srgb(1, 1, 1);
const SLATE = srgb(0.1, 0.1, 0.1);

function list(commands: readonly RitoReaderPrimitiveV1[], ratio = 1): RitoReaderPrimitiveListV1 {
  return { formatVersion: 2, ratio, commandCount: commands.length, commands };
}

describe('browser primitive renderer', () => {
  it('blits fills, clips, paths and strokes exactly as resolved', () => {
    const mock = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(
      list([
        { kind: 'push-state' },
        { kind: 'translate', dx: 3, dy: 4 },
        { kind: 'opacity', value: 0.5 },
        {
          kind: 'transform',
          origin: { x: 10, y: 20 },
          transforms: [
            { kind: 'rotate', radians: 0.5 },
            { kind: 'scale', sx: 2, sy: 3 },
            { kind: 'translate', dx: 8, dy: 40 },
          ],
        },
        { kind: 'clip-path', path: [{ op: 'rect', x: 0, y: 0, width: 40, height: 60 }] },
        {
          kind: 'fill-rect',
          rect: { x: 10, y: 21, width: 101, height: 1 },
          color: INK,
          ground: 'none',
        },
        {
          kind: 'fill-path',
          path: [
            { op: 'ellipse', cx: 3, cy: 3, rx: 3, ry: 3 },
            { op: 'move-to', x: 0, y: 0 },
            { op: 'line-to', x: 5, y: 0 },
            { op: 'arc', cx: 5, cy: 5, rx: 5, ry: 5, start: -Math.PI / 2, sweep: Math.PI / 2 },
            { op: 'close' },
          ],
          rule: 'evenodd',
          color: INK,
          ground: 'none',
        },
        {
          kind: 'stroke-path',
          path: [{ op: 'rect', x: 1, y: 1, width: 8, height: 8 }],
          width: 1.5,
          color: INK,
          cap: 'round',
          dash: { on: 3, off: 2 },
        },
        { kind: 'pop-state' },
      ]),
      mock.ctx,
    );

    expect(mock.getCalls('scale')).toEqual([{ method: 'scale', args: [2, 3] }]);
    expect(mock.getCalls('translate').map((call) => call.args)).toEqual([
      [3, 4],
      [10, 20],
      [8, 40],
      [-10, -20],
    ]);
    expect(mock.getCalls('rotate').map((call) => call.args)).toEqual([[0.5]]);
    expect(mock.getPropertySets('globalAlpha').map((set) => set.value)).toEqual([0.5]);
    expect(mock.getCalls('rect').map((call) => call.args)).toEqual([
      [0, 0, 40, 60],
      [1, 1, 8, 8],
    ]);
    expect(mock.getCalls('clip')).toHaveLength(1);
    expect(mock.getCalls('fillRect').map((call) => call.args)).toEqual([[10, 21, 101, 1]]);
    expect(mock.getCalls('ellipse').map((call) => call.args)).toEqual([
      [3, 3, 3, 3, 0, 0, 2 * Math.PI],
      [5, 5, 5, 5, 0, -Math.PI / 2, 0, false],
    ]);
    expect(mock.getCalls('fill').map((call) => call.args)).toEqual([['evenodd']]);
    expect(mock.getPropertySets('lineWidth').map((set) => set.value)).toEqual([1.5]);
    expect(mock.getPropertySets('lineCap').map((set) => set.value)).toEqual(['round']);
    expect(mock.getCalls('setLineDash').map((call) => call.args)).toEqual([[[3, 2]]]);
    expect(mock.getCalls('stroke')).toHaveLength(1);
    // The outer save plus the pushed state, both restored.
    expect(mock.getCalls('save')).toHaveLength(2);
    expect(mock.getCalls('restore')).toHaveLength(2);
  });

  it('takes the theme override decision on the page ground and keeps declared block grounds', () => {
    const page = (color: RitoReaderColorV1): RitoReaderPrimitiveV1 => ({
      kind: 'fill-rect',
      rect: { x: 0, y: 0, width: 100, height: 150 },
      color,
      ground: 'page',
    });
    const themed = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(list([page(PAPER)]), themed.ctx, {
      foregroundColor: '#e5e5e5',
      backgroundColor: '#1a1a1a',
    });
    expect(themed.getPropertySets('fillStyle').map((set) => set.value)).toEqual(['#1a1a1a']);

    const designed = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(list([page(SLATE)]), designed.ctx, {
      foregroundColor: '#e5e5e5',
      backgroundColor: '#1a1a1a',
    });
    expect(designed.getPropertySets('fillStyle').map((set) => set.value)).toEqual([
      'rgba(25.5, 25.5, 25.5, 1)',
    ]);

    const unthemed = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(list([page(PAPER)]), unthemed.ctx);
    expect(unthemed.getPropertySets('fillStyle').map((set) => set.value)).toEqual([
      'rgba(255, 255, 255, 1)',
    ]);
  });

  it('draws images once or per tile and samples a source rect', () => {
    const mock = createMockCanvasContext();
    const bitmap = { width: 16, height: 16 } as ImageBitmap;
    renderReaderPrimitivesToCanvas(
      list([
        {
          kind: 'draw-image',
          src: 'a.png',
          dest: { x: 1, y: 2, width: 10, height: 20 },
          sourceRect: { x: 0, y: 0, width: 5, height: 5 },
        },
        {
          kind: 'draw-image',
          src: 'a.png',
          dest: { x: 0, y: 0, width: 16, height: 16 },
          tiles: { origin: { x: 100, y: 200 }, stepX: 16, stepY: 16, columns: 2, rows: 3 },
        },
        { kind: 'draw-image', src: 'missing.png', dest: { x: 0, y: 0, width: 1, height: 1 } },
      ]),
      mock.ctx,
      { resolveImage: (src) => (src === 'a.png' ? bitmap : undefined) },
    );
    const draws = mock.getCalls('drawImage').map((call) => call.args.slice(1));
    expect(draws).toHaveLength(7);
    expect(draws[0]).toEqual([0, 0, 5, 5, 1, 2, 10, 20]);
    expect(draws[1]).toEqual([100, 200, 16, 16]);
    expect(draws[6]).toEqual([116, 232, 16, 16]);
  });

  it('hands text runs to the semantic text painter over their declared grounds', () => {
    const mock = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(
      list([
        {
          kind: 'fill-path',
          path: [{ op: 'rect', x: 0, y: 0, width: 50, height: 50 }],
          rule: 'nonzero',
          color: PAPER,
          ground: 'block',
          groundRect: { x: 0.4, y: 0.4, width: 49.5, height: 49.5 },
        },
        {
          kind: 'text',
          vertical: false,
          clusters: [],
          text: 'run',
          rect: { x: 10, y: 10, width: 30, height: 20 },
          paint: {
            font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
            color: INK,
            textShadows: [],
          },
        },
      ]),
      mock.ctx,
      { foregroundColor: '#e5e5e5', backgroundColor: '#1a1a1a' },
    );
    expect(mock.getCalls('fill')).toHaveLength(1);
    expect(mock.getCalls('fillText').map((call) => call.args[0])).toEqual(['run']);
    // Ink over a declared block ground keeps the typesetter's colour pair.
    expect(mock.getPropertySets('fillStyle').map((set) => set.value)).toEqual([
      'rgba(255, 255, 255, 1)',
      'rgba(0, 0, 0, 1)',
    ]);
  });

  it('draws text runs at their CSS size under the list ratio and finds grounds on the device rect', () => {
    // Glyph rasterization follows the CSS font size (a synthetic-bold run
    // widens with the size it is asked for), so the run is drawn as the
    // engine wrote it, under scale(ratio); the block ground it sits on is
    // a device rect, so the containment test scales the run's rect.
    const mock = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(
      list(
        [
          {
            kind: 'fill-rect',
            rect: { x: 0, y: 0, width: 100, height: 100 },
            color: PAPER,
            ground: 'block',
            groundRect: { x: 0, y: 0, width: 100, height: 100 },
          },
          {
            kind: 'text',
            vertical: false,
            clusters: [],
            text: 'run',
            rect: { x: 10, y: 10, width: 30, height: 20 },
            paint: {
              font: { family: 'serif', sizePx: 26, weight: 700, style: 'normal' },
              color: INK,
              textShadows: [],
            },
          },
        ],
        2,
      ),
      mock.ctx,
      { foregroundColor: '#e5e5e5', backgroundColor: '#1a1a1a' },
    );
    expect(mock.getCalls('scale').map((call) => call.args)).toEqual([[2, 2]]);
    expect(mock.getPropertySets('font').map((set) => set.value)).toEqual(['700 26px serif']);
    expect(mock.getCalls('fillText').map((call) => call.args)).toEqual([
      ['run', 10, 10 + 0.8 * 26],
    ]);
    // The run at CSS (10, 10, 30, 20) is device (20, 20, 60, 40), inside
    // the 100-square block ground: its ink keeps the typesetter's colour.
    expect(mock.getPropertySets('fillStyle').map((set) => set.value)).toEqual([
      'rgba(255, 255, 255, 1)',
      'rgba(0, 0, 0, 1)',
    ]);
    expect(mock.getCalls('save')).toHaveLength(mock.getCalls('restore').length);
  });

  it('blurs a shadow at twice its sigma inside its exclusion clip', () => {
    const mock = createMockCanvasContext();
    renderReaderPrimitivesToCanvas(
      list([
        {
          kind: 'shadow',
          shape: [{ op: 'rect', x: 10, y: 10, width: 20, height: 20 }],
          sigma: 1.5,
          offset: { x: 1, y: 2 },
          color: INK,
          clipOut: [{ op: 'rect', x: 10, y: 10, width: 20, height: 20 }],
        },
      ]),
      mock.ctx,
    );
    expect(mock.getCalls('clip').map((call) => call.args)).toEqual([['evenodd']]);
    expect(mock.getPropertySets('shadowBlur').map((set) => set.value)).toEqual([3]);
    expect(mock.getPropertySets('shadowOffsetX').map((set) => set.value)).toEqual([1]);
    expect(mock.getPropertySets('shadowOffsetY').map((set) => set.value)).toEqual([2]);
    expect(mock.getCalls('fill')).toHaveLength(1);
  });

  it('contains a ruby paint fault: no throw, ruby-local state restored', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'fillText');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        renderReaderPrimitivesToCanvas(
          list([
            { kind: 'push-state' },
            { kind: 'push-state' },
            {
              kind: 'ruby',
              vertical: false,
              clusters: [],
              text: 'boom',
              rect: { x: 0, y: 0, width: 20, height: 10 },
              paint: {
                font: { family: 'serif', sizePx: 8, weight: 400, style: 'normal' },
                color: INK,
                textShadows: [],
              },
            },
          ]),
          ctx,
        );
      }).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
    expect(mock.getCalls('save')).toHaveLength(mock.getCalls('restore').length);
  });

  it('contains an image paint fault: no throw, state restored', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'drawImage');
    const bitmap = { width: 20, height: 30 } as ImageBitmap;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        renderReaderPrimitivesToCanvas(
          list([
            { kind: 'push-state' },
            { kind: 'push-state' },
            {
              kind: 'draw-image',
              src: 'Images/pattern.png',
              dest: { x: 0, y: 0, width: 10, height: 10 },
            },
          ]),
          ctx,
          { resolveImage: () => bitmap },
        );
      }).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
    expect(mock.getCalls('save')).toHaveLength(mock.getCalls('restore').length);
  });

  it('hands every primitive to the paint tap with the on-screen flag', () => {
    const mock = createMockCanvasContext();
    const seen: string[] = [];
    const scope = globalThis as {
      __ritoPaintTap?: (p: { kind: string }, onScreen: boolean) => void;
    };
    scope.__ritoPaintTap = (primitive, onScreen) => {
      seen.push(`${primitive.kind}:${String(onScreen)}`);
    };
    try {
      renderReaderPrimitivesToCanvas(
        list([
          { kind: 'push-state' },
          {
            kind: 'fill-rect',
            rect: { x: 0, y: 0, width: 1, height: 1 },
            color: INK,
            ground: 'none',
          },
          { kind: 'pop-state' },
        ]),
        mock.ctx,
      );
    } finally {
      delete scope.__ritoPaintTap;
    }
    expect(seen).toEqual(['push-state:false', 'fill-rect:false', 'pop-state:false']);
  });

  it('isolates a primitive fault, restores its state and records it', () => {
    const mock = createMockCanvasContext();
    const ctx = new Proxy(mock.ctx, {
      get(target, prop, receiver) {
        if (prop === 'fillText') {
          return () => {
            throw new Error('boom');
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        renderReaderPrimitivesToCanvas(
          list([
            { kind: 'push-state' },
            {
              kind: 'text',
              vertical: false,
              clusters: [],
              text: 'boom',
              rect: { x: 0, y: 0, width: 10, height: 10 },
              paint: {
                font: { family: 'serif', sizePx: 16, weight: 400, style: 'normal' },
                color: INK,
                textShadows: [],
              },
            },
            { kind: 'pop-state' },
            {
              kind: 'fill-rect',
              rect: { x: 0, y: 0, width: 1, height: 1 },
              color: INK,
              ground: 'none',
            },
          ]),
          ctx,
        );
      }).not.toThrow();
    } finally {
      errorSpy.mockRestore();
    }
    expect(mock.getCalls('fillRect')).toHaveLength(1);
    expect(mock.getCalls('save')).toHaveLength(mock.getCalls('restore').length);
    const failures = (
      globalThis as { __ritoRenderFailures?: { failedCommand: { kind: string } }[] }
    ).__ritoRenderFailures;
    expect(failures?.at(-1)?.failedCommand.kind).toBe('text');
  });
});

function contextThrowingOn(
  ctx: CanvasRenderingContext2D,
  method: 'fillText' | 'drawImage',
): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(target, prop, receiver) {
      if (prop === method) {
        return () => {
          throw new Error(`${method} failed`);
        };
      }
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
}
