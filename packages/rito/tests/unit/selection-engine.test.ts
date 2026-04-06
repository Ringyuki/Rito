import { describe, expect, it, vi } from 'vitest';
import { createSelectionEngine } from '../../src/interaction/selection';
import type {
  LayoutBlock,
  LayoutConfig,
  LineBox,
  Page,
  Spread,
  TextRun,
} from '../../src/layout/core/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

const style = { ...DEFAULT_STYLE, fontSize: 10 };

const measurer: TextMeasurer = {
  measureText: (text: string) => ({ width: text.length * 10, height: 20 }),
};

function makeRun(text: string, x: number): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    style,
  };
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[]): LayoutBlock {
  return { type: 'layout-block', bounds: { x: 0, y: 0, width: 300, height: 100 }, children: lines };
}

function makePage(blocks: LayoutBlock[], index: number): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: blocks };
}

const singleConfig: LayoutConfig = {
  viewportWidth: 300,
  viewportHeight: 400,
  pageWidth: 300,
  pageHeight: 400,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  spreadMode: 'single',
  firstPageAlone: false,
  spreadGap: 0,
  rootFontSize: 16,
};

const doubleConfig: LayoutConfig = {
  ...singleConfig,
  viewportWidth: 640,
  pageWidth: 300,
  spreadMode: 'double',
  spreadGap: 40,
};

function singleSpread(): Spread {
  const page = makePage(
    [
      makeBlock([
        makeLine([makeRun('Hello world', 0)], 0),
        makeLine([makeRun('Second line', 0)], 25),
      ]),
    ],
    0,
  );
  return { index: 0, left: page };
}

function doubleSpread(): Spread {
  const leftPage = makePage([makeBlock([makeLine([makeRun('Left page', 0)], 0)])], 0);
  const rightPage = makePage([makeBlock([makeLine([makeRun('Right page', 0)], 0)])], 1);
  return { index: 0, left: leftPage, right: rightPage };
}

