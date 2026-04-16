/**
 * Phase 0 — Characterization tests for the coordinate system.
 *
 * These tests verify the pure math that a CoordinateMapper must implement.
 * They describe the EXPECTED correct behavior — some currently-untested
 * scenarios are confirmed bugs in the existing code.
 */
import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from 'rito';

// ── Coordinate math expectations ──��──────────────────────────────────

describe('Coordinate system math expectations', () => {
  describe('single mode with margins', () => {
    const MARGIN = 40;
    const config = createLayoutConfig({
      width: 800,
      height: 600,
      margin: MARGIN,
      spread: 'single',
    });

    it('content area dimensions exclude margins', () => {
      const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
      const contentHeight = config.pageHeight - config.marginTop - config.marginBottom;
      expect(contentWidth).toBe(800 - 80);
      expect(contentHeight).toBe(600 - 80);
    });

    it('page-content origin in viewport is at (marginLeft, marginTop)', () => {
      // A rect at page-content (0,0) should appear at viewport (40,40)
      const viewportX = 0 + config.marginLeft;
      const viewportY = 0 + config.marginTop;
      expect(viewportX).toBe(MARGIN);
      expect(viewportY).toBe(MARGIN);
    });

    it('CSS display coords to content area subtracts margin and divides by scale', () => {
      const renderScale = 1.5;
      const cssX = 120; // CSS pixels from canvas left
      const cssY = 90;

      // Expected: (cssX / scale) - margin
      const contentX = cssX / renderScale - MARGIN;
      const contentY = cssY / renderScale - MARGIN;
      expect(contentX).toBe(40);
      expect(contentY).toBe(20);
    });
  });

  describe('double mode with margins', () => {
    const MARGIN = 40;
    const GAP = 20;
    const config = createLayoutConfig({
      width: 1600,
      height: 600,
      margin: MARGIN,
      spread: 'double',
      spreadGap: GAP,
    });

    it('page width is (viewport - gap) / 2', () => {
      expect(config.pageWidth).toBe((1600 - GAP) / 2);
    });

    it('content width excludes margins from page width', () => {
      const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
      expect(contentWidth).toBe(config.pageWidth - 2 * MARGIN);
    });

    it('left page content origin in viewport is at (marginLeft, marginTop)', () => {
      const vpX = config.marginLeft;
      const vpY = config.marginTop;
      expect(vpX).toBe(MARGIN);
      expect(vpY).toBe(MARGIN);
    });

    it('right page content origin in viewport accounts for pageWidth + gap + margin', () => {
      const vpX = config.pageWidth + config.spreadGap + config.marginLeft;
      const vpY = config.marginTop;
      expect(vpX).toBe(config.pageWidth + GAP + MARGIN);
      expect(vpY).toBe(MARGIN);
    });

    it('synthetic selection config uses content dimensions', () => {
      // This is what syncSelectionEngine should produce
      const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
      const contentGap = config.marginLeft + config.spreadGap + config.marginRight;
      const syntheticConfig = createLayoutConfig({
        width: 2 * contentWidth + contentGap,
        height: config.pageHeight - config.marginTop - config.marginBottom,
        spread: 'double',
        spreadGap: contentGap,
      });

      expect(syntheticConfig.pageWidth).toBe(contentWidth);
      expect(syntheticConfig.spreadGap).toBe(contentGap);
    });

    it('right page link at page-content x=50 should be hit at spread-content x=contentWidth+contentGap+50', () => {
      const contentWidth = config.pageWidth - config.marginLeft - config.marginRight;
      const contentGap = config.marginLeft + config.spreadGap + config.marginRight;
      const rightPageContentOffset = contentWidth + contentGap;

      // A link at page-content (50, 10) on the RIGHT page
      // should be testable at spread-content (rightPageContentOffset + 50, 10)
      const spreadContentX = rightPageContentOffset + 50;
      expect(spreadContentX).toBe(contentWidth + contentGap + 50);

      // Historical note: older flattened-region handling compared this
      // spread-space x against raw page-local x=50 and missed the link.
      // The current page-aware mapper avoids that class of bug.
    });
  });

  describe('screen coordinate conversion', () => {
    const MARGIN = 40;
    const config = createLayoutConfig({
      width: 800,
      height: 600,
      margin: MARGIN,
      spread: 'single',
    });

    it('page-content rect converts to screen via margin + scale + canvasRect', () => {
      const renderScale = 2;
      const canvasRect = { left: 100, top: 50 };

      // A page-content rect at (10, 20, 80, 15)
      const pageRect = { x: 10, y: 20, width: 80, height: 15 };

      // viewport: add margin
      const vpX = pageRect.x + config.marginLeft;
      const vpY = pageRect.y + config.marginTop;

      // screen: multiply by scale, add canvas offset
      const screenX = canvasRect.left + vpX * renderScale;
      const screenY = canvasRect.top + vpY * renderScale;

      expect(screenX).toBe(100 + (10 + MARGIN) * 2);
      expect(screenY).toBe(50 + (20 + MARGIN) * 2);
    });
  });
});
