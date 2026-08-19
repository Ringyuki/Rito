import { describe, expect, it } from 'vitest';
import type { RitoCoreWasmPaintBlockCommand } from '@ritojs/core-wasm';

import { renderCanvasBlockDecoration } from '../../src/bindings/browser/canvas-block/renderer';
import { renderBlockDecoration } from '../../src/reference/ts-core/render/backends/canvas/background/background-renderer';
import {
  createMockCanvasContext,
  isCall,
  type MockCanvasContext,
} from '../helpers/mock-canvas-context';

type ImageResolver = (src: string) => ImageBitmap | undefined;
type BlockPaint = RitoCoreWasmPaintBlockCommand['paint'];

interface DecorationCase {
  readonly name: string;
  readonly command: RitoCoreWasmPaintBlockCommand;
  readonly resolveImage?: ImageResolver;
  readonly contextScale?: number;
}

const IMAGE_HREF = 'Images/pattern.png';
const PATTERN = { width: 40, height: 20 } as ImageBitmap;
const PATTERN_RESOLVER: ImageResolver = (src) => (src === IMAGE_HREF ? PATTERN : undefined);

describe('production Canvas block decoration', () => {
  it.each(basicDecorationCases())('matches reference records: $name', (testCase) => {
    expectProductionToMatchReference(testCase);
  });

  it.each(backgroundImageCases())('matches reference image records: $name', (testCase) => {
    expectProductionToMatchReference(testCase);
  });

  it.each(borderCases())('matches reference border records: $name', (testCase) => {
    expectProductionToMatchReference(testCase);
  });

  it.each(shadowCases())('matches reference shadow records: $name', (testCase) => {
    expectProductionToMatchReference(testCase);
  });

  it('rasters straight solid edges as binary device-row bands', () => {
    // Measured Blink raster: a solid edge starts at round(border-box
    // edge) and fills max(1, floor(width)) full-tone rows — no
    // centerline stroke, no antialiasing (a 1.5px border is exactly one
    // row). Non-solid straight edges keep the stroked path.
    const production = renderProduction({
      name: 'straight mixed borders with an absent edge',
      command: blockCommand(
        {
          border: {
            top: { color: '#110000', style: 'solid' },
            right: { color: '#001100', style: 'dashed' },
            bottom: { color: '#000011', style: 'dotted' },
          },
        },
        { topWidth: 1.5, rightWidth: 2, bottomWidth: 5, leftWidth: 4 },
      ),
    });
    const fills = production.records.filter(
      (record) => isCall(record) && record.method === 'fillRect',
    );
    // rect x10 y20 w100: the top edge band = round(10)..round(110) at
    // round(20), one row for the 1.5px width.
    expect(fills.map((record) => (isCall(record) ? [...record.args] : []))).toContainEqual([
      10, 20, 100, 1,
    ]);
    // The 5px dotted bottom edge paints measured circles, not a stroke.
    const arcs = production.records.filter((record) => isCall(record) && record.method === 'arc');
    expect(arcs.length).toBeGreaterThan(0);
    const strokes = production.records.filter(
      (record) => isCall(record) && record.method === 'stroke',
    );
    expect(strokes.length).toBe(0);
  });

  it('keeps shadow, color, image, and border paint ordering', () => {
    const testCase = combinedDecorationCase();
    expectProductionToMatchReference(testCase);

    const production = renderProduction(testCase);
    const calls = production.records.filter(isCall);
    const firstFill = calls.findIndex((call) => call.method === 'fill');
    const drawImage = calls.findIndex((call) => call.method === 'drawImage');
    const stroke = calls.findIndex((call) => call.method === 'stroke');

    expect(firstFill).toBeGreaterThanOrEqual(0);
    expect(drawImage).toBeGreaterThan(firstFill);
    expect(stroke).toBeGreaterThan(drawImage);
  });

  it.each(throwingPaintCases())(
    'restores Canvas state when $method throws during $name',
    ({ command, method, resolveImage }) => {
      const mock = createMockCanvasContext();
      const ctx = contextThrowingOn(mock.ctx, method);

      expect(() => {
        renderCanvasBlockDecoration(ctx, command, resolveImage);
      }).toThrow(`forced ${method} failure`);
      expect(mock.getCalls('save').length).toBeGreaterThan(0);
      expect(mock.getCalls('restore')).toHaveLength(mock.getCalls('save').length);
    },
  );
});

function basicDecorationCases(): readonly DecorationCase[] {
  return [
    {
      name: 'empty paint',
      command: blockCommand({}),
    },
    {
      name: 'flat background color',
      command: blockCommand({ background: { color: '#123456' } }),
    },
    {
      name: 'circular rounded background color',
      command: blockCommand({ background: { color: '#abcdef' }, radius: { px: 8 } }),
    },
    {
      name: 'percentage elliptical background color',
      command: blockCommand({ background: { color: '#fedcba' }, radius: { pct: 25 } }),
    },
  ];
}

