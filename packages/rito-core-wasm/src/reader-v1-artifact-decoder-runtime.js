import { readerWireBytesV1, validateReaderWireMessageV1 } from './reader-v1-wire-base-runtime.js';
import { decodeRitoReaderDisplayListV1 } from './reader-v1-display-decoder-runtime.js';

const MAX_SEMANTIC_DEPTH = 64;
const LOCATOR_MATCHES = ['source-range', 'source-point', 'anchor', 'progression', 'href'];
const ADJACENT = ['available', 'pending', 'chapter-boundary', 'terminal', 'blocked'];
const RESOURCE_KINDS = ['image', 'font', 'stylesheet'];
const RESOURCE_BYTE_LIMITS = [32 * 1024 * 1024, 16 * 1024 * 1024, 4 * 1024 * 1024];
const SEMANTIC_ROLES = [
  'heading',
  'paragraph',
  'list',
  'list-item',
  'image',
  'link',
  'blockquote',
  'table',
  'generic',
];

export function decodeRitoReaderArtifactV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITOART1', 'artifact');
  const protocolVersion = reader.u32('artifact protocol version');
  if (protocolVersion !== 1) {
    reader.fail(`unsupported artifact protocol version: ${String(protocolVersion)}`);
  }
  const capabilityProfileId = reader.u32('capability profile');
  if (capabilityProfileId !== 1) {
    reader.fail(`unsupported capability profile: ${String(capabilityProfileId)}`);
  }
  const artifact = {
    protocolVersion,
    capabilityProfileId,
    sessionId: reader.externalId('session id'),
    requestId: reader.externalId('request id'),
    revisionId: reader.externalId('revision id'),
    revisionVersion: reader.u32('revision version'),
    artifactId: reader.externalId('artifact id'),
    locator: readLocator(reader),
    matchedBy: readTaggedU32(reader, 'locator match', LOCATOR_MATCHES),
    localPageIndex: reader.u32('local page index'),
    localSpreadIndex: reader.u32('local spread index'),
    localPageIndexes: readCollection(reader, 'local page indexes', () =>
      reader.u32('local page index'),
    ),
    width: reader.f64('artifact width'),
    height: reader.f64('artifact height'),
    terminalExtent: reader.bool('terminal extent'),
    navigation: {
      previous: readTaggedU32(reader, 'adjacent availability', ADJACENT),
      next: readTaggedU32(reader, 'adjacent availability', ADJACENT),
    },
    textProfile: readTaggedU32(reader, 'text profile', [
      'platform-string-runs',
      'positioned-glyph-runs',
    ]),
    displayList: readDisplayList(reader),
    resources: readCollection(reader, 'resources', () => readResourceRef(reader)),
    fonts: readCollection(reader, 'fonts', () => readFont(reader)),
    pages: readCollection(reader, 'pages', () => readPage(reader)),
  };
  reader.finish('artifact wire message');
  return artifact;
}

export function decodeRitoReaderArtifactIdentityV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITOART1', 'artifact');
  const protocolVersion = reader.u32('artifact protocol version');
  const capabilityProfileId = reader.u32('capability profile');
  if (protocolVersion !== 1 || capabilityProfileId !== 1) {
    reader.fail('artifact protocol or capability profile is unsupported');
  }
  return {
    sessionId: reader.externalId('session id'),
    requestId: reader.externalId('request id'),
    revisionId: reader.externalId('revision id'),
    revisionVersion: reader.u32('revision version'),
    artifactId: reader.externalId('artifact id'),
  };
}

export function decodeRitoReaderResourceV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITORES1', 'resource');
  const artifactId = reader.externalId('resource artifact id');
  const kindTag = reader.u32('resource kind');
  const kind = RESOURCE_KINDS[kindTag];
  if (kind === undefined) reader.fail(`unknown resource kind tag: ${String(kindTag)}`);
  const resource = {
    artifactId,
    kind,
    href: reader.string('resource href'),
    mediaType: reader.string('resource media type'),
    bytes: reader.blob('resource bytes', RESOURCE_BYTE_LIMITS[kindTag]),
    width: reader.option('resource width', () => reader.u32('resource width')),
    height: reader.option('resource height', () => reader.u32('resource height')),
  };
  reader.finish('resource wire message');
  return resource;
}

function readLocator(reader) {
  const record = reader.record('locator');
  const locator = {
    href: record.string('locator href'),
    anchorId: record.option('locator anchor', () => record.string('locator anchor')),
    sourcePoint: record.option('source point', () => readSourcePoint(record)),
    sourceRange: record.option('source range', () => readSourceRange(record)),
    progression: record.option('locator progression', () => record.f64('locator progression')),
  };
  record.finish('locator');
  if (locator.href.length === 0) record.fail('locator href must not be empty');
  if (locator.progression !== undefined && (locator.progression < 0 || locator.progression > 1)) {
    record.fail('locator progression must be 0..1');
  }
  return locator;
}

