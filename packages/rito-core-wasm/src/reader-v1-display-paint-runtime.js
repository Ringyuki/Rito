import { readerWireEnumV1 } from './reader-v1-wire-base-runtime.js';

const COLOR_SPACES = [
  'srgb',
  'hsl',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'srgb-linear',
  'display-p3',
  'display-p3-linear',
  'a98-rgb',
  'prophoto-rgb',
  'rec2020',
  'xyz-d50',
  'xyz-d65',
];
const BORDER_STYLES = [
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset',
];

export function readRitoDisplayRunPaintV1(reader) {
  const font = {
    family: reader.string('font family'),
    sizePx: reader.f64('font size'),
    weight: reader.f64('font weight'),
    style: readerWireEnumV1(reader, 'font style', ['normal', 'italic']),
  };
  const color = readColor(reader);
  const wordSpacingPx = reader.option('word spacing', () => reader.f64('word spacing'));
  const letterSpacingPx = reader.option('letter spacing', () => reader.f64('letter spacing'));
  const backgroundColor = reader.option('text background color', () => readColor(reader));
  const backgroundRadius = reader.option('text background radius', () =>
    reader.f64('text background radius'),
  );
  const count = reader.count('text shadow count');
  const textShadows = Array.from({ length: count }, () => readTextShadow(reader));
  const decoration = reader.option('text decoration', () => readDecoration(reader));
  const padding = reader.option('text padding', () => readSpacing(reader));
  const border = reader.option('text border', () => readRunBorder(reader));
  // The run's inline-box tail: engine-computed box top/bottom offsets
  // (absent when the run carries no box paint), then whether the run
  // opens and closes its inline box.
  const boxOffsets = reader.option('inline box offsets', () => ({
    top: reader.f64('inline box top'),
    bottom: reader.f64('inline box bottom'),
  }));
  const boxStart = reader.bool('inline box start');
  const boxEnd = reader.bool('inline box end');
  return {
    font,
    color,
    wordSpacingPx,
    letterSpacingPx,
    backgroundColor,
    backgroundRadius,
    textShadows,
    decoration,
    padding,
    border,
    boxOffsets,
    boxStart,
    boxEnd,
  };
}

export function readRitoDisplayColorV1(reader) {
  return readColor(reader);
}

function readTextShadow(reader) {
  return {
    offsetX: reader.f64('text shadow offset x'),
    offsetY: reader.f64('text shadow offset y'),
    blur: reader.f64('text shadow blur'),
    color: readColor(reader),
  };
}

function readDecoration(reader) {
  return {
    kind: readerWireEnumV1(reader, 'text decoration kind', ['underline', 'line-through']),
    y: reader.f64('text decoration y'),
    thickness: reader.f64('text decoration thickness'),
    color: readColor(reader),
  };
}

function readSpacing(reader) {
  return {
    top: reader.f64('text padding top'),
    right: reader.f64('text padding right'),
    bottom: reader.f64('text padding bottom'),
    left: reader.f64('text padding left'),
  };
}

function readRunBorder(reader) {
  return {
    top: reader.option('text top border', () => readRunBorderEdge(reader)),
    bottom: reader.option('text bottom border', () => readRunBorderEdge(reader)),
    start: reader.option('text start border', () => readRunBorderEdge(reader)),
    end: reader.option('text end border', () => readRunBorderEdge(reader)),
  };
}

function readRunBorderEdge(reader) {
  return { widthPx: reader.f64('text border width'), paint: readBorderEdge(reader) };
}

function readBorderEdge(reader) {
  return {
    color: readColor(reader),
    style: readerWireEnumV1(reader, 'border style', BORDER_STYLES),
  };
}

function readColor(reader) {
  const space = readerWireEnumV1(reader, 'color space', COLOR_SPACES);
  const component0 = reader.f32('color component 0');
  const component1 = reader.f32('color component 1');
  const component2 = reader.f32('color component 2');
  const alpha = reader.f32('color alpha');
  const flags = reader.u8('color none flags');
  if ((flags & 0xf0) !== 0) reader.fail(`color none flags contain unknown bits: ${String(flags)}`);
  return {
    space,
    component0,
    component1,
    component2,
    alpha,
    none: {
      component0: (flags & 0x01) !== 0,
      component1: (flags & 0x02) !== 0,
      component2: (flags & 0x04) !== 0,
      alpha: (flags & 0x08) !== 0,
    },
  };
}
