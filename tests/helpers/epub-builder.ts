import { zipSync } from 'fflate';

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

  const creatorTag = creator ? `    <dc:creator>${creator}</dc:creator>\n` : '';

  const manifestItems = chapters
    .map((ch) => `    <item id="${ch.id}" href="${ch.href}" media-type="application/xhtml+xml"/>`)
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

  const zipped = zipSync(files);
  return zipped.buffer as ArrayBuffer;
}

const MINIMAL_CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter 1</title></head>
  <body>
    <h1>Chapter 1</h1>
    <p>Hello, world!</p>
  </body>
</html>`;