function backgroundImageCases(): readonly DecorationCase[] {
  return [
    imageCase('auto image at its default origin', {
      image: IMAGE_HREF,
      size: 'auto',
      repeat: 'no-repeat',
    }),
    imageCase('cover image at its default center', {
      image: IMAGE_HREF,
      size: 'cover',
      repeat: 'no-repeat',
    }),
    imageCase('contain image at its default center', {
      image: IMAGE_HREF,
      size: 'contain',
      repeat: 'no-repeat',
    }),
    imageCase('image with pixel and percentage position', {
      image: IMAGE_HREF,
      size: 'auto',
      repeat: 'no-repeat',
      position: {
        x: { unit: 'px', value: 7 },
        y: { unit: 'percent', value: 100 },
      },
    }),
    imageCase('repeated image tiles', {
      image: IMAGE_HREF,
      size: 'auto',
      repeat: 'repeat',
      position: {
        x: { unit: 'percent', value: 50 },
        y: { unit: 'px', value: 5 },
      },
    }),
    {
      name: 'missing image returns without drawing',
      command: blockCommand({
        background: { image: 'Images/missing.png', size: 'cover', repeat: 'no-repeat' },
      }),
      resolveImage: PATTERN_RESOLVER,
    },
    {
      name: 'rounded image clip',
      command: blockCommand({
        background: { image: IMAGE_HREF, size: 'contain', repeat: 'no-repeat' },
        radius: { px: 10 },
      }),
      resolveImage: PATTERN_RESOLVER,
    },
  ];
}

function imageCase(
  name: string,
  background: NonNullable<BlockPaint['background']>,
): DecorationCase {
  return {
    name,
    command: blockCommand({ background }),
    resolveImage: PATTERN_RESOLVER,
  };
}

function borderCases(): readonly DecorationCase[] {
  return [
    {
      name: 'uniform rounded solid border',
      command: blockCommand(
        { border: uniformBorder('#223344', 'solid'), radius: { px: 9 } },
        uniformBorderBox(2),
      ),
    },
    {
      name: 'uniform rounded dashed border',
      command: blockCommand(
        { border: uniformBorder('#334455', 'dashed'), radius: { px: 12 } },
        uniformBorderBox(3),
      ),
    },
    {
      name: 'split elliptical rounded border',
      command: blockCommand(
        {
          border: {
            top: { color: '#112233', style: 'solid' },
            right: { color: '#223344', style: 'dashed' },
            bottom: { color: '#334455', style: 'dotted' },
            left: { color: '#445566', style: 'solid' },
          },
          radius: { pct: 20 },
        },
        { topWidth: 1, rightWidth: 2, bottomWidth: 3, leftWidth: 4 },
      ),
    },
  ];
}

function shadowCases(): readonly DecorationCase[] {
  return [
    {
      name: 'rectangular shadow at a scaled DPR',
      command: blockCommand({
        boxShadow: [shadow({ offsetX: 2, offsetY: 3, blur: 4, spread: 1 })],
      }),
      contextScale: 2,
    },
    {
      name: 'rounded multiple shadows skip inset and render in reverse order',
      command: blockCommand({
        radius: { px: 8 },
        boxShadow: [
          shadow({ offsetX: 1, offsetY: 2, blur: 3, spread: 2, color: '#111111' }),
          shadow({ inset: true, color: '#222222' }),
          shadow({ offsetX: -4, offsetY: 5, blur: 6, spread: 1, color: '#333333' }),
        ],
      }),
    },
    {
      name: 'negative shadow spread keeps a positive expanded box',
      command: blockCommand({
        radius: { px: 6 },
        boxShadow: [shadow({ offsetX: -2, offsetY: -3, blur: 2, spread: -4 })],
      }),
    },
    {
      name: 'negative spread can collapse the expanded shadow shape',
      command: blockCommand({ boxShadow: [shadow({ blur: 0, spread: -6 })] }, undefined, {
        x: 3,
        y: 4,
        width: 8,
        height: 8,
      }),
    },
  ];
}

function combinedDecorationCase(): DecorationCase {
  return {
    name: 'combined decoration layers',
    command: blockCommand(
      {
        background: {
          color: '#ddeeff',
          image: IMAGE_HREF,
          size: 'contain',
          repeat: 'no-repeat',
        },
        border: uniformBorder('#102030', 'dashed'),
        radius: { px: 7 },
        boxShadow: [shadow({ offsetX: 2, offsetY: 3, blur: 4, spread: 1 })],
      },
      uniformBorderBox(2),
    ),
    resolveImage: PATTERN_RESOLVER,
  };
}

