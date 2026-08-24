import {
  READER_V1_PROTOCOL_VERSION,
  RitoReaderWireErrorV1,
  readerWireBytesV1,
  validateReaderWireMessageV1,
} from './reader-v1-wire-base-runtime.js';

const PUBLICATION_WIRE_BYTES_MAX = 16 * 1024 * 1024;
const TOC_DEPTH_MAX = 64;
const TOC_ITEM_MAX = 100_000;

export function decodeRitoReaderPublicationV1(value) {
  const bytes = readerWireBytesV1(value, 'publication');
  if (bytes.byteLength > PUBLICATION_WIRE_BYTES_MAX) {
    throw new RitoReaderWireErrorV1('publication wire exceeds the byte limit', 0);
  }
  const reader = validateReaderWireMessageV1(bytes, 'RITOPUB1', 'publication');
  const protocolVersion = reader.u32('publication protocol version');
  if (protocolVersion !== READER_V1_PROTOCOL_VERSION) {
    reader.fail(`unsupported publication protocol version: ${String(protocolVersion)}`);
  }
  const sessionId = reader.externalId('publication session id');
  const metadata = readMetadata(reader);
  const { spine, duplicateHrefs } = readSpine(reader);
  const tocContext = { itemCount: 0, nextTocId: 0 };
  const toc = readTocEntries(reader, 1, tocContext, spine, duplicateHrefs);
  reader.finish('publication wire message');
  return { protocolVersion, sessionId, metadata, spine, toc };
}

function readMetadata(reader) {
  const record = reader.record('publication metadata');
  const metadata = {
    title: record.string('publication title'),
    language: record.string('publication language'),
    identifier: record.string('publication identifier'),
    creator: record.option('publication creator', () => record.string('publication creator')),
  };
  record.finish('publication metadata');
  return metadata;
}

function readSpine(reader) {
  const count = reader.count('publication spine');
  const spine = [];
  const hrefs = new Set();
  const duplicateHrefs = new Set();
  let nextLinearIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const record = reader.record('publication spine item');
    const item = {
      spineIndex: record.u32('publication spine index'),
      linearIndex: record.option('publication linear index', () =>
        record.u32('publication linear index'),
      ),
      idref: record.string('publication spine idref'),
      href: record.string('publication spine href'),
    };
    record.finish('publication spine item');
    if (item.spineIndex !== index)
      reader.fail('publication spine indexes must be dense and ordered');
    if (item.idref.length === 0 || item.href.length === 0) {
      reader.fail('publication spine idref and href must not be empty');
    }
    if (hrefs.has(item.href)) duplicateHrefs.add(item.href);
    else hrefs.add(item.href);
    if (item.linearIndex !== undefined) {
      if (item.linearIndex !== nextLinearIndex) {
        reader.fail('publication linear indexes must be dense and ordered');
      }
      nextLinearIndex += 1;
    }
    spine.push(item);
  }
  return { spine, duplicateHrefs };
}

function readTocEntries(reader, depth, context, spine, duplicateHrefs) {
  const count = reader.count('publication TOC child count');
  if (depth > TOC_DEPTH_MAX && count !== 0) {
    reader.fail('publication TOC exceeds the depth limit');
  }
  if (context.itemCount + count > TOC_ITEM_MAX) {
    reader.fail('publication TOC exceeds the item limit');
  }
  context.itemCount += count;
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    entries.push(readTocEntry(reader, depth, context, spine, duplicateHrefs));
  }
  return entries;
}

function readTocEntry(reader, depth, context, spine, duplicateHrefs) {
  const record = reader.record('publication TOC entry');
  const tocId = record.u32('publication TOC id');
  if (tocId !== context.nextTocId) {
    record.fail('publication TOC IDs must be dense preorder identities');
  }
  context.nextTocId += 1;
  const entry = {
    tocId,
    label: record.string('publication TOC label'),
    target: readTocTarget(record, spine, duplicateHrefs),
    children: readTocEntries(record, depth + 1, context, spine, duplicateHrefs),
  };
  record.finish('publication TOC entry');
  return entry;
}

function readTocTarget(reader, spine, duplicateHrefs) {
  const tag = reader.u8('publication TOC target tag');
  if (tag === 0) {
    const spineIndex = reader.u32('publication TOC spine index');
    const locator = readTocLocator(reader);
    const item = spine[spineIndex];
    if (!item) reader.fail('publication TOC spine index is out of bounds');
    if (locator.href !== item.href) {
      reader.fail('publication TOC locator does not match its spine item');
    }
    if (duplicateHrefs.has(locator.href)) {
      reader.fail('publication TOC locator href is ambiguous in the spine');
    }
    return { kind: 'locator', spineIndex, locator };
  }
  if (tag !== 1 && tag !== 2) {
    reader.fail(`unknown publication TOC target tag: ${String(tag)}`);
  }
  const href = reader.string(
    tag === 1 ? 'publication external TOC href' : 'publication unresolved TOC href',
  );
  if (tag === 1) {
    if (href.length === 0 || !isExternalHref(href)) {
      reader.fail('publication external TOC href is invalid');
    }
    return { kind: 'external', href };
  }
  if (isExternalHref(href)) {
    reader.fail('publication external TOC href must use the external target');
  }
  return { kind: 'unresolved', href };
}

function readTocLocator(reader) {
  const record = reader.record('publication TOC locator');
  const locator = {
    href: record.string('locator href'),
    anchorId: record.option('locator anchor', () => record.string('locator anchor')),
    sourcePoint: record.option('source point', () => readSourcePoint(record)),
    sourceRange: record.option('source range', () => readSourceRange(record)),
    progression: record.option('locator progression', () => record.f64('locator progression')),
  };
  record.finish('publication TOC locator');
  if (
    locator.sourcePoint !== undefined ||
    locator.sourceRange !== undefined ||
    locator.progression !== undefined
  ) {
    record.fail('publication TOC locator may only contain href and anchorId');
  }
  return locator;
}

function readSourcePoint(reader) {
  const record = reader.record('source point');
  const count = record.count('source point path');
  const nodePath = [];
  for (let index = 0; index < count; index += 1) nodePath.push(record.u32('source path part'));
  const point = { nodePath, textOffset: record.u64('source text offset') };
  record.finish('source point');
  return point;
}

function readSourceRange(reader) {
  const record = reader.record('source range');
  const range = { start: readSourcePoint(record), end: readSourcePoint(record) };
  record.finish('source range');
  return range;
}

function isExternalHref(href) {
  if (href.startsWith('//')) return true;
  const query = href.indexOf('?');
  const fragment = href.indexOf('#');
  const pathEnd = Math.min(query < 0 ? href.length : query, fragment < 0 ? href.length : fragment);
  const path = href.slice(0, pathEnd);
  const colon = path.indexOf(':');
  if (colon <= 0 || !isAsciiLetter(path[0])) return false;
  for (let index = 1; index < colon; index += 1) {
    const character = path[index];
    if (!isAsciiLetter(character) && !isAsciiDigit(character) && !'+-.'.includes(character)) {
      return false;
    }
  }
  return true;
}

function isAsciiLetter(character) {
  return typeof character === 'string' && /^[A-Za-z]$/.test(character);
}

function isAsciiDigit(character) {
  return typeof character === 'string' && /^[0-9]$/.test(character);
}
