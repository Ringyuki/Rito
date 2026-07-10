import { parseXml } from '../xml';
import type { XmlDocument } from '../xml';
import { EpubParseError } from './errors';

/** Parse an EPUB XML resource and attach a resource-specific diagnostic label. */
export function parseEpubXml(source: string, label: string): XmlDocument {
  return parseXml(source, (details) => new EpubParseError(`Invalid ${label}: ${details}`));
}
