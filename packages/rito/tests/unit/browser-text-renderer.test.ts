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
import { createMockCanvasContext, type MockCanvasContext } from '../helpers/mock-canvas-context';

type TextPaint = CanvasTextFragment['paint'];

const COLOR_OVERRIDE = { foregroundColor: '#101010', backgroundColor: '#ffffff' } as const;
const BASE_PAINT = {
  color: '#223344',
  font: { style: 'normal', weight: 400, sizePx: 16, family: 'serif' },
} as const satisfies TextPaint;
// The engine's origins for 'Canvas text' in a 16px run at (10, 20): the
// word, the space and the word, each on the em-box baseline 20 + 0.8·16.
const CLUSTERS = [
  { byte: 0, x: 10, y: 32.8 },
  { byte: 6, x: 60, y: 32.8 },
  { byte: 7, x: 64, y: 32.8 },
] as const;

afterEach(() => vi.unstubAllGlobals());

describe('production Canvas text renderer', () => {
  it.each([
    {
      name: 'plain defaults',
      paint: {},
      font: '16px serif',
    },
    {
      name: 'styled font with explicit spacing',
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
    },
  ])('sets the font shorthand and draws with spacing off for $name', (testCase) => {
    const result = drawText(textFragment(testCase.paint));
    expect(lastProperty(result, 'font')).toBe(testCase.font);
    // Every spacing is already in the origins the engine sent; the pen
    // never spends a share of its own.
    expect(lastProperty(result, 'wordSpacing')).toBe('0px');
    expect(lastProperty(result, 'letterSpacing')).toBe('0px');
    expect(lastProperty(result, 'textBaseline')).toBe('alphabetic');
  });

  // Unreadable chromatic ink relights along lightness only (R3): yellow
  // keeps its hue at the foreground's lightness instead of snapping.
  it.each([
    { name: 'hex', color: '#ffff00', expected: 'rgb(32, 32, 0)' },
    { name: 'rgb', color: 'rgb(255, 255, 0)', expected: 'rgb(32, 32, 0)' },
    { name: 'hsl', color: 'hsl(60 100% 50%)', expected: 'rgb(32, 32, 0)' },
    { name: 'named', color: 'yellow', expected: 'rgb(32, 32, 0)' },
    { name: 'unparseable', color: 'currentColor', expected: 'currentColor' },
  ])('relights $name ink under a color override', ({ color, expected }) => {
    const result = drawText(textFragment({ color }), COLOR_OVERRIDE);
    expect(lastProperty(result, 'fillStyle')).toBe(expected);
  });

  it('draws every cluster at the origin the engine placed it at', () => {
    const result = drawText(textFragment());
    expect(result.getCalls('fillText').map((call) => call.args)).toEqual([
      ['Canvas', 10, 32.8],
      [' ', 60, 32.8],
      ['text', 64, 32.8],
    ]);
    expect(result.getCalls('measureText')).toHaveLength(0);
  });

  it('draws a run that arrives without origins as one string at its rect start', () => {
    const { clusters: _clusters, ...fragment } = textFragment();
    const result = drawText(fragment);
    expect(result.getCalls('fillText').map((call) => call.args)).toEqual([
      ['Canvas text', 10, 32.8],
    ]);
  });

  it('paints text shadows cluster by cluster when Node has no scratch canvas', () => {
    vi.stubGlobal('OffscreenCanvas', undefined);
    vi.stubGlobal('document', undefined);
    const result = drawText(
      textFragment({
        textShadow: [
          { offsetX: 2, offsetY: 3, blur: 4, color: '#000000' },
          { offsetX: -1, offsetY: 1, blur: 0, color: '#445566' },
        ],
      }),
    );

    expect(result.getCalls('getTransform')).toHaveLength(1);
    expect(result.getCalls('drawImage')).toHaveLength(0);
    expect(result.getCalls('fillText')).toHaveLength(3);
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
        { byte: 0, x: 19.5, y: 20 },
        { byte: 3, x: 38.5, y: 20 },
      ],
    };
    const result = drawRuby(ruby, COLOR_OVERRIDE);
    // The engine distributed the annotation (here the space-around
    // shares over a 50px base) and placed its line; the pen draws each
    // cluster at its origin, its alphabetic baseline, with its own
    // spacing off — exactly as a text run.
    expect(result.getCalls('fillText').map((call) => call.args)).toEqual([
      ['か', 19.5, 20],
      ['な', 38.5, 20],
    ]);
    expect(result.getCalls('measureText')).toHaveLength(0);
    expect(lastProperty(result, 'wordSpacing')).toBe('0px');
    expect(lastProperty(result, 'letterSpacing')).toBe('0px');
    expect(lastProperty(result, 'textBaseline')).toBe('alphabetic');
    expect(lastProperty(result, 'fillStyle')).toBe('rgb(32, 32, 0)');
  });

  it('draws an annotation that arrives without origins as one string at the box start', () => {
    const result = drawRuby(
      rubyFragment(
        {
          font: { style: 'normal', weight: 400, sizePx: 10, family: 'serif' },
        },
        'rt',
      ),
    );
    // Its baseline 0.8 em below the rect's top, like a text run's.
    expect(result.getCalls('fillText').map((call) => call.args)).toEqual([['rt', 10, 28]]);
    expect(result.getCalls('measureText')).toHaveLength(0);
  });

  it('balances local Canvas state when fillText throws in the ruby pen', () => {
    const mock = createMockCanvasContext();
    const ctx = contextThrowingOn(mock.ctx, 'fillText');
    expect(() => {
      drawCanvasRubyFragment(ctx, rubyFragment({}, 'ruby'));
    }).toThrow('forced fillText failure');
    expect(mock.getCalls('save').length).toBeGreaterThan(0);
    expect(mock.getCalls('restore')).toHaveLength(mock.getCalls('save').length);
  });
});

function textFragment(paint: Partial<TextPaint> = {}, text = 'Canvas text'): CanvasTextFragment {
  return {
    text,
    rect: { x: 10, y: 20, width: 50, height: 24 },
    paint: { ...BASE_PAINT, ...paint },
    clusters: CLUSTERS,
  };
}

function rubyFragment(paint: Partial<TextPaint>, text: string): CanvasRubyFragment {
  return {
    text,
    rect: { x: 10, y: 20, width: 50, height: 24 },
    paint: { ...BASE_PAINT, ...paint },
  };
}

function drawText(
  fragment: CanvasTextFragment,
  override?: CanvasTextColorOverride,
): MockCanvasContext {
  const production = createMockCanvasContext();
  drawCanvasTextFragment(production.ctx, fragment, override);
  return production;
}

function drawRuby(
  fragment: CanvasRubyFragment,
  override?: CanvasTextColorOverride,
): MockCanvasContext {
  const production = createMockCanvasContext();
  drawCanvasRubyFragment(production.ctx, fragment, override);
  return production;
}

function lastProperty(mock: MockCanvasContext, property: string): unknown {
  return mock.getPropertySets(property).at(-1)?.value;
}

function contextThrowingOn(
  ctx: CanvasRenderingContext2D,
  method: 'measureText' | 'fillText',
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
