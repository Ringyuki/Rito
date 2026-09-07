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
  const count = reader.count('text shadow count');
  const textShadows = Array.from({ length: count }, () => readTextShadow(reader));
  return { font, color, wordSpacingPx, letterSpacingPx, textShadows };
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
