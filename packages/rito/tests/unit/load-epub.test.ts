// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadEpub } from '../../src/runtime/load-epub';
import { buildMinimalEpub } from '../helpers/epub-builder';

describe('loadEpub', () => {
  it('loads a minimal EPUB and returns an EpubDocument', () => {
    const data = buildMinimalEpub({ title: 'Test Book', creator: 'Author' });
    const doc = loadEpub(data);

    expect(doc.packageDocument.metadata.title).toBe('Test Book');
    expect(doc.packageDocument.metadata.creator).toBe('Author');
  });

  it('reads chapter content lazily via readChapter', () => {
    const data = buildMinimalEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', content: '<html><body><p>One</p></body></html>' },
        { id: 'ch2', href: 'ch2.xhtml', content: '<html><body><p>Two</p></body></html>' },
      ],
    });
    const doc = loadEpub(data);

    expect(doc.readChapter('ch1')).toContain('<p>One</p>');
    expect(doc.readChapter('ch2')).toContain('<p>Two</p>');
    expect(doc.readChapter('nonexistent')).toBeUndefined();
  });

  it('respects maxChapters option', () => {
    const data = buildMinimalEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', content: '<html><body><p>One</p></body></html>' },
        { id: 'ch2', href: 'ch2.xhtml', content: '<html><body><p>Two</p></body></html>' },
        { id: 'ch3', href: 'ch3.xhtml', content: '<html><body><p>Three</p></body></html>' },
      ],
    });
    const doc = loadEpub(data, { maxChapters: 2 });

    expect(doc.readChapter('ch1')).toBeDefined();
    expect(doc.readChapter('ch2')).toBeDefined();
    expect(doc.readChapter('ch3')).toBeUndefined();
  });

  it('loads stylesheets from manifest', () => {
    const data = buildMinimalEpub({
      stylesheets: [{ id: 'css1', href: 'styles/main.css', content: 'p { color: red; }' }],
    });
    const doc = loadEpub(data);

    expect(doc.stylesheets.size).toBe(1);
    expect(doc.stylesheets.get('styles/main.css')).toContain('color: red');
  });

  it('returns empty stylesheets map when no CSS exists', () => {
    const data = buildMinimalEpub();
    const doc = loadEpub(data);
    expect(doc.stylesheets.size).toBe(0);
  });

  it('loads font files from manifest', () => {
    const fakeFont = new Uint8Array([0, 1, 2, 3]);
    const data = buildMinimalEpub({
      fonts: [{ id: 'font1', href: 'Fonts/test.ttf', mediaType: 'font/ttf', data: fakeFont }],
    });
    const doc = loadEpub(data);

    expect(doc.fonts.size).toBe(1);
    expect(doc.fonts.get('Fonts/test.ttf')).toBeDefined();
    expect(doc.fonts.get('Fonts/test.ttf')?.length).toBe(4);
  });

  it('returns empty fonts map when no fonts exist', () => {
    const data = buildMinimalEpub();
    const doc = loadEpub(data);
    expect(doc.fonts.size).toBe(0);
  });

  it('includes spine and manifest in packageDocument', () => {
    const data = buildMinimalEpub({
      chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: '<html><body></body></html>' }],
    });
    const doc = loadEpub(data);

    expect(doc.packageDocument.spine).toHaveLength(1);
    expect(doc.packageDocument.spine[0]?.idref).toBe('ch1');
    expect(doc.packageDocument.manifest).toHaveLength(1);
  });

  it('provides a close method', () => {
    const data = buildMinimalEpub();
    const doc = loadEpub(data);
    expect(() => {
      doc.close();
    }).not.toThrow();
  });
});
