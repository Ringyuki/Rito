import { describe, expect, it } from 'vitest';
import {
  buildChapterRules,
  buildStylesheetRuleMap,
  buildStylesheetRules,
} from '../../src/runtime/pagination-stylesheets';

describe('chapter stylesheet href matching', () => {
  it('matches percent-decoded and dot-normalized linked stylesheet paths', () => {
    const stylesheets = new Map([
      ['Styles/My Style.css', 'p { color: red; }'],
      ['Other/My Style.css', 'p { color: blue; }'],
    ]);
    const all = buildStylesheetRules(stylesheets, 16);
    const byStylesheet = buildStylesheetRuleMap(stylesheets, 16);

    const rules = buildChapterRules(
      all,
      byStylesheet,
      ['../Styles/tmp/../My%20Style.css'],
      undefined,
      16,
    );

    expect(rules).toHaveLength(1);
    expect(rules[0]?.declarations.color).toBe('red');
  });

  it('does not bind malformed percent escapes to a similarly named stylesheet', () => {
    const stylesheets = new Map([['Styles/book.css', 'p { color: red; }']]);
    const rules = buildChapterRules(
      buildStylesheetRules(stylesheets, 16),
      buildStylesheetRuleMap(stylesheets, 16),
      ['Styles/%ZZ/book.css'],
      undefined,
      16,
    );

    expect(rules).toEqual([]);
  });
});
