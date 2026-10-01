import { ReaderWireWriter } from './reader-session-wire-base-runtime.js';
import {
  writeRitoReaderLocator,
  writeRitoReaderSourcePoint,
} from './reader-session-request-runtime.js';

const AFFINITIES = ['upstream', 'downstream'];
const GRANULARITIES = ['word', 'paragraph'];
const MOVEMENTS = [
  'character-left',
  'character-right',
  'word-left',
  'word-right',
  'word-start-right',
  'line-up',
  'line-down',
  'line-start',
  'line-end',
  'page-up',
  'page-down',
  'paragraph-backward',
  'paragraph-forward',
  'paragraph-previous-start',
  'paragraph-next-start',
  'chapter-start',
  'chapter-end',
  'document-start',
  'document-end',
];
const TEXT_RANGE_REQUEST_BYTES = 72;

export function encodeRitoReaderSearchRequest(request) {
  const writer = ReaderWireWriter.message('RITOSRQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.artifactId, 'artifact id');
  writer.string(request.query, 'search query');
  writer.bool(request.caseSensitive);
  writer.bool(request.wholeWord);
  writer.u32(request.limit, 'search limit');
  return writer.finish();
}

export function encodeRitoReaderTextRangeRequest(request) {
  const writer = ReaderWireWriter.message('RITOTRQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.artifactId, 'artifact id');
  writer.u32(request.pageIndex, 'page index');
  writeTextPosition(writer, request.start);
  writeTextPosition(writer, request.end);
  const bytes = writer.finish();
  if (bytes.byteLength !== TEXT_RANGE_REQUEST_BYTES) {
    throw new Error(`RITOTRQ1 must be exactly ${String(TEXT_RANGE_REQUEST_BYTES)} bytes`);
  }
  return bytes;
}

export function encodeRitoReaderExactSourceRangeRequest(request) {
  const writer = ReaderWireWriter.message('RITOESQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.artifactId, 'artifact id');
  writer.string(request.href, 'exact source range href');
  writeSourceRange(writer, request.range);
  return writer.finish();
}

export function encodeRitoReaderTextInteractionRequest(request) {
  const writer = ReaderWireWriter.message('RITOTIQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.artifactId, 'artifact id');
  const { query } = request;
  switch (query.kind) {
    case 'caret':
      writer.u8(0, 'text interaction query');
      writeTextPoint(writer, query.point);
      break;
    case 'range':
      writer.u8(1, 'text interaction query');
      writeCaretAddress(writer, query.anchor);
      writeCaretAddress(writer, query.focus);
      break;
    case 'range-to-point':
      writer.u8(2, 'text interaction query');
      writeCaretAddress(writer, query.anchor);
      writeTextPoint(writer, query.focus);
      break;
    case 'range-from-points':
      writer.u8(3, 'text interaction query');
      writeTextPoint(writer, query.anchor);
      writeTextPoint(writer, query.focus);
      writer.u8(tag(GRANULARITIES, query.granularity, 'selection granularity'), 'granularity');
      break;
    case 'movement':
      writer.u8(4, 'text interaction query');
      writeCaretAddress(writer, query.anchor);
      writeCaretAddress(writer, query.focus);
      writer.u8(tag(MOVEMENTS, query.movement, 'selection movement'), 'movement');
      writer.option(query.preferredInlinePosition, (value) =>
        writer.f64(value, 'preferred inline position'),
      );
      writer.option(query.preferredBlockPosition, (value) =>
        writer.f64(value, 'preferred block position'),
      );
      break;
    default:
      throw new RangeError(`unknown text interaction query: ${String(query?.kind)}`);
  }
  return writer.finish();
}

export function encodeRitoReaderAnnotationRequest(request) {
  const writer = ReaderWireWriter.message('RITOANQ1');
  writer.externalId(request.sessionId, 'session id');
  const { query } = request;
  switch (query.kind) {
    case 'create':
      writer.u8(0, 'annotation query');
      writer.string(query.href, 'annotation href');
      writeSourceRange(writer, query.range);
      break;
    case 'resolve':
      writer.u8(1, 'annotation query');
      writer.string(query.targetJson, 'annotation target');
      break;
    default:
      throw new RangeError(`unknown annotation query: ${String(query?.kind)}`);
  }
  return writer.finish();
}

export function encodeRitoReaderNavigationRequest(request) {
  const writer = ReaderWireWriter.message('RITONVQ1');
  writer.externalId(request.sessionId, 'session id');
  const { query } = request;
  switch (query.kind) {
    case 'toc-entry-at-page':
      writer.u8(0, 'navigation query');
      writer.externalId(query.artifactId, 'artifact id');
      writer.u32(query.pageIndex, 'page index');
      break;
    case 'toc-entry-at-position':
      writer.u8(1, 'navigation query');
      writer.string(query.href, 'position href');
      writeRitoReaderSourcePoint(writer, query.point);
      break;
    case 'locate':
      writer.u8(2, 'navigation query');
      writer.externalId(query.artifactId, 'artifact id');
      writer.record((record) => writeRitoReaderLocator(record, query.locator));
      break;
    case 'compare':
      writer.u8(3, 'navigation query');
      writer.string(query.firstHref, 'first href');
      writeRitoReaderSourcePoint(writer, query.first);
      writer.string(query.secondHref, 'second href');
      writeRitoReaderSourcePoint(writer, query.second);
      break;
    default:
      throw new RangeError(`unknown navigation query: ${String(query?.kind)}`);
  }
  return writer.finish();
}

function writeSourceRange(writer, range) {
  writer.record((record) => {
    writeRitoReaderSourcePoint(record, range.start);
    writeRitoReaderSourcePoint(record, range.end);
  });
}

function writeTextPosition(writer, value) {
  writer.u32(value.blockIndex, 'block index');
  writer.u32(value.lineIndex, 'line index');
  writer.u32(value.runIndex, 'run index');
  writer.u32(value.charIndex, 'char index');
}

function writeTextPoint(writer, point) {
  writer.record((record) => {
    record.u32(point.pageIndex, 'text point page index');
    record.f64(point.x, 'text point x');
    record.f64(point.y, 'text point y');
  });
}

function writeCaretAddress(writer, address) {
  writer.record((record) => {
    record.u32(address.pageIndex, 'caret page index');
    writeTextPosition(record, address.position);
    record.u8(tag(AFFINITIES, address.affinity, 'caret affinity'), 'caret affinity');
  });
}

function tag(values, value, field) {
  const index = values.indexOf(value);
  if (index < 0) throw new RangeError(`unknown ${field}: ${String(value)}`);
  return index;
}
