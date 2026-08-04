import { describe, expect, it, vi } from 'vitest';
import type { RitoCoreWasmFrameCommand } from '@ritojs/core-wasm';

import { renderFrameCommandsToCanvas } from '../../src/bindings/browser/frame-command-renderer';
import { createCanvasImageResolver } from '../../src/bindings/browser/image-href-resolver';
import { canvasDisplayListRenderer } from '../../src/reference/ts-core/render/backends/canvas';
import type { DisplayList } from '../../src/reference/ts-core/render/display-list';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';

describe('browser frame-command Canvas renderer', () => {
  it('matches the reference renderer for every frame command kind', () => {
    const commands = representativeCommands();
    const reference = createMockCanvasContext();
    const production = createMockCanvasContext();
    const cover = { width: 120, height: 180 } as ImageBitmap;
    const images = new Map<string, ImageBitmap>([['Images/cover.jpg', cover]]);
    const displayList: DisplayList = { width: 320, height: 480, commands };

    canvasDisplayListRenderer.render(displayList, reference.ctx, {
      pixelRatio: 1.5,
      images,
      foregroundColor: '#f0f0f0',
      backgroundColor: '#101010',
    });
    renderFrameCommandsToCanvas(commands, production.ctx, {
      pixelRatio: 1.5,
      resolveImage: createCanvasImageResolver(images),
      foregroundColor: '#f0f0f0',
      backgroundColor: '#101010',
    });

    expect(commands.map((command) => command.kind)).toEqual([
      'paintPage',
      'pushState',
      'translate',
      'opacity',
      'transform',
      'clipRect',
      'paintBlock',
      'paintText',
      'paintRuby',
      'paintImage',
      'paintHorizontalRule',
      'popState',
    ]);
    expect(production.records).toEqual(reference.records);
  });

  it('replaces the materialized page ground with the theme override background', () => {
    const commands: readonly RitoCoreWasmFrameCommand[] = [
      {
        kind: 'paintPage',
        rect: { x: 0, y: 0, width: 100, height: 150 },
        paint: { backgroundColor: '#ffffff' },
      },
    ];

    const themed = createMockCanvasContext();
    renderFrameCommandsToCanvas(commands, themed.ctx, {
      pixelRatio: 1,
      foregroundColor: '#e5e5e5',
      backgroundColor: '#1a1a1a',
    });
    expect(themed.getPropertySets('fillStyle').map((set) => set.value)).toEqual(['#1a1a1a']);

    const unthemed = createMockCanvasContext();
    renderFrameCommandsToCanvas(commands, unthemed.ctx, { pixelRatio: 1 });
    expect(unthemed.getPropertySets('fillStyle').map((set) => set.value)).toEqual(['#ffffff']);
  });

  it('contains a text paint fault: no throw, state restored, fault recorded', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'fillText');
    const commands: readonly RitoCoreWasmFrameCommand[] = [
      { kind: 'pushState' },
      { kind: 'pushState' },
      {
        kind: 'paintText',
        text: 'boom',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        paint: {
          color: '#000',
          font: { style: 'normal', weight: 400, sizePx: 16, family: 'serif' },
        },
      },
      { kind: 'popState' },
      { kind: 'popState' },
    ];

    // A paint fault must never escape the frame walk: an exception here
    // leaves the spread permanently unpainted and wedges paging into it.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    delete (globalThis as { __ritoRenderFailures?: unknown[] }).__ritoRenderFailures;
    try {
      expect(() => {
        renderFrameCommandsToCanvas(commands, ctx, {});
      }).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }
    expect(mock.getCalls('save')).toHaveLength(3);
    expect(mock.getCalls('restore')).toHaveLength(3);
    const failures = (globalThis as { __ritoRenderFailures?: unknown[] }).__ritoRenderFailures;
    expect(failures).toHaveLength(1);
    expect(String((failures?.[0] as { message?: string }).message)).toContain('paint failed');
  });

  it('contains a ruby paint fault: no throw, ruby-local state restored', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'fillText');
    const commands: readonly RitoCoreWasmFrameCommand[] = [
      { kind: 'pushState' },
      { kind: 'pushState' },
      {
        kind: 'paintRuby',
        text: 'boom',
        rect: { x: 0, y: 0, width: 20, height: 10 },
        paint: {
          color: '#000',
          font: { style: 'normal', weight: 400, sizePx: 8, family: 'serif' },
        },
      },
    ];

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        renderFrameCommandsToCanvas(commands, ctx, {});
      }).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }
    expect(mock.getCalls('save')).toHaveLength(4);
    expect(mock.getCalls('restore')).toHaveLength(4);
  });

  it('contains an image paint fault: no throw, block-local state restored', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'drawImage');
    const bitmap = { width: 20, height: 30 } as ImageBitmap;
    const commands: readonly RitoCoreWasmFrameCommand[] = [
      { kind: 'pushState' },
      { kind: 'pushState' },
      {
        kind: 'paintBlock',
        rect: { x: 0, y: 0, width: 10, height: 10 },
        paint: {
          background: { image: 'Images/pattern.png', repeat: 'no-repeat' },
        },
      },
    ];

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => {
        renderFrameCommandsToCanvas(commands, ctx, {
          resolveImage: () => bitmap,
        });
      }).not.toThrow();
    } finally {
      consoleError.mockRestore();
    }
    expect(mock.getCalls('save')).toHaveLength(4);
    expect(mock.getCalls('restore')).toHaveLength(4);
  });

  it.each([
    { name: 'plain', expectedRect: 1, expectedArc: 0, expectedEllipse: 0 },
    {
      name: 'zero radius',
      radius: { rx: 0, ry: 0 },
      expectedRect: 1,
      expectedArc: 0,
      expectedEllipse: 0,
    },
    {
      name: 'circular radius',
      radius: { rx: 4, ry: 4 },
      expectedRect: 0,
      expectedArc: 4,
      expectedEllipse: 0,
    },
    {
      name: 'elliptical radius',
      radius: { rx: 4, ry: 2 },
      expectedRect: 0,
      expectedArc: 0,
      expectedEllipse: 4,
    },
    {
      name: 'oversized radius',
      radius: { rx: 99, ry: 99 },
      expectedRect: 0,
      expectedArc: 0,
      expectedEllipse: 4,
      expectedFirstEllipse: [12, 8, 10, 5, 0, -Math.PI / 2, 0],
    },
  ])(
    'matches the reference $name clip path',
    ({ radius, expectedRect, expectedArc, expectedEllipse, expectedFirstEllipse }) => {
      const command: RitoCoreWasmFrameCommand = {
        kind: 'clipRect',
        rect: { x: 2, y: 3, width: 20, height: 10 },
        ...(radius ? { radius } : {}),
      };
      const reference = createMockCanvasContext();
      const production = createMockCanvasContext();

      canvasDisplayListRenderer.render(
        { width: 20, height: 10, commands: [command] } as DisplayList,
        reference.ctx,
      );
      renderFrameCommandsToCanvas([command], production.ctx, {});

      expect(production.records).toEqual(reference.records);
      expect(production.getCalls('rect')).toHaveLength(expectedRect);
      expect(production.getCalls('arcTo')).toHaveLength(expectedArc);
      expect(production.getCalls('ellipse')).toHaveLength(expectedEllipse);
      expect(production.getCalls('clip')).toHaveLength(1);
      expect(production.getCalls('closePath')).toHaveLength(expectedRect === 0 ? 1 : 0);
      if (expectedFirstEllipse) {
        expect(production.getCalls('ellipse')[0]?.args).toEqual(expectedFirstEllipse);
      }
    },
  );
});

