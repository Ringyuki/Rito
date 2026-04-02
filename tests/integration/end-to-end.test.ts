// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadEpub } from '../../src/runtime/load-epub';
import { paginate } from '../../src/runtime/paginate';
import { renderPage } from '../../src/render/page-renderer';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { buildMinimalEpub } from '../helpers/epub-builder';
import type { LayoutConfig } from '../../src/layout/types';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

const CONFIG: LayoutConfig = {
  pageWidth: 400,
  pageHeight: 600,
  marginTop: 20,
  marginRight: 20,
  marginBottom: 20,
  marginLeft: 20,
};

describe('end-to-end: loadEpub → paginate → renderPage', () => {
  it('renders a minimal EPUB to canvas', () => {
    const data = buildMinimalEpub({
      title: 'E2E Test',
      chapters: [
        {
          id: 'ch1',
          href: 'ch1.xhtml',
          content: xhtml('<h1>Hello</h1><p>This is a test paragraph.</p>'),
        },
      ],
    });

    const measurer = createMockTextMeasurer(0.6);
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    expect(pages.length).toBeGreaterThan(0);

    const firstPage = pages[0];
    if (!firstPage) throw new Error('Expected at least one page');

    const mock = createMockCanvasContext();
    renderPage(firstPage, mock.ctx, CONFIG, { backgroundColor: '#ffffff' });

    // Verify background was drawn
    const fillRectCalls = mock.getCalls('fillRect');
    expect(fillRectCalls).toHaveLength(1);

    // Verify text was drawn
    const fillTextCalls = mock.getCalls('fillText');
    expect(fillTextCalls.length).toBeGreaterThan(0);

    // Verify "Hello" appears in the rendered text
    const renderedTexts = fillTextCalls.map((c) => c.args[0]);
    expect(renderedTexts).toContain('Hello');
  });

  it('produces multiple pages for long content', () => {
    const paras = Array.from(
      { length: 30 },
      (_, i) =>
        `<p>Paragraph ${String(i + 1)} with enough words to fill some space on the page.</p>`,
    ).join('');

    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml(paras) }],
    });

    const measurer = createMockTextMeasurer(0.6);
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    expect(pages.length).toBeGreaterThan(1);

    // Render each page and verify all produce draw calls
    for (const page of pages) {
      const mock = createMockCanvasContext();
      renderPage(page, mock.ctx, CONFIG);
      const calls = mock.getCalls('fillText');
      expect(calls.length).toBeGreaterThan(0);
    }
  });

  it('multi-chapter EPUB renders all chapters', () => {
    const data = buildMinimalEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Chapter one content.</p>') },
        { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Chapter two content.</p>') },
      ],
    });

    const measurer = createMockTextMeasurer(0.6);
    const doc = loadEpub(data);
    const pages = paginate(doc, CONFIG, measurer);

    // Collect all rendered text across all pages
    const allTexts: unknown[] = [];
    for (const page of pages) {
      const mock = createMockCanvasContext();
      renderPage(page, mock.ctx, CONFIG);
      allTexts.push(...mock.getCalls('fillText').map((c) => c.args[0]));
    }

    // Both chapters' content should be present
    expect(allTexts.some((t) => String(t).includes('one'))).toBe(true);
    expect(allTexts.some((t) => String(t).includes('two'))).toBe(true);
  });
});
