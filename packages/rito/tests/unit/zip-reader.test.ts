import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { createZipReader } from '../../src/reference/ts-core/parser/epub/zip-reader';
import { buildMinimalEpub } from '../helpers/epub-builder';

function findSignature(data: Uint8Array, signature: number): number {
  for (let offset = 0; offset <= data.length - 4; offset++) {
    const value =
      ((data[offset] ?? 0) |
        ((data[offset + 1] ?? 0) << 8) |
        ((data[offset + 2] ?? 0) << 16) |
        ((data[offset + 3] ?? 0) << 24)) >>>
      0;
    if (value === signature) return offset;
  }
  throw new Error(`ZIP signature not found: ${signature.toString(16)}`);
}

function writeU16(data: Uint8Array, offset: number, value: number): void {
  data[offset] = value & 0xff;
  data[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  writeU16(data, offset, value & 0xffff);
  writeU16(data, offset + 2, value >>> 16);
}

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

  it('resolves a percent-encoded href to its literal entry name', () => {
    // Real EPUBs (e.g. some Sigil exports) reference "Character%20Profile.xhtml"
    // while the actual zip entry name contains a literal space.
    const zip = zipSync({
      'OEBPS/Text/Character Profile.xhtml': new TextEncoder().encode('<p>hi</p>'),
    });
    const reader = createZipReader(zip.buffer as ArrayBuffer);

    expect(reader.readTextFile('OEBPS/Text/Character%20Profile.xhtml')).toBe('<p>hi</p>');
    // a literal path still resolves directly
    expect(reader.readTextFile('OEBPS/Text/Character Profile.xhtml')).toBe('<p>hi</p>');
  });

  it('still throws for a percent-encoded path with no matching entry', () => {
    const zip = zipSync({ 'OEBPS/a.xhtml': new TextEncoder().encode('x') });
    const reader = createZipReader(zip.buffer as ArrayBuffer);

    expect(() => reader.readFile('OEBPS/missing%20file.xhtml')).toThrow(
      'File not found in EPUB archive',
    );
  });

  it('rejects data that is too small', () => {
    const tiny = new ArrayBuffer(2);
    expect(() => createZipReader(tiny)).toThrow('Data too small');
  });

  it('rejects an HTML error page with diagnostic message', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><body>404</body></html>');
    expect(() => createZipReader(html.buffer)).toThrow('received an HTML/XML document');
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

  it('enforces the central-directory entry-count budget before extraction', () => {
    const zip = zipSync({
      'one.txt': new Uint8Array([1]),
      'two.txt': new Uint8Array([2]),
    });

    expect(() => createZipReader(zip.buffer as ArrayBuffer, { maxEntries: 1 })).toThrow(
      'maxEntries',
    );
  });

  it('enforces single-entry and aggregate uncompressed-size budgets', () => {
    const zip = zipSync({
      'one.bin': new Uint8Array(8),
      'two.bin': new Uint8Array(8),
    });

    expect(() =>
      createZipReader(zip.buffer as ArrayBuffer, { maxEntryUncompressedBytes: 7 }),
    ).toThrow('maxEntryUncompressedBytes');
    expect(() =>
      createZipReader(zip.buffer as ArrayBuffer, { maxTotalUncompressedBytes: 15 }),
    ).toThrow('maxTotalUncompressedBytes');
  });

  it('enforces compressed input and per-entry compression-ratio budgets', () => {
    const zip = zipSync({ 'zeros.bin': new Uint8Array(10_000) });

    expect(() =>
      createZipReader(zip.buffer as ArrayBuffer, { maxArchiveBytes: zip.length - 1 }),
    ).toThrow('maxArchiveBytes');
    expect(() => createZipReader(zip.buffer as ArrayBuffer, { maxCompressionRatio: 2 })).toThrow(
      'maxCompressionRatio',
    );
  });

  it('rejects a forged huge output size before allocating the declared buffer', () => {
    const zip = zipSync({ 'small.txt': new TextEncoder().encode('small') }).slice();
    const centralDirectory = findSignature(zip, 0x02014b50);
    writeU32(zip, centralDirectory + 24, 0x7fffffff);

    expect(() => createZipReader(zip.buffer)).toThrow('maxEntryUncompressedBytes');
  });

  it('detects a forged small output size without expanding the full hidden payload', () => {
    const zip = zipSync({ 'bomb.bin': new Uint8Array(1_000_000) }).slice();
    const centralDirectory = findSignature(zip, 0x02014b50);
    writeU32(zip, centralDirectory + 24, 1);

    expect(() => createZipReader(zip.buffer)).toThrow('inconsistent uncompressed size');
  });

  it('decodes legacy CP437 filenames when the UTF-8 flag is unset', () => {
    const zip = zipSync({ 'x.txt': new TextEncoder().encode('legacy') }).slice();
    const localHeader = findSignature(zip, 0x04034b50);
    const centralDirectory = findSignature(zip, 0x02014b50);
    writeU16(zip, localHeader + 6, 0);
    writeU16(zip, centralDirectory + 8, 0);
    zip[localHeader + 30] = 0x82;
    zip[centralDirectory + 46] = 0x82;

    const reader = createZipReader(zip.buffer);
    expect(reader.listFiles()).toContain('é.txt');
    expect(reader.readTextFile('é.txt')).toBe('legacy');
  });

  it('reliably rejects malformed filenames marked as UTF-8', () => {
    const zip = zipSync({ 'x.txt': new TextEncoder().encode('bad') }).slice();
    const centralDirectory = findSignature(zip, 0x02014b50);
    writeU16(zip, centralDirectory + 8, 1 << 11);
    zip[centralDirectory + 46] = 0xff;

    expect(() => createZipReader(zip.buffer)).toThrow('invalid UTF-8 filename');
  });

  it('normalizes safe dot segments and rejects paths escaping archive root', () => {
    const safeZip = zipSync({ 'OPS/Text/../chapter.xhtml': new TextEncoder().encode('ok') });
    const safeReader = createZipReader(safeZip.buffer as ArrayBuffer);
    expect(safeReader.listFiles()).toContain('OPS/chapter.xhtml');
    expect(safeReader.readTextFile('OPS/./chapter.xhtml')).toBe('ok');

    const unsafeZip = zipSync({ '../outside.xhtml': new TextEncoder().encode('bad') });
    expect(() => createZipReader(unsafeZip.buffer as ArrayBuffer)).toThrow('escapes');
  });

  it('rejects invalid limit values instead of silently disabling protection', () => {
    const epub = buildMinimalEpub();
    expect(() => createZipReader(epub, { maxEntries: Number.POSITIVE_INFINITY })).toThrow(
      'positive safe integer',
    );
    expect(() => createZipReader(epub, { maxCompressionRatio: 0 })).toThrow(
      'positive finite number',
    );
  });
});
