// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockCanvasContext } from '../helpers/mock-canvas-context';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import type { Reader, ReaderOptions } from '../../src/reader';

/**
 * Mock loadAssets so we skip real font loading, image decoding, and canvas
 * text measurement (none of which exist in a happy-dom / Node environment).
 */
vi.mock('../../src/render/resources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/render/resources')>();
  const mockMeasurer = createMockTextMeasurer(0.6);
  return {
    ...actual,
    loadAssets: vi.fn(() =>
      Promise.resolve({
        images: new Map<string, ImageBitmap>(),
        measurer: mockMeasurer,
      }),
    ),
    disposeAssets: vi.fn(),
  };
});

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function createMockCanvas(): HTMLCanvasElement {
  const mockCtx = createMockCanvasContext();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => mockCtx.ctx),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

const DEFAULT_OPTIONS: ReaderOptions = {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'single',
  devicePixelRatio: 1,
};

async function buildReader(opts?: {
  epubOptions?: Parameters<typeof buildMinimalEpub>[0];
  readerOptions?: Partial<ReaderOptions>;
}): Promise<Reader> {
  const { createReader } = await import('../../src/reader');
  const data = buildMinimalEpub(opts?.epubOptions);
  const canvas = createMockCanvas();
  return createReader(data, canvas, { ...DEFAULT_OPTIONS, ...opts?.readerOptions });
}

