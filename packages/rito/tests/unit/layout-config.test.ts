import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '../../src/layout/config';

describe('createLayoutConfig', () => {
  it('creates config with uniform margin and defaults', () => {
    const config = createLayoutConfig({ width: 800, height: 1200, margin: 40 });
    expect(config).toEqual({
      viewportWidth: 800,
      viewportHeight: 1200,
      pageWidth: 800,
      pageHeight: 1200,
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      spreadMode: 'single',
      firstPageAlone: true,
      spreadGap: 0,
      rootFontSize: 16,
    });
  });

  it('creates config with x/y margins', () => {
    const config = createLayoutConfig({ width: 800, height: 1200, margin: { x: 40, y: 60 } });
    expect(config.marginTop).toBe(60);
    expect(config.marginBottom).toBe(60);
    expect(config.marginLeft).toBe(40);
    expect(config.marginRight).toBe(40);
  });

  it('creates config with individual margins', () => {
    const config = createLayoutConfig({
      width: 800,
      height: 1200,
      margin: { top: 10, right: 20, bottom: 30, left: 40 },
    });
    expect(config.marginTop).toBe(10);
    expect(config.marginRight).toBe(20);
    expect(config.marginBottom).toBe(30);
    expect(config.marginLeft).toBe(40);
  });

  it('defaults to zero margins when omitted', () => {
    const config = createLayoutConfig({ width: 800, height: 1200 });
    expect(config.marginTop).toBe(0);
  });

  it('single mode: page fills viewport', () => {
    const config = createLayoutConfig({ width: 800, height: 1200 });
    expect(config.pageWidth).toBe(800);
    expect(config.pageHeight).toBe(1200);
    expect(config.viewportWidth).toBe(800);
    expect(config.viewportHeight).toBe(1200);
  });

  it('double mode: page width = (viewport - gap) / 2', () => {
    // Landscape: width > height for double mode to take effect
    const config = createLayoutConfig({
      width: 1600,
      height: 1000,
      spread: 'double',
      spreadGap: 20,
    });
    expect(config.spreadMode).toBe('double');
    expect(config.pageWidth).toBe(790); // (1600 - 20) / 2
    expect(config.pageHeight).toBe(1000);
    expect(config.viewportWidth).toBe(1600);
  });

  it('portrait viewport forces single mode', () => {
    const config = createLayoutConfig({
      width: 600,
      height: 900,
      spread: 'double',
    });
    expect(config.spreadMode).toBe('single');
    expect(config.pageWidth).toBe(600);
  });

  it('square viewport allows double mode', () => {
    const config = createLayoutConfig({
      width: 1000,
      height: 1000,
      spread: 'double',
      spreadGap: 20,
    });
    expect(config.spreadMode).toBe('double');
    expect(config.pageWidth).toBe(490);
  });

  it('defaults spread to single, firstPageAlone true, gap 0', () => {
    const config = createLayoutConfig({ width: 800, height: 1200 });
    expect(config.spreadMode).toBe('single');
    expect(config.firstPageAlone).toBe(true);
    expect(config.spreadGap).toBe(0);
  });
});
