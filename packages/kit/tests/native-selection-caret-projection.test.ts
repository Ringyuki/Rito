import { describe, expect, it } from 'vitest';
import { projectNativeSelectionCaret } from '../src/interaction/selection/native-adapter-projection';
import type { NativeSelectionProjection } from '../src/interaction/selection/engine-types';

const shifted: NativeSelectionProjection = {
  spreadContentToPage: () => null,
  isPageVisible: (pageIndex) => pageIndex === 0,
  pageContentToSpread: (_, rect) => ({ ...rect, x: rect.x + 100, y: rect.y + 10 }),
};

describe('native selection caret projection', () => {
  it('keeps a caret on a horizontal line upright, with no width', () => {
    const caret = { pageIndex: 0, geometry: { x: 12, y: 30, width: 0, height: 18 } };
    expect(projectNativeSelectionCaret(shifted, caret)).toEqual({
      x: 112,
      y: 40,
      width: 0,
      height: 18,
    });
  });

  it('keeps a caret down a vertical line across its column, with no height', () => {
    const caret = { pageIndex: 0, geometry: { x: 340, y: 64, width: 23, height: 0 } };
    expect(projectNativeSelectionCaret(shifted, caret)).toEqual({
      x: 440,
      y: 74,
      width: 23,
      height: 0,
    });
  });

  it('projects no caret on a page the spread does not show', () => {
    const caret = { pageIndex: 1, geometry: { x: 340, y: 64, width: 23, height: 0 } };
    expect(projectNativeSelectionCaret(shifted, caret)).toBeNull();
  });
});
