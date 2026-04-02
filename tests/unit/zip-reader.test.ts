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
});
