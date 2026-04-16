/**
 * Unit tests for CoordinateMapper — pure coordinate math.
 */
import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '@ritojs/core';
import type { Page, Spread } from '@ritojs/core';
import { createCoordinateMapper } from '../src/controller/geometry/coordinate-mapper';

function makePage(index: number): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: [] };
}

describe('CoordinateMapper', () => {
  describe('single mode, margin=40, renderScale=1', () => {
    const config = createLayoutConfig({ width: 800, height: 600, margin: 40, spread: 'single' });
    const spread: Spread = { index: 0, left: makePage(0) };
    const mapper = createCoordinateMapper(config, spread, 1);

    it('exposes layout geometry', () => {
      expect(mapper.layout.marginLeft).toBe(40);
      expect(mapper.layout.marginTop).toBe(40);
      expect(mapper.layout.spreadMode).toBe('single');
    });

    it('getPage returns single page geometry', () => {
      const pg = mapper.getPage(0);
      expect(pg).toBeDefined();
      expect(pg?.side).toBe('single');
      expect(pg?.contentOriginX).toBe(40);
      expect(pg?.contentOriginY).toBe(40);
      expect(pg?.contentWidth).toBe(800 - 80);
      expect(pg?.spreadContentOriginX).toBe(0);
    });

    it('cssToSpreadContent subtracts margin (scale=1)', () => {
      const p = mapper.cssToSpreadContent(80, 60);
      expect(p.x).toBe(40);
      expect(p.y).toBe(20);
    });

    it('spreadContentToPage maps to page 0', () => {
      const p = mapper.spreadContentToPage(40, 20);
      expect(p).not.toBeNull();
      expect(p?.pageIndex).toBe(0);
      expect(p?.x).toBe(40);
    });

    it('spreadContentToPage returns null for out-of-bounds', () => {
      expect(mapper.spreadContentToPage(-5, 0)).toBeNull();
      expect(mapper.spreadContentToPage(800, 0)).toBeNull();
    });

    it('pageContentToViewport adds margin', () => {
      const vp = mapper.pageContentToViewport(0, { x: 10, y: 20, width: 50, height: 15 });
      expect(vp.x).toBe(50);
      expect(vp.y).toBe(60);
      expect(vp.width).toBe(50);
      expect(vp.height).toBe(15);
    });

    it('viewportToDisplay is identity at scale=1', () => {
      const d = mapper.viewportToDisplay({ x: 50, y: 60, width: 50, height: 15 });
      expect(d).toEqual({ x: 50, y: 60, width: 50, height: 15 });
    });

    it('pageContentToScreen composes margin + canvasRect', () => {
      const s = mapper.pageContentToScreen(
        0,
        { x: 10, y: 20, width: 50, height: 15 },
        { left: 100, top: 50 },
      );
      expect(s.x).toBe(100 + 50);
      expect(s.y).toBe(50 + 60);
    });

    it('selectionConfig has contentWidth as pageWidth (no margins)', () => {
      expect(mapper.selectionConfig.pageWidth).toBe(800 - 80);
      expect(mapper.selectionConfig.marginLeft).toBe(0);
      expect(mapper.selectionConfig.marginRight).toBe(0);
    });
  });

  describe('single mode, margin=40, renderScale=1.5', () => {
    const config = createLayoutConfig({ width: 800, height: 600, margin: 40, spread: 'single' });
    const spread: Spread = { index: 0, left: makePage(0) };
    const mapper = createCoordinateMapper(config, spread, 1.5);

    it('cssToSpreadContent divides by scale then subtracts margin', () => {
      const p = mapper.cssToSpreadContent(120, 90);
      expect(p.x).toBe(40);
      expect(p.y).toBe(20);
    });

    it('viewportToDisplay multiplies by scale', () => {
      const d = mapper.viewportToDisplay({ x: 50, y: 60, width: 50, height: 15 });
      expect(d.x).toBe(75);
      expect(d.y).toBe(90);
      expect(d.width).toBe(75);
      expect(d.height).toBe(22.5);
    });

    it('pageContentToScreen uses scale', () => {
      const s = mapper.pageContentToScreen(
        0,
        { x: 10, y: 20, width: 50, height: 15 },
        { left: 100, top: 50 },
      );
      expect(s.x).toBe(100 + 50 * 1.5);
      expect(s.y).toBe(50 + 60 * 1.5);
    });
  });

  describe('double mode, margin=40, gap=20, renderScale=1', () => {
    const config = createLayoutConfig({
      width: 1600,
      height: 600,
      margin: 40,
      spread: 'double',
      spreadGap: 20,
    });
    const spread: Spread = { index: 0, left: makePage(0), right: makePage(1) };
    const mapper = createCoordinateMapper(config, spread, 1);

    const pageWidth = (1600 - 20) / 2; // 790
    const contentWidth = pageWidth - 80; // 710
    const contentGap = 40 + 20 + 40; // 100

    it('pageWidth and contentWidth are correct', () => {
      expect(config.pageWidth).toBe(pageWidth);
      expect(mapper.getPage(0)?.contentWidth).toBe(contentWidth);
    });

    it('left page geometry', () => {
      const pg = mapper.getPage(0);
      expect(pg?.side).toBe('left');
      expect(pg?.contentOriginX).toBe(40);
      expect(pg?.contentOriginY).toBe(40);
      expect(pg?.spreadContentOriginX).toBe(0);
    });

    it('right page geometry', () => {
      const pg = mapper.getPage(1);
      expect(pg?.side).toBe('right');
      expect(pg?.contentOriginX).toBe(pageWidth + 20 + 40);
      expect(pg?.contentOriginY).toBe(40);
      expect(pg?.spreadContentOriginX).toBe(contentWidth + contentGap);
    });

    it('cssToSpreadContent for left page area', () => {
      const p = mapper.cssToSpreadContent(80, 60);
      expect(p.x).toBe(40);
      expect(p.y).toBe(20);
    });

    it('spreadContentToPage resolves left page', () => {
      const p = mapper.spreadContentToPage(40, 20);
      expect(p).not.toBeNull();
      expect(p?.pageIndex).toBe(0);
      expect(p?.x).toBe(40);
    });

    it('spreadContentToPage resolves right page', () => {
      const rightOffset = contentWidth + contentGap;
      const p = mapper.spreadContentToPage(rightOffset + 50, 20);
      expect(p).not.toBeNull();
      expect(p?.pageIndex).toBe(1);
      expect(p?.x).toBe(50);
    });

    it('spreadContentToPage returns null for gap region', () => {
      const p = mapper.spreadContentToPage(contentWidth + 10, 20);
      expect(p).toBeNull();
    });

    it('pageContentToViewport for right page', () => {
      const vp = mapper.pageContentToViewport(1, { x: 10, y: 20, width: 50, height: 15 });
      expect(vp.x).toBe(10 + pageWidth + 20 + 40);
      expect(vp.y).toBe(60);
    });

    it('selectionConfig uses content dimensions', () => {
      expect(mapper.selectionConfig.pageWidth).toBe(contentWidth);
      expect(mapper.selectionConfig.spreadGap).toBe(contentGap);
      expect(mapper.selectionConfig.spreadMode).toBe('double');
    });

    it('right page link at page-content (50,10) can be found via spreadContentToPage', () => {
      const rightOffset = contentWidth + contentGap;
      const result = mapper.spreadContentToPage(rightOffset + 50, 10);
      expect(result).not.toBeNull();
      expect(result?.pageIndex).toBe(1);
      expect(result?.x).toBe(50);
    });
  });
});
