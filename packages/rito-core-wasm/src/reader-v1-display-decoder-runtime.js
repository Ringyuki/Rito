import { ReaderWireReaderV1, readerWireBytesV1 } from './reader-v1-wire-base-runtime.js';
import {
  readRitoDisplayBlockPaintV1,
  readRitoDisplayBorderBoxV1,
  readRitoDisplayHorizontalRulePaintV1,
  readRitoDisplayLengthV1,
  readRitoDisplayPagePaintV1,
  readRitoDisplayRunPaintV1,
} from './reader-v1-display-paint-runtime.js';

export function decodeRitoReaderDisplayListV1(value) {
  const bytes = readerWireBytesV1(value, 'RITODL1');
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITODL1', 'display list magic');
  const formatVersion = reader.u32('display list version');
  if (formatVersion !== 1)
    reader.fail(`unsupported display list version: ${String(formatVersion)}`);
  const commandCount = reader.count('display command count');
  const commands = Array.from({ length: commandCount }, () => readCommand(reader));
  reader.finish('display list');
  return { formatVersion, commandCount, commands };
}

function readCommand(reader) {
  const opcode = reader.u16('display command opcode');
  switch (opcode) {
    case 1:
      return { kind: 'push-state', opcode };
    case 2:
      return { kind: 'pop-state', opcode };
    case 3:
      return {
        kind: 'translate',
        opcode,
        dx: reader.f64('translate dx'),
        dy: reader.f64('translate dy'),
      };
    case 4:
      return { kind: 'opacity', opcode, value: reader.f64('opacity') };
    case 5:
      return readTransform(reader, opcode);
    case 6:
      return {
        kind: 'clip-rect',
        opcode,
        rect: readRect(reader, 'clip rect'),
        radius: reader.option('clip radius', () => ({
          rx: reader.f64('clip radius rx'),
          ry: reader.f64('clip radius ry'),
        })),
      };
    case 7:
      return {
        kind: 'paint-page',
        opcode,
        rect: readRect(reader, 'page rect'),
        paint: readRitoDisplayPagePaintV1(reader),
      };
    case 8:
      return {
        kind: 'paint-block',
        opcode,
        rect: readRect(reader, 'block rect'),
        paint: readRitoDisplayBlockPaintV1(reader),
        borderBox: reader.option('block border box', () => readRitoDisplayBorderBoxV1(reader)),
      };
    case 9:
      return readText(reader, opcode, 'paint-text');
    case 10:
      return readText(reader, opcode, 'paint-ruby');
    case 11:
      return {
        kind: 'paint-image',
        opcode,
        src: reader.string('image source'),
        rect: readRect(reader, 'image rect'),
        alt: reader.option('image alternative', () => reader.string('image alternative')),
        href: reader.option('image href', () => reader.string('image href')),
      };
    case 12:
      return {
        kind: 'paint-horizontal-rule',
        opcode,
        rect: readRect(reader, 'horizontal rule rect'),
        paint: readRitoDisplayHorizontalRulePaintV1(reader),
      };
    default:
      reader.fail(`unknown display command opcode: ${String(opcode)}`);
  }
}

function readTransform(reader, opcode) {
  const origin = { x: reader.f64('transform origin x'), y: reader.f64('transform origin y') };
  const boxSize = {
    width: reader.f64('transform box width'),
    height: reader.f64('transform box height'),
  };
  const count = reader.count('transform count');
  const transforms = Array.from({ length: count }, () => readTransformOperation(reader));
  return { kind: 'transform', opcode, origin, boxSize, transforms };
}

function readTransformOperation(reader) {
  const tag = reader.u8('transform tag');
  if (tag === 1) return { kind: 'rotate', radians: reader.f64('transform rotation') };
  if (tag === 2) {
    return {
      kind: 'scale',
      sx: reader.f64('transform scale x'),
      sy: reader.f64('transform scale y'),
    };
  }
  if (tag === 3) {
    return {
      kind: 'translate',
      x: readRitoDisplayLengthV1(reader, 'transform translation x'),
      y: readRitoDisplayLengthV1(reader, 'transform translation y'),
    };
  }
  reader.fail(`unknown transform tag: ${String(tag)}`);
}

function readText(reader, opcode, kind) {
  return {
    kind,
    opcode,
    text: reader.string('text'),
    rect: readRect(reader, 'text rect'),
    paint: readRitoDisplayRunPaintV1(reader),
    lineHeightPx: reader.option('text line height', () => reader.f64('text line height')),
    href: reader.option('text href', () => reader.string('text href')),
    sourceText: reader.option('source text', () => reader.string('source text')),
    sourceTextOffset: reader.option('source text offset', () => reader.u64('source text offset')),
  };
}

function readRect(reader, field) {
  return {
    x: reader.f64(`${field} x`),
    y: reader.f64(`${field} y`),
    width: reader.f64(`${field} width`),
    height: reader.f64(`${field} height`),
  };
}
