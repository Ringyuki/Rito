import { describe, expect, it } from 'vitest';
import type { SelectorTarget } from '../../src/style/cascade/selector-matcher';
import { matchesSelector } from '../../src/style/cascade/selector-matcher';

function target(
  tag: string,
  opts?: { className?: string; id?: string; attributes?: ReadonlyMap<string, string> },
): SelectorTarget {
  const t: SelectorTarget & {
    className?: string;
    id?: string;
    attributes?: ReadonlyMap<string, string>;
  } = { tag };
  if (opts?.className !== undefined) t.className = opts.className;
  if (opts?.id !== undefined) t.id = opts.id;
  if (opts?.attributes !== undefined) t.attributes = opts.attributes;
  return t;
}

describe('matchesSelector', () => {
  it('matches element selector', () => {
    expect(matchesSelector(target('p'), 'p')).toBe(true);
  });

  it('rejects wrong element', () => {
    expect(matchesSelector(target('div'), 'p')).toBe(false);
  });

  it('matches class selector', () => {
    expect(matchesSelector(target('p', { className: 'intro' }), '.intro')).toBe(true);
  });

  it('matches class in multi-class attribute', () => {
    expect(matchesSelector(target('p', { className: 'intro highlight' }), '.intro')).toBe(true);
  });

  it('rejects missing class', () => {
    expect(matchesSelector(target('p'), '.intro')).toBe(false);
  });

  it('matches id selector', () => {
    expect(matchesSelector(target('div', { id: 'ch1' }), '#ch1')).toBe(true);
  });

  it('rejects wrong id', () => {
    expect(matchesSelector(target('div', { id: 'ch2' }), '#ch1')).toBe(false);
  });

  it('rejects missing id', () => {
    expect(matchesSelector(target('div'), '#ch1')).toBe(false);
  });

  it('matches compound element + class', () => {
    expect(matchesSelector(target('p', { className: 'intro' }), 'p.intro')).toBe(true);
  });

  it('rejects compound with wrong element', () => {
    expect(matchesSelector(target('div', { className: 'intro' }), 'p.intro')).toBe(false);
  });

  it('rejects compound with missing class', () => {
    expect(matchesSelector(target('p'), 'p.intro')).toBe(false);
  });

  it('matches compound with id + class + element', () => {
    expect(
      matchesSelector(target('div', { id: 'main', className: 'container' }), 'div#main.container'),
    ).toBe(true);
  });

  it('target without className/id rejects class/id selectors', () => {
    expect(matchesSelector(target('p'), 'p.intro')).toBe(false);
    expect(matchesSelector(target('p'), '#ch1')).toBe(false);
  });

  describe('descendant selectors', () => {
    it('matches .title p with correct ancestor', () => {
      const ancestors = [target('div', { className: 'title' })];
      expect(matchesSelector(target('p'), '.title p', ancestors)).toBe(true);
    });

    it('rejects .title p without matching ancestor', () => {
      const ancestors = [target('div', { className: 'other' })];
      expect(matchesSelector(target('p'), '.title p', ancestors)).toBe(false);
    });

    it('matches body p with body ancestor', () => {
      const ancestors = [target('div'), target('body')];
      expect(matchesSelector(target('p'), 'body p', ancestors)).toBe(true);
    });

    it('matches deep descendant .title .tilh', () => {
      const ancestors = [target('p'), target('div', { className: 'title' })];
      expect(
        matchesSelector(target('span', { className: 'tilh' }), '.title .tilh', ancestors),
      ).toBe(true);
    });

    it('rejects descendant selector without ancestors arg', () => {
      expect(matchesSelector(target('p'), '.title p')).toBe(false);
    });

    it('rejects descendant selector with empty ancestors', () => {
      expect(matchesSelector(target('p'), '.title p', [])).toBe(false);
    });

    it('matches three-level descendant body .content p', () => {
      const ancestors = [target('div', { className: 'content' }), target('body')];
      expect(matchesSelector(target('p'), 'body .content p', ancestors)).toBe(true);
    });

    it('ancestor order matters (parent first, root last)', () => {
      // ancestors: [parent=div, grandparent=body]
      // selector: body div p — body is grandparent, div is parent
      const ancestors = [target('div'), target('body')];
      expect(matchesSelector(target('p'), 'body div p', ancestors)).toBe(true);
    });

    it('single-part selector still works with ancestors', () => {
      const ancestors = [target('div')];
      expect(matchesSelector(target('p'), 'p', ancestors)).toBe(true);
    });
  });

  describe('child combinator >', () => {
    it('matches ul > li with direct parent', () => {
      const ancestors = [target('ul')];
      expect(matchesSelector(target('li'), 'ul > li', ancestors)).toBe(true);
    });

    it('rejects ul > li when parent is not ul', () => {
      const ancestors = [target('ol')];
      expect(matchesSelector(target('li'), 'ul > li', ancestors)).toBe(false);
    });

    it('rejects ul > li when ul is grandparent (not direct parent)', () => {
      const ancestors = [target('div'), target('ul')];
      expect(matchesSelector(target('li'), 'ul > li', ancestors)).toBe(false);
    });

    it('matches .toc > ol with direct parent', () => {
      const ancestors = [target('nav', { className: 'toc' })];
      expect(matchesSelector(target('ol'), '.toc > ol', ancestors)).toBe(true);
    });

    it('mixes descendant and child: body .toc > ol', () => {
      const ancestors = [target('nav', { className: 'toc' }), target('body')];
      expect(matchesSelector(target('ol'), 'body .toc > ol', ancestors)).toBe(true);
    });

    it('rejects mixed descendant+child when child part fails', () => {
      // .toc is grandparent, not direct parent
      const ancestors = [target('div'), target('nav', { className: 'toc' }), target('body')];
      expect(matchesSelector(target('ol'), 'body .toc > ol', ancestors)).toBe(false);
    });

    it('matches chained child combinators: div > ul > li', () => {
      const ancestors = [target('ul'), target('div')];
      expect(matchesSelector(target('li'), 'div > ul > li', ancestors)).toBe(true);
    });

    it('rejects chained child when intermediate is wrong', () => {
      const ancestors = [target('ol'), target('div')];
      expect(matchesSelector(target('li'), 'div > ul > li', ancestors)).toBe(false);
    });
  });

  describe('attribute selectors', () => {
    it('[attr] existence matches', () => {
      const attrs = new Map([['role', 'doc-toc']]);
      expect(matchesSelector(target('nav', { attributes: attrs }), '[role]')).toBe(true);
    });

    it('[attr] existence rejects when missing', () => {
      expect(matchesSelector(target('nav'), '[role]')).toBe(false);
    });

    it('[attr="val"] exact match', () => {
      const attrs = new Map([['epub:type', 'toc']]);
      expect(matchesSelector(target('nav', { attributes: attrs }), '[epub:type="toc"]')).toBe(true);
    });

    it('[attr="val"] rejects wrong value', () => {
      const attrs = new Map([['epub:type', 'glossary']]);
      expect(matchesSelector(target('nav', { attributes: attrs }), '[epub:type="toc"]')).toBe(
        false,
      );
    });

    it('[attr~="val"] whitespace-separated word match', () => {
      const attrs = new Map([['class', 'intro highlight']]);
      expect(matchesSelector(target('p', { attributes: attrs }), '[class~="highlight"]')).toBe(
        true,
      );
    });

    it('[attr^="val"] starts with', () => {
      const attrs = new Map([['href', '../Text/chapter3.xhtml']]);
      expect(matchesSelector(target('a', { attributes: attrs }), '[href^="../Text"]')).toBe(true);
    });

    it('[attr$="val"] ends with', () => {
      const attrs = new Map([['src', 'image.jpg']]);
      expect(matchesSelector(target('img', { attributes: attrs }), '[src$=".jpg"]')).toBe(true);
    });

    it('[attr*="val"] contains', () => {
      const attrs = new Map([['data-type', 'chapter-heading']]);
      expect(matchesSelector(target('h1', { attributes: attrs }), '[data-type*="chapter"]')).toBe(
        true,
      );
    });

    it('compound: p[role="doc-noteref"]', () => {
      const attrs = new Map([['role', 'doc-noteref']]);
      expect(matchesSelector(target('p', { attributes: attrs }), 'p[role="doc-noteref"]')).toBe(
        true,
      );
    });

    it('compound rejects when tag does not match', () => {
      const attrs = new Map([['role', 'doc-noteref']]);
      expect(matchesSelector(target('div', { attributes: attrs }), 'p[role="doc-noteref"]')).toBe(
        false,
      );
    });

    it('combined with descendant: .toc [epub:type="toc"]', () => {
      const attrs = new Map([['epub:type', 'toc']]);
      const ancestors = [target('nav', { className: 'toc' })];
      expect(
        matchesSelector(target('ol', { attributes: attrs }), '.toc [epub:type="toc"]', ancestors),
      ).toBe(true);
    });

    it('[attr="value with spaces"] preserved across selector split', () => {
      const attrs = new Map([['title', 'foo bar']]);
      expect(matchesSelector(target('p', { attributes: attrs }), '[title="foo bar"]')).toBe(true);
    });

    it('descendant + attr with spaces: div [title="foo bar"]', () => {
      const attrs = new Map([['title', 'hello world']]);
      const ancestors = [target('div')];
      expect(
        matchesSelector(target('p', { attributes: attrs }), 'div [title="hello world"]', ancestors),
      ).toBe(true);
    });

    it("single-quoted value: [type='button']", () => {
      const attrs = new Map([['type', 'button']]);
      expect(matchesSelector(target('input', { attributes: attrs }), "[type='button']")).toBe(true);
    });

    it('unquoted value: [type=button]', () => {
      const attrs = new Map([['type', 'button']]);
      expect(matchesSelector(target('input', { attributes: attrs }), '[type=button]')).toBe(true);
    });

    it('quoted value may contain ]: [title="a]b"]', () => {
      const attrs = new Map([['title', 'a]b']]);
      expect(matchesSelector(target('p', { attributes: attrs }), '[title="a]b"]')).toBe(true);
    });
  });
});
