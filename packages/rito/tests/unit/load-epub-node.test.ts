import { describe, expect, it } from 'vitest';
import { loadEpub } from '../../src/runtime/load-epub';
import { buildMinimalEpub } from '../helpers/epub-builder';

describe('loadEpub in a DOM-less runtime', () => {
  it('loads container, OPF, and NAV XML without creating a DOM', () => {
    expect(typeof globalThis.DOMParser).toBe('undefined');
    const epub = buildMinimalEpub({
      title: 'Node EPUB',
      toc: [{ label: 'Chapter 1', href: 'chapter1.xhtml' }],
    });

    const document = loadEpub(epub);
    expect(document.packageDocument.metadata.title).toBe('Node EPUB');
    expect(document.readChapter('ch1')).toContain('Hello, world!');
    expect(document.toc).toEqual([{ label: 'Chapter 1', href: 'chapter1.xhtml', children: [] }]);
  });
});
