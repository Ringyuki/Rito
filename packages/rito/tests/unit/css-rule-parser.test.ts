import { describe, expect, it } from 'vitest';
import { parseCssRules } from '../../src/style/css/rule-parser';

const BASE = 16;

describe('parseCssRules', () => {
  it('parses a single rule', () => {
    const rules = parseCssRules('p { color: red; }', BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('p');
    expect(rules[0]?.declarations).toEqual({ color: 'red' });
  });

  it('parses multiple rules', () => {
    const rules = parseCssRules('p { color: red; } h1 { font-weight: bold; }', BASE);
    expect(rules).toHaveLength(2);
    expect(rules[0]?.selector).toBe('p');
    expect(rules[1]?.selector).toBe('h1');
  });

  it('splits grouped selectors', () => {
    const rules = parseCssRules('h1, h2, h3 { font-weight: bold; }', BASE);
    expect(rules).toHaveLength(3);
    expect(rules[0]?.selector).toBe('h1');
    expect(rules[1]?.selector).toBe('h2');
    expect(rules[2]?.selector).toBe('h3');
    // All share same declarations
    expect(rules[0]?.declarations).toEqual(rules[1]?.declarations);
  });

  it('strips comments', () => {
    const rules = parseCssRules('/* heading */ h1 { color: blue; }', BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations).toEqual({ color: 'blue' });
  });

  it('skips rules with only unknown properties', () => {
    const rules = parseCssRules('p { display: flex; }', BASE);
    expect(rules).toHaveLength(0);
  });

  it('skips @charset rules', () => {
    const rules = parseCssRules('@charset "utf-8"; p { color: red; }', BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('p');
  });

  it('skips @media blocks', () => {
    const css = '@media screen { h1 { color: blue; } } p { color: red; }';
    const rules = parseCssRules(css, BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('p');
  });

  it('handles class selectors', () => {
    const rules = parseCssRules('.intro { text-indent: 0px; }', BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('.intro');
    expect(rules[0]?.declarations).toEqual({ textIndent: 0 });
  });

  it('handles compound selectors', () => {
    const rules = parseCssRules('p.special { color: green; }', BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.selector).toBe('p.special');
  });

  it('returns empty array for empty input', () => {
    expect(parseCssRules('', BASE)).toEqual([]);
  });

  it('handles whitespace and newlines', () => {
    const css = `
      p {
        color: red;
        font-size: 18px;
      }
    `;
    const rules = parseCssRules(css, BASE);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations).toEqual({ color: 'red', fontSize: 18 });
  });

  it('parses real EPUB-style CSS', () => {
    const css = `
      body { line-height: 130%; text-align: justify; }
      h1 { font-size: 1.65em; text-align: center; font-weight: bold; }
      p { text-indent: 2em; line-height: 1.3em; margin-top: 0.4em; margin-bottom: 0.4em; }
      .illus { text-indent: 0em; text-align: center; }
    `;
    const rules = parseCssRules(css, BASE);

    // body + h1 + p + .illus = 4 rules
    expect(rules.length).toBeGreaterThanOrEqual(4);

    const pRule = rules.find((r) => r.selector === 'p');
    expect(pRule?.declarations.textIndent).toBe(32); // 2em * 16
    expect(pRule?.declarations.marginTop).toBeCloseTo(6.4); // 0.4em * 16
  });
});
