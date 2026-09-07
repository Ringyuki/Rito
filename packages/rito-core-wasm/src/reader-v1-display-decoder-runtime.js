import { readRitoDisplayRunPaintV1 } from './reader-v1-display-paint-runtime.js';

/** The text run body the `RITODL1` text and ruby primitives share. */
export function readRitoDisplayTextCommandV1(reader) {
  return {
    text: reader.string('text'),
    rect: readRect(reader, 'text rect'),
    paint: readRitoDisplayRunPaintV1(reader),
    lineHeightPx: reader.option('text line height', () => reader.f64('text line height')),
    href: reader.option('text href', () => reader.string('text href')),
    sourceText: reader.option('source text', () => reader.string('source text')),
    sourceTextOffset: reader.option('source text offset', () => reader.u64('source text offset')),
    rubyAlign: reader.option('ruby align', () => reader.string('ruby align')),
    alignRight: reader.bool('text align right'),
    vertical: reader.bool('text vertical'),
  };
}

export function readRitoDisplayRectV1(reader, field) {
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