describe('SelectionEngine', () => {
  describe('state machine', () => {
    it('starts in idle state', () => {
      const engine = createSelectionEngine();
      expect(engine.getState()).toBe('idle');
      expect(engine.getSelection()).toBeNull();
    });

    it('transitions to selecting on pointerDown', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 20, y: 10 });
      expect(engine.getState()).toBe('selecting');
    });

    it('transitions to selected on pointerUp after drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getState()).toBe('selected');
    });

    it('returns to idle on click without drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 20, y: 10 });
      engine.handlePointerUp({ x: 20, y: 10 });
      expect(engine.getState()).toBe('idle');
      expect(engine.getSelection()).toBeNull();
    });

    it('clears selection on new pointerDown after selected', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getState()).toBe('selected');

      engine.handlePointerDown({ x: 80, y: 10 });
      // The old selection was cleared, now selecting a new one
      expect(engine.getState()).toBe('selecting');
    });

    it('clear() resets to idle', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      engine.clear();
      expect(engine.getState()).toBe('idle');
      expect(engine.getSelection()).toBeNull();
      expect(engine.getRects()).toHaveLength(0);
    });
  });

  describe('selection data', () => {
    it('produces non-empty selection rects after drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getRects().length).toBeGreaterThan(0);
    });

    it('returns selected text', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      // Select "Hello" (chars 0-5, x: 0-50 with 10px/char)
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      const text = engine.getText();
      expect(text.length).toBeGreaterThan(0);
    });

    it('returns empty text when no selection', () => {
      const engine = createSelectionEngine();
      expect(engine.getText()).toBe('');
    });
  });

  describe('callbacks', () => {
    it('fires onSelectionChange during drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      const cb = vi.fn();
      engine.onSelectionChange(cb);

      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      expect(cb).toHaveBeenCalled();
    });

    it('fires onSelectionChange on clear', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });

      const cb = vi.fn();
      engine.onSelectionChange(cb);
      engine.clear();
      expect(cb).toHaveBeenCalledWith(null);
    });

    it('unsubscribe stops notifications', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      const cb = vi.fn();
      const unsub = engine.onSelectionChange(cb);
      unsub();

      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('setSpread', () => {
    it('clears selection when spread changes', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getState()).toBe('selected');

      engine.setSpread(singleSpread(), singleConfig, measurer);
      expect(engine.getState()).toBe('idle');
      expect(engine.getSelection()).toBeNull();
    });
  });

  describe('double spread', () => {
    it('selects text on left page', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 40, y: 10 });
      engine.handlePointerUp({ x: 40, y: 10 });
      expect(engine.getState()).toBe('selected');
      expect(engine.getRects().length).toBeGreaterThan(0);
    });

    it('selects text on right page', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      // Right page starts at pageWidth + gap = 300 + 40 = 340
      engine.handlePointerDown({ x: 340, y: 10 });
      engine.handlePointerMove({ x: 400, y: 10 });
      engine.handlePointerUp({ x: 400, y: 10 });
      expect(engine.getState()).toBe('selected');
      expect(engine.getRects().length).toBeGreaterThan(0);
    });

    it('ignores clicks in the spread gap', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      engine.handlePointerDown({ x: 320, y: 10 }); // in the gap (300-340)
      expect(engine.getState()).toBe('idle');
    });

    it('returns text for a cross-page selection', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 400, y: 10 });
      engine.handlePointerUp({ x: 400, y: 10 });
      expect(engine.getState()).toBe('selected');
      expect(engine.getText()).toBe('Left pageRight ');
    });
  });

  describe('reverse selection (regression)', () => {
    it('getSelection() returns normalized range for reverse same-line drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 100, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      const range = engine.getSelection();
      expect(range).toBeDefined();
      if (range) expect(range.start.charIndex).toBeLessThanOrEqual(range.end.charIndex);
    });

    it('getSelection() returns normalized range for reverse multi-line drag', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 50, y: 30 });
      engine.handlePointerMove({ x: 20, y: 10 });
      engine.handlePointerUp({ x: 20, y: 10 });
      const range = engine.getSelection();
      expect(range).toBeDefined();
      if (range) expect(range.start.lineIndex).toBeLessThanOrEqual(range.end.lineIndex);
    });

    it('getRects() produces rects for reverse selection', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 100, y: 10 });
      engine.handlePointerMove({ x: 0, y: 10 });
      engine.handlePointerUp({ x: 0, y: 10 });
      expect(engine.getRects().length).toBeGreaterThan(0);
    });

    it('getText() returns correct text for reverse selection', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 50, y: 10 });
      engine.handlePointerMove({ x: 0, y: 10 });
      engine.handlePointerUp({ x: 0, y: 10 });
      expect(engine.getText()).toBe('Hello');
    });
  });

  describe('SelectionSnapshot', () => {
    it('getSnapshot() returns null when no selection', () => {
      const engine = createSelectionEngine();
      expect(engine.getSnapshot()).toBeNull();
    });

    it('forward selection: anchor === start, focus === end', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      const snap = engine.getSnapshot();
      expect(snap).toBeDefined();
      if (snap) {
        expect(snap.anchor).toBe(snap.start);
        expect(snap.focus).toBe(snap.end);
      }
    });

    it('reverse selection: anchor === end, focus === start', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 50, y: 10 });
      engine.handlePointerMove({ x: 0, y: 10 });
      engine.handlePointerUp({ x: 0, y: 10 });
      const snap = engine.getSnapshot();
      expect(snap).toBeDefined();
      if (snap) {
        expect(snap.anchor).toBe(snap.end);
        expect(snap.focus).toBe(snap.start);
      }
    });

    it('cross-page selection: start on earlier page, end on later page', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 400, y: 10 });
      engine.handlePointerUp({ x: 400, y: 10 });
      const snap = engine.getSnapshot();
      expect(snap).toBeDefined();
      if (snap) expect(snap.start.pageIndex).toBeLessThan(snap.end.pageIndex);
    });

    it('reverse cross-page selection: anchor on later page, focus on earlier', () => {
      const engine = createSelectionEngine();
      engine.setSpread(doubleSpread(), doubleConfig, measurer);
      engine.handlePointerDown({ x: 400, y: 10 });
      engine.handlePointerMove({ x: 0, y: 10 });
      engine.handlePointerUp({ x: 0, y: 10 });
      const snap = engine.getSnapshot();
      expect(snap).toBeDefined();
      if (snap) {
        expect(snap.start.pageIndex).toBeLessThan(snap.end.pageIndex);
        expect(snap.anchor.pageIndex).toBeGreaterThan(snap.focus.pageIndex);
      }
    });

    it('snapshot cleared after clear()', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getSnapshot()).not.toBeNull();
      engine.clear();
      expect(engine.getSnapshot()).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('ignores pointer events before setSpread', () => {
      const engine = createSelectionEngine();
      engine.handlePointerDown({ x: 20, y: 10 });
      expect(engine.getState()).toBe('idle');
    });

    it('ignores pointerMove when not selecting', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerMove({ x: 50, y: 10 });
      expect(engine.getState()).toBe('idle');
    });

    it('ignores pointerUp when not selecting', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerUp({ x: 50, y: 10 });
      expect(engine.getState()).toBe('idle');
    });

    it('ignores click outside page bounds', () => {
      const engine = createSelectionEngine();
      engine.setSpread(singleSpread(), singleConfig, measurer);
      engine.handlePointerDown({ x: 500, y: 10 });
      expect(engine.getState()).toBe('idle');
    });
  });
});
