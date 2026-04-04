import { describe, expect, it } from 'vitest';
import type { SelectorTarget } from '../../src/style/cascade/selector-matcher';
import { matchesSelector } from '../../src/style/cascade/selector-matcher';

function target(tag: string, opts?: { className?: string; id?: string }): SelectorTarget {
  const t: { tag: string; className?: string; id?: string } = { tag };
  if (opts?.className !== undefined) t.className = opts.className;
  if (opts?.id !== undefined) t.id = opts.id;
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
});
