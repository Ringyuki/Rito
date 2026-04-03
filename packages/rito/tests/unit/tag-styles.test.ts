import { describe, expect, it } from 'vitest';
import { getTagStyle } from '../../src/style/tag-styles';

describe('getTagStyle', () => {
  it('returns bold for <strong>', () => {
    const style = getTagStyle('strong');
    expect(style?.fontWeight).toBe('bold');
  });

  it('returns bold for <b>', () => {
    const style = getTagStyle('b');
    expect(style?.fontWeight).toBe('bold');
  });

  it('returns italic for <em>', () => {
    const style = getTagStyle('em');
    expect(style?.fontStyle).toBe('italic');
  });

  it('returns italic for <i>', () => {
    const style = getTagStyle('i');
    expect(style?.fontStyle).toBe('italic');
  });

  it('returns larger font size for <h1>', () => {
    const style = getTagStyle('h1');
    expect(style?.fontSize).toBe(32);
    expect(style?.fontWeight).toBe('bold');
  });

  it('returns monospace for <pre>', () => {
    const style = getTagStyle('pre');
    expect(style?.fontFamily).toBe('monospace');
  });

  it('returns monospace for <code>', () => {
    const style = getTagStyle('code');
    expect(style?.fontFamily).toBe('monospace');
  });

  it('returns center alignment for <center>', () => {
    const style = getTagStyle('center');
    expect(style?.textAlign).toBe('center');
  });

  it('returns margins for <p>', () => {
    const style = getTagStyle('p');
    expect(style?.marginTop).toBe(16);
    expect(style?.marginBottom).toBe(16);
  });

  it('returns undefined for unknown tags', () => {
    expect(getTagStyle('span')).toBeUndefined();
    expect(getTagStyle('a')).toBeUndefined();
    expect(getTagStyle('custom')).toBeUndefined();
  });
});
