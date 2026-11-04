import { describe, expect, it } from 'vitest';
import type { ReaderScrollLayout } from '@ritojs/core';
import { createScrollGeometry, type ScrollWindow } from '../src/scroll/geometry';

function at(windows: readonly ScrollWindow[], index: number): ScrollWindow {
  const window = windows[index];
  if (window === undefined) throw new Error(`no window ${String(index)}`);
  return window;
}

const LAYOUT: ReaderScrollLayout = {
  axis: 'down',
  windowLength: 950,
  chapters: [
    { firstSpread: 0, spreadCount: 1, extent: 300.5 },
    { firstSpread: 1, spreadCount: 4, extent: 3_401.25 },
    { firstSpread: 5, spreadCount: 2, extent: 1_900 },
  ],
};

describe('scroll geometry', () => {
  it('tiles each chapter by the engine rule and the chapters end to end', () => {
    for (const ratio of [1, 1.25, 1.5, 2, 2.625, 3]) {
      const geometry = createScrollGeometry(LAYOUT, ratio);
      const { windows } = geometry;
      expect(windows.map((window) => window.spreadIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      for (let index = 1; index < windows.length; index += 1) {
        const before = at(windows, index - 1);
        expect(at(windows, index).start).toBe(before.start + before.length);
      }
      // A chapter's second window starts D(1) into it, the engine's row.
      const second = Math.floor(ratio * 300.5 + 0.5);
      expect(at(windows, 2).start - at(windows, 1).start).toBe(Math.floor(950 * ratio + 0.5));
      expect(at(windows, 1).start).toBe(second);
      expect(geometry.extent).toBe(
        Math.floor(300.5 * ratio + 0.5) +
          Math.floor(3_401.25 * ratio + 0.5) +
          Math.floor(1_900 * ratio + 0.5),
      );
      for (const window of windows) expect(Number.isInteger(window.start)).toBe(true);
    }
  });

  it('finds the window under an offset and the windows a viewport shows', () => {
    const geometry = createScrollGeometry(LAYOUT, 1);
    expect(geometry.windowAt(0)?.spreadIndex).toBe(0);
    expect(geometry.windowAt(299)?.spreadIndex).toBe(0);
    expect(geometry.windowAt(301)?.spreadIndex).toBe(1);
    expect(geometry.windowAt(-50)?.spreadIndex).toBe(0);
    expect(geometry.windowAt(1e9)?.spreadIndex).toBe(6);
    // The cover's 301 rows, then chapter one's windows from row 301.
    expect(geometry.visible(200, 950).map((window) => window.spreadIndex)).toEqual([0, 1]);
    expect(geometry.visible(200, 1_100).map((window) => window.spreadIndex)).toEqual([0, 1, 2]);
    expect(geometry.visible(301, 950).map((window) => window.spreadIndex)).toEqual([1]);
  });
});