function throwingPaintCases(): readonly {
  readonly name: string;
  readonly method: 'drawImage' | 'fill' | 'stroke' | 'clip';
  readonly command: RitoCoreWasmPaintBlockCommand;
  readonly resolveImage?: ImageResolver;
}[] {
  const imageCommand = blockCommand({
    background: { image: IMAGE_HREF, size: 'auto', repeat: 'no-repeat' },
  });
  return [
    {
      name: 'background image draw',
      method: 'drawImage',
      command: imageCommand,
      resolveImage: PATTERN_RESOLVER,
    },
    {
      name: 'box shadow fill',
      method: 'fill',
      command: blockCommand({ boxShadow: [shadow({ blur: 2, spread: 1 })] }),
    },
    {
      name: 'rounded border stroke',
      method: 'stroke',
      command: blockCommand(
        { border: uniformBorder('#000000', 'solid'), radius: { px: 5 } },
        uniformBorderBox(2),
      ),
    },
    {
      name: 'rounded border stroke',
      method: 'stroke',
      // A rounded non-solid border still walks the stroked path.
      command: blockCommand(
        { border: uniformBorder('#111111', 'dashed'), radius: { px: 5 } },
        uniformBorderBox(2),
      ),
    },
    {
      name: 'split rounded border fill',
      method: 'fill',
      command: blockCommand(
        {
          border: {
            top: { color: '#111111', style: 'solid' },
            right: { color: '#222222', style: 'solid' },
          },
          radius: { px: 5 },
        },
        { topWidth: 1, rightWidth: 2, bottomWidth: 0, leftWidth: 0 },
      ),
    },
    {
      name: 'background image clip',
      method: 'clip',
      command: imageCommand,
      resolveImage: PATTERN_RESOLVER,
    },
  ];
}

function blockCommand(
  paint: BlockPaint,
  borderBox?: RitoCoreWasmPaintBlockCommand['borderBox'],
  rect: RitoCoreWasmPaintBlockCommand['rect'] = { x: 10, y: 20, width: 100, height: 60 },
): RitoCoreWasmPaintBlockCommand {
  return {
    kind: 'paintBlock',
    rect,
    paint,
    ...(borderBox ? { borderBox } : {}),
  };
}

function uniformBorder(
  color: string,
  style: 'solid' | 'dotted' | 'dashed',
): NonNullable<BlockPaint['border']> {
  const edge = { color, style };
  return { top: edge, right: edge, bottom: edge, left: edge };
}

function uniformBorderBox(width: number): NonNullable<RitoCoreWasmPaintBlockCommand['borderBox']> {
  return { topWidth: width, rightWidth: width, bottomWidth: width, leftWidth: width };
}

function shadow(
  overrides: Partial<NonNullable<BlockPaint['boxShadow']>[number]> = {},
): NonNullable<BlockPaint['boxShadow']>[number] {
  return {
    offsetX: 0,
    offsetY: 0,
    blur: 0,
    spread: 0,
    color: '#000000',
    inset: false,
    ...overrides,
  };
}

function expectProductionToMatchReference(testCase: DecorationCase): void {
  const reference = renderReference(testCase);
  const production = renderProduction(testCase);
  expect(production.records).toEqual(reference.records);
}

function renderReference(testCase: DecorationCase): MockCanvasContext {
  const mock = createMockCanvasContext();
  applyContextScale(mock, testCase.contextScale);
  const { command } = testCase;
  renderBlockDecoration(
    mock.ctx,
    {
      rect: command.rect,
      paint: command.paint,
      ...(command.borderBox ? { borderBox: command.borderBox } : {}),
    },
    resolvedRadius(command),
    testCase.resolveImage,
  );
  return mock;
}

function renderProduction(testCase: DecorationCase): MockCanvasContext {
  const mock = createMockCanvasContext();
  applyContextScale(mock, testCase.contextScale);
  renderCanvasBlockDecoration(mock.ctx, testCase.command, testCase.resolveImage);
  return mock;
}

function applyContextScale(mock: MockCanvasContext, scale: number | undefined): void {
  if (scale !== undefined) mock.ctx.scale(scale, scale);
}

function resolvedRadius(command: RitoCoreWasmPaintBlockCommand): {
  readonly rx: number;
  readonly ry: number;
} {
  const radius = command.paint.radius;
  if (radius?.pct !== undefined) {
    return {
      rx: (radius.pct / 100) * command.rect.width,
      ry: (radius.pct / 100) * command.rect.height,
    };
  }
  const value = radius?.px ?? 0;
  return { rx: value, ry: value };
}

function contextThrowingOn(
  ctx: CanvasRenderingContext2D,
  method: 'drawImage' | 'fill' | 'stroke' | 'clip',
): CanvasRenderingContext2D {
  return new Proxy(ctx, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== method || typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        Reflect.apply(value, target, args);
        throw new Error(`forced ${method} failure`);
      };
    },
  });
}
