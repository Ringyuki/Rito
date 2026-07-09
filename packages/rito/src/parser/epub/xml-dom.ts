import { childElements, parseXmlDocument } from '../xml-dom';
import { EpubParseError } from './errors';

export { childElements };

/** Parse an EPUB XML resource and attach a resource-specific diagnostic label. */
export function parseEpubXmlDocument(source: string, mimeType: string, label: string): Document {
  return parseXmlDocument(
    source,
    mimeType,
    (details) => new EpubParseError(`Invalid ${label}: ${details}`),
  );
}
