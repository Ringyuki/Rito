import { createZipReader } from '../parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../parser/epub/container-parser';
import { parsePackageDocument } from '../parser/epub/package-parser';
import { parseNavDocument, parseNcx } from '../parser/epub/toc-parser';
import type { TocEntry } from '../parser/epub/types';
import type { ZipReader } from '../parser/epub/zip-reader';
import type { PackageDocument } from '../parser/epub/types';
import type { EpubDocument, LoadOptions } from './types';
import { createLogger, type Logger } from '../utils/logger';

/**
 * Load and parse an EPUB file from an ArrayBuffer.
 *
 * Parses the EPUB structure (container, OPF, stylesheets, fonts, images, TOC)
 * eagerly, but chapter XHTML is loaded lazily via {@link EpubDocument.readChapter}.
 *
 * @param data - The raw EPUB file as an ArrayBuffer.
 * @param options - Optional loading options (e.g. `maxChapters` to limit loading).
 * @returns A parsed {@link EpubDocument} ready for pagination.
 * @throws {@link EpubParseError} if the EPUB structure is invalid.
 */
export function loadEpub(data: ArrayBuffer, options?: LoadOptions): EpubDocument {
  const log = options?.logger ?? createLogger();
  const reader = createZipReader(data);

  const containerXml = reader.readTextFile(CONTAINER_PATH);
  const rootfilePath = parseContainer(containerXml);

  const opfXml = reader.readTextFile(rootfilePath);
  const packageDocument = parsePackageDocument(opfXml);

  const opfDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);
  const manifestById = new Map(packageDocument.manifest.map((item) => [item.id, item.href]));

  // Build the idref → full zip path lookup for lazy chapter loading
  const maxChapters = options?.maxChapters ?? Infinity;
  const chapterPaths = new Map<string, string>();
  let count = 0;
  for (const spineItem of packageDocument.spine) {
    if (count >= maxChapters) break;
    const href = manifestById.get(spineItem.idref);
    if (!href) continue;
    chapterPaths.set(spineItem.idref, opfDir + href);
    count++;
  }

  const { stylesheets, fonts, images } = loadManifestResources(packageDocument, reader, opfDir);

  const toc = loadToc(reader, packageDocument, opfDir, log);
  log.info('EPUB loaded: %d spine items, %d stylesheets', chapterPaths.size, stylesheets.size);

  return {
    packageDocument,
    readChapter(idref: string): string | undefined {
      const path = chapterPaths.get(idref);
      if (!path) return undefined;
      return reader.readTextFile(path);
    },
    stylesheets,
    fonts,
    images,
    toc,
    close(): void {
      reader.close();
    },
  };
}

const FONT_MEDIA_TYPES = new Set([
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

function loadManifestResources(
  pkg: PackageDocument,
  reader: ZipReader,
  opfDir: string,
): {
  stylesheets: Map<string, string>;
  fonts: Map<string, Uint8Array>;
  images: Map<string, Uint8Array>;
} {
  const stylesheets = new Map<string, string>();
  const fonts = new Map<string, Uint8Array>();
  const images = new Map<string, Uint8Array>();

  for (const item of pkg.manifest) {
    if (item.mediaType === 'text/css') {
      stylesheets.set(item.id, reader.readTextFile(opfDir + item.href));
    } else if (FONT_MEDIA_TYPES.has(item.mediaType)) {
      fonts.set(item.href, reader.readFile(opfDir + item.href));
    } else if (item.mediaType.startsWith('image/')) {
      images.set(item.href, reader.readFile(opfDir + item.href));
    }
  }

  return { stylesheets, fonts, images };
}

/** Attempt to load TOC from EPUB 3 nav document or EPUB 2 NCX. */
function loadToc(
  reader: ZipReader,
  pkg: PackageDocument,
  opfDir: string,
  log: Logger,
): readonly TocEntry[] {
  const navItem = pkg.manifest.find((item) => item.properties?.includes('nav'));
  if (navItem) {
    try {
      const navXhtml = reader.readTextFile(opfDir + navItem.href);
      const entries = parseNavDocument(navXhtml);
      if (entries.length > 0) return entries;
    } catch (e) {
      log.warn('Failed to parse NAV document, falling back to NCX:', e);
    }
  }

  const ncxItem = pkg.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    try {
      const ncxXml = reader.readTextFile(opfDir + ncxItem.href);
      return parseNcx(ncxXml);
    } catch (e) {
      log.warn('Failed to parse NCX document:', e);
    }
  }

  return [];
}
