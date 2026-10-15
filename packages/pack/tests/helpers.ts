import { readFileSync } from 'node:fs';

import { strToU8, unzipSync, zipSync } from 'fflate';

import type * as Pack from '../src/index';

/**
 * The built package: its worker and its pack module load relative to the
 * bundled entry, so the tests drive what ships.
 */
export const pack = (await import(
  new URL('../dist/index.mjs', import.meta.url).href
)) as typeof Pack;

export const CLI = new URL('../dist/cli.mjs', import.meta.url);

const books = new URL('../../rito/tests/fixtures/books/', import.meta.url);

/** A fixture book: 852 KB, sixteen chapters, twelve images. */
export const BOOK = new Uint8Array(readFileSync(new URL('book-10.epub', books)));

/** A fixture book large enough to take a noticeable time to pack. */
export const LARGE_BOOK = new Uint8Array(readFileSync(new URL('book-01.epub', books)));

/** The archive's files (directories left out) and their bytes. */
export function archiveFiles(epub: Uint8Array): Record<string, Uint8Array> {
  return Object.fromEntries(
    Object.entries(unzipSync(epub)).filter(([path]) => !path.endsWith('/')),
  );
}

const GOOD_CHAPTER =
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head>' +
  '<body><p>A chapter.</p><img src="plate.png" alt="plate"/></body></html>';

/**
 * A two-chapter book listing a stylesheet and an image under `OPS/`.
 * `files` replaces those files, or removes them with `undefined`.
 */
export function book(files: Readonly<Record<string, string | undefined>> = {}): Uint8Array {
  const contents: Record<string, string | Uint8Array | undefined> = {
    'chapter-1.xhtml': GOOD_CHAPTER,
    'chapter-2.xhtml': GOOD_CHAPTER,
    'style.css': 'p { margin: 0 }',
    'plate.png': archiveFiles(BOOK)['OEBPS/Images/LK-logo.png'],
    ...files,
  };
  const archive: Record<string, Uint8Array> = {
    'META-INF/container.xml': strToU8(
      '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
        '<rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OPS/package.opf': strToU8(
      '<?xml version="1.0"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">' +
        '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Checked</dc:title><dc:language>en</dc:language>' +
        '<dc:identifier id="id">checked</dc:identifier></metadata><manifest>' +
        '<item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>' +
        '<item id="style" href="style.css" media-type="text/css"/>' +
        '<item id="plate" href="plate.png" media-type="image/png"/>' +
        '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
    ),
  };
  for (const [path, content] of Object.entries(contents)) {
    if (content === undefined) continue;
    archive[`OPS/${path}`] = typeof content === 'string' ? strToU8(content) : content;
  }
  return zipSync(archive);
}

/** A copy of `bytes` in an ArrayBuffer of its own. */
export function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
