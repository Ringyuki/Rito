import { validateReaderWireMessage } from './reader-session-wire-base-runtime.js';
import {
  readCollection,
  readTaggedU32,
  readLocator,
  readRect,
  readSourcePoint,
  readSourceRange,
} from './reader-session-artifact-decoder-runtime.js';

const FOOTNOTE_KINDS = ['footnote', 'endnote', 'rearnote', 'note'];
const FONT_SOURCES = ['host', 'publication'];
const FONT_GENERIC_ROLES = [null, 'serif', 'sansSerif', 'monospace'];
const EXACT_STATUSES = ['resolved', 'pending', 'unavailable'];
const AFFINITIES = ['upstream', 'downstream'];
const BOUNDARIES = ['start', 'end'];
const UNAVAILABLE_REASONS = [
  'shape-unavailable',
  'source-unavailable',
  'unsupported-transform',
  'visual-geometry-unavailable',
  'invalid-caret',
  'different-chapter',
];
const ANNOTATION_LEVELS = [
  'created',
  'exact',
  'quote',
  'position',
  'progression',
  'orphaned-href-not-found',
  'orphaned-empty-chapter',
];
const LOCATOR_MATCHES = ['source-range', 'source-point', 'anchor', 'progression', 'href'];
const ORDERS = [-1, 0, 1];

/** Decodes a `RITOFNT1` font catalog: every family a `font-family` list can name. */
export function decodeRitoReaderFontCatalog(value) {
  const reader = validateReaderWireMessage(value, 'RITOFNT1', 'font catalog');
  const families = readCollection(reader, 'font families', () => ({
    name: reader.string('font family name'),
    source: readTaggedU32(reader, 'font source', FONT_SOURCES),
    genericRole: readTaggedU32(reader, 'font generic role', FONT_GENERIC_ROLES),
    language:
      reader.option('font family language', () => reader.string('font family language')) ?? null,
    faces: readCollection(reader, 'font faces', () => ({
      weight: reader.u16('font face weight'),
      style: reader.string('font face style'),
      sha256: reader.option('font face sha256', () => reader.string('font face sha256')) ?? null,
    })),
  }));
  reader.finish('font catalog wire message');
  return { families };
}

/** Decodes a `RITOFNN1` list of font family names. */
export function decodeRitoReaderFontNames(value) {
  const reader = validateReaderWireMessage(value, 'RITOFNN1', 'font names');
  const names = readCollection(reader, 'font names', () => reader.string('font name'));
  reader.finish('font names wire message');
  return names;
}

export function decodeRitoReaderFootnote(value) {
  const reader = validateReaderWireMessage(value, 'RITOFTN1', 'footnote');
  const footnote = {
    artifactId: reader.externalId('footnote artifact id'),
    key: reader.string('footnote key'),
    kind: u32Tag(reader, 'footnote kind', FOOTNOTE_KINDS),
    text: reader.string('footnote text'),
    html: reader.string('footnote html'),
  };
  reader.finish('footnote wire message');
  return footnote;
}

export function decodeRitoReaderSearchResponse(value) {
  const reader = validateReaderWireMessage(value, 'RITOSRS1', 'search response');
  const response = {
    artifactId: reader.externalId('search response artifact id'),
    query: reader.string('search query'),
    truncated: reader.bool('search truncated'),
    searchedPageCount: reader.u32('searched page count'),
    results: readCollection(reader, 'search results', () => readSearchResult(reader)),
  };
  reader.finish('search response wire message');
  return response;
}

export function decodeRitoReaderTextRangeGeometry(value) {
  const reader = validateReaderWireMessage(value, 'RITOTRG1', 'text range geometry');
  const geometry = {
    artifactId: reader.externalId('text range geometry artifact id'),
    pageIndex: reader.u32('text range geometry page index'),
    rects: readCollection(reader, 'text range rects', () => {
      const record = reader.record('text range rect');
      const rect = readTextRect(record);
      record.finish('text range rect');
      return rect;
    }),
  };
  reader.finish('text range geometry wire message');
  return geometry;
}

