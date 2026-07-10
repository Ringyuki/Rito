import { EpubParseError } from './errors';
import { findFirstElement, getAttribute } from '../xml';
import { parseEpubXml } from './xml';

const CONTAINER_PATH = 'META-INF/container.xml';

/**
 * Parse container.xml and extract the rootfile path (path to the OPF package document).
 */
export function parseContainer(containerXml: string): string {
  const doc = parseEpubXml(containerXml, 'container.xml');

  const rootfile = findFirstElement(doc.root, 'rootfile');
  if (!rootfile) {
    throw new EpubParseError('No <rootfile> element found in container.xml');
  }

  const fullPath = getAttribute(rootfile, 'full-path');
  if (!fullPath) {
    throw new EpubParseError('<rootfile> element missing full-path attribute');
  }

  return fullPath;
}

export { CONTAINER_PATH };
