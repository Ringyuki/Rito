/**
 * Phase 0 — Characterization test: selection coordinate spaces.
 *
 * Verifies that:
 * 1. SelectionEngine with zero-margin config works (current passing behavior)
 * 2. SelectionEngine with non-zero margins requires a synthetic content-config
 *    (the workaround that kit uses)
 * 3. Selection rects are in spread-content space, not viewport-logical
 */
import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from 'rito';
import type { Page, Spread, TextMeasurer } from 'rito';
import { createSelectionEngine } from 'rito/selection';
import type { LayoutBlock, LineBox, TextRun } from 'rito/advanced';
import { DEFAULT_STYLE } from 'rito/advanced';

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

describe('Selection engine coordinate behavior', () => {
  describe('zero-margin config (current test baseline)', () => {
    const config = createLayoutConfig({
      width: 300,
      height: 400,
      margin: 0,
      spread: 'single',
    });

    it('selection works because hitMap and config are in the same space', () => {
      const page = makePage([makeBlock([makeLine([makeRun('Hello world', 0)], 0)])], 0);
      const spread: Spread = { index: 0, left: page };
      const engine = createSelectionEngine();
      engine.setSpread(spread, config, measurer);

      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });

      expect(engine.getState()).toBe('selected');
      expect(engine.getRects().length).toBeGreaterThan(0);
    });
  });

  describe('non-zero margin config (needs synthetic content config)', () => {
    const MARGIN = 40;
    const realConfig = createLayoutConfig({
      width: 800,
      height: 600,
      margin: MARGIN,
      spread: 'single',
    });

    // HitMap entries are at page-content coordinates (no margins)
    // SelectionEngine uses config.pageWidth for boundary checks.
    // With real config, pageWidth includes margins, so the boundary check
    // allows clicks beyond the content area.

    it('synthetic content config makes selection work with non-zero margins', () => {
      const contentWidth = realConfig.pageWidth - realConfig.marginLeft - realConfig.marginRight;
      const contentHeight = realConfig.pageHeight - realConfig.marginTop - realConfig.marginBottom;
      const contentConfig = createLayoutConfig({
        width: contentWidth,
        height: contentHeight,
        spread: 'single',
      });

      const page = makePage([makeBlock([makeLine([makeRun('Hello world', 0)], 0)])], 0);
      const spread: Spread = { index: 0, left: page };
      const engine = createSelectionEngine();
      engine.setSpread(spread, contentConfig, measurer);

      // Pointer at content-area (0, 10) → should resolve to "Hello"
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });

      expect(engine.getState()).toBe('selected');
      expect(engine.getRects().length).toBeGreaterThan(0);
    });
  });

  describe('double mode selection rect offset', () => {
    it('right page selection rects are offset by pageWidth + spreadGap in spread-content space', () => {
      const config = createLayoutConfig({
        width: 640,
        height: 400,
        margin: 0,
        spread: 'double',
        spreadGap: 40,
      });

      const leftPage = makePage([makeBlock([makeLine([makeRun('Left page text', 0)], 0)])], 0);
      const rightPage = makePage([makeBlock([makeLine([makeRun('Right page text', 0)], 0)])], 1);
      const spread: Spread = { index: 0, left: leftPage, right: rightPage };
      const engine = createSelectionEngine();
      engine.setSpread(spread, config, measurer);

      // Select on the right page
      // Right page starts at pageWidth + spreadGap = 300 + 40 = 340
      engine.handlePointerDown({ x: 340, y: 10 });
      engine.handlePointerMove({ x: 400, y: 10 });
      engine.handlePointerUp({ x: 400, y: 10 });

      expect(engine.getState()).toBe('selected');
      const rects = engine.getRects();
      expect(rects.length).toBeGreaterThan(0);

      // Rects should be in spread-content space (offset by right page position)
      const firstRect = rects[0];
      expect(firstRect).toBeDefined();
      expect(firstRect?.x).toBeGreaterThanOrEqual(config.pageWidth + config.spreadGap);
    });
  });

  describe('focusRect caret semantics', () => {
    const config = createLayoutConfig({
      width: 300,
      height: 400,
      margin: 0,
      spread: 'single',
    });

    function setupEngine() {
      const page = makePage(
        [
          makeBlock([
            makeLine([makeRun('Hello world this is', 0)], 0),
            makeLine([makeRun('a second line here', 0)], 25),
          ]),
        ],
        0,
      );
      const spread: Spread = { index: 0, left: page };
      const engine = createSelectionEngine();
      engine.setSpread(spread, config, measurer);
      return engine;
    }

    it('forward selection: focus caret is at right edge of last rect', () => {
      const engine = setupEngine();
      // Select "Hello" (x:0 → x:50, 5 chars × 10px)
      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 50, y: 10 });
      engine.handlePointerUp({ x: 50, y: 10 });

      const rects = engine.getRects();
      const snap = engine.getSnapshot();
      expect(rects.length).toBeGreaterThan(0);
      expect(snap).toBeDefined();
      if (!snap || rects.length === 0) return;

      // Forward: anchor === start
      expect(snap.anchor).toBe(snap.start);
      const lastRect = rects[rects.length - 1];
      if (!lastRect) return;
      // The focus caret should be at the right edge
      const focusX = lastRect.x + lastRect.width;
      expect(focusX).toBeCloseTo(50, 0); // 5 chars × 10px
    });

    it('reverse selection: focus caret is at left edge of first rect', () => {
      const engine = setupEngine();
      // Reverse: drag from char 10 back to char 5
      engine.handlePointerDown({ x: 100, y: 10 }); // char 10
      engine.handlePointerMove({ x: 50, y: 10 }); // char 5
      engine.handlePointerUp({ x: 50, y: 10 });

      const rects = engine.getRects();
      const snap = engine.getSnapshot();
      expect(rects.length).toBeGreaterThan(0);
      expect(snap).toBeDefined();
      if (!snap || rects.length === 0) return;

      // Reverse: anchor === end (anchor was at char 10, which is later)
      expect(snap.anchor).toBe(snap.end);
      const firstRect = rects[0];
      if (!firstRect) return;
      // The focus caret should be at the left edge
      expect(firstRect.x).toBeCloseTo(50, 0); // char 5 × 10px
    });

    it('multi-line forward: focus caret at right edge of last line rect', () => {
      const engine = setupEngine();
      // Select from first line to middle of second line
      engine.handlePointerDown({ x: 0, y: 10 }); // line 0, char 0
      engine.handlePointerMove({ x: 60, y: 30 }); // line 1, char 6
      engine.handlePointerUp({ x: 60, y: 30 });

      const rects = engine.getRects();
      expect(rects.length).toBeGreaterThan(1); // should span 2 lines

      const snap = engine.getSnapshot();
      if (!snap) return;
      expect(snap.anchor).toBe(snap.start); // forward

      const lastRect = rects[rects.length - 1];
      if (!lastRect) return;
      // Focus caret on second line, right edge ≈ 60px
      expect(lastRect.x + lastRect.width).toBeCloseTo(60, 0);
    });

    it('multi-line reverse: focus caret at left edge of first line rect', () => {
      const engine = setupEngine();
      // Reverse: from second line back to first line
      engine.handlePointerDown({ x: 60, y: 30 }); // line 1, char 6
      engine.handlePointerMove({ x: 50, y: 10 }); // line 0, char 5
      engine.handlePointerUp({ x: 50, y: 10 });

      const rects = engine.getRects();
      expect(rects.length).toBeGreaterThan(1);

      const snap = engine.getSnapshot();
      if (!snap) return;
      expect(snap.anchor).toBe(snap.end); // reverse

      const firstRect = rects[0];
      if (!firstRect) return;
      // Focus caret on first line, left edge ≈ 50px
      expect(firstRect.x).toBeCloseTo(50, 0);
    });
  });

  describe('selection rects are in spread-content, NOT viewport-logical', () => {
    it('rects do not include margin offset', () => {
      const config = createLayoutConfig({
        width: 300,
        height: 400,
        margin: 0,
        spread: 'single',
      });

      const page = makePage([makeBlock([makeLine([makeRun('Hello', 0)], 0)])], 0);
      const spread: Spread = { index: 0, left: page };
      const engine = createSelectionEngine();
      engine.setSpread(spread, config, measurer);

      engine.handlePointerDown({ x: 0, y: 10 });
      engine.handlePointerMove({ x: 30, y: 10 });
      engine.handlePointerUp({ x: 30, y: 10 });

      const rects = engine.getRects();
      expect(rects.length).toBeGreaterThan(0);

      // In zero-margin case, spread-content === page-content === viewport-logical
      // Rect x should start at 0, not at some margin offset
      const firstRect = rects[0];
      expect(firstRect).toBeDefined();
      expect(firstRect?.x).toBe(0);
    });
  });
});
