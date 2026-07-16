import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAME_FLOW_FIRST_LINE = 'ALPHA FIRST LINE';
export const SAME_FLOW_SECOND_LINE = 'BRAVO SECOND LINE';
export const CROSS_FLOW_LINE = 'CHARLIE NEXT PARAGRAPH';
export const SAME_FLOW_SELECTION_TEXT = `${SAME_FLOW_FIRST_LINE}\n${SAME_FLOW_SECOND_LINE}`;
export const CROSS_FLOW_SELECTION_TEXT = `${SAME_FLOW_SELECTION_TEXT}\n\n${CROSS_FLOW_LINE}`;

type ZipEntry = Uint8Array | [Uint8Array, { readonly level: number }];

interface FflateApi {
  zipSync(files: Record<string, ZipEntry>): Uint8Array;
}

export function createSelectionFixtureEpub(): Buffer {
  const encoder = new TextEncoder();
  const files: Record<string, ZipEntry> = {
    mimetype: [encoder.encode('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    'OEBPS/content.opf': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Native Selection Fixture</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:rito-native-selection-fixture</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="book.css" media-type="text/css"/>
  </manifest>
  <spine><itemref idref="chapter"/></spine>
</package>`),
    'OEBPS/Text/chapter.xhtml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head><link rel="stylesheet" type="text/css" href="../book.css"/></head>
  <body>
    <p>${SAME_FLOW_FIRST_LINE}<br/>${SAME_FLOW_SECOND_LINE}</p>
    <p>${CROSS_FLOW_LINE}</p>
  </body>
</html>`),
    'OEBPS/book.css': encoder.encode(`
body {
  margin: 0;
  color: #111;
  font-family: serif;
  font-size: 32px;
  font-style: normal;
  font-weight: 400;
  line-height: 1.5;
}
p { margin: 0; }
p + p { margin-top: 64px; }
`),
  };
  return Buffer.from(loadFflate().zipSync(files));
}

function loadFflate(): FflateApi {
  const requireFromCore = createRequire(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/rito/package.json'),
  );
  const value: unknown = requireFromCore('fflate');
  if (value === null || typeof value !== 'object') throw new Error('fflate module is unavailable');
  const candidate = value as Partial<FflateApi>;
  if (typeof candidate.zipSync !== 'function') {
    throw new Error('fflate module does not expose zipSync');
  }
  return candidate as FflateApi;
}
