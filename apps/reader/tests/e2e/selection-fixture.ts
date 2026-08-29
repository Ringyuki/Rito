import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SAME_FLOW_FIRST_LINE = 'ALPHA FIRST LINE';
export const SAME_FLOW_SECOND_LINE = 'BRAVO SECOND LINE';
export const CROSS_FLOW_LINE = 'CHARLIE NEXT PARAGRAPH';
export const SAME_FLOW_SELECTION_TEXT = `${SAME_FLOW_FIRST_LINE}\n${SAME_FLOW_SECOND_LINE}`;
export const SAME_FLOW_PARAGRAPH_SELECTION_TEXT = `${SAME_FLOW_SELECTION_TEXT}\n\n`;
export const CROSS_FLOW_SELECTION_TEXT = `${SAME_FLOW_SELECTION_TEXT}\n\n${CROSS_FLOW_LINE}`;
export const CJK_FIRST_LINE = '独居生活开始';
export const CJK_SECOND_LINE = '帮他做饭打扫';
export const CJK_CROSS_FLOW_LINE = '高亮区域精确对齐';
export const CJK_SELECTION_TEXT = `${CJK_FIRST_LINE}\n${CJK_SECOND_LINE}`;
export const EDGE_FIRST_PAGE_TEXT = 'EDGEALPHA';
export const EDGE_SECOND_PAGE_TEXT = 'EDGEBRAVO';
export const EDGE_SELECTION_TEXT = `${EDGE_FIRST_PAGE_TEXT}\n\n${EDGE_SECOND_PAGE_TEXT}`;
export const PAGE_MOVEMENT_TARGET_TEXT = 'MOVETARGET';
export const PAGE_MOVEMENT_FIRST_TOP = 'FIRST TOP';
export const PAGE_MOVEMENT_MIDDLE_TOP = 'MIDDLE TOP';
export const PAGE_MOVEMENT_FINAL_TOP = 'FINAL TOP';
export const PAGE_MOVEMENT_FORWARD_SELECTION_TEXT = `${PAGE_MOVEMENT_TARGET_TEXT}\nMIDDLE BOTTOM\n\n${PAGE_MOVEMENT_FINAL_TOP}\n${PAGE_MOVEMENT_TARGET_TEXT}`;
export const DOCUMENT_FIRST_CHAPTER_TEXT = 'DOCUMENTALPHA';
export const DOCUMENT_SECOND_CHAPTER_TEXT = 'DOCUMENTBRAVO';
export const DOCUMENT_SELECTION_TEXT = `${DOCUMENT_FIRST_CHAPTER_TEXT}\n\n${DOCUMENT_SECOND_CHAPTER_TEXT}`;

type ZipEntry = Uint8Array | [Uint8Array, { readonly level: number }];

interface FflateApi {
  zipSync(files: Record<string, ZipEntry>): Uint8Array;
}

export interface SelectionFixtureOptions {
  readonly includeImage?: boolean;
  readonly locale?: 'latin' | 'cjk';
  readonly layout?: 'compact' | 'edge-pages' | 'page-movement' | 'cross-chapter';
}

export function createSelectionFixtureEpub(options: SelectionFixtureOptions = {}): Buffer {
  const encoder = new TextEncoder();
  const cjk = options.locale === 'cjk';
  const language = cjk ? 'zh-Hans' : 'en';
  const firstLine = cjk ? CJK_FIRST_LINE : SAME_FLOW_FIRST_LINE;
  const secondLine = cjk ? CJK_SECOND_LINE : SAME_FLOW_SECOND_LINE;
  const crossFlowLine = cjk ? CJK_CROSS_FLOW_LINE : CROSS_FLOW_LINE;
  const edgePages = options.layout === 'edge-pages';
  const pageMovement = options.layout === 'page-movement';
  const crossChapter = options.layout === 'cross-chapter';
  const imageManifest = options.includeImage
    ? '<item id="pixel" href="Images/pixel.png" media-type="image/png"/>'
    : '';
  const imageElement = options.includeImage ? '<img src="../Images/pixel.png" alt=""/>' : '';
  const body = crossChapter
    ? `<p>${DOCUMENT_FIRST_CHAPTER_TEXT}</p>`
    : pageMovement
      ? `<p>${PAGE_MOVEMENT_FIRST_TOP}<br/>${PAGE_MOVEMENT_TARGET_TEXT}<br/>FIRST BOTTOM</p>
    <p class="edge-page">${PAGE_MOVEMENT_MIDDLE_TOP}<br/>${PAGE_MOVEMENT_TARGET_TEXT}<br/>MIDDLE BOTTOM</p>
    <p class="edge-page">${PAGE_MOVEMENT_FINAL_TOP}<br/>${PAGE_MOVEMENT_TARGET_TEXT}<br/>FINAL BOTTOM</p>`
      : edgePages
        ? `<p>${EDGE_FIRST_PAGE_TEXT}</p>
    <p class="edge-page">${EDGE_SECOND_PAGE_TEXT}</p>`
        : `<p>${firstLine}<br/>${secondLine}</p>
    <p>${crossFlowLine}</p>
    ${imageElement}`;
  const secondChapterManifest = crossChapter
    ? '<item id="chapter-2" href="Text/chapter-2.xhtml" media-type="application/xhtml+xml"/>'
    : '';
  const secondChapterSpine = crossChapter ? '<itemref idref="chapter-2"/>' : '';
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
    <dc:language>${language}</dc:language>
    <dc:identifier id="uid">urn:uuid:rito-native-selection-fixture</dc:identifier>
  </metadata>
  <manifest>
    <item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/>
    ${secondChapterManifest}
    <item id="style" href="book.css" media-type="text/css"/>
    ${imageManifest}
  </manifest>
  <spine><itemref idref="chapter"/>${secondChapterSpine}</spine>
</package>`),
    'OEBPS/Text/chapter.xhtml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head><link rel="stylesheet" type="text/css" href="../book.css"/></head>
  <body>
    ${body}
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
.edge-page {
  /* Overflow the page by margin: the engine deliberately mirrors
     Chromium's continuous-multicol truth, where page forced breaks do
     not break a fragmentainer, so the fixture makes its second page by
     volume — a margin taller than any viewport pushes the paragraph to
     the next page, and the unforced break truncates it to zero there. */
  margin-top: 2000px;
}
img {
  display: block;
  width: 64px;
  height: 64px;
  margin-top: 32px;
}
`),
  };
  if (crossChapter) {
    files['OEBPS/Text/chapter-2.xhtml'] = encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <head><link rel="stylesheet" type="text/css" href="../book.css"/></head>
  <body><p>${DOCUMENT_SECOND_CHAPTER_TEXT}</p></body>
</html>`);
  }
  if (options.includeImage) {
    files['OEBPS/Images/pixel.png'] = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWP8z8DwnwEJMDGgASYGNMDEgAYAg9ECBvYVtPAAAAAASUVORK5CYII=',
      'base64',
    );
  }
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
