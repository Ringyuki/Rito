// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createZipReader } from '../../src/parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../../src/parser/epub/container-parser';
import { parsePackageDocument } from '../../src/parser/epub/package-parser';
import { buildMinimalEpub } from '../helpers/epub-builder';

describe('EPUB loading pipeline', () => {
  it('loads and parses a minimal EPUB end-to-end', () => {
    const epub = buildMinimalEpub({
      title: 'Integration Test',
      creator: 'Test Author',
      chapters: [
        { id: 'ch1', href: 'chapter1.xhtml', content: '<html><body><p>One</p></body></html>' },
        { id: 'ch2', href: 'chapter2.xhtml', content: '<html><body><p>Two</p></body></html>' },
      ],
    });

    // Step 1: Extract ZIP
    const reader = createZipReader(epub);

    // Step 2: Parse container.xml
    const containerXml = reader.readTextFile(CONTAINER_PATH);
    const rootfilePath = parseContainer(containerXml);
    expect(rootfilePath).toBe('OEBPS/content.opf');

    // Step 3: Parse OPF
    const opfXml = reader.readTextFile(rootfilePath);
    const pkg = parsePackageDocument(opfXml);

    expect(pkg.metadata.title).toBe('Integration Test');
    expect(pkg.metadata.creator).toBe('Test Author');
    expect(pkg.manifest).toHaveLength(2);
    expect(pkg.spine).toHaveLength(2);

    // Step 4: Load chapter content via manifest
    const firstSpineItem = pkg.spine[0];
    expect(firstSpineItem).toBeDefined();

    const manifestItem = pkg.manifest.find((m) => m.id === firstSpineItem?.idref);
    expect(manifestItem).toBeDefined();

    const chapterDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
    const chapterContent = reader.readTextFile(`${chapterDir}${manifestItem?.href ?? ''}`);
    expect(chapterContent).toContain('<p>One</p>');
  });

  it('handles EPUB with no creator', () => {
    const epub = buildMinimalEpub({ title: 'No Creator Book' });
    const reader = createZipReader(epub);
    const containerXml = reader.readTextFile(CONTAINER_PATH);
    const rootfilePath = parseContainer(containerXml);
    const opfXml = reader.readTextFile(rootfilePath);
    const pkg = parsePackageDocument(opfXml);

    expect(pkg.metadata.title).toBe('No Creator Book');
    expect(pkg.metadata).not.toHaveProperty('creator');
  });
});
