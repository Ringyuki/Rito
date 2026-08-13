import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  drawCanvasRubyFragment,
  drawCanvasTextFragment,
} from '../../src/bindings/browser/canvas-text/renderer';
import type {
  CanvasRubyFragment,
  CanvasTextColorOverride,
  CanvasTextFragment,
} from '../../src/bindings/browser/canvas-text/types';
import {
  drawRubyFragment,
  drawTextFragment,
} from '../../src/reference/ts-core/render/backends/canvas/text/text-renderer';
import { createMockCanvasContext, type MockCanvasContext } from '../helpers/mock-canvas-context';

type TextPaint = CanvasTextFragment['paint'];
type BorderStyle = 'solid' | 'dotted' | 'dashed';
type ThrowingMethod = 'fill' | 'fillRect' | 'stroke' | 'clip' | 'measureText' | 'fillText';

const COLOR_OVERRIDE = { foregroundColor: '#101010', backgroundColor: '#ffffff' } as const;
const BASE_PAINT = {
  color: '#223344',
  font: { style: 'normal', weight: 400, sizePx: 16, family: 'serif' },
} as const satisfies TextPaint;

afterEach(() => vi.unstubAllGlobals());

describe('production Canvas text renderer', () => {
  it.each([
    {
      name: 'plain defaults',
      paint: {},
      font: '16px serif',
      wordSpacing: '0px',
      letterSpacing: '0px',
    },
    {
      name: 'styled font and explicit spacing',
      paint: {
        font: {
          style: 'italic' as const,
          weight: 650,
          sizePx: 18.5,
          family: '"Source Serif 4", serif',
        },
        wordSpacingPx: 2.25,
        letterSpacingPx: -0.5,
      },
      font: 'italic 650 18.5px "Source Serif 4", serif',
      wordSpacing: '2.25px',
      letterSpacing: '-0.5px',
    },
  ])('matches reference records for $name', (testCase) => {
    const result = expectTextParity(textFragment(testCase.paint));
    expect(lastProperty(result, 'font')).toBe(testCase.font);
    expect(lastProperty(result, 'wordSpacing')).toBe(testCase.wordSpacing);
    expect(lastProperty(result, 'letterSpacing')).toBe(testCase.letterSpacing);
  });

  // Unreadable chromatic ink relights along lightness only (R3): yellow
  // keeps its hue at the foreground's lightness instead of snapping.
  it.each([
    { name: 'hex', color: '#ffff00', expected: 'rgb(32, 32, 0)' },
    { name: 'rgb', color: 'rgb(255, 255, 0)', expected: 'rgb(32, 32, 0)' },
    { name: 'hsl', color: 'hsl(60 100% 50%)', expected: 'rgb(32, 32, 0)' },
    { name: 'named', color: 'yellow', expected: 'rgb(32, 32, 0)' },
    { name: 'unparseable', color: 'currentColor', expected: 'currentColor' },
  ])('matches reference $name color override behavior', ({ color, expected }) => {
    const result = expectTextParity(textFragment({ color }), COLOR_OVERRIDE);
    expect(lastProperty(result, 'fillStyle')).toBe(expected);
  });

  it('paints each glyph at floor64 of the cumulative advance at fractional font sizes', () => {
    // 35th law: an off-grid font size (12.16 = 0.8em of 15.2) drifts the
    // float cumulative advance off Blink's LayoutUnit grid; the DOM
    // paints each glyph at floor64 of that cumulative (21/21 oracle
    // positions), so the pen does too. Mock glyph width = 12.16 × 0.6 =
    // 7.296 → floors 0, 466/64, 933/64.
    const result = expectTextParity(
      textFragment({ font: { ...BASE_PAINT.font, sizePx: 12.16 } }, '中中中'),
    );
    const calls = result.getCalls('fillText').map((call) => call.args);
    expect(calls).toEqual([
      ['中', 10, 20 + 0.8 * 12.16],
      ['中', 10 + 466 / 64, 20 + 0.8 * 12.16],
      ['中', 10 + 933 / 64, 20 + 0.8 * 12.16],
    ]);
  });

  it('keeps the whole-run fillText at grid-aligned font sizes', () => {
    const result = expectTextParity(
      textFragment({ font: { ...BASE_PAINT.font, sizePx: 16 } }, '中中中'),
    );
    expect(result.getCalls('fillText')).toHaveLength(1);
  });

  it('matches a rounded inline background with padding', () => {
    const result = expectTextParity(
      textFragment({
        backgroundColor: '#ffeecc',
        backgroundRadius: 6,
        padding: { top: 2, right: 8, bottom: 6, left: 4 },
      }),
    );

    expect(result.getCalls('moveTo')[0]?.args).toEqual([12, 18]);
    expect(result.getCalls('arcTo')).toHaveLength(4);
    expect(result.getCalls('fill')).toHaveLength(1);
  });

  it('matches partial straight solid, dotted, and dashed borders', () => {
    const result = expectTextParity(
      textFragment({
        backgroundRadius: 9,
        border: {
          top: borderEdge(2, 'solid', '#111111'),
          bottom: borderEdge(4, 'dotted', '#222222'),
          start: borderEdge(3, 'dashed', '#333333'),
        },
      }),
    );

    expect(result.getCalls('setLineDash').map((call) => call.args[0])).toEqual([
      [],
      [0.001, 6],
      [9, 6],
    ]);
    expect(result.getCalls('stroke')).toHaveLength(3);
    expect(result.getCalls('clip')).toHaveLength(0);
  });

  it('matches all-edge rounded borders', () => {
    const result = expectTextParity(textFragment(roundedBorderPaint()));

    expect(result.getCalls('clip')).toHaveLength(4);
    expect(result.getCalls('stroke')).toHaveLength(4);
    expect(result.getCalls('save')).toHaveLength(5);
    expect(result.getCalls('restore')).toHaveLength(5);
  });

  it.each([
    { kind: 'underline' as const, y: 17, thickness: 1.25, color: '#456789' },
    { kind: 'line-through' as const, y: 8, thickness: 2, color: '#987654' },
  ])('matches reference $kind decoration records', (decoration) => {
    const result = expectTextParity(textFragment({ decoration }));
    expect(result.getCalls('moveTo').at(-1)?.args).toEqual([10, 20 + decoration.y]);
    expect(result.getCalls('lineTo').at(-1)?.args).toEqual([60, 20 + decoration.y]);
    expect(lastProperty(result, 'lineWidth')).toBe(decoration.thickness);
  });

  it('matches the reference text-shadow path when Node has no scratch canvas', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', undefined);
    const result = expectTextParity(
      textFragment({
        textShadow: [
          { offsetX: 2, offsetY: 3, blur: 4, color: '#000000' },
          { offsetX: -1, offsetY: 1, blur: 0, color: '#445566' },
        ],
      }),
    );

    expect(result.getCalls('getTransform')).toHaveLength(1);
    expect(result.getCalls('drawImage')).toHaveLength(0);
    expect(result.getCalls('fillText')).toHaveLength(1);
  });

  it('matches centered ruby with zero spacing and a color override', () => {
    const ruby = rubyFragment(
      {
        color: 'yellow',
        font: { style: 'italic', weight: 700, sizePx: 10, family: 'sans-serif' },
        wordSpacingPx: 12,
        letterSpacingPx: 4,
      },
      'rt',
    );
    const result = expectRubyParity(ruby, COLOR_OVERRIDE);

    expect(result.getCalls('measureText')[0]?.args).toEqual(['rt']);
    // A LATIN annotation is one justification unit — no intra-word
    // space-around — so the word centers whole: 38px free →
    // x = 10 + 19, letter spacing stays zero (measured in Chromium on
    // latin rubies: natural word width, free/2 at each edge).
    expect(result.getCalls('fillText')[0]?.args).toEqual(['rt', 29, 20]);
    expect(lastProperty(result, 'wordSpacing')).toBe('0px');
    expect(lastProperty(result, 'letterSpacing')).toBe('0px');
    expect(lastProperty(result, 'fillStyle')).toBe('rgb(32, 32, 0)');
  });

  it('spreads a CJK annotation space-around per glyph', () => {
    const ruby = rubyFragment(
      {
        font: { style: 'normal', weight: 400, sizePx: 10, family: 'serif' },
      },
      'かな',
    );
    const result = expectRubyParity(ruby);
    // CJK annotations keep the space-around per-glyph distribution:
    // 38px free over 2 glyphs — 9.5px at each edge, 19px between.
    expect(result.getCalls('fillText')[0]?.args).toEqual(['かな', 19.5, 20]);
    expect(lastProperty(result, 'letterSpacing')).toBe('19px');
  });

  it.each(localFailureCases())(
    'balances local Canvas state when $method throws in $name',
    ({ method, render }) => {
      const mock = createMockCanvasContext();
      const ctx = contextThrowingOn(mock.ctx, method);

      expect(() => {
        render(ctx);
      }).toThrow(`forced ${method} failure`);
      expect(mock.getCalls('save').length).toBeGreaterThan(0);
      expect(mock.getCalls('restore')).toHaveLength(mock.getCalls('save').length);
    },
  );
});

