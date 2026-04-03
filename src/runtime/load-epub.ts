import { createZipReader } from '../parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../parser/epub/container-parser';
import { parsePackageDocument } from '../parser/epub/package-parser';
import { parseNavDocument, parseNcx } from '../parser/epub/toc-parser';
import type { TocEntry } from '../parser/epub/types';
import type { ZipReader } from '../parser/epub/zip-reader';
import type { PackageDocument } from '../parser/epub/types';
import type { EpubDocument, LoadOptions } from './types';

/**
 * Load and parse an EPUB file from an ArrayBuffer.
 *
 * Extracts the ZIP archive, parses `container.xml` and the OPF package document,
 * and eagerly loads all chapter XHTML content from the spine.
 *
 * This function is synchronous. The caller is responsible for fetching the
 * ArrayBuffer (e.g. via `fetch()` or `FileReader`).
 *
 * @param data - The raw EPUB file as an ArrayBuffer.
 * @param options - Optional loading options (e.g. `maxChapters` to limit loading).
 * @returns A parsed {@link EpubDocument} ready for pagination.
 * @throws {@link EpubParseError} if the EPUB structure is invalid.
 *
 * @example
 * ```ts
 * const response = await fetch('book.epub');
 * const data = await response.arrayBuffer();
 * const doc = loadEpub(data);
 * ```
 */
export function loadEpub(data: ArrayBuffer, options?: LoadOptions): EpubDocument {
  const reader = createZipReader(data);

  const containerXml = reader.readTextFile(CONTAINER_PATH);
  const rootfilePath = parseContainer(containerXml);

  const opfXml = reader.readTextFile(rootfilePath);
  const packageDocument = parsePackageDocument(opfXml);

  const opfDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
  const manifestById = new Map(packageDocument.manifest.map((item) => [item.id, item.href]));

  const chapters = new Map<string, string>();
  const maxChapters = options?.maxChapters ?? Infinity;
  let loaded = 0;

  for (const spineItem of packageDocument.spine) {
    if (loaded >= maxChapters) break;

    const href = manifestById.get(spineItem.idref);
    if (!href) continue;

    const fullPath = opfDir + href;
    const content = reader.readTextFile(fullPath);
    chapters.set(spineItem.idref, content);
    loaded++;
  }

  // Load stylesheets from manifest
  const stylesheets = new Map<string, string>();
  for (const item of packageDocument.manifest) {
    if (item.mediaType === 'text/css') {
      const fullPath = opfDir + item.href;
      stylesheets.set(item.id, reader.readTextFile(fullPath));
    }
  }

  // Load font files from manifest
  const fonts = new Map<string, Uint8Array>();
  const fontMediaTypes = new Set([
    'font/ttf',
    'font/otf',
    'font/woff',
    'font/woff2',
    'application/x-font-ttf',
    'application/x-font-woff',
    'application/font-woff',
    'application/font-woff2',
    'application/vnd.ms-opentype',
    'application/font-sfnt',
  ]);
  for (const item of packageDocument.manifest) {
    if (fontMediaTypes.has(item.mediaType)) {
      const fullPath = opfDir + item.href;
      fonts.set(item.href, reader.readFile(fullPath));
    }
  }

  // Load image files from manifest
  const images = new Map<string, Uint8Array>();
  for (const item of packageDocument.manifest) {
    if (item.mediaType.startsWith('image/')) {
      const fullPath = opfDir + item.href;
      images.set(item.href, reader.readFile(fullPath));
    }
  }

  const toc = loadToc(reader, packageDocument, opfDir);

  return { packageDocument, chapters, stylesheets, fonts, images, toc };
}

/** Attempt to load TOC from EPUB 3 nav document or EPUB 2 NCX. */
function loadToc(
  reader: ZipReader,
  pkg: PackageDocument,
  opfDir: string,
): readonly TocEntry[] {
  // EPUB 3: look for manifest item with properties containing "nav"
  const navItem = pkg.manifest.find((item) => item.properties?.includes('nav'));
  if (navItem) {
    try {
      const navXhtml = reader.readTextFile(opfDir + navItem.href);
      const entries = parseNavDocument(navXhtml);
      if (entries.length > 0) return entries;
    } catch {
      // Fall through to NCX
    }
  }

  // EPUB 2: look for NCX file in manifest (media-type: application/x-dtbncx+xml)
  const ncxItem = pkg.manifest.find(
    (item) => item.mediaType === 'application/x-dtbncx+xml',
  );
  if (ncxItem) {
    try {
      const ncxXml = reader.readTextFile(opfDir + ncxItem.href);
      return parseNcx(ncxXml);
    } catch {
      // No TOC available
    }
  }

  return [];
}
