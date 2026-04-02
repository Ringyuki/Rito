import { createZipReader } from '../parser/epub/zip-reader';
import { CONTAINER_PATH, parseContainer } from '../parser/epub/container-parser';
import { parsePackageDocument } from '../parser/epub/package-parser';
import type { EpubDocument, LoadOptions } from './types';

/**
 * Load an EPUB file from an ArrayBuffer.
 *
 * Parses the container, package document, and eagerly loads all chapter content.
 * Returns an EpubDocument ready for pagination.
 */
export function loadEpub(data: ArrayBuffer, options?: LoadOptions): EpubDocument {
  const reader = createZipReader(data);

  // Parse container.xml to find the OPF path
  const containerXml = reader.readTextFile(CONTAINER_PATH);
  const rootfilePath = parseContainer(containerXml);

  // Parse the OPF package document
  const opfXml = reader.readTextFile(rootfilePath);
  const packageDocument = parsePackageDocument(opfXml);

  // Resolve the directory containing the OPF for relative hrefs
  const opfDir = rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1);

  // Build a lookup from manifest id → href
  const manifestById = new Map(packageDocument.manifest.map((item) => [item.id, item.href]));

  // Load chapters from the spine
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

  return { packageDocument, chapters };
}
