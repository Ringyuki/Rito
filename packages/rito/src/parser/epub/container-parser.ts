import { EpubParseError } from './errors';
import { parseEpubXmlDocument } from './xml-dom';

const CONTAINER_PATH = 'META-INF/container.xml';

/**
 * Parse container.xml and extract the rootfile path (path to the OPF package document).
 */
export function parseContainer(containerXml: string): string {
  const doc = parseEpubXmlDocument(containerXml, 'application/xml', 'container.xml');

  const rootfile = doc.getElementsByTagName('rootfile')[0];
  if (!rootfile) {
    throw new EpubParseError('No <rootfile> element found in container.xml');
  }

  const fullPath = rootfile.getAttribute('full-path');
  if (!fullPath) {
    throw new EpubParseError('<rootfile> element missing full-path attribute');
  }

  return fullPath;
}

export { CONTAINER_PATH };