function readSourcePoint(reader) {
  const record = reader.record('source point');
  const point = {
    nodePath: readCollection(record, 'source point path', () => record.u32('source path part')),
    textOffset: record.u64('source text offset'),
  };
  record.finish('source point');
  return point;
}

function readSourceRange(reader) {
  const record = reader.record('source range');
  const range = { start: readSourcePoint(record), end: readSourcePoint(record) };
  record.finish('source range');
  return range;
}

function readDisplayList(reader) {
  const record = reader.record('display list');
  const formatVersion = record.u32('display list format version');
  const commandCount = record.u32('display list command count');
  const semanticDigest = record.fixedBytes(32, 'display list digest');
  const wireBytes = record.blob('display list bytes');
  record.finish('display list');
  const displayList = decodeRitoReaderDisplayListV1(wireBytes);
  if (displayList.formatVersion !== formatVersion || displayList.commandCount !== commandCount) {
    reader.fail('display list metadata does not match RITODL1 bytes');
  }
  return { formatVersion, commandCount, semanticDigest, wireBytes, displayList };
}

function readResourceRef(reader) {
  const record = reader.record('resource');
  const resource = {
    kind: readTaggedU32(record, 'resource kind', RESOURCE_KINDS),
    href: record.string('resource href'),
  };
  record.finish('resource');
  return resource;
}

function readFont(reader) {
  const record = reader.record('font');
  const font = {
    family: record.string('font family'),
    href: record.string('font href'),
    style: record.string('font style'),
    weight: record.u16('font weight'),
    shapeFingerprint: record.string('font shape fingerprint'),
    byteLength: record.u64('font byte length'),
  };
  record.finish('font');
  return font;
}

function readPage(reader) {
  const record = reader.record('page');
  const page = {
    pageIndex: record.u32('page index'),
    width: record.f64('page width'),
    height: record.f64('page height'),
    hits: readCollection(record, 'page hits', () => readHit(record)),
    semantics: readSemantics(record, 0),
    text: record.string('page text'),
    textLength: record.u64('page text length'),
    textRuns: readCollection(record, 'page text runs', () => readTextRun(record)),
  };
  record.finish('page');
  return page;
}

function readHit(reader) {
  const record = reader.record('hit');
  const hit = {
    pageIndex: record.u32('hit page index'),
    bounds: readRect(record),
    text: record.string('hit text'),
    href: readOptionalString(record, 'hit href'),
    sourcePoint: record.option('hit source point', () => readSourcePoint(record)),
    imageSrc: readOptionalString(record, 'hit image source'),
    imageAlt: readOptionalString(record, 'hit image alternative'),
  };
  record.finish('hit');
  return hit;
}

function readSemantics(reader, depth) {
  return readCollection(reader, 'page semantics', () => readSemanticNode(reader, depth));
}

function readSemanticNode(reader, depth) {
  if (depth > MAX_SEMANTIC_DEPTH) reader.fail('semantic tree exceeds the depth limit');
  const record = reader.record('semantic node');
  const semantic = {
    role: readTaggedU32(record, 'semantic role', SEMANTIC_ROLES),
    level: record.option('semantic level', () => record.u8('semantic level')),
    text: readOptionalString(record, 'semantic text'),
    alt: readOptionalString(record, 'semantic alternative'),
    href: readOptionalString(record, 'semantic href'),
    bounds: readRect(record),
    children: readSemantics(record, depth + 1),
  };
  record.finish('semantic node');
  return semantic;
}

function readTextRun(reader) {
  const record = reader.record('text run');
  const run = {
    start: record.u64('text run start'),
    end: record.u64('text run end'),
    blockIndex: record.u32('text block index'),
    lineIndex: record.u32('text line index'),
    runIndex: record.u32('text run index'),
  };
  record.finish('text run');
  return run;
}

function readRect(reader) {
  return {
    x: reader.f64('rectangle x'),
    y: reader.f64('rectangle y'),
    width: reader.f64('rectangle width'),
    height: reader.f64('rectangle height'),
  };
}

function readCollection(reader, field, read) {
  return Array.from({ length: reader.count(field) }, read);
}

function readOptionalString(reader, field) {
  return reader.option(field, () => reader.string(field));
}

function readTaggedU32(reader, field, values) {
  const tag = reader.u32(field);
  const value = values[tag];
  if (value === undefined) reader.fail(`unknown ${field}: ${String(tag)}`);
  return value;
}

export function copyRitoReaderWireBytesV1(value) {
  return new Uint8Array(readerWireBytesV1(value, 'reader wire bytes'));
}
