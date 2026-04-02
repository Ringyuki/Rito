// @vitest-environment happy-dom
/**
 * Browser-reference comparison test.
 * Renders the title-page structure in happy-dom's real CSS engine,
 * extracts getComputedStyle values, and compares against Rito's pipeline.
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { parseCssRules } from '../../src/style/css-rule-parser';
import { resolveStyles } from '../../src/style/resolver';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { StyledNode } from '../../src/style/types';

const BASE = 16;

const REAL_CSS = `
body {
  padding: 0%;
  margin-top: 0%;
  margin-bottom: 0%;
  margin-left: 1%;
  margin-right: 1%;
  line-height: 130%;
  text-align: justify;
}
p {
  text-indent: 2em;
  display: block;
  line-height: 1.3em;
  margin-top: 0.4em;
  margin-bottom: 0.4em;
}
.center { text-align: center; }
.tilh { text-indent: 0em; }
.em04 { font-size: 0.4em; }
.em08 { font-size: 0.8em; }
.em09 { font-size: 0.9em; }
.em12 { font-size: 1.2em; }
.em13 { font-size: 1.3em; }
.em17 { font-size: 1.7em; }
.em26 { font-size: 2.6em; }
.tco1 { color: #716F71; }
`;

const TITLE_HTML = `
<div class="title center" style="margin: 4em 0 0 0;">
  <p class="tilh em17" style="margin: 0;">关于我在无意间被</p>
  <p class="tilh em09" style="margin: 0;">She is the neighbor Angel</p>
  <p class="tilh em17" style="margin: 0.15em 0 0 0;">隔壁的天使变成废柴这件事</p>
  <p class="tilh em26 tco1" style="margin: 0.3em 0 0 0;">vol 1</p>
  <p class="tilh em08 tco1" style="margin: 3.5em 0 0.15em 0;">作者</p>
  <p class="tilh em13" style="margin: 0;">佐伯さん</p>
  <p class="tilh em08 tco1" style="margin: 2em 0 0.15em 0;">插画</p>
  <p class="tilh" style="margin: 0;">和武はざの</p>
</div>
`;

interface BrowserValues {
  fontSize: number;
  lineHeight: string;
  marginTop: number;
  marginBottom: number;
  textAlign: string;
  textIndent: string;
  color: string;
}

function getBrowserValues(el: Element): BrowserValues {
  const cs = window.getComputedStyle(el);
  return {
    fontSize: parseFloat(cs.fontSize),
    lineHeight: cs.lineHeight,
    marginTop: parseFloat(cs.marginTop),
    marginBottom: parseFloat(cs.marginBottom),
    textAlign: cs.textAlign,
    textIndent: cs.textIndent,
    color: cs.color,
  };
}

function getRitoValues(node: StyledNode): {
  fontSize: number;
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  textAlign: string;
  textIndent: number;
  color: string;
} {
  return {
    fontSize: node.style.fontSize,
    lineHeight: node.style.lineHeight,
    marginTop: node.style.marginTop,
    marginBottom: node.style.marginBottom,
    textAlign: node.style.textAlign,
    textIndent: node.style.textIndent,
    color: node.style.color,
  };
}

describe('browser vs Rito comparison', () => {
  // Set up browser DOM
  const style = document.createElement('style');
  style.textContent = REAL_CSS;
  document.head.appendChild(style);
  document.body.innerHTML = TITLE_HTML;

  const browserDiv = document.querySelector('div.title') as HTMLElement;
  const browserPs = Array.from(browserDiv.querySelectorAll(':scope > p'));

  // Set up Rito pipeline
  const rules = parseCssRules(REAL_CSS, BASE);
  const bodyStyle = (() => {
    const s = { ...DEFAULT_STYLE };
    for (const r of rules) {
      if (r.selector === 'body') Object.assign(s, r.declarations);
    }
    return s;
  })();

  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>T</title></head>
<body>${TITLE_HTML}</body>
</html>`;
  const { nodes } = parseXhtml(xhtml);
  const styled = resolveStyles(nodes, bodyStyle, rules);
  const styledDiv = styled.find((n) => n.type === 'block' && n.tag === 'div');
  const styledPs = styledDiv?.children.filter((c) => c.type === 'block') ?? [];

  const labels = [
    'p.em17 (title line 1)',
    'p.em09 (subtitle)',
    'p.em17 (title line 3)',
    'p.em26 (vol line)',
    'p.em08 (author label)',
    'p.em13 (author name)',
    'p.em08 (illustrator label)',
    'p (illustrator name)',
  ];

  // Print comparison table
  it('prints comparison table for inspection', () => {
    console.log('\n=== WRAPPER DIV ===');
    const bDiv = getBrowserValues(browserDiv);
    const rDiv = styledDiv ? getRitoValues(styledDiv) : null;
    console.log('Browser:', JSON.stringify(bDiv));
    console.log('Rito:   ', rDiv ? JSON.stringify(rDiv) : 'NOT FOUND');

    console.log('\n=== PARAGRAPHS ===');
    for (let i = 0; i < Math.max(browserPs.length, styledPs.length); i++) {
      console.log(`\n--- ${labels[i] ?? `p[${String(i)}]`} ---`);
      const bEl = browserPs[i];
      const rNode = styledPs[i];
      if (bEl) console.log('Browser:', JSON.stringify(getBrowserValues(bEl)));
      if (rNode) console.log('Rito:   ', JSON.stringify(getRitoValues(rNode)));
      if (bEl && rNode) {
        const bv = getBrowserValues(bEl);
        const rv = getRitoValues(rNode);
        const diffs: string[] = [];
        if (Math.abs(bv.fontSize - rv.fontSize) > 0.1)
          diffs.push(`fontSize: browser=${String(bv.fontSize)} rito=${String(rv.fontSize)}`);
        if (Math.abs(bv.marginTop - rv.marginTop) > 0.1)
          diffs.push(`marginTop: browser=${String(bv.marginTop)} rito=${String(rv.marginTop)}`);
        if (Math.abs(bv.marginBottom - rv.marginBottom) > 0.1)
          diffs.push(
            `marginBottom: browser=${String(bv.marginBottom)} rito=${String(rv.marginBottom)}`,
          );
        if (bv.textAlign !== rv.textAlign)
          diffs.push(`textAlign: browser=${bv.textAlign} rito=${rv.textAlign}`);
        if (diffs.length > 0) console.log('DIFFS:', diffs.join(', '));
        else console.log('MATCH');
      }
    }
  });

  // Structural assertions
  it('same number of paragraph children', () => {
    expect(styledPs.length).toBe(browserPs.length);
  });

  it('wrapper div fontSize matches', () => {
    const bv = getBrowserValues(browserDiv);
    expect(styledDiv?.style.fontSize).toBeCloseTo(bv.fontSize, 0);
  });

  it('wrapper div textAlign matches', () => {
    const bv = getBrowserValues(browserDiv);
    expect(styledDiv?.style.textAlign).toBe(bv.textAlign);
  });

  it('wrapper div marginTop matches', () => {
    const bv = getBrowserValues(browserDiv);
    expect(styledDiv?.style.marginTop).toBeCloseTo(bv.marginTop, 0);
  });

  // Per-paragraph fontSize comparison
  for (let i = 0; i < 8; i++) {
    it(`${labels[i] ?? `p[${String(i)}]`} fontSize matches browser`, () => {
      const bEl = browserPs[i];
      const rNode = styledPs[i];
      if (!bEl || !rNode) return;
      const bv = getBrowserValues(bEl);
      expect(rNode.style.fontSize).toBeCloseTo(bv.fontSize, 0);
    });
  }

  // Per-paragraph marginTop comparison
  for (let i = 0; i < 8; i++) {
    it(`${labels[i] ?? `p[${String(i)}]`} marginTop matches browser`, () => {
      const bEl = browserPs[i];
      const rNode = styledPs[i];
      if (!bEl || !rNode) return;
      const bv = getBrowserValues(bEl);
      expect(rNode.style.marginTop).toBeCloseTo(bv.marginTop, 0);
    });
  }

  // Per-paragraph marginBottom comparison
  for (let i = 0; i < 8; i++) {
    it(`${labels[i] ?? `p[${String(i)}]`} marginBottom matches browser`, () => {
      const bEl = browserPs[i];
      const rNode = styledPs[i];
      if (!bEl || !rNode) return;
      const bv = getBrowserValues(bEl);
      expect(rNode.style.marginBottom).toBeCloseTo(bv.marginBottom, 0);
    });
  }

  // textAlign comparison
  for (let i = 0; i < 8; i++) {
    it(`${labels[i] ?? `p[${String(i)}]`} textAlign matches browser`, () => {
      const bEl = browserPs[i];
      const rNode = styledPs[i];
      if (!bEl || !rNode) return;
      const bv = getBrowserValues(bEl);
      expect(rNode.style.textAlign).toBe(bv.textAlign);
    });
  }
});
