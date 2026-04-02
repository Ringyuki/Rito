import { describe, expect, it } from 'vitest';
import { parseFontFaceRules } from '../../src/style/css-rule-parser';

describe('parseFontFaceRules', () => {
  it('parses a basic @font-face rule', () => {
    const css = `@font-face { font-family: "title"; src: url(../Fonts/title.ttf); }`;
    const rules = parseFontFaceRules(css);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.family).toBe('title');
    expect(rules[0]?.src).toBe('../Fonts/title.ttf');
  });

  it('parses multiple @font-face rules', () => {
    const css = `
      @font-face { font-family: "title"; src: url(../Fonts/title.ttf); }
      @font-face { font-family: "illus1"; src: url(../Fonts/illus1.ttf); }
    `;
    const rules = parseFontFaceRules(css);

    expect(rules).toHaveLength(2);
    expect(rules[0]?.family).toBe('title');
    expect(rules[1]?.family).toBe('illus1');
  });

  it('strips quotes from font-family', () => {
    const css = `@font-face { font-family: 'MyFont'; src: url(font.woff2); }`;
    const rules = parseFontFaceRules(css);
    expect(rules[0]?.family).toBe('MyFont');
  });

  it('parses font-weight and font-style', () => {
    const css = `@font-face {
      font-family: "MyFont";
      src: url(font-bold-italic.woff2);
      font-weight: bold;
      font-style: italic;
    }`;
    const rules = parseFontFaceRules(css);

    expect(rules[0]?.weight).toBe('bold');
    expect(rules[0]?.style).toBe('italic');
  });

  it('omits weight and style when not specified', () => {
    const css = `@font-face { font-family: "Simple"; src: url(simple.ttf); }`;
    const rules = parseFontFaceRules(css);

    expect(rules[0]).not.toHaveProperty('weight');
    expect(rules[0]).not.toHaveProperty('style');
  });

  it('handles url with quotes', () => {
    const css = `@font-face { font-family: "F"; src: url("fonts/f.woff2"); }`;
    const rules = parseFontFaceRules(css);
    expect(rules[0]?.src).toBe('fonts/f.woff2');
  });

  it('handles url with single quotes', () => {
    const css = `@font-face { font-family: "F"; src: url('fonts/f.woff'); }`;
    const rules = parseFontFaceRules(css);
    expect(rules[0]?.src).toBe('fonts/f.woff');
  });

  it('ignores @font-face without font-family', () => {
    const css = `@font-face { src: url(font.ttf); }`;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(0);
  });

  it('ignores @font-face without src', () => {
    const css = `@font-face { font-family: "F"; }`;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(0);
  });

  it('skips non-font-face @-rules', () => {
    const css = `
      @charset "utf-8";
      @font-face { font-family: "F"; src: url(f.ttf); }
      @media screen { body { color: red; } }
    `;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.family).toBe('F');
  });

  it('skips regular CSS rules', () => {
    const css = `
      p { color: red; }
      @font-face { font-family: "F"; src: url(f.ttf); }
      h1 { font-size: 2em; }
    `;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(1);
  });

  it('returns empty for CSS without @font-face', () => {
    const css = `p { color: red; } h1 { font-size: 2em; }`;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(0);
  });

  it('parses real demo EPUB CSS', () => {
    const css = `
      body { line-height: 130%; }
      @font-face { font-family: "title"; src: url(../Fonts/title.ttf); }
      @font-face { font-family: "illus1"; src: url(../Fonts/illus1.ttf); }
      p { text-indent: 2em; }
    `;
    const rules = parseFontFaceRules(css);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.family).toBe('title');
    expect(rules[0]?.src).toBe('../Fonts/title.ttf');
    expect(rules[1]?.family).toBe('illus1');
    expect(rules[1]?.src).toBe('../Fonts/illus1.ttf');
  });
});
