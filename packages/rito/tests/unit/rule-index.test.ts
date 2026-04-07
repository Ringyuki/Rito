import { describe, expect, it } from 'vitest';
import { buildRuleIndex } from '../../src/style/cascade/rule-index';
import type { CssRule } from '../../src/style/core/types';

function rule(selector: string): CssRule {
  return { selector, declarations: {}, rawDeclarations: '' };
}

describe('buildRuleIndex', () => {
  it('indexes rules by tag name', () => {
    const pRule = rule('p');
    const divRule = rule('div');
    const index = buildRuleIndex([pRule, divRule]);

    const pCandidates = index.getCandidates('p', undefined, undefined);
    expect(pCandidates).toContain(pRule);
    expect(pCandidates).not.toContain(divRule);

    const divCandidates = index.getCandidates('div', undefined, undefined);
    expect(divCandidates).toContain(divRule);
    expect(divCandidates).not.toContain(pRule);
  });

  it('indexes rules by class name', () => {
    const introRule = rule('.intro');
    const highlightRule = rule('.highlight');
    const index = buildRuleIndex([introRule, highlightRule]);

    const candidates = index.getCandidates('p', 'intro', undefined);
    expect(candidates).toContain(introRule);
    expect(candidates).not.toContain(highlightRule);
  });

  it('indexes rules by id', () => {
    const chapterRule = rule('#chapter1');
    const index = buildRuleIndex([chapterRule]);

    const matched = index.getCandidates('div', undefined, 'chapter1');
    expect(matched).toContain(chapterRule);

    const unmatched = index.getCandidates('div', undefined, 'chapter2');
    expect(unmatched).not.toContain(chapterRule);
  });

  it('puts universal selector in universal bucket', () => {
    const starRule = rule('*');
    const pRule = rule('p');
    const index = buildRuleIndex([starRule, pRule]);

    // Universal rules appear for any node
    const candidates = index.getCandidates('div', undefined, undefined);
    expect(candidates).toContain(starRule);
    expect(candidates).not.toContain(pRule);

    // Universal rules also appear alongside tag matches
    const pCandidates = index.getCandidates('p', undefined, undefined);
    expect(pCandidates).toContain(starRule);
    expect(pCandidates).toContain(pRule);
  });

  it('handles compound selectors (p.intro)', () => {
    const compoundRule = rule('p.intro');
    const index = buildRuleIndex([compoundRule]);

    // Indexed under both tag "p" and class "intro"
    const byTag = index.getCandidates('p', undefined, undefined);
    expect(byTag).toContain(compoundRule);

    const byClass = index.getCandidates('div', 'intro', undefined);
    expect(byClass).toContain(compoundRule);
  });

  it('handles descendant selectors by indexing the rightmost part', () => {
    const descendantRule = rule('body .content p');
    const index = buildRuleIndex([descendantRule]);

    // Rightmost part is "p" -> indexed under tag "p"
    const pCandidates = index.getCandidates('p', undefined, undefined);
    expect(pCandidates).toContain(descendantRule);

    // Should NOT appear for "body" or nodes with class "content" alone
    const bodyCandidates = index.getCandidates('body', undefined, undefined);
    expect(bodyCandidates).not.toContain(descendantRule);

    const contentCandidates = index.getCandidates('div', 'content', undefined);
    expect(contentCandidates).not.toContain(descendantRule);
  });

  it('handles multi-class nodes', () => {
    const aRule = rule('.alpha');
    const bRule = rule('.beta');
    const index = buildRuleIndex([aRule, bRule]);

    const candidates = index.getCandidates('span', 'alpha beta', undefined);
    expect(candidates).toContain(aRule);
    expect(candidates).toContain(bRule);
  });

  it('deduplicates candidates for compound selectors', () => {
    const compoundRule = rule('p.intro');
    const index = buildRuleIndex([compoundRule]);

    // Node matches both tag "p" and class "intro", rule should appear once
    const candidates = index.getCandidates('p', 'intro', undefined);
    const count = candidates.filter((r) => r === compoundRule).length;
    expect(count).toBe(1);
  });

  it('returns empty candidates for unmatched nodes', () => {
    const pRule = rule('p');
    const index = buildRuleIndex([pRule]);

    const candidates = index.getCandidates('span', undefined, undefined);
    expect(candidates).toHaveLength(0);
  });

  it('returns only universal rules when no specific match', () => {
    const starRule = rule('*');
    const pRule = rule('p');
    const index = buildRuleIndex([starRule, pRule]);

    const candidates = index.getCandidates('span', undefined, undefined);
    expect(candidates).toEqual([starRule]);
  });

  it('works with id compound selector (#main p)', () => {
    const idDescendant = rule('#main p');
    const index = buildRuleIndex([idDescendant]);

    // Rightmost part is "p"
    const candidates = index.getCandidates('p', undefined, undefined);
    expect(candidates).toContain(idDescendant);

    // Should not appear for #main alone
    const mainCandidates = index.getCandidates('div', undefined, 'main');
    expect(mainCandidates).not.toContain(idDescendant);
  });

  it('indexes tag+attribute selectors when quoted value contains ]', () => {
    const attrRule = rule('div[title="a]b"]');
    const index = buildRuleIndex([attrRule]);

    const divCandidates = index.getCandidates('div', undefined, undefined);
    expect(divCandidates).toContain(attrRule);

    const pCandidates = index.getCandidates('p', undefined, undefined);
    expect(pCandidates).not.toContain(attrRule);
  });

  it('handles empty rules array', () => {
    const index = buildRuleIndex([]);
    const candidates = index.getCandidates('p', 'intro', 'ch1');
    expect(candidates).toHaveLength(0);
  });
});
