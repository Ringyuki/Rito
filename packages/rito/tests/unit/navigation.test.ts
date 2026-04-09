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

  // --- 8.1A: relative path normalization ---

  it('matches href with ../ prefix against manifest href', () => {
    const spine = [spineItem('ch3')];
    const manifest = new Map([['ch3', 'OEBPS/Text/chapter3.xhtml']]);
    const chapters = new Map([['ch3', range(10, 15)]]);

    expect(findPageForTocEntry(entry('../Text/chapter3.xhtml'), chapters, spine, manifest)).toBe(
      10,
    );
  });

  it('matches href with multiple ../ prefixes', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'Text/chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(0, 5)]]);

    expect(findPageForTocEntry(entry('../../Text/chapter1.xhtml'), chapters, spine, manifest)).toBe(
      0,
    );
  });

  it('matches ../ href combined with fragment — falls back to chapter start without anchorMap', () => {
    const spine = [spineItem('ch3')];
    const manifest = new Map([['ch3', 'OEBPS/Text/chapter3.xhtml']]);
    const chapters = new Map([['ch3', range(10, 15)]]);

    expect(
      findPageForTocEntry(entry('../Text/chapter3.xhtml#section-2'), chapters, spine, manifest),
    ).toBe(10);
  });

  // --- 8.1B: fragment precise positioning via anchorMap ---

  it('returns precise anchor page when anchorMap has the fragment', () => {
    const spine = [spineItem('ch2')];
    const manifest = new Map([['ch2', 'chapter2.xhtml']]);
    const chapters = new Map([['ch2', range(6, 12)]]);
    const anchors = new Map([['section-1', 8]]);

    expect(
      findPageForTocEntry(entry('chapter2.xhtml#section-1'), chapters, spine, manifest, anchors),
    ).toBe(8);
  });

  it('falls back to chapter start when fragment not in anchorMap', () => {
    const spine = [spineItem('ch2')];
    const manifest = new Map([['ch2', 'chapter2.xhtml']]);
    const chapters = new Map([['ch2', range(6, 12)]]);
    const anchors = new Map([['other-id', 9]]);

    expect(
      findPageForTocEntry(entry('chapter2.xhtml#missing'), chapters, spine, manifest, anchors),
    ).toBe(6);
  });

  it('combines ../ normalization with fragment anchor lookup', () => {
    const spine = [spineItem('ch3')];
    const manifest = new Map([['ch3', 'OEBPS/Text/chapter3.xhtml']]);
    const chapters = new Map([['ch3', range(10, 15)]]);
    const anchors = new Map([['section-2', 13]]);

    expect(
      findPageForTocEntry(
        entry('../Text/chapter3.xhtml#section-2'),
        chapters,
        spine,
        manifest,
        anchors,
      ),
    ).toBe(13);
  });

  it('ignores anchorMap when href has no fragment', () => {
    const spine = [spineItem('ch1')];
    const manifest = new Map([['ch1', 'chapter1.xhtml']]);
    const chapters = new Map([['ch1', range(0, 5)]]);
    const anchors = new Map([['some-id', 3]]);

    expect(findPageForTocEntry(entry('chapter1.xhtml'), chapters, spine, manifest, anchors)).toBe(
      0,
    );
  });

  // --- P1 fix: cross-chapter ID collision scoping ---

  it('scopes anchor to target chapter — rejects anchor from a different chapter', () => {
    const spine = [spineItem('ch1'), spineItem('ch2')];
    const manifest = new Map([
      ['ch1', 'chapter1.xhtml'],
      ['ch2', 'chapter2.xhtml'],
    ]);
    const chapters = new Map([
      ['ch1', range(0, 4)],
      ['ch2', range(5, 9)],
    ]);
    // "section-1" lands on page 2 (inside ch1), but we're navigating to ch2#section-1
    const anchors = new Map([['section-1', 2]]);

    // Page 2 is outside ch2's range [5,9] — should fall back to ch2 start page
    expect(
      findPageForTocEntry(entry('chapter2.xhtml#section-1'), chapters, spine, manifest, anchors),
    ).toBe(5);
  });

  it('accepts anchor when it falls within the target chapter range', () => {
    const spine = [spineItem('ch1'), spineItem('ch2')];
    const manifest = new Map([
      ['ch1', 'chapter1.xhtml'],
      ['ch2', 'chapter2.xhtml'],
    ]);
    const chapters = new Map([
      ['ch1', range(0, 4)],
      ['ch2', range(5, 9)],
    ]);
    // "section-1" lands on page 7 (inside ch2)
    const anchors = new Map([['section-1', 7]]);

    expect(
      findPageForTocEntry(entry('chapter2.xhtml#section-1'), chapters, spine, manifest, anchors),
    ).toBe(7);
  });

  // --- P2 fix: ambiguous path resolution ---

  it('returns undefined for ambiguous basename when multiple spine items share it', () => {
    const spine = [spineItem('text-ch1'), spineItem('appendix-ch1')];
    const manifest = new Map([
      ['text-ch1', 'Text/ch1.xhtml'],
      ['appendix-ch1', 'Appendix/ch1.xhtml'],
    ]);
    const chapters = new Map([
      ['text-ch1', range(0, 4)],
      ['appendix-ch1', range(5, 9)],
    ]);

    // "../ch1.xhtml" is ambiguous — matches both Text/ch1.xhtml and Appendix/ch1.xhtml
    expect(findPageForTocEntry(entry('../ch1.xhtml'), chapters, spine, manifest)).toBeUndefined();
  });

  it('resolves unambiguous suffix match correctly', () => {
    const spine = [spineItem('text-ch1'), spineItem('appendix-ch2')];
    const manifest = new Map([
      ['text-ch1', 'Text/ch1.xhtml'],
      ['appendix-ch2', 'Appendix/ch2.xhtml'],
    ]);
    const chapters = new Map([
      ['text-ch1', range(0, 4)],
      ['appendix-ch2', range(5, 9)],
    ]);

    // "Text/ch1.xhtml" is unique — unambiguous suffix match
    expect(findPageForTocEntry(entry('../Text/ch1.xhtml'), chapters, spine, manifest)).toBe(0);
  });
});
