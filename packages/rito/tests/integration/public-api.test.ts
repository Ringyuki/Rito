import { describe, expect, it } from 'vitest';

/**
 * Integration test scaffold.
 * Validates that the public API surface exports the expected symbols.
 * This will grow as actual parsing/layout/render logic is implemented.
 */
describe('public API surface', () => {
  it('exports parser types', async () => {
    const api = await import('../../src/index.js');
    expect(api.NODE_TYPES).toBeDefined();
    expect(api.NODE_TYPES.Block).toBe('block');
    expect(api.NODE_TYPES.Inline).toBe('inline');
    expect(api.NODE_TYPES.Text).toBe('text');
  });

  it('exports style constants and defaults', async () => {
    const api = await import('../../src/index.js');
    expect(api.DEFAULT_STYLE).toBeDefined();
    expect(api.FONT_WEIGHTS).toBeDefined();
    expect(api.FONT_STYLES).toBeDefined();
    expect(api.TEXT_ALIGNMENTS).toBeDefined();
  });

  it('default style has correct shape', async () => {
    const { DEFAULT_STYLE } = await import('../../src/index.js');
    expect(DEFAULT_STYLE).toEqual({
      fontFamily: 'serif',
      fontSize: 16,
      fontWeight: 'normal',
      fontStyle: 'normal',
      lineHeight: 1.5,
      textAlign: 'left',
      textDecoration: 'none',
      textIndent: 0,
      color: '#000000',
      marginTop: 0,
      marginBottom: 0,
      display: 'block',
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
      backgroundColor: '',
      letterSpacing: 0,
      textTransform: 'none',
      listStyleType: 'none',
      pageBreakBefore: 'auto',
      pageBreakAfter: 'auto',
    });
  });
});
