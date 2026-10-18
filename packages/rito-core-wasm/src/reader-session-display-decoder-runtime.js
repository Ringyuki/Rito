import { readRitoDisplayRunPaint } from './reader-session-display-paint-runtime.js';

/** The text run body the `RITODL1` text and ruby primitives share. */
export function readRitoDisplayTextCommand(reader) {
  return {
    text: reader.string('text'),
    rect: readRect(reader, 'text rect'),
    paint: readRitoDisplayRunPaint(reader),
    lineHeightPx: reader.option('text line height', () => reader.f64('text line height')),
    href: reader.option('text href', () => reader.string('text href')),
    sourceText: reader.option('source text', () => reader.string('source text')),
    sourceTextOffset: reader.option('source text offset', () => reader.u64('source text offset')),
    clusters: readClusters(reader),
  };
}

/** Every cluster in text order, packed: its byte offset into the run's
 * text, the absolute CSS point the pen draws it at (the alphabetic
 * baseline, for a text run and an annotation alike) and whether the pen
 * reaches it from the cluster before. */
function readClusters(reader) {
  const count = reader.count('cluster count');
  const bytes = new Uint32Array(count);
  const origins = new Float32Array(count * 2);
  const joins = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    bytes[index] = reader.u32('cluster byte');
    origins[index * 2] = reader.f32('cluster x');
    origins[index * 2 + 1] = reader.f32('cluster y');
    joins[index] = reader.bool('cluster joins') ? 1 : 0;
  }
  return { bytes, origins, joins };
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