function representativeCommands(): readonly RitoCoreWasmFrameCommand[] {
  return [
    {
      kind: 'paintPage',
      rect: { x: 0, y: 0, width: 320, height: 480 },
      paint: { backgroundColor: '#fefefe' },
    },
    { kind: 'pushState' },
    { kind: 'translate', dx: 7, dy: 11 },
    { kind: 'opacity', value: 0.625 },
    {
      kind: 'transform',
      origin: { x: 50, y: 60 },
      box: { width: 100, height: 80 },
      transforms: [
        {
          kind: 'translate',
          x: { unit: 'percent', value: 25 },
          y: { unit: 'px', value: -4 },
        },
        { kind: 'scale', sx: 1.25, sy: 0.75 },
        { kind: 'rotate', rad: Math.PI / 8 },
      ],
    },
    {
      kind: 'clipRect',
      rect: { x: 12, y: 18, width: 250, height: 300 },
      radius: { rx: 9, ry: 13 },
    },
    {
      kind: 'paintBlock',
      rect: { x: 20, y: 30, width: 180, height: 90 },
      paint: {
        background: { color: '#ddeeff' },
        border: {
          top: { color: '#112233', style: 'solid' },
          right: { color: '#223344', style: 'dashed' },
          bottom: { color: '#334455', style: 'dotted' },
          left: { color: '#445566', style: 'solid' },
        },
        radius: { pct: 12.5 },
        boxShadow: [
          {
            offsetX: 2,
            offsetY: 3,
            blur: 4,
            spread: 1,
            color: '#556677',
            inset: false,
          },
        ],
      },
      borderBox: { topWidth: 1, rightWidth: 2, bottomWidth: 3, leftWidth: 4 },
    },
    {
      kind: 'paintText',
      text: 'Frame text',
      rect: { x: 28, y: 44, width: 96, height: 24 },
      paint: {
        color: '#334455',
        font: { style: 'italic', weight: 700, sizePx: 18, family: 'serif' },
        wordSpacingPx: 2,
        letterSpacingPx: 0.5,
        backgroundColor: '#ffeecc',
        backgroundRadius: 3,
        textShadow: [{ offsetX: 1, offsetY: 2, blur: 3, color: '#000000' }],
        decoration: {
          kind: 'underline',
          y: 19,
          thickness: 1.5,
          color: '#778899',
        },
        padding: { top: 1, right: 2, bottom: 3, left: 4 },
        border: {
          top: { widthPx: 1, paint: { color: '#112233', style: 'solid' } },
          bottom: { widthPx: 2, paint: { color: '#223344', style: 'dashed' } },
          start: { widthPx: 3, paint: { color: '#334455', style: 'dotted' } },
          end: { widthPx: 4, paint: { color: '#445566', style: 'solid' } },
        },
      },
    },
    {
      kind: 'paintRuby',
      text: 'るび',
      rect: { x: 40, y: 70, width: 52, height: 12 },
      paint: {
        color: '#223344',
        font: { style: 'normal', weight: 400, sizePx: 9, family: 'sans-serif' },
      },
    },
    {
      kind: 'paintImage',
      src: '../Images/cover.jpg',
      rect: { x: 210, y: 35, width: 60, height: 90 },
      alt: 'Cover',
    },
    {
      kind: 'paintHorizontalRule',
      rect: { x: 24, y: 150, width: 220, height: 3 },
      paint: { color: '#667788', style: 'dotted' },
    },
    { kind: 'popState' },
  ];
}

function contextThrowingOn(
  ctx: CanvasRenderingContext2D,
  method: 'drawImage' | 'fillText',
): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== method || typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        Reflect.apply(value, target, args);
        throw new Error('paint failed');
      };
    },
  });
}
