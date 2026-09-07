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
type ThrowingMethod = 'measureText' | 'fillText';

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

  it('keeps the whole-run fillText for runs holding non-CJK glyphs', () => {
    // Latin words kern; per-glyph measurement would misplace them, so a
    // mixed run stays on the whole-run path even at a fractional size
    // (measured: a Trial-and-Error title line grew a 674px band under
    // the unconditional per-glyph pen).
    const result = expectTextParity(
      textFragment({ font: { ...BASE_PAINT.font, sizePx: 12.16 } }, 'Trial'),
    );
    expect(result.getCalls('fillText')).toHaveLength(1);
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

  it('draws an annotation at its engine-placed cluster origins with a color override', () => {
    const ruby = {
      ...rubyFragment(
        {
          color: 'yellow',
          font: { style: 'italic', weight: 700, sizePx: 10, family: 'sans-serif' },
          wordSpacingPx: 12,
          letterSpacingPx: 4,
        },
        'かな',
      ),
      clusters: [
        { byte: 0, x: 19.5 },
        { byte: 3, x: 38.5 },
      ],
    };
    const result = expectRubyParity(ruby, COLOR_OVERRIDE);
    // The engine distributed the annotation (here the space-around
    // shares over a 50px base); the pen draws each cluster at its origin
    // from the box top with its own spacing off.
    expect(result.getCalls('fillText').map((call) => call.args)).toEqual([
      ['か', 19.5, 20],
      ['な', 38.5, 20],
    ]);
    expect(result.getCalls('measureText')).toHaveLength(0);
    expect(lastProperty(result, 'wordSpacing')).toBe('0px');
    expect(lastProperty(result, 'letterSpacing')).toBe('0px');
    expect(lastProperty(result, 'textBaseline')).toBe('top');
    expect(lastProperty(result, 'fillStyle')).toBe('rgb(32, 32, 0)');
  });

  it('draws an annotation that arrives without origins packed and centered', () => {
    const ruby = rubyFragment(
      {
        font: { style: 'normal', weight: 400, sizePx: 10, family: 'serif' },
      },
      'rt',
    );
    const result = expectRubyParity(ruby);
    // 12px of 'rt' over the 50px box: 19px at each side.
    expect(result.getCalls('fillText')[0]?.args).toEqual(['rt', 29, 20]);
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
  // Inline backgrounds and borders are the engine's primitives now; the
  // ruby painter is the one path left that saves canvas state around its
  // measurement and glyph calls.
  return [
    rubyFailureCase('ruby measurement', 'measureText'),
    rubyFailureCase('ruby glyph', 'fillText'),
  ];
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
