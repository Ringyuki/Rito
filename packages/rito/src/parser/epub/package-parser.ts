import type { ManifestItem, PackageDocument, PackageMetadata, SpineItem } from './types';
import { EpubParseError } from './errors';
import type { Logger } from '../../utils/logger';
import {
  childElements,
  findDescendants,
  findElements,
  findFirstElement,
  getAttribute,
  textContent,
} from '../xml';
import type { XmlDocument, XmlElement } from '../xml';
import { parseEpubXml } from './xml';

/**
 * Parse an OPF package document XML string into a PackageDocument.
 */
export function parsePackageDocument(opfXml: string, logger?: Logger): PackageDocument {
  const doc = parseEpubXml(opfXml, 'OPF package document');

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
function parseMetadata(doc: XmlDocument, logger?: Logger): PackageMetadata {
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

function parseManifest(doc: XmlDocument): ManifestItem[] {
  const items: ManifestItem[] = [];
  const manifestEl = findFirstElement(doc.root, 'manifest');
  if (!manifestEl) {
    throw new EpubParseError('Missing <manifest> element in package document');
  }

  for (const el of findDescendants(manifestEl, 'item')) {
    const id = getAttribute(el, 'id');
    const href = getAttribute(el, 'href');
    const mediaType = getAttribute(el, 'media-type');

    if (!id || !href || !mediaType) {
      continue;
    }

    const propertiesAttr = getAttribute(el, 'properties');
    const item: ManifestItem = { id, href, mediaType };

    if (propertiesAttr) {
      items.push({ ...item, properties: propertiesAttr.split(/\s+/) });
    } else {
      items.push(item);
    }
  }

  return items;
}

function parseSpine(doc: XmlDocument): SpineItem[] {
  const items: SpineItem[] = [];
  const spineEl = findFirstElement(doc.root, 'spine');
  if (!spineEl) {
    throw new EpubParseError('Missing <spine> element in package document');
  }

  for (const el of findDescendants(spineEl, 'itemref')) {
    const idref = getAttribute(el, 'idref');
    if (!idref) {
      continue;
    }

    const linear = getAttribute(el, 'linear') !== 'no';
    items.push({ idref, linear });
  }

  return items;
}

function getMetadataText(doc: XmlDocument, localName: string): string | undefined {
  const el = findMetadataElement(doc, localName);
  const text = el ? textContent(el).trim() : '';
  return text || undefined;
}

function findMetadataElement(doc: XmlDocument, localName: string): XmlElement | undefined {
  // Try with dc: namespace prefix first, then without
  const dcElement = findElements(doc.root, `dc:${localName}`)[0];
  if (dcElement) return dcElement;

  // Fallback: search by local name within metadata element
  const metadataEl = findFirstElement(doc.root, 'metadata');
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