describe('createReader', () => {
  describe('returned Reader object shape', () => {
    it('returns an object with all expected properties and methods', async () => {
      const reader = await buildReader();

      // Read-only properties
      expect(reader.metadata).toBeDefined();
      expect(typeof reader.totalSpreads).toBe('number');
      expect(Array.isArray(reader.toc)).toBe(true);
      expect(reader.chapterMap).toBeInstanceOf(Map);
      expect(Array.isArray(reader.pages)).toBe(true);
      expect(Array.isArray(reader.spreads)).toBe(true);

      // Methods
      expect(typeof reader.renderSpread).toBe('function');
      expect(typeof reader.resize).toBe('function');
      expect(typeof reader.setSpreadMode).toBe('function');
      expect(typeof reader.updateLayout).toBe('function');
      expect(typeof reader.setTheme).toBe('function');
      expect(typeof reader.findPage).toBe('function');
      expect(typeof reader.findSpread).toBe('function');
      expect(typeof reader.resolveTocEntry).toBe('function');
      expect(typeof reader.findActiveTocEntry).toBe('function');
      expect(typeof reader.getCanvasSize).toBe('function');
      expect(typeof reader.dispose).toBe('function');
    });
  });

  describe('metadata', () => {
    it('exposes EPUB metadata from the loaded document', async () => {
      const reader = await buildReader({
        epubOptions: {
          title: 'My Book',
          creator: 'Test Author',
          language: 'en',
          identifier: 'urn:uuid:abc-123',
        },
      });

      expect(reader.metadata.title).toBe('My Book');
      expect(reader.metadata.creator).toBe('Test Author');
      expect(reader.metadata.language).toBe('en');
      expect(reader.metadata.identifier).toBe('urn:uuid:abc-123');
    });
  });

  describe('pages and spreads', () => {
    it('produces at least one page from a chapter with content', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello world</p>') }],
        },
      });

      expect(reader.pages.length).toBeGreaterThan(0);
      expect(reader.totalSpreads).toBeGreaterThan(0);
      expect(reader.spreads.length).toBe(reader.totalSpreads);
    });

    it('pages have sequential indices', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Short content.</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Another chapter.</p>') },
          ],
        },
      });

      for (let i = 0; i < reader.pages.length; i++) {
        expect(reader.pages[i]?.index).toBe(i);
      }
    });

    it('in single mode, each page is its own spread', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>World</p>') },
          ],
        },
        readerOptions: { spread: 'single' },
      });

      expect(reader.totalSpreads).toBe(reader.pages.length);
      for (const spread of reader.spreads) {
        expect(spread.left).toBeDefined();
        expect(spread.right).toBeUndefined();
      }
    });
  });

  describe('chapterMap', () => {
    it('maps spine item idrefs to page ranges', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>First</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Second</p>') },
          ],
        },
      });

      expect(reader.chapterMap.size).toBe(2);
      const ch1Range = reader.chapterMap.get('ch1');
      expect(ch1Range).toBeDefined();
      expect(typeof ch1Range?.startPage).toBe('number');
      expect(typeof ch1Range?.endPage).toBe('number');
    });
  });

  describe('toc', () => {
    it('returns the table of contents from the EPUB', async () => {
      const reader = await buildReader();
      // The minimal EPUB does not contain a nav document, so toc is empty
      expect(Array.isArray(reader.toc)).toBe(true);
    });
  });

  describe('renderSpread', () => {
    it('does not throw for valid spread index', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Content</p>') }],
        },
      });

      expect(() => {
        reader.renderSpread(0);
      }).not.toThrow();
    });

    it('warns but does not throw for out-of-range index', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Content</p>') }],
        },
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      reader.renderSpread(-1);
      reader.renderSpread(reader.totalSpreads + 10);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      warnSpy.mockRestore();
    });

    it('accepts an optional scale parameter', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Content</p>') }],
        },
      });

      expect(() => {
        reader.renderSpread(0, 2);
      }).not.toThrow();
    });
  });

  describe('resize', () => {
    it('re-paginates the document with new dimensions', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Some content here.</p>') }],
        },
        readerOptions: { width: 800, height: 600 },
      });

      reader.resize(400, 300);
      // After resize, the reader should still be usable
      expect(reader.totalSpreads).toBeGreaterThan(0);
      expect(reader.pages.length).toBeGreaterThan(0);
    });

    it('updates spreads after resize', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') }],
        },
      });

      reader.resize(200, 300);
      expect(reader.spreads.length).toBe(reader.totalSpreads);
    });
  });

  describe('setSpreadMode', () => {
    it('switches from single to double mode', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Page one.</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Page two.</p>') },
          ],
        },
        readerOptions: { spread: 'single', width: 800, height: 600 },
      });

      const singleSpreads = reader.totalSpreads;
      expect(singleSpreads).toBe(reader.pages.length);

      reader.setSpreadMode('double');
      // In double mode, spreads should be <= single mode (pages pair up)
      expect(reader.totalSpreads).toBeLessThanOrEqual(singleSpreads);
    });

    it('switches from double to single mode', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>World</p>') },
          ],
        },
        readerOptions: { spread: 'double', width: 800, height: 600 },
      });

      reader.setSpreadMode('single');
      // In single mode every page is its own spread
      expect(reader.totalSpreads).toBe(reader.pages.length);
    });

    it('re-paginates and updates spreads', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Content</p>') }],
        },
      });

      reader.setSpreadMode('double');
      expect(reader.spreads.length).toBe(reader.totalSpreads);
      expect(reader.pages.length).toBeGreaterThan(0);
    });
  });

  describe('updateLayout', () => {
    it('returns false when the requested layout is unchanged', async () => {
      const reader = await buildReader();

      expect(reader.updateLayout(800, 600, 'single')).toBe(false);
    });

    it('applies size and spread changes in one pass', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Page one.</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Page two.</p>') },
          ],
        },
        readerOptions: { spread: 'single', width: 800, height: 600 },
      });

      expect(reader.updateLayout(400, 300, 'double')).toBe(true);
      expect(reader.spreads.length).toBe(reader.totalSpreads);
      expect(reader.totalSpreads).toBeLessThanOrEqual(reader.pages.length);
    });

    it('remembers the requested spread mode even when portrait falls back to single', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Page one.</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Page two.</p>') },
            { id: 'ch3', href: 'ch3.xhtml', content: xhtml('<p>Page three.</p>') },
          ],
        },
        readerOptions: { spread: 'single', width: 400, height: 600 },
      });

      expect(reader.updateLayout(400, 600, 'double')).toBe(false);
      expect(reader.totalSpreads).toBe(reader.pages.length);
      expect(reader.updateLayout(800, 600)).toBe(true);
      expect(reader.totalSpreads).toBeLessThanOrEqual(reader.pages.length);
    });
  });

  describe('setTheme', () => {
    it('updates background color', async () => {
      const reader = await buildReader();
      expect(() => {
        reader.setTheme({ backgroundColor: '#000000' });
      }).not.toThrow();
    });

    it('updates foreground color', async () => {
      const reader = await buildReader();
      expect(() => {
        reader.setTheme({ foregroundColor: '#ffffff' });
      }).not.toThrow();
    });

    it('can update both colors at once', async () => {
      const reader = await buildReader();
      expect(() => {
        reader.setTheme({ backgroundColor: '#1a1a1a', foregroundColor: '#e0e0e0' });
      }).not.toThrow();
    });

    it('does not re-paginate (no side effects on pages/spreads)', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Content</p>') }],
        },
      });

      const pageCount = reader.pages.length;
      const spreadCount = reader.totalSpreads;

      reader.setTheme({ backgroundColor: '#333', foregroundColor: '#ccc' });

      expect(reader.pages.length).toBe(pageCount);
      expect(reader.totalSpreads).toBe(spreadCount);
    });
  });

  describe('findSpread', () => {
    it('returns the spread index for a given page index', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>World</p>') },
          ],
        },
        readerOptions: { spread: 'single' },
      });

      // In single mode, spread index equals page index
      for (let i = 0; i < reader.pages.length; i++) {
        expect(reader.findSpread(i)).toBe(i);
      }
    });

    it('returns undefined for a page index that does not exist', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') }],
        },
      });

      expect(reader.findSpread(9999)).toBeUndefined();
    });
  });

  describe('findPage', () => {
    it('returns a page index for a valid TOC entry', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'chapter1.xhtml', content: xhtml('<p>First chapter</p>') },
            { id: 'ch2', href: 'chapter2.xhtml', content: xhtml('<p>Second chapter</p>') },
          ],
        },
      });

      // Create a TOC-like entry matching a chapter href
      const entry = { label: 'Chapter 2', href: 'chapter2.xhtml', children: [] };
      const pageIndex = reader.findPage(entry);
      // Should resolve to the start page of chapter 2
      expect(pageIndex).toBeDefined();
      expect(typeof pageIndex).toBe('number');
    });

    it('returns undefined for a non-existent TOC entry', async () => {
      const reader = await buildReader();
      const entry = { label: 'Missing', href: 'nonexistent.xhtml', children: [] };
      expect(reader.findPage(entry)).toBeUndefined();
    });
  });

  describe('resolveTocEntry', () => {
    it('returns both page and spread indices for a valid TOC entry', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'chapter1.xhtml', content: xhtml('<p>First chapter</p>') },
            { id: 'ch2', href: 'chapter2.xhtml', content: xhtml('<p>Second chapter</p>') },
          ],
        },
      });

      const entry = { label: 'Chapter 2', href: 'chapter2.xhtml', children: [] };
      const location = reader.resolveTocEntry(entry);

      expect(location).toBeDefined();
      expect(location?.pageIndex).toBeTypeOf('number');
      expect(location?.spreadIndex).toBeTypeOf('number');
    });
  });

  describe('findActiveTocEntry', () => {
    it('returns the closest TOC entry at or before the given page', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'chapter1.xhtml', content: xhtml('<p>First chapter</p>') },
            { id: 'ch2', href: 'chapter2.xhtml', content: xhtml('<p>Second chapter</p>') },
          ],
          toc: [
            { label: 'Chapter 1', href: 'chapter1.xhtml' },
            { label: 'Chapter 2', href: 'chapter2.xhtml' },
          ],
        },
      });

      expect(reader.findActiveTocEntry(0)?.href).toBe('chapter1.xhtml');
      const chapter2Page = reader.findPage({
        label: 'Chapter 2',
        href: 'chapter2.xhtml',
        children: [],
      });
      expect(chapter2Page).toBeDefined();
      expect(reader.findActiveTocEntry(chapter2Page ?? 0)?.href).toBe('chapter2.xhtml');
    });
  });

  describe('getCanvasSize', () => {
    it('returns the viewport dimensions at scale 1 with dpr 1', async () => {
      const reader = await buildReader({
        readerOptions: { width: 800, height: 600, devicePixelRatio: 1 },
      });

      const size = reader.getCanvasSize();
      expect(size.width).toBe(800);
      expect(size.height).toBe(600);
    });

    it('scales the canvas size by the given scale factor', async () => {
      const reader = await buildReader({
        readerOptions: { width: 800, height: 600, devicePixelRatio: 1 },
      });

      const size = reader.getCanvasSize(2);
      expect(size.width).toBe(1600);
      expect(size.height).toBe(1200);
    });

    it('accounts for DPR internally (CSS size stays the same)', async () => {
      const reader = await buildReader({
        readerOptions: { width: 800, height: 600, devicePixelRatio: 2 },
      });

      // CSS size should remain 800x600 regardless of DPR
      const size = reader.getCanvasSize(1);
      expect(size.width).toBe(800);
      expect(size.height).toBe(600);
    });
  });

  describe('dispose', () => {
    it('does not throw', async () => {
      const reader = await buildReader();
      expect(() => {
        reader.dispose();
      }).not.toThrow();
    });

    it('calls disposeAssets', async () => {
      const { disposeAssets } = await import('../../src/render/resources');
      const reader = await buildReader();
      reader.dispose();
      expect(disposeAssets).toHaveBeenCalled();
    });
  });

  describe('multi-chapter navigation support', () => {
    it('creates a chapter map with entries for each spine item', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Chapter 1</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Chapter 2</p>') },
            { id: 'ch3', href: 'ch3.xhtml', content: xhtml('<p>Chapter 3</p>') },
          ],
        },
      });

      expect(reader.chapterMap.size).toBe(3);
      expect(reader.chapterMap.has('ch1')).toBe(true);
      expect(reader.chapterMap.has('ch2')).toBe(true);
      expect(reader.chapterMap.has('ch3')).toBe(true);
    });

    it('chapter ranges have non-overlapping page ranges', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Chapter 1</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Chapter 2</p>') },
          ],
        },
      });

      const ch1 = reader.chapterMap.get('ch1');
      const ch2 = reader.chapterMap.get('ch2');
      expect(ch1).toBeDefined();
      expect(ch2).toBeDefined();
      // ch2 starts at or after ch1 ends
      expect(ch2?.startPage).toBeGreaterThanOrEqual(ch1?.endPage ?? 0);
    });
  });

  describe('default options', () => {
    it('defaults to single spread mode', async () => {
      const { createReader } = await import('../../src/reader');
      const data = buildMinimalEpub({
        chapters: [
          { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') },
          { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>World</p>') },
        ],
      });
      const canvas = createMockCanvas();
      const reader = await createReader(data, canvas, { width: 800, height: 600 });

      // Default spread mode is single: each page is its own spread
      expect(reader.totalSpreads).toBe(reader.pages.length);
    });

    it('defaults devicePixelRatio to 1 in non-browser environments', async () => {
      const reader = await buildReader({
        readerOptions: { width: 400, height: 300 },
      });

      // With default DPR=1, canvas size should equal viewport size
      const size = reader.getCanvasSize(1);
      expect(size.width).toBe(400);
      expect(size.height).toBe(300);
    });
  });

  describe('double spread mode', () => {
    it('pairs pages into spreads in double mode', async () => {
      const chapters = [];
      for (let i = 0; i < 4; i++) {
        const paras = Array.from(
          { length: 5 },
          (_, j) => `<p>Ch ${String(i + 1)} para ${String(j + 1)} with some filler text.</p>`,
        ).join('');
        chapters.push({
          id: `ch${String(i + 1)}`,
          href: `ch${String(i + 1)}.xhtml`,
          content: xhtml(paras),
        });
      }

      const reader = await buildReader({
        epubOptions: { chapters },
        readerOptions: { spread: 'double', width: 800, height: 600 },
      });

      // In double mode, spreads <= pages (pages can pair up)
      expect(reader.totalSpreads).toBeLessThanOrEqual(reader.pages.length);
    });

    it('forces single mode for portrait viewport', async () => {
      const reader = await buildReader({
        epubOptions: {
          chapters: [
            { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Hello</p>') },
            { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>World</p>') },
          ],
        },
        // Portrait: height > width
        readerOptions: { spread: 'double', width: 400, height: 600 },
      });

      // Portrait viewport forces single mode
      expect(reader.totalSpreads).toBe(reader.pages.length);
    });
  });
});
