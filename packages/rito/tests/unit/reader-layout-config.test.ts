import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '../../src';

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

  it('preserves optional typography and pagination overrides only when provided', () => {
    const config = createLayoutConfig({
      width: 600,
      height: 900,
      lineHeightOverride: 1.7,
      lineHeightForce: true,
      fontFamilyOverride: 'serif',
      fontFamilyForce: true,
      paginationPolicy: { enabled: true, defaultOrphans: 2, defaultWidows: 3 },
    });

    expect(config.spreadMode).toBe('single');
    expect(config.lineHeightOverride).toBe(1.7);
    expect(config.lineHeightForce).toBe(true);
    expect(config.fontFamilyOverride).toBe('serif');
    expect(config.fontFamilyForce).toBe(true);
    expect(config.paginationPolicy).toEqual({
      enabled: true,
      defaultOrphans: 2,
      defaultWidows: 3,
    });
  });
});
