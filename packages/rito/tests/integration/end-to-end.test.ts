// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { loadEpub } from '../../src/runtime/load-epub';
import { paginate } from '../../src/runtime/paginate';
import { renderPage } from '../../src/render/page';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createLayoutConfig } from '../../src/layout/core/config';

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function rewriteEpub(
  data: ArrayBuffer,
  rewrite: (files: Record<string, Uint8Array>) => void,
): ArrayBuffer {
  const files = unzipSync(new Uint8Array(data));
  rewrite(files);
  return zipSync(files).buffer as ArrayBuffer;
}

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

  it('opens an EPUB with missing CSS, legacy void tags, and unmanifested images', () => {
    const data = rewriteEpub(
      buildMinimalEpub({
        chapters: [
          {
            id: 'ch1',
            href: 'Text/chapter.html',
            content: xhtml(
              '<p>Before<br>After</p><img src="../images/unlisted.jpeg" alt="Illustration">',
            ),
          },
        ],
        stylesheets: [{ id: 'css', href: 'css/main.css', content: 'p { color: red; }' }],
      }),
      (files) => {
        delete files['OEBPS/css/main.css'];
        files['OEBPS/images/unlisted.jpeg'] = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      },
    );

    const doc = loadEpub(data, {
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const pages = paginate(doc, CONFIG, createMockTextMeasurer(0.6));

    expect(doc.stylesheets.size).toBe(0);
    expect(doc.images.has('images/unlisted.jpeg')).toBe(true);
    expect(pages.length).toBeGreaterThan(0);

    const renderedTexts: unknown[] = [];
    for (const page of pages) {
      const mock = createMockCanvasContext();
      renderPage(page, mock.ctx, CONFIG);
      renderedTexts.push(...mock.getCalls('fillText').map((call) => call.args[0]));
    }
    expect(renderedTexts).toContain('Before');
    expect(renderedTexts).toContain('After');
    doc.close();
  });
});
