import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '../../src/reader';

describe('reader createLayoutConfig', () => {
  it('creates the root reader layout contract without using the reference core entry', () => {
    expect(
      createLayoutConfig({
        width: 1600,
        height: 1000,
        margin: { x: 40, y: 50 },
        spread: 'double',
        spreadGap: 20,
      }),
    ).toEqual({
      viewportWidth: 1600,
      viewportHeight: 1000,
      pageWidth: 790,
      pageHeight: 1000,
      marginTop: 50,
      marginRight: 40,
      marginBottom: 50,
      marginLeft: 40,
      spreadMode: 'double',
      firstPageAlone: true,
      spreadGap: 20,
      rootFontSize: 16,
    });
  });

  it('preserves optional typography overrides only when provided', () => {
    const config = createLayoutConfig({
      width: 600,
      height: 900,
      lineHeightOverride: 1.7,
      lineHeightForce: true,
      fontFamilyOverride: 'serif',
      fontFamilyForce: true,
    });

    expect(config.spreadMode).toBe('single');
    expect(config.lineHeightOverride).toBe(1.7);
    expect(config.lineHeightForce).toBe(true);
    expect(config.fontFamilyOverride).toBe('serif');
    expect(config.fontFamilyForce).toBe(true);
  });

  it('keeps a scrolled reader scrolled in any orientation, a window as wide as the viewport', () => {
    for (const [width, height] of [
      [390, 844],
      [1500, 950],
    ] as const) {
      const config = createLayoutConfig({ width, height, spread: 'scrolled', spreadGap: 20 });
      expect(config.spreadMode).toBe('scrolled');
      expect(config.pageWidth).toBe(width);
    }
    // A portrait viewport holds one page a spread.
    expect(createLayoutConfig({ width: 390, height: 844, spread: 'double' }).spreadMode).toBe(
      'single',
    );
  });
});
