// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { extractAllFootnotes, extractChapterFootnotes } from '../../src/runtime/footnote-extractor';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function parse(body: string) {
  return parseXhtml(xhtml(body)).nodes;
}

describe('extractChapterFootnotes (single chapter)', () => {
  it('extracts footnote aside referenced by noteref', () => {
    const nodes = parse(`
      <p>Text<a epub:type="noteref" href="#fn1"><sup>1</sup></a></p>
      <aside epub:type="footnote" id="fn1"><p>Footnote content</p></aside>
    `);
    const { filtered, footnotes } = extractChapterFootnotes(nodes, 'OEBPS/Text/ch1.xhtml');
    expect(footnotes.size).toBe(1);
    const entry = footnotes.get('OEBPS/Text/ch1.xhtml#fn1');
    expect(entry?.text).toBe('Footnote content');
    expect(entry?.kind).toBe('footnote');
    expect(entry?.html).toContain('Footnote content');
    expect(filtered.length).toBeLessThan(nodes.length);
  });

  it('leaves unreferenced aside in tree', () => {
    const nodes = parse(`
      <p>No noteref here</p>
      <aside epub:type="footnote" id="fn1"><p>Orphan note</p></aside>
    `);
    const { filtered, footnotes } = extractChapterFootnotes(nodes, 'ch1.xhtml');
    expect(footnotes.size).toBe(0);
    expect(filtered.length).toBe(nodes.length);
  });

  it('handles deprecated epub:type values', () => {
    const nodes = parse(`
      <p><a epub:type="noteref" href="#n1">*</a></p>
      <aside epub:type="endnote" id="n1"><p>Endnote</p></aside>
    `);
    const { footnotes } = extractChapterFootnotes(nodes, 'ch1.xhtml');
    expect(footnotes.get('ch1.xhtml#n1')?.kind).toBe('endnote');
  });

  it('supports non-aside elements with footnote epub:type', () => {
    const nodes = parse(`
      <p><a epub:type="noteref" href="#n1">1</a></p>
      <div epub:type="footnote" id="n1">Note in a div</div>
    `);
    const { footnotes } = extractChapterFootnotes(nodes, 'ch1.xhtml');
    expect(footnotes.size).toBe(1);
  });

  it('recursively removes nested footnotes', () => {
    const nodes = parse(`
      <p><a epub:type="noteref" href="#n1">1</a></p>
      <div><aside epub:type="footnote" id="n1"><p>Nested</p></aside></div>
    `);
    const { footnotes } = extractChapterFootnotes(nodes, 'ch1.xhtml');
    expect(footnotes.size).toBe(1);
    expect(footnotes.get('ch1.xhtml#n1')?.text).toBe('Nested');
  });
});

describe('extractAllFootnotes (cross-chapter)', () => {
  const hrefMap = new Map([
    ['chapter1', 'OEBPS/Text/chapter1.xhtml'],
    ['chapter2', 'OEBPS/Text/chapter2.xhtml'],
    ['notes', 'OEBPS/Text/notes.xhtml'],
  ]);

  it('duplicate fragment IDs in different chapters do not collide', () => {
    const ch1 = parse(`
      <p><a epub:type="noteref" href="#note1">*</a></p>
      <aside epub:type="footnote" id="note1"><p>Chapter 1 note</p></aside>
    `);
    const ch2 = parse(`
      <p><a epub:type="noteref" href="#note1">*</a></p>
      <aside epub:type="footnote" id="note1"><p>Chapter 2 note</p></aside>
    `);
    const chapters = new Map([
      ['chapter1', ch1],
      ['chapter2', ch2],
    ]);
    const { footnotes } = extractAllFootnotes(chapters, hrefMap);
    expect(footnotes.size).toBe(2);
    expect(footnotes.get('OEBPS/Text/chapter1.xhtml#note1')?.text).toBe('Chapter 1 note');
    expect(footnotes.get('OEBPS/Text/chapter2.xhtml#note1')?.text).toBe('Chapter 2 note');
  });

  it('noteref in chapter A does not extract aside in chapter B (same-doc scoping)', () => {
    const chA = parse(`<p><a epub:type="noteref" href="#fn1">*</a></p>`);
    const chB = parse(`<aside epub:type="footnote" id="fn1"><p>Should stay</p></aside>`);
    const chapters = new Map([
      ['chapter1', chA],
      ['chapter2', chB],
    ]);
    const { footnotes, filteredChapters } = extractAllFootnotes(chapters, hrefMap);
    expect(footnotes.size).toBe(0);
    expect(filteredChapters.get('chapter2')?.length).toBe(chB.length);
  });

  it('cross-document noteref resolves against manifest href', () => {
    const ch1 = parse(`
      <p><a epub:type="noteref" href="../Text/notes.xhtml#n1">*</a></p>
    `);
    const notes = parse(`
      <aside epub:type="footnote" id="n1"><p>Cross-doc note</p></aside>
    `);
    const chapters = new Map([
      ['chapter1', ch1],
      ['notes', notes],
    ]);
    const { footnotes } = extractAllFootnotes(chapters, hrefMap);
    expect(footnotes.size).toBe(1);
    expect(footnotes.get('OEBPS/Text/notes.xhtml#n1')?.text).toBe('Cross-doc note');
  });

  it('text preserves inline adjacency and adds space at block boundaries', () => {
    const nodes = parse(`
      <p><a epub:type="noteref" href="#n1">1</a></p>
      <aside epub:type="footnote" id="n1">
        <p>foo<em>bar</em>baz</p>
        <p>Second paragraph</p>
      </aside>
    `);
    const { footnotes } = extractChapterFootnotes(nodes, 'ch.xhtml');
    const entry = footnotes.get('ch.xhtml#n1');
    // Inline: no space between foo/bar/baz. Block boundary: space between paragraphs.
    expect(entry?.text).toBe('foobarbaz Second paragraph');
  });

  it('html preserves attributes (class, href, style, lang)', () => {
    const nodes = parse(`
      <p><a epub:type="noteref" href="#n1">1</a></p>
      <aside epub:type="footnote" id="n1">
        <p class="note-text" lang="ja">注：<a href="#ref1">返回</a></p>
      </aside>
    `);
    const { footnotes } = extractChapterFootnotes(nodes, 'ch.xhtml');
    const entry = footnotes.get('ch.xhtml#n1');
    expect(entry?.html).toContain('class="note-text"');
    expect(entry?.html).toContain('lang="ja"');
    expect(entry?.html).toContain('href="#ref1"');
  });
});
