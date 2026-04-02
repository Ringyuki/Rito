import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '../../src/layout/config';

describe('createLayoutConfig', () => {
  it('creates config with uniform margin and defaults', () => {
    const config = createLayoutConfig({ width: 800, height: 1200, margin: 40 });
    expect(config).toEqual({
      pageWidth: 800,
      pageHeight: 1200,
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      spreadMode: 'single',
      firstPageAlone: true,
      spreadGap: 0,
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
    expect(config.marginRight).toBe(0);
    expect(config.marginBottom).toBe(0);
    expect(config.marginLeft).toBe(0);
  });

  it('sets pageWidth and pageHeight', () => {
    const config = createLayoutConfig({ width: 640, height: 480 });
    expect(config.pageWidth).toBe(640);
    expect(config.pageHeight).toBe(480);
  });

  it('accepts spread configuration', () => {
    const config = createLayoutConfig({
      width: 800,
      height: 1200,
      spread: 'double',
      firstPageAlone: false,
      spreadGap: 20,
    });
    expect(config.spreadMode).toBe('double');
    expect(config.firstPageAlone).toBe(false);
    expect(config.spreadGap).toBe(20);
  });

  it('defaults spread to single, firstPageAlone true, gap 0', () => {
    const config = createLayoutConfig({ width: 800, height: 1200 });
    expect(config.spreadMode).toBe('single');
    expect(config.firstPageAlone).toBe(true);
    expect(config.spreadGap).toBe(0);
  });
});
