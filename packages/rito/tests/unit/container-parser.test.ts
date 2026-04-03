// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { CONTAINER_PATH, parseContainer } from '../../src/parser/epub/container-parser';

describe('parseContainer', () => {
  it('extracts the rootfile full-path', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    expect(parseContainer(xml)).toBe('OEBPS/content.opf');
  });

  it('handles different rootfile paths', () => {
    const xml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    expect(parseContainer(xml)).toBe('content.opf');
  });

  it('throws on missing rootfile element', () => {
    const xml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles/>
</container>`;

    expect(() => parseContainer(xml)).toThrow('No <rootfile> element');
  });

  it('throws on missing full-path attribute', () => {
    const xml = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    expect(() => parseContainer(xml)).toThrow('full-path attribute');
  });

  it('exports CONTAINER_PATH constant', () => {
    expect(CONTAINER_PATH).toBe('META-INF/container.xml');
  });
});