function textFragment(paint: Partial<TextPaint> = {}, text = 'Canvas text'): CanvasTextFragment {
  return {
    text,
    rect: { x: 10, y: 20, width: 50, height: 24 },
    paint: { ...BASE_PAINT, ...paint },
  };
}

function rubyFragment(paint: Partial<TextPaint>, text: string): CanvasRubyFragment {
  return textFragment(paint, text);
}

function borderEdge(widthPx: number, style: BorderStyle, color: string) {
  return { widthPx, paint: { color, style } };
}

function roundedBorderPaint(): Partial<TextPaint> {
  return {
    backgroundRadius: 7,
    border: {
      top: borderEdge(1, 'solid', '#111111'),
      end: borderEdge(2, 'dashed', '#222222'),
      bottom: borderEdge(3, 'dotted', '#333333'),
      start: borderEdge(4, 'solid', '#444444'),
    },
  };
}

function expectTextParity(
  fragment: CanvasTextFragment,
  override?: CanvasTextColorOverride,
): MockCanvasContext {
  const reference = createMockCanvasContext();
  const production = createMockCanvasContext();
  drawTextFragment(reference.ctx, fragment, override);
  drawCanvasTextFragment(production.ctx, fragment, override);
  expect(production.records).toEqual(reference.records);
  return production;
}

