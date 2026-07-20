import { ReaderWireWriterV1 } from './reader-v1-wire-base-runtime.js';

export function encodeRitoReaderArtifactRequestV1(request) {
  const writer = ReaderWireWriterV1.message('RITOREQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.requestId, 'request id');
  writer.record((record) => writeLayout(record, request.layout));
  writer.record((record) => writeLocator(record, request.locator));
  writer.record((record) => writeWork(record, request.work));
  writer.u32(textProfile(request.textProfile), 'text profile');
  return writer.finish();
}

export function encodeRitoReaderAdjacentRequestV1(request) {
  const writer = ReaderWireWriterV1.message('RITONAV1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.requestId, 'request id');
  writer.externalId(request.fromArtifactId, 'from artifact id');
  writer.u32(adjacentDirection(request.direction), 'adjacent direction');
  writeWork(writer, request.work);
  const bytes = writer.finish();
  if (bytes.byteLength !== 60) throw new Error('RITONAV1 must be exactly 60 bytes');
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
}

function writeLocator(writer, value) {
  if (value === null || typeof value !== 'object')
    throw new TypeError('Reader locator is required');
  writer.string(value.href, 'locator href');
  if (value.href.length === 0) throw new RangeError('locator href must not be empty');
  writer.option(value.anchorId, (anchor) => writer.string(anchor, 'locator anchor'));
  writer.option(value.sourcePoint, (point) => writeSourcePointRecord(writer, point));
  writer.option(value.sourceRange, (range) => {
    writer.record((record) => {
      writeSourcePointRecord(record, range.start);
      writeSourcePointRecord(record, range.end);
    });
  });
  writer.option(value.progression, (progression) => {
    if (progression < 0 || progression > 1)
      throw new RangeError('locator progression must be 0..1');
    writer.f64(progression, 'locator progression');
  });
}

function writeSourcePointRecord(writer, value) {
  if (value === null || typeof value !== 'object' || !Array.isArray(value.nodePath)) {
    throw new TypeError('Reader source point is invalid');
  }
  writer.record((record) => {
    record.count(value.nodePath.length, 'source path count');
    for (const part of value.nodePath) record.u32(part, 'source path part');
    record.u64(value.textOffset, 'source text offset');
  });
}

function writeWork(writer, value) {
  if (value === null || typeof value !== 'object')
    throw new TypeError('Reader work budget is required');
  writer.u32(value.maxTopLevelNodesPerQuantum, 'max top-level nodes per quantum');
  writer.u32(value.maxForegroundQuanta, 'max foreground quanta');
  writer.u32(value.localPageCap, 'local page cap');
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
