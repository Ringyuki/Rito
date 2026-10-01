import { ReaderWireWriter } from './reader-session-wire-base-runtime.js';

export function encodeRitoReaderArtifactRequest(request) {
  const writer = ReaderWireWriter.message('RITOREQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.requestId, 'request id');
  writer.record((record) => writeLayout(record, request.layout));
  writer.record((record) => writeRitoReaderLocator(record, request.locator));
  writer.u32(textProfile(request.textProfile), 'text profile');
  return writer.finish();
}

export function encodeRitoReaderAdjacentRequest(request) {
  const writer = ReaderWireWriter.message('RITONAV1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.requestId, 'request id');
  writer.externalId(request.fromArtifactId, 'from artifact id');
  writer.u32(adjacentDirection(request.direction), 'adjacent direction');
  const bytes = writer.finish();
  if (bytes.byteLength !== 48) throw new Error('RITONAV1 must be exactly 48 bytes');
  return bytes;
}

function writeLayout(writer, value) {
  if (value === null || typeof value !== 'object') throw new TypeError('Reader layout is required');
  writer.f64(value.viewportWidth, 'viewport width');
  writer.f64(value.viewportHeight, 'viewport height');
  writer.f64(value.marginTop, 'top margin');
  writer.f64(value.marginRight, 'right margin');
  writer.f64(value.marginBottom, 'bottom margin');
  writer.f64(value.marginLeft, 'left margin');
  writer.u32(value.spreadMode === 'single' ? 0 : requireDouble(value.spreadMode), 'spread mode');
  writer.bool(value.firstPageAlone);
  writer.f64(value.spreadGap, 'spread gap');
  writer.f64(value.rootFontSize, 'root font size');
  writer.option(value.lineHeightOverride, (override) =>
    writer.f64(override, 'line height override'),
  );
  writer.option(value.fontFamilyOverride, (family) =>
    writer.string(family, 'font family override'),
  );
  writer.f64(value.renderRatio ?? 1, 'render ratio');
}

export function writeRitoReaderLocator(writer, value) {
  if (value === null || typeof value !== 'object')
    throw new TypeError('Reader locator is required');
  writer.string(value.href, 'locator href');
  if (value.href.length === 0) throw new RangeError('locator href must not be empty');
  writer.option(value.anchorId, (anchor) => writer.string(anchor, 'locator anchor'));
  writer.option(value.sourcePoint, (point) => writeRitoReaderSourcePoint(writer, point));
  writer.option(value.sourceRange, (range) => {
    writer.record((record) => {
      writeRitoReaderSourcePoint(record, range.start);
      writeRitoReaderSourcePoint(record, range.end);
    });
  });
  writer.option(value.progression, (progression) => {
    if (progression < 0 || progression > 1)
      throw new RangeError('locator progression must be 0..1');
    writer.f64(progression, 'locator progression');
  });
}

export function writeRitoReaderSourcePoint(writer, value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.nodePath)) {
    throw new TypeError('Reader source point is invalid');
  }
  writer.record((record) => {
    record.count(value.nodePath.length, 'source path count');
    for (const part of value.nodePath) record.u32(part, 'source path part');
    record.u64(value.textOffset, 'source text offset');
  });
}

function requireDouble(value) {
  if (value !== 'double') throw new RangeError(`unknown spread mode: ${String(value)}`);
  return 1;
}

function textProfile(value) {
  if (value === 'platform-string-runs') return 0;
  if (value === 'positioned-glyph-runs') return 1;
  throw new RangeError(`unknown text profile: ${String(value)}`);
}

function adjacentDirection(value) {
  if (value === 'previous') return 0;
  if (value === 'next') return 1;
  throw new RangeError(`unknown adjacent direction: ${String(value)}`);
}
