// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { loadEpub } from '../../src/reference/ts-core/runtime/load-epub';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { buildHrefResolver } from '../../src/reference/ts-core/utils/resolve-href';
import { createLogger } from '../../src/reference/ts-core/utils/logger';

function buildCustomEpub(options: {
  readonly opf: string;
  readonly opfPath?: string;
  readonly rootfileHref?: string;
  readonly files: Readonly<Record<string, Uint8Array>>;
}): ArrayBuffer {
  const opfPath = options.opfPath ?? 'OPS/content.opf';
  const rootfileHref = options.rootfileHref ?? opfPath;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${rootfileHref}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const zip = zipSync({
    'META-INF/container.xml': strToU8(container),
    [opfPath]: strToU8(options.opf),
    ...options.files,
  });
  return zip.buffer as ArrayBuffer;
}

function pathNormalizationEpub(): ArrayBuffer {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Paths</dc:title><dc:language>en</dc:language><dc:identifier>paths</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="./Text/temp/../Chapter%201.xhtml" media-type="application/xhtml+xml"/>
    <item id="aux" href="Text/nonlinear.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="Styles/old/../main%2Ecss" media-type="text/css"/>
    <item id="font" href="../Shared/Fonts/book.ttf" media-type="font/ttf"/>
    <item id="cover" href="Images/tmp/../cover%2Ejpg" media-type="image/jpeg"/>
    <item id="nav" href="Nav/./toc%2Exhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="aux" linear="no"/></spine>
</package>`;
  const nav = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol><li><a href="../Text/Chapter%201.xhtml">One</a></li></ol></nav></body>
</html>`;
  return buildCustomEpub({
    opf,
    rootfileHref: './OPS/%63ontent.opf',
    files: {
      'OPS/Text/Chapter 1.xhtml': strToU8('<html><body><p>Canonical chapter</p></body></html>'),
      'OPS/Text/nonlinear.xhtml': strToU8('<html><body><p>Supplement</p></body></html>'),
      'OPS/Styles/main.css': strToU8('p { color: navy; }'),
      'Shared/Fonts/book.ttf': new Uint8Array([1, 2, 3]),
      'OPS/Images/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff]),
      'OPS/Nav/toc.xhtml': strToU8(nav),
    },
  });
}

/** Build an EPUB whose archive contains an image that is NOT in the manifest. */
function epubWithUndeclaredImage(): ArrayBuffer {
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Undeclared</dc:title><dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:x</dc:identifier>
  </metadata>
  <manifest>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const zip = zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/ch1.xhtml': strToU8('<html><body><img src="images/illus1.jpg"/></body></html>'),
    'OEBPS/images/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff, 1]),
    'OEBPS/images/illus1.jpg': new Uint8Array([0xff, 0xd8, 0xff, 2]), // not in manifest
  });
  return zip.buffer as ArrayBuffer;
}

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

  it('indexes images present in the archive but absent from the manifest', () => {
    // Spec-violating books reference illustrations not declared in the manifest;
    // those must still be loaded so they are not rendered as broken images.
    const doc = loadEpub(epubWithUndeclaredImage());
    const resolve = buildHrefResolver(doc.images);

    expect(resolve('images/cover.jpg')).toBeDefined(); // declared
    expect(resolve('images/illus1.jpg')).toBeDefined(); // undeclared, still indexed
    expect(doc.images.get('images/illus1.jpg')).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 2]));
  });

  it('canonicalizes percent escapes and dot segments for every manifest resource type', () => {
    const doc = loadEpub(pathNormalizationEpub());

    expect(doc.packageDocument.manifest.find((item) => item.id === 'ch1')?.href).toBe(
      'Text/Chapter 1.xhtml',
    );
    expect(doc.packageDocument.manifest.find((item) => item.id === 'font')?.href).toBe(
      '../Shared/Fonts/book.ttf',
    );
    expect(doc.readChapter('ch1')).toContain('Canonical chapter');
    expect(doc.stylesheets.get('Styles/main.css')).toContain('color: navy');
    expect(doc.fonts.get('../Shared/Fonts/book.ttf')).toEqual(new Uint8Array([1, 2, 3]));
    expect(doc.images.get('Images/cover.jpg')).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(doc.toc[0]).toMatchObject({ label: 'One', href: '../Text/Chapter%201.xhtml' });
  });

  it('skips linear=no spine items by default without dropping their manifest resources', () => {
    const doc = loadEpub(pathNormalizationEpub());

    expect(doc.packageDocument.spine.find((item) => item.idref === 'aux')?.linear).toBe(false);
    expect(doc.readChapter('aux')).toBeUndefined();
    expect(doc.images.has('Images/cover.jpg')).toBe(true);
  });

  it('loads an NCX whose manifest path requires URL and dot-segment normalization', () => {
    const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>NCX</dc:title><dc:language>en</dc:language><dc:identifier>x</dc:identifier></metadata>
  <manifest>
    <item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="ncx" href="Nav/tmp/../book%2Encx" media-type="application/x-dtbncx+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch"/></spine>
</package>`;
    const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint id="one"><navLabel><text>One</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>`;
    const data = buildCustomEpub({
      opf,
      files: {
        'OPS/chapter.xhtml': strToU8('<html><body>One</body></html>'),
        'OPS/Nav/book.ncx': strToU8(ncx),
      },
    });

    expect(loadEpub(data).toc).toEqual([{ label: 'One', href: 'chapter.xhtml', children: [] }]);
  });

  it('rejects a rootfile path that escapes the archive root', () => {
    const data = buildCustomEpub({
      opf: '<package/>',
      rootfileHref: '%2e%2e/content.opf',
      files: {},
    });
    expect(() => loadEpub(data)).toThrow('escapes the EPUB archive root');
  });

  it('rejects absolute rootfile paths instead of rebasing them into the OPF directory', () => {
    const data = buildCustomEpub({
      opf: '<package/>',
      rootfileHref: '/OPS/content.opf',
      files: {},
    });
    expect(() => loadEpub(data)).toThrow('not an EPUB archive path');
  });

  it('skips unsafe per-resource manifest paths while keeping the book loadable', () => {
    const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Safe</dc:title><dc:language>en</dc:language><dc:identifier>x</dc:identifier></metadata>
  <manifest>
    <item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="bad" href="%2e%2e/%2e%2e/outside.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="ch"/></spine>
</package>`;
    const data = buildCustomEpub({
      opf,
      files: {
        'OPS/chapter.xhtml': strToU8('<html><body>Safe chapter</body></html>'),
        'outside.css': strToU8('body { display: none }'),
      },
    });

    const doc = loadEpub(data, { logger: createLogger('silent') });
    expect(doc.readChapter('ch')).toContain('Safe chapter');
    expect(doc.stylesheets.size).toBe(0);
  });

  it('forwards configurable ZIP limits through LoadOptions', () => {
    const data = buildMinimalEpub();
    expect(() => loadEpub(data, { zipLimits: { maxEntries: 1 } })).toThrow('maxEntries');
  });
});