export function decodeRitoReaderExactSourceRangeResolution(value) {
  const reader = validateReaderWireMessage(value, 'RITOESR1', 'exact source range');
  const resolution = {
    artifactId: reader.externalId('exact source range artifact id'),
    status: u32Tag(reader, 'exact source range status', EXACT_STATUSES),
    firstPageIndex: reader.option('exact source range first page', () =>
      reader.u32('exact source range first page index'),
    ),
    selectedText: reader.string('exact source range text'),
    rects: readCollection(reader, 'exact source rects', () => readPageTextRect(reader)),
  };
  reader.finish('exact source range wire message');
  return resolution;
}

export function decodeRitoReaderTextInteractionResponse(value) {
  const reader = validateReaderWireMessage(value, 'RITOTIR1', 'text interaction');
  const artifactId = reader.externalId('text interaction artifact id');
  const tag = reader.u8('text interaction result tag');
  let result;
  switch (tag) {
    case 0:
      result = { kind: 'caret', caret: readCaret(reader) };
      break;
    case 1:
      result = readSelectionResult(reader);
      break;
    case 2:
      result = { kind: 'miss' };
      break;
    case 3:
      result = { kind: 'boundary', boundary: u8Tag(reader, 'selection boundary', BOUNDARIES) };
      break;
    case 4:
      result = { kind: 'pending', boundary: u8Tag(reader, 'selection boundary', BOUNDARIES) };
      break;
    case 5:
      result = {
        kind: 'unavailable',
        reason: u8Tag(reader, 'unavailable reason', UNAVAILABLE_REASONS),
      };
      break;
    default:
      reader.fail(`unknown text interaction result tag: ${String(tag)}`);
  }
  reader.finish('text interaction wire message');
  return { artifactId, result };
}

export function decodeRitoReaderAnnotationResponse(value) {
  const reader = validateReaderWireMessage(value, 'RITOANR1', 'annotation');
  const level = u8Tag(reader, 'annotation level', ANNOTATION_LEVELS);
  const target = reader.option('annotation target', () => readAnnotationTarget(reader));
  reader.finish('annotation wire message');
  if (level.startsWith('orphaned') !== (target === undefined)) {
    reader.fail('an annotation carries a target exactly when it is not orphaned');
  }
  return { level, target };
}

export function decodeRitoReaderNavigationResult(value) {
  const reader = validateReaderWireMessage(value, 'RITONVR1', 'navigation');
  const tag = reader.u8('navigation result tag');
  let result;
  switch (tag) {
    case 0:
      result = {
        kind: 'toc-entry',
        tocId: reader.option('toc entry', () => reader.u32('toc entry')),
      };
      break;
    case 1:
      result = { kind: 'location', location: readLocation(reader) };
      break;
    case 2:
      result = { kind: 'order', order: u8Tag(reader, 'order', ORDERS) };
      break;
    case 3:
      result = { kind: 'layout', layout: readRevisionLayout(reader) };
      break;
    default:
      reader.fail(`unknown navigation result tag: ${String(tag)}`);
  }
  reader.finish('navigation wire message');
  return result;
}

function readSearchResult(reader) {
  const record = reader.record('search result');
  const result = {
    pageIndex: record.u32('search page index'),
    spreadIndex: record.u32('search spread index'),
    start: readTextPosition(record),
    end: readTextPosition(record),
    context: record.string('search context'),
    locator: record.option('search locator', () => readLocator(record)),
  };
  record.finish('search result');
  return result;
}

function readTextPosition(reader) {
  return {
    blockIndex: reader.u32('block index'),
    lineIndex: reader.u32('line index'),
    runIndex: reader.u32('run index'),
    charIndex: reader.u32('char index'),
  };
}

function readTextRect(reader) {
  return {
    bounds: readRect(reader),
    blockIndex: reader.u32('rect block index'),
    lineIndex: reader.u32('rect line index'),
    runIndex: reader.u32('rect run index'),
    startCharIndex: reader.u32('rect start char index'),
    endCharIndex: reader.u32('rect end char index'),
  };
}

function readPageTextRect(reader) {
  const record = reader.record('page text rect');
  const pageIndex = record.u32('rect page index');
  const rect = { pageIndex, ...readTextRect(record) };
  record.finish('page text rect');
  return rect;
}

