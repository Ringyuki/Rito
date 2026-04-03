import { describe, expect, it } from 'vitest';
import { render, getSpreadDimensions } from '../../src/render/spread-renderer';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { createLayoutConfig } from '../../src/layout/config';
import type { Page, Spread } from '../../src/layout/types';

const SINGLE = createLayoutConfig({ width: 400, height: 600, margin: 20 });
const DOUBLE = createLayoutConfig({
  width: 820,
  height: 600,
  margin: 20,
  spread: 'double',
  spreadGap: 20,
});

function makePage(index: number): Page {
  return { index, bounds: { x: 0, y: 0, width: 400, height: 600 }, content: [] };
}

describe('render', () => {
  it('renders single-page spread', () => {
    const mock = createMockCanvasContext();
    const spread: Spread = { index: 0, left: makePage(0) };
    render(spread, mock.ctx, SINGLE, { backgroundColor: '#fff' });

    const saves = mock.getCalls('save');
    expect(saves.length).toBeGreaterThanOrEqual(1);
  });

  it('renders double-page spread with two pages', () => {
    const mock = createMockCanvasContext();
    const spread: Spread = { index: 0, left: makePage(0), right: makePage(1) };
    render(spread, mock.ctx, DOUBLE, { backgroundColor: '#fff' });

    const translates = mock.getCalls('translate');
    expect(translates).toHaveLength(2);
    expect(translates[0]?.args[0]).toBe(0);
    // Right page at x = pageWidth + gap = 420
    expect(translates[1]?.args[0]).toBe(420);
  });

  it('renders double spread with only left page', () => {
    const mock = createMockCanvasContext();
    const spread: Spread = { index: 0, left: makePage(0) };
    render(spread, mock.ctx, DOUBLE);

    const translates = mock.getCalls('translate');
    expect(translates).toHaveLength(1);
    expect(translates[0]?.args[0]).toBe(0);
  });

  it('applies pixelRatio to right page offset', () => {
    const mock = createMockCanvasContext();
    const spread: Spread = { index: 0, left: makePage(0), right: makePage(1) };
    render(spread, mock.ctx, DOUBLE, { pixelRatio: 2 });

    const translates = mock.getCalls('translate');
    expect(translates).toHaveLength(2);
    // (400+20)*2 = 840
    expect(translates[1]?.args[0]).toBe(840);
  });
});

describe('getSpreadDimensions', () => {
  it('single mode: page dimensions', () => {
    expect(getSpreadDimensions(SINGLE)).toEqual({ width: 400, height: 600 });
  });

  it('double mode: 2x width + gap', () => {
    expect(getSpreadDimensions(DOUBLE)).toEqual({ width: 820, height: 600 });
  });

  it('respects pixelRatio', () => {
    expect(getSpreadDimensions(DOUBLE, 2)).toEqual({ width: 1640, height: 1200 });
  });

  it('single mode with pixelRatio', () => {
    expect(getSpreadDimensions(SINGLE, 2)).toEqual({ width: 800, height: 1200 });
  });
});
