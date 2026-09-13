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

/** The origin of every cluster in text order: byte offset into the run's
 * text and the absolute CSS point the pen draws it at: the alphabetic
 * baseline, for a text run and an annotation alike. */
function readClusters(reader) {
  const count = reader.count('cluster count');
  const clusters = [];
  for (let index = 0; index < count; index += 1) {
    const byte = reader.u32('cluster byte');
    const x = reader.f64('cluster x');
    const y = reader.f64('cluster y');
    clusters.push({ byte, x, y });
  }
  return clusters;
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
