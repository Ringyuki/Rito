import { createZipReader } from '../parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../parser/epub/container-parser';
import { parsePackageDocument } from '../parser/epub/package-parser';
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

  return { packageDocument, chapters, stylesheets };
}