function readSelectionResult(reader) {
  const anchorCaret = reader.option('anchor caret', () => readCaret(reader));
  const focusCaret = reader.option('focus caret', () => readCaret(reader));
  const selection = readSelection(reader);
  return {
    kind: 'selection',
    anchorCaret,
    focusCaret,
    selection,
    preferredInlinePosition: reader.option('preferred inline position', () =>
      reader.f64('preferred inline position'),
    ),
    preferredBlockPosition: reader.option('preferred block position', () =>
      reader.f64('preferred block position'),
    ),
  };
}

function readCaret(reader) {
  const record = reader.record('caret');
  const caret = {
    address: readCaretAddress(record),
    geometry: record.option('caret geometry', () => ({
      x: record.f64('caret x'),
      y: record.f64('caret y'),
      height: record.f64('caret height'),
    })),
    href: record.string('caret href'),
    sourcePoint: readSourcePoint(record),
  };
  record.finish('caret');
  return caret;
}

function readSelection(reader) {
  const record = reader.record('selection');
  const selection = {
    anchor: readCaretAddress(record),
    focus: readCaretAddress(record),
    start: readCaretAddress(record),
    end: readCaretAddress(record),
    selectedText: record.string('selected text'),
    sourceStartHref: record.string('selection start href'),
    sourceStart: readSourcePoint(record),
    sourceEndHref: record.string('selection end href'),
    sourceEnd: readSourcePoint(record),
    rects: readCollection(record, 'selection rects', () => readPageTextRect(record)),
  };
  record.finish('selection');
  return selection;
}

function readCaretAddress(reader) {
  const record = reader.record('caret address');
  const address = {
    pageIndex: record.u32('caret page index'),
    position: readTextPosition(record),
    affinity: u8Tag(record, 'caret affinity', AFFINITIES),
  };
  record.finish('caret address');
  return address;
}

function readAnnotationTarget(reader) {
  const record = reader.record('annotation target');
  const target = {
    json: record.string('annotation target json'),
    href: record.string('annotation href'),
    sourceRange: readSourceRange(record),
    exact: record.string('annotation exact'),
    prefix: record.string('annotation prefix'),
    suffix: record.string('annotation suffix'),
    start: record.u64('annotation start'),
    end: record.u64('annotation end'),
    chapterLength: record.u64('annotation chapter length'),
  };
  record.finish('annotation target');
  return target;
}

function readLocation(reader) {
  const tag = reader.u8('location tag');
  switch (tag) {
    case 0:
      return {
        kind: 'page',
        pageIndex: reader.u32('located page'),
        drawn: reader.bool('page drawn'),
        matchedBy: u8Tag(reader, 'locator match', LOCATOR_MATCHES),
      };
    case 1:
      return { kind: 'not-laid-out' };
    case 2:
      return { kind: 'unavailable' };
    default:
      reader.fail(`unknown location tag: ${String(tag)}`);
  }
}

function readRevisionLayout(reader) {
  const optionalU32 = (field) => reader.option(field, () => reader.u32(field));
  return {
    pageCount: reader.u32('layout page count'),
    spreads: readCollection(reader, 'layout spreads', () => ({
      leftPageIndex: reader.u32('spread left page'),
      rightPageIndex: optionalU32('spread right page'),
    })),
    chapters: readCollection(reader, 'layout chapters', () => ({
      spineIndex: reader.u32('chapter spine index'),
      startPage: reader.u32('chapter start page'),
      endPage: reader.u32('chapter end page'),
    })),
    tocTargets: readCollection(reader, 'layout toc targets', () => ({
      tocId: reader.u32('toc target entry'),
      pageIndex: reader.u32('toc target page'),
    })),
    activeTocEntryByPage: readCollection(reader, 'layout page toc entries', () =>
      optionalU32('page toc entry'),
    ),
    complete: reader.bool('layout complete'),
  };
}

function u8Tag(reader, field, values) {
  const tag = reader.u8(field);
  if (tag >= values.length) reader.fail(`unknown ${field}: ${String(tag)}`);
  return values[tag];
}

function u32Tag(reader, field, values) {
  const tag = reader.u32(field);
  if (tag >= values.length) reader.fail(`unknown ${field}: ${String(tag)}`);
  return values[tag];
}
