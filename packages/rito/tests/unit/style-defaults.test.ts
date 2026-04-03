import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STYLE,
  FONT_STYLES,
  FONT_WEIGHTS,
  TEXT_ALIGNMENTS,
} from '../../src/style/index.js';

describe('DEFAULT_STYLE', () => {
  it('has expected default values', () => {
    expect(DEFAULT_STYLE.fontFamily).toBe('serif');
    expect(DEFAULT_STYLE.fontSize).toBe(16);
    expect(DEFAULT_STYLE.fontWeight).toBe(FONT_WEIGHTS.Normal);
    expect(DEFAULT_STYLE.fontStyle).toBe(FONT_STYLES.Normal);
    expect(DEFAULT_STYLE.lineHeight).toBe(1.5);
    expect(DEFAULT_STYLE.textAlign).toBe(TEXT_ALIGNMENTS.Left);
    expect(DEFAULT_STYLE.color).toBe('#000000');
  });
});
