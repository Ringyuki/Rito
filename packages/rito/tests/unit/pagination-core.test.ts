// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createLayoutConfig } from '../../src/layout/config';
import type { Page } from '../../src/layout/types';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { paginateChapterNodes, preparePaginationContext } from '../../src/runtime/pagination-core';
import { loadEpub } from '../../src/runtime/load-epub';
import { paginateWithMeta } from '../../src/runtime/paginate';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { buildMinimalEpub } from '../helpers/epub-builder';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function longParagraph(word: string, count: number): string {
  return `<p>${Array.from({ length: count }, () => word).join(' ')}</p>`;
}

describe('pagination-core', () => {
  const config = createLayoutConfig({ width: 260, height: 320, margin: 20 });

  it('matches paginateWithMeta when chapters are paginated incrementally from parsed nodes', () => {
    const data = buildMinimalEpub({
      chapters: [
        {
          id: 'ch1',
          href: 'chapter1.xhtml',
          content: xhtml(
            `<h1 id="ch1-start">Chapter 1</h1>${longParagraph('alpha', 120)}<h2 id="ch1-mid">Mid</h2>${longParagraph('beta', 80)}`,
          ),
        },
        {
          id: 'ch2',
          href: 'Text/chapter2.xhtml',
          content: xhtml(
            `<h1 id="ch2-start">Chapter 2</h1>${longParagraph('gamma', 90)}<div id="ch2-end">${longParagraph('delta', 70)}</div>`,
          ),
        },
      ],
      stylesheets: [
        {
          id: 'main',
          href: 'styles/book.css',
          content:
            'body { font-size: 18px; } h1 { margin-top: 0; } h2 { page-break-before: always; }',
        },
      ],
    });

    const doc = loadEpub(data);
    const measurer = createMockTextMeasurer(0.6);
    const expected = paginateWithMeta(doc, config, measurer);
    const context = preparePaginationContext(config, measurer, doc.stylesheets);

    const pages: Page[] = [];
    const chapterMap = new Map<string, { startPage: number; endPage: number }>();
    const anchorMap = new Map<string, number>();

    for (const spineItem of doc.packageDocument.spine) {
      const xhtmlContent = doc.readChapter(spineItem.idref);
      if (!xhtmlContent) continue;

      const { nodes } = parseXhtml(xhtmlContent);
      const startPage = pages.length;
      const chapter = paginateChapterNodes(nodes, config, context, startPage);
      if (chapter.pages.length === 0) continue;

      pages.push(...chapter.pages);
      for (const [anchorId, pageIndex] of chapter.anchorMap) {
        if (!anchorMap.has(anchorId)) anchorMap.set(anchorId, pageIndex);
      }
      chapterMap.set(spineItem.idref, { startPage, endPage: pages.length - 1 });
    }

    expect(pages).toEqual(expected.pages);
    expect(Array.from(chapterMap.entries())).toEqual(Array.from(expected.chapterMap.entries()));
    expect(Array.from(anchorMap.entries())).toEqual(Array.from(expected.anchorMap.entries()));
  });

  it('resolves image hrefs the same way for bitmap maps and plain size maps', () => {
    const { nodes } = parseXhtml(
      xhtml('<img src="../Images/photo.jpg" alt="cover" /><p>After image</p>'),
    );
    const measurer = createMockTextMeasurer(0.6);
    const bitmapImages = new Map([
      ['Images/photo.jpg', { width: 800, height: 400 } as ImageBitmap],
    ]);
    const sizeImages = new Map([['Images/photo.jpg', { width: 800, height: 400 }]]);

    const bitmapContext = preparePaginationContext(
      config,
      measurer,
      new Map<string, string>(),
      bitmapImages,
    );
    const sizeContext = preparePaginationContext(
      config,
      measurer,
      new Map<string, string>(),
      sizeImages,
    );

    const bitmapResult = paginateChapterNodes(nodes, config, bitmapContext, 0);
    const sizeResult = paginateChapterNodes(nodes, config, sizeContext, 0);

    expect(bitmapResult.pages).toEqual(sizeResult.pages);
    expect(Array.from(bitmapResult.anchorMap.entries())).toEqual(
      Array.from(sizeResult.anchorMap.entries()),
    );
  });
});
