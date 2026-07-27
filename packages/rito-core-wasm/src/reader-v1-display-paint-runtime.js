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

export function readRitoDisplayPagePaintV1(reader) {
  return { backgroundColor: reader.option('page background color', () => readColor(reader)) };
}

export function readRitoDisplayBlockPaintV1(reader) {
  const background = reader.option('block background', () => readBackground(reader));
  const border = reader.option('block border', () => readBlockBorder(reader));
  const radius = reader.option('block radius', () => readRadius(reader));
  const count = reader.count('box shadow count');
  const boxShadows = Array.from({ length: count }, () => readBoxShadow(reader));
  return { background, border, radius, boxShadows };
}

export function readRitoDisplayBorderBoxV1(reader) {
  return {
    topWidth: reader.f64('border box top width'),
    rightWidth: reader.f64('border box right width'),
    bottomWidth: reader.f64('border box bottom width'),
    leftWidth: reader.f64('border box left width'),
  };
}

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
  return {
    font,
    color,
    wordSpacingPx,
    letterSpacingPx,
    backgroundColor,
    backgroundRadius,
    textShadows,
    decoration: reader.option('text decoration', () => readDecoration(reader)),
    padding: reader.option('text padding', () => readSpacing(reader)),
    border: reader.option('text border', () => readRunBorder(reader)),
  };
}

export function readRitoDisplayHorizontalRulePaintV1(reader) {
  return {
    color: readColor(reader),
    style: readerWireEnumV1(reader, 'horizontal rule style', BORDER_STYLES),
  };
}

export function readRitoDisplayLengthV1(reader, field) {
  const unit = reader.u8(`${field} unit`);
  if (unit === 1) return { unit: 'px', value: reader.f64(`${field} value`) };
  if (unit === 2) return { unit: 'percent', value: reader.f64(`${field} value`) };
  reader.fail(`unknown ${field} unit tag: ${String(unit)}`);
}

function readBackground(reader) {
  return {
    color: reader.option('background color', () => readColor(reader)),
    image: reader.option('background image', () => reader.string('background image')),
    size: reader.option('background size', () =>
      readerWireEnumV1(reader, 'background size', ['auto', 'cover', 'contain']),
    ),
    repeat: reader.option('background repeat', () =>
      readerWireEnumV1(reader, 'background repeat', [
        'repeat',
        'no-repeat',
        'repeat-x',
        'repeat-y',
        'space',
        'round',
      ]),
    ),
    position: reader.option('background position', () => ({
      x: readRitoDisplayLengthV1(reader, 'background position x'),
      y: readRitoDisplayLengthV1(reader, 'background position y'),
    })),
  };
}

function readBlockBorder(reader) {
  return {
    top: reader.option('top block border', () => readBorderEdge(reader)),
    right: reader.option('right block border', () => readBorderEdge(reader)),
    bottom: reader.option('bottom block border', () => readBorderEdge(reader)),
    left: reader.option('left block border', () => readBorderEdge(reader)),
  };
}

function readRadius(reader) {
  const tag = reader.u8('block radius tag');
  if (tag === 1) return { unit: 'px', value: reader.f64('block radius') };
  if (tag === 2) return { unit: 'percent', value: reader.f64('block radius') };
  if (tag === 3) {
    // Circular corner radii in CSS order (top-left, top-right,
    // bottom-right, bottom-left) for boxes whose corners disagree.
    return {
      unit: 'corners',
      corners: [
        reader.f64('block radius top-left'),
        reader.f64('block radius top-right'),
        reader.f64('block radius bottom-right'),
        reader.f64('block radius bottom-left'),
      ],
    };
  }
  reader.fail(`unknown block radius tag: ${String(tag)}`);
}

function readBoxShadow(reader) {
  return {
    offsetX: reader.f64('box shadow offset x'),
    offsetY: reader.f64('box shadow offset y'),
    blur: reader.f64('box shadow blur'),
    spread: reader.f64('box shadow spread'),
    color: readColor(reader),
    inset: reader.bool('box shadow inset'),
  };
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