function expectRubyParity(
  fragment: CanvasRubyFragment,
  override?: CanvasTextColorOverride,
): MockCanvasContext {
  const reference = createMockCanvasContext();
  const production = createMockCanvasContext();
  drawRubyFragment(reference.ctx, fragment, override);
  drawCanvasRubyFragment(production.ctx, fragment, override);
  expect(production.records).toEqual(reference.records);
  return production;
}

function lastProperty(mock: MockCanvasContext, property: string): unknown {
  return mock.getPropertySets(property).at(-1)?.value;
}

function localFailureCases(): readonly {
  readonly name: string;
  readonly method: ThrowingMethod;
  readonly render: (ctx: CanvasRenderingContext2D) => void;
}[] {
  return [
    failureCase(
      'rounded background',
      'fill',
      textFragment({
        backgroundColor: '#ffffff',
        backgroundRadius: 4,
      }),
    ),
    failureCase('flat background', 'fillRect', textFragment({ backgroundColor: '#ffffff' })),
    failureCase(
      'straight border',
      'stroke',
      textFragment({
        border: { top: borderEdge(2, 'solid', '#000000') },
      }),
    ),
    failureCase('rounded border', 'clip', textFragment(roundedBorderPaint())),
    rubyFailureCase('ruby measurement', 'measureText'),
    rubyFailureCase('ruby glyph', 'fillText'),
  ];
}

function failureCase(name: string, method: ThrowingMethod, fragment: CanvasTextFragment) {
  return {
    name,
    method,
    render: (ctx: CanvasRenderingContext2D) => {
      drawCanvasTextFragment(ctx, fragment);
    },
  };
}

function rubyFailureCase(name: string, method: 'measureText' | 'fillText') {
  const fragment = rubyFragment({}, 'ruby');
  return {
    name,
    method,
    render: (ctx: CanvasRenderingContext2D) => {
      drawCanvasRubyFragment(ctx, fragment);
    },
  };
}

function contextThrowingOn(
  ctx: CanvasRenderingContext2D,
  method: ThrowingMethod,
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
