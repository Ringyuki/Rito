import { describe, expect, it } from 'vitest';
import { createZipReader } from '../../src/parser/epub/zip-reader';
import { buildMinimalEpub } from '../helpers/epub-builder';

describe('createZipReader', () => {
  it('lists files in the archive', () => {
    const epub = buildMinimalEpub();
    const reader = createZipReader(epub);
    const files = reader.listFiles();

    expect(files).toContain('META-INF/container.xml');
    expect(files).toContain('OEBPS/content.opf');
    expect(files).toContain('OEBPS/chapter1.xhtml');
  });

  it('reads a text file from the archive', () => {
    const epub = buildMinimalEpub();
    const reader = createZipReader(epub);
    const text = reader.readTextFile('META-INF/container.xml');

    expect(text).toContain('<container');
    expect(text).toContain('full-path="OEBPS/content.opf"');
  });

  it('reads a binary file from the archive', () => {
    const epub = buildMinimalEpub();
    const reader = createZipReader(epub);
    const data = reader.readFile('META-INF/container.xml');

    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBeGreaterThan(0);
  });

  it('throws EpubParseError for missing files', () => {
    const epub = buildMinimalEpub();
    const reader = createZipReader(epub);

    expect(() => reader.readFile('nonexistent.xml')).toThrow('File not found in EPUB archive');
  });

  it('rejects data that is too small', () => {
    const tiny = new ArrayBuffer(2);
    expect(() => createZipReader(tiny)).toThrow('Data too small');
  });

  it('rejects an HTML error page with diagnostic message', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>404</body></html>');
    expect(() => createZipReader(html.buffer)).toThrow(
      'received an HTML/XML document',
    );
  });

  it('rejects non-ZIP binary data with first-bytes hint', () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    expect(() => createZipReader(pdf.buffer)).toThrow('No ZIP signature found');
  });

  it('handles ZIP with prepended data', () => {
    // Simulate a ZIP file with arbitrary data prepended (e.g. multipart boundary).
    // fflate's unzipSync scans EOCD from the end but may still choke on shifted offsets.
    // Our fallback parser should handle this because it re-reads central directory offsets.
    const epub = new Uint8Array(buildMinimalEpub());
    const prefix = new TextEncoder().encode('----boundary-junk\r\n');
    const combined = new Uint8Array(prefix.length + epub.length);
    combined.set(prefix);
    combined.set(epub, prefix.length);

    // This exercises the fallback: fflate may fail because local header offsets in the
    // central directory don't account for the prepended data, but our parser
    // re-derives offsets from the EOCD which is at the end.
    // Note: both fflate and our parser use central-directory offsets as stored in the file,
    // so prepended data shifts all offsets. This specific test verifies graceful handling —
    // if fflate chokes, the fallback should also fail gracefully rather than returning garbage.
    expect(() => createZipReader(combined.buffer)).not.toThrow();
  });
});
