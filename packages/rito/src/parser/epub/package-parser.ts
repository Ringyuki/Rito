import type { ManifestItem, PackageDocument, PackageMetadata, SpineItem } from './types';
import { EpubParseError } from './errors';
import type { Logger } from '../../utils/logger';
import { childElements, parseEpubXmlDocument } from './xml-dom';

/**
 * Parse an OPF package document XML string into a PackageDocument.
 */
export function parsePackageDocument(opfXml: string, logger?: Logger): PackageDocument {
  const doc = parseEpubXmlDocument(opfXml, 'application/xml', 'OPF package document');

  const metadata = parseMetadata(doc, logger);
  const manifest = parseManifest(doc);
  const spine = parseSpine(doc);

  return { metadata, manifest, spine };
}

/**
 * Parse Dublin Core metadata. The EPUB spec requires `<dc:title>`,
 * `<dc:language>` and `<dc:identifier>`, but spec-violating files (e.g. some
 * Sigil exports) omit them while remaining perfectly readable. Rather than
 * refusing to open such books, missing fields fall back to an empty string and
 * a warning — the structural `<manifest>`/`<spine>` checks below stay strict.
 */
function parseMetadata(doc: Document, logger?: Logger): PackageMetadata {
  const title = getMetadataText(doc, 'title');
  const language = getMetadataText(doc, 'language');
  const identifier = getMetadataText(doc, 'identifier');

  if (!title) logger?.warn('Missing <dc:title> in package metadata; using empty title');
  if (!language) logger?.warn('Missing <dc:language> in package metadata; using empty language');
  if (!identifier) {
    logger?.warn('Missing <dc:identifier> in package metadata; using empty identifier');
  }

  const creator = getMetadataText(doc, 'creator');
  const result: PackageMetadata = {
    title: title ?? '',
    language: language ?? '',
    identifier: identifier ?? '',
  };

  if (creator) {
    return { ...result, creator };
  }

  return result;
}

function parseManifest(doc: Document): ManifestItem[] {
  const items: ManifestItem[] = [];
  const manifestEl = doc.getElementsByTagName('manifest')[0];
  if (!manifestEl) {
    throw new EpubParseError('Missing <manifest> element in package document');
  }

  const itemEls = manifestEl.getElementsByTagName('item');
  for (let i = 0; i < itemEls.length; i++) {
    const el = itemEls[i];
    if (!el) continue;

    const id = el.getAttribute('id');
    const href = el.getAttribute('href');
    const mediaType = el.getAttribute('media-type');

    if (!id || !href || !mediaType) {
      continue;
    }

    const propertiesAttr = el.getAttribute('properties');
    const item: ManifestItem = { id, href, mediaType };

    if (propertiesAttr) {
      items.push({ ...item, properties: propertiesAttr.split(/\s+/) });
    } else {
      items.push(item);
    }
  }

  return items;
}

function parseSpine(doc: Document): SpineItem[] {
  const items: SpineItem[] = [];
  const spineEl = doc.getElementsByTagName('spine')[0];
  if (!spineEl) {
    throw new EpubParseError('Missing <spine> element in package document');
  }

  const itemrefEls = spineEl.getElementsByTagName('itemref');
  for (let i = 0; i < itemrefEls.length; i++) {
    const el = itemrefEls[i];
    if (!el) continue;

    const idref = el.getAttribute('idref');
    if (!idref) {
      continue;
    }

    const linear = el.getAttribute('linear') !== 'no';
    items.push({ idref, linear });
  }

  return items;
}

function getMetadataText(doc: Document, localName: string): string | undefined {
  const el = findMetadataElement(doc, localName);
  const text = el?.textContent.trim();
  return text || undefined;
}

function findMetadataElement(doc: Document, localName: string): Element | undefined {
  // Try with dc: namespace prefix first, then without
  const dcElements = doc.getElementsByTagName(`dc:${localName}`);
  if (dcElements.length > 0) {
    return dcElements[0];
  }

  // Fallback: search by local name within metadata element
  const metadataEl = doc.getElementsByTagName('metadata')[0];
  if (!metadataEl) {
    return undefined;
  }

  for (const child of childElements(metadataEl)) {
    if (child.localName === localName) {
      return child;
    }
  }

  return undefined;
}
