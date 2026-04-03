import { describe, expect, it } from 'vitest';
import { findPageForTocEntry } from '../../src/runtime/navigation';
import type { TocEntry } from '../../src/parser/epub/types';
import type { SpineItem } from '../../src/parser/epub/types';
import type { ChapterRange } from '../../src/runtime/types';

function entry(href: string): TocEntry {
  return { label: 'Test', href, children: [] };
}

function spineItem(idref: string, linear = true): SpineItem {
  return { idref, linear };
}

const range = (startPage: number, endPage: number): ChapterRange => ({
  startPage,
  endPage,
});

describe('findPageForTocEntry', () => {
  it('returns startPage on exact href match', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(0, 5)]]);

    expect(findPageForTocEntry(entry('chapter1.xhtml'), chapters, spine, manifest)).toBe(0);
  });

  it('matches when manifest href ends with entry path (path prefix)', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'OEBPS/Text/chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(3, 10)]]);

    expect(findPageForTocEntry(entry('chapter1.xhtml'), chapters, spine, manifest)).toBe(3);
  });

  it('strips fragment identifier before matching', () => {
    const spine = [spineItem('ch2')];
    const manifest = new Map([['ch2', 'chapter2.xhtml']]);
    const chapters = new Map([['ch2', range(6, 12)]]);

    expect(findPageForTocEntry(entry('chapter2.xhtml#section-1'), chapters, spine, manifest)).toBe(
      6,
    );
  });

  it('returns undefined when no spine item matches', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(0, 5)]]);

    expect(findPageForTocEntry(entry('missing.xhtml'), chapters, spine, manifest)).toBeUndefined();
  });

  it('returns undefined when hrefPath is empty', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(0, 5)]]);

    expect(findPageForTocEntry(entry('#fragment-only'), chapters, spine, manifest)).toBeUndefined();
  });

  it('skips spine items whose idref has no manifest entry', () => {
    const spine = [spineItem('missing'), spineItem('ch1')];
    const manifest = new Map([['ch1', 'chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(2, 8)]]);

    expect(findPageForTocEntry(entry('chapter1.xhtml'), chapters, spine, manifest)).toBe(2);
  });

  it('returns the correct page when multiple spine items exist', () => {
    const spine = [spineItem('ch1'), spineItem('ch2'), spineItem('ch3')];
    const manifest = new Map([
      ['ch1', 'chapter1.xhtml'],
      ['ch2', 'chapter2.xhtml'],
      ['ch3', 'chapter3.xhtml'],
    ]);
    const chapters = new Map([
      ['ch1', range(0, 4)],
      ['ch2', range(5, 9)],
      ['ch3', range(10, 15)],
    ]);

    expect(findPageForTocEntry(entry('chapter3.xhtml'), chapters, spine, manifest)).toBe(10);
  });
});
