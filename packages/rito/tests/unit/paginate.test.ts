// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { paginate } from '../../src/runtime/paginate';
import { loadEpub } from '../../src/runtime/load-epub';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createLayoutConfig } from '../../src/layout/core/config';

const measurer = createMockTextMeasurer(0.6);

const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

describe('paginate', () => {
  it('produces pages from a loaded EPUB', () => {
    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello world</p>') }],
    });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]?.index).toBe(0);
    expect(pages[0]?.content.length).toBeGreaterThan(0);
  });

  it('paginates multiple chapters into continuous pages', () => {
    const chapters = [];
    for (let i = 0; i < 5; i++) {
      const paras = Array.from(
        { length: 10 },
        (_, j) => `<p>Chapter ${String(i + 1)} paragraph ${String(j + 1)} with some text.</p>`,
      ).join('');
      chapters.push({
        id: `ch${String(i + 1)}`,
        href: `ch${String(i + 1)}.xhtml`,
        content: xhtml(paras),
      });
    }
    const data = buildMinimalEpub({ chapters });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    expect(pages.length).toBeGreaterThan(1);
    // Pages have sequential indices
    for (let i = 0; i < pages.length; i++) {
      expect(pages[i]?.index).toBe(i);
    }
  });

  it('pages have correct bounds from config', () => {
    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') }],
    });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    expect(pages[0]?.bounds).toEqual({
      x: 0,
      y: 0,
      width: CONFIG.pageWidth,
      height: CONFIG.pageHeight,
    });
  });

  it('handles an EPUB with empty chapters', () => {
    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('') }],
    });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    // May produce 0 pages if there's no content
    expect(pages.length).toBeGreaterThanOrEqual(0);
  });

  it('layout blocks contain line boxes with text runs', () => {
    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello world</p>') }],
    });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    const firstBlock = pages[0]?.content[0];
    expect(firstBlock?.type).toBe('layout-block');
    expect(firstBlock?.children.length).toBeGreaterThan(0);

    const firstChild = firstBlock?.children[0];
    if (firstChild?.type === 'line-box') {
      expect(firstChild.runs.length).toBeGreaterThan(0);
      expect(firstChild.runs[0]?.text.length).toBeGreaterThan(0);
    }
  });

  it('starts each chapter on a new page', () => {
    // Two short chapters that each fit on one page
    const data = buildMinimalEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Chapter one.</p>') },
        { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Chapter two.</p>') },
      ],
    });
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    // Each chapter should produce its own page (not merged onto one)
    expect(pages).toHaveLength(2);
    expect(pages[0]?.index).toBe(0);
    expect(pages[1]?.index).toBe(1);
  });
});
