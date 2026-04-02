import type { ManifestItem, PackageDocument, PackageMetadata, SpineItem } from './types';
import { EpubParseError } from './errors';

/**
 * Parse an OPF package document XML string into a PackageDocument.
 */
export function parsePackageDocument(opfXml: string): PackageDocument {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const parserError = doc.querySelector('parsererror');
  if (parserError) {
    throw new EpubParseError(`Invalid OPF package document: ${parserError.textContent}`);
  }

  const metadata = parseMetadata(doc);
  const manifest = parseManifest(doc);
  const spine = parseSpine(doc);

  return { metadata, manifest, spine };
}

function parseMetadata(doc: Document): PackageMetadata {
  const title = getMetadataText(doc, 'title');
  const language = getMetadataText(doc, 'language');
  const identifier = getMetadataText(doc, 'identifier');

  if (!title) {
    throw new EpubParseError('Missing required <dc:title> in package metadata');
  }
  if (!language) {
    throw new EpubParseError('Missing required <dc:language> in package metadata');
  }
  if (!identifier) {
    throw new EpubParseError('Missing required <dc:identifier> in package metadata');
  }

  const creator = getMetadataText(doc, 'creator');
  const result: PackageMetadata = { title, language, identifier };

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

  for (let i = 0; i < metadataEl.children.length; i++) {
    const child = metadataEl.children[i];
    if (child?.localName === localName) {
      return child;
    }
  }

  return undefined;
}
