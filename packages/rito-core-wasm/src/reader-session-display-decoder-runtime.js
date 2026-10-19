import { readRitoDisplayRunPaint } from './reader-session-display-paint-runtime.js';

/** Whether this platform lays typed arrays out little-endian, as the wire
 * is: then the cluster table is read in place. */
const LITTLE_ENDIAN = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;

/** A text or ruby run as the `RITODL1` primitive carries it: its rect and
 * optional fields, and where its text, paint and clusters sit in the
 * tables after the primitives (see `readRitoDisplayTextTables`). */
export function readRitoDisplayTextReference(reader, kind) {
  // The run's byte range in the text table, which a UTF-16 reader skips.
  reader.u32('text byte start');
  reader.u32('text byte length');
  return {
    kind,
    unitStart: reader.u32('text start'),
    unitLength: reader.u32('text length'),
    rect: readRect(reader, 'text rect'),
    paintIndex: reader.u32('text paint'),
    lineHeightPx: reader.option('text line height', () => reader.f64('text line height')),
    href: reader.option('text href', () => reader.string('text href')),
    sourceText: reader.option('source text', () => reader.string('source text')),
    sourceTextOffset: reader.option('source text offset', () => reader.u64('source text offset')),
    clusterStart: reader.u32('text cluster start'),
    clusterCount: reader.u32('text cluster count'),
  };
}

/** The tables the runs index into: every cluster's byte, origin and joins
 * flag as typed arrays over the message itself, the text decoded once, and
 * each distinct paint decoded once. A table the message does not hold on
 * a four-byte boundary is copied out once, as a whole. */
export function readRitoDisplayTextTables(reader) {
  const count = reader.count('cluster table count');
  while (reader.cursor % 4 !== 0) {
    if (reader.u8('cluster table padding') !== 0) reader.fail('cluster table padding is not zero');
  }
  const table = reader.take(count * 13, 'cluster table');
  const joins = table.subarray(count * 12);
  for (let index = 0; index < count; index += 1) {
    if (joins[index] > 1) reader.fail(`unknown cluster joins boolean tag: ${String(joins[index])}`);
  }
  const clusters = clusterTable(table, count);
  const text = reader.string('text table');
  const paints = Array.from({ length: reader.count('paint count') }, () =>
    readRitoDisplayRunPaint(reader),
  );
  return { count, ...clusters, text, paints };
}

/** A run as a renderer reads it, from its reference into the tables. */
export function resolveRitoDisplayTextRun(reader, reference, tables) {
  const { unitStart, unitLength, paintIndex, clusterStart, clusterCount } = reference;
  const paint = tables.paints[paintIndex];
  if (
    paint === undefined ||
    unitStart + unitLength > tables.text.length ||
    clusterStart + clusterCount > tables.count
  ) {
    reader.fail('text run reaches past the tables');
  }
  const end = clusterStart + clusterCount;
  return {
    kind: reference.kind,
    text: tables.text.substring(unitStart, unitStart + unitLength),
    rect: reference.rect,
    paint,
    lineHeightPx: reference.lineHeightPx,
    href: reference.href,
    sourceText: reference.sourceText,
    sourceTextOffset: reference.sourceTextOffset,
    clusters: {
      bytes: tables.bytes.subarray(clusterStart, end),
      origins: tables.origins.subarray(clusterStart * 2, end * 2),
      joins: tables.joins.subarray(clusterStart, end),
    },
  };
}

function clusterTable(table, count) {
  if (LITTLE_ENDIAN && table.byteOffset % 4 === 0) {
    return {
      bytes: new Uint32Array(table.buffer, table.byteOffset, count),
      origins: new Float32Array(table.buffer, table.byteOffset + count * 4, count * 2),
      joins: table.subarray(count * 12),
    };
  }
  if (LITTLE_ENDIAN) return clusterTable(table.slice(), count);
  const data = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const bytes = new Uint32Array(count);
  const origins = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    bytes[index] = data.getUint32(index * 4, true);
    origins[index * 2] = data.getFloat32(count * 4 + index * 8, true);
    origins[index * 2 + 1] = data.getFloat32(count * 4 + index * 8 + 4, true);
  }
  return { bytes, origins, joins: table.slice(count * 12) };
}

export function readRitoDisplayRect(reader, field) {
  return readRect(reader, field);
}

function readRect(reader, field) {
  return {
    x: reader.f64(`${field} x`),
    y: reader.f64(`${field} y`),
    width: reader.f64(`${field} width`),
    height: reader.f64(`${field} height`),
  };
}
