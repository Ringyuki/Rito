import { zipSync } from 'fflate';

interface TocItem {
  readonly label: string;
  readonly href: string;
  readonly children?: readonly TocItem[];
}

/**
 * Builds a minimal valid EPUB 3 archive in memory for testing.
 * Returns an ArrayBuffer containing the ZIP data.
 */
export function buildMinimalEpub(options?: {
  title?: string;
  language?: string;
  identifier?: string;
  creator?: string;
  chapters?: Array<{ id: string; href: string; content: string }>;
  stylesheets?: Array<{ id: string; href: string; content: string }>;
  fonts?: Array<{ id: string; href: string; mediaType: string; data: Uint8Array }>;
  toc?: readonly TocItem[];
}): ArrayBuffer {
  const title = options?.title ?? 'Test Book';
  const language = options?.language ?? 'en';
  const identifier = options?.identifier ?? 'urn:uuid:test-1234';
  const creator = options?.creator;
  const chapters = options?.chapters ?? [
    {
      id: 'ch1',
      href: 'chapter1.xhtml',
      content: MINIMAL_CHAPTER,
    },
  ];

  const stylesheets = options?.stylesheets ?? [];
  const fontItems = options?.fonts ?? [];
  const toc = options?.toc ?? [];
  const creatorTag = creator ? `    <dc:creator>${creator}</dc:creator>\n` : '';

  const chapterManifest = chapters
    .map((ch) => `    <item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`)
    .join('\n');

  const cssManifest = stylesheets
    .map((ss) => `    <item id="${ss.id}" href="${ss.href}" media-type="text/css"/>`)
    .join('\n');

  const fontManifest = fontItems
    .map((f) => `    <item id="${f.id}" href="${f.href}" media-type="${f.mediaType}"/>`)
    .join('\n');
  const navManifest =
    toc.length > 0
      ? '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
      : '';

  const manifestItems = [chapterManifest, cssManifest, fontManifest, navManifest]
    .filter((s) => s.length > 0)
    .join('\n');
  const spineItems = chapters.map((ch) => `    <itemref idref="${ch.id}"/>`).join('\n');

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:language>${language}</dc:language>
    <dc:identifier id="uid">${identifier}</dc:identifier>
${creatorTag}  </metadata>
  <manifest>
${manifestItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`;

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    'META-INF/container.xml': encoder.encode(containerXml),
    'OEBPS/content.opf': encoder.encode(opf),
  };

  for (const ch of chapters) {
    files[`OEBPS/${ch.href}`] = encoder.encode(ch.content);
  }

  for (const ss of stylesheets) {
    files[`OEBPS/${ss.href}`] = encoder.encode(ss.content);
  }

  for (const f of fontItems) {
    files[`OEBPS/${f.href}`] = f.data;
  }

  if (toc.length > 0) {
    files['OEBPS/nav.xhtml'] = encoder.encode(buildNavDocument(toc));
  }

  const zipped = zipSync(files);
  return zipped.buffer as ArrayBuffer;
}

function buildNavDocument(entries: readonly TocItem[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      ${renderTocEntries(entries)}
    </nav>
  </body>
</html>`;
}

function renderTocEntries(entries: readonly TocItem[]): string {
  const items = entries
    .map((entry) => {
      const children = entry.children?.length ? renderTocEntries(entry.children) : '';
      return `<li><a href="${entry.href}">${entry.label}</a>${children}</li>`;
    })
    .join('');
  return `<ol>${items}</ol>`;
}

const MINIMAL_CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body>
    <h1>Chapter 1</h1>
    <p>Hello, world!</p>
  </body>
</html>`;
