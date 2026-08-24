import { createZipReader } from '../parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../parser/epub/container-parser';
import { parsePackageDocument } from '../parser/epub/package-parser';
import { parseNavDocument, parseNcx } from '../parser/epub/toc-parser';
import type { TocEntry } from '../parser/epub/types';
import type { ZipReader } from '../parser/epub/zip-reader';
import type { PackageDocument } from '../parser/epub/types';
import type { EpubDocument, LoadOptions } from './types';
import { createLogger, type Logger } from '../utils/logger';
import {
  archiveDirname,
  relativeArchiveHref,
  resolveArchiveHref,
} from '../parser/epub/archive-path';

/**
 * Load and parse an EPUB file from an ArrayBuffer.
 *
 * Parses the EPUB structure (container, OPF, stylesheets, fonts, images, TOC)
 * eagerly, but chapter XHTML is loaded lazily via {@link EpubDocument.readChapter}.
 *
 * @param data - The raw EPUB file as an ArrayBuffer.
 * @param options - Optional loading options (e.g. `maxChapters` to limit loading).
 * @returns A parsed {@link EpubDocument} ready for pagination.
 * @throws {@link EpubParseError} if the EPUB structure is invalid or a ZIP safety limit is exceeded.
 */
export function loadEpub(data: ArrayBuffer, options?: LoadOptions): EpubDocument {
  const log = options?.logger ?? createLogger();
  const reader = createZipReader(data, options?.zipLimits);

  try {
    const containerXml = reader.readTextFile(CONTAINER_PATH);
    const rootfilePath = resolveArchiveHref('', parseContainer(containerXml));
    const opfDir = archiveDirname(rootfilePath);

    const opfXml = reader.readTextFile(rootfilePath);
    const parsedPackage = parsePackageDocument(opfXml, log);
    const packageDocument = normalizePackagePaths(parsedPackage, opfDir, log);

    const chapterPaths = buildChapterPaths(
      packageDocument,
      opfDir,
      options?.maxChapters ?? Infinity,
      log,
    );
    const { stylesheets, fonts, images } = loadManifestResources(
      packageDocument,
      reader,
      opfDir,
      log,
    );

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
  } catch (error) {
    reader.close();
    throw error;
  }
}

/** Canonicalize valid manifest URLs while retaining unreadable items for metadata compatibility. */
function normalizePackagePaths(pkg: PackageDocument, opfDir: string, log: Logger): PackageDocument {
  const manifest = pkg.manifest.map((item) => {
    try {
      const archivePath = resolveArchiveHref(opfDir, item.href);
      return { ...item, href: relativeArchiveHref(opfDir, archivePath) };
    } catch (error) {
      log.warn('Manifest href will not be loaded because it is unsafe (%s): %s', item.href, error);
      return item;
    }
  });
  return { ...pkg, manifest };
}

/** Build the idref → full zip path lookup used for lazy chapter loading. */
function buildChapterPaths(
  pkg: PackageDocument,
  opfDir: string,
  maxChapters: number,
  log: Logger,
): Map<string, string> {
  const manifestById = new Map(pkg.manifest.map((item) => [item.id, item.href]));
  const chapterPaths = new Map<string, string>();
  let count = 0;
  for (const spineItem of pkg.spine) {
    if (!spineItem.linear) continue;
    if (count >= maxChapters) break;
    const href = manifestById.get(spineItem.idref);
    if (!href) continue;
    try {
      chapterPaths.set(spineItem.idref, resolveArchiveHref(opfDir, href));
      count++;
    } catch (error) {
      log.warn('Skipping chapter with unsafe href %s: %s', href, error);
    }
  }
  return chapterPaths;
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

const IMAGE_EXTENSIONS_RE = /\.(jpe?g|png|gif|webp|avif|bmp|svg|tiff?|ico)$/i;

function loadManifestResources(
  pkg: PackageDocument,
  reader: ZipReader,
  opfDir: string,
  log: Logger,
): {
  stylesheets: Map<string, string>;
  fonts: Map<string, Uint8Array>;
  images: Map<string, Uint8Array>;
} {
  const stylesheets = new Map<string, string>();
  const fonts = new Map<string, Uint8Array>();
  const images = new Map<string, Uint8Array>();

  for (const item of pkg.manifest) {
    // A single missing/mislabeled manifest entry must not abort the whole load.
    try {
      if (item.mediaType === 'text/css') {
        stylesheets.set(item.href, reader.readTextFile(resolveArchiveHref(opfDir, item.href)));
      } else if (FONT_MEDIA_TYPES.has(item.mediaType)) {
        fonts.set(item.href, reader.readFile(resolveArchiveHref(opfDir, item.href)));
      } else if (item.mediaType.startsWith('image/')) {
        images.set(item.href, reader.readFile(resolveArchiveHref(opfDir, item.href)));
      }
    } catch (e) {
      log.warn('Skipping unreadable manifest resource %s: %s', item.href, e);
    }
  }

  // Some EPUBs (especially older ones) reference images that are absent from the
  // manifest. Index every image file in the archive so undeclared illustrations
  // still resolve. Keyed opfDir-relative to match the resolver's href matching.
  for (const fullPath of reader.listFiles()) {
    if (!IMAGE_EXTENSIONS_RE.test(fullPath)) continue;
    const key = relativeArchiveHref(opfDir, fullPath);
    if (images.has(key)) continue;
    try {
      images.set(key, reader.readFile(fullPath));
    } catch (e) {
      log.warn('Failed to read archive image %s: %s', fullPath, e);
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
      const navXhtml = reader.readTextFile(resolveArchiveHref(opfDir, navItem.href));
      const entries = parseNavDocument(navXhtml);
      if (entries.length > 0) return entries;
    } catch (e) {
      log.warn('Failed to parse NAV document, falling back to NCX:', e);
    }
  }

  const ncxItem = pkg.manifest.find((item) => item.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    try {
      const ncxXml = reader.readTextFile(resolveArchiveHref(opfDir, ncxItem.href));
      return parseNcx(ncxXml);
    } catch (e) {
      log.warn('Failed to parse NCX document:', e);
    }
  }

  return [];
}
