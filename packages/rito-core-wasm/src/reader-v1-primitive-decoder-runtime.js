import {
  ReaderWireReaderV1,
  readerWireBytesV1,
  readerWireEnumV1,
} from './reader-v1-wire-base-runtime.js';
import {
  readRitoDisplayRectV1,
  readRitoDisplayTextCommandV1,
} from './reader-v1-display-decoder-runtime.js';
import {
  readRitoDisplayBlockPaintV1,
  readRitoDisplayBorderBoxV1,
  readRitoDisplayColorV1,
} from './reader-v1-display-paint-runtime.js';

/**
 * `RITODL1` format version 2, mirroring `READER_PRIMITIVE_LIST_FORMAT_VERSION`
 * in crates/rito-core/src/render/commands/reader_wire_v1.rs: the
 * device-resolved primitive list. Every coordinate is a device pixel and
 * every raster rule has been applied by the engine; a renderer blits.
 */
export const READER_V1_PRIMITIVE_LIST_FORMAT_VERSION = 2;

export function decodeRitoReaderPrimitiveListV1(value) {
  const bytes = readerWireBytesV1(value, 'RITODL1');
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITODL1', 'primitive list magic');
  const formatVersion = reader.u32('primitive list version');
  if (formatVersion !== READER_V1_PRIMITIVE_LIST_FORMAT_VERSION)
    reader.fail(`unsupported primitive list version: ${String(formatVersion)}`);
  const ratio = reader.f64('primitive list ratio');
  if (ratio <= 0) reader.fail('primitive list ratio must be positive');
  const commandCount = reader.count('primitive count');
  const commands = Array.from({ length: commandCount }, () => readPrimitive(reader));
  reader.finish('primitive list');
  return { formatVersion, ratio, commandCount, commands };
}

function readPrimitive(reader) {
  const opcode = reader.u16('primitive opcode');
  switch (opcode) {
    case 1:
      return { kind: 'push-state' };
    case 2:
      return { kind: 'pop-state' };
    case 3:
      return { kind: 'translate', dx: reader.f64('translate dx'), dy: reader.f64('translate dy') };
    case 4:
      return { kind: 'opacity', value: reader.f64('opacity') };
    case 5:
      return readTransform(reader);
    case 6:
      return { kind: 'clip-path', path: readPath(reader) };
    case 7:
      return {
        kind: 'fill-rect',
        rect: readRitoDisplayRectV1(reader, 'fill rect'),
        color: readRitoDisplayColorV1(reader),
        ground: readerWireEnumV1(reader, 'fill ground', ['none', 'page', 'block']),
      };
    case 8:
      return {
        kind: 'fill-path',
        path: readPath(reader),
        rule: readerWireEnumV1(reader, 'fill rule', ['nonzero', 'evenodd']),
        color: readRitoDisplayColorV1(reader),
      };
    case 9:
      return {
        kind: 'stroke-path',
        path: readPath(reader),
        width: reader.f64('stroke width'),
        color: readRitoDisplayColorV1(reader),
        cap: readerWireEnumV1(reader, 'stroke cap', ['butt', 'round']),
        dash: reader.option('stroke dash', () => ({
          on: reader.f64('stroke dash on'),
          off: reader.f64('stroke dash off'),
        })),
      };
    case 10:
      return {
        kind: 'shadow',
        shape: readPath(reader),
        sigma: reader.f64('shadow sigma'),
        offset: readPoint(reader, 'shadow offset'),
        color: readRitoDisplayColorV1(reader),
        clipOut: reader.option('shadow clip', () => readPath(reader)),
      };
    case 11:
      return {
        kind: 'draw-image',
        src: reader.string('image source'),
        dest: readRitoDisplayRectV1(reader, 'image dest'),
        sourceRect: reader.option('image source rect', () =>
          readRitoDisplayRectV1(reader, 'image source rect'),
        ),
        tiles: reader.option('image tiles', () => readTilePlan(reader)),
      };
    case 12:
      return { kind: 'text', ...readRitoDisplayTextCommandV1(reader) };
    case 13:
      return { kind: 'ruby', ...readRitoDisplayTextCommandV1(reader) };
    case 14:
      return {
        kind: 'block',
        rect: readRitoDisplayRectV1(reader, 'block rect'),
        paint: readRitoDisplayBlockPaintV1(reader),
        borderBox: reader.option('block border box', () => readRitoDisplayBorderBoxV1(reader)),
      };
    default:
      reader.fail(`unknown primitive opcode: ${String(opcode)}`);
  }
}

function readTransform(reader) {
  const origin = readPoint(reader, 'transform origin');
  const count = reader.count('transform count');
  const transforms = Array.from({ length: count }, () => {
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
        dx: reader.f64('transform translation x'),
        dy: reader.f64('transform translation y'),
      };
    }
    reader.fail(`unknown transform tag: ${String(tag)}`);
  });
  return { kind: 'transform', origin, transforms };
}

function readPath(reader) {
  const count = reader.count('path op count');
  return Array.from({ length: count }, () => {
    const tag = reader.u8('path op tag');
    switch (tag) {
      case 1:
        return { op: 'move-to', x: reader.f64('path x'), y: reader.f64('path y') };
      case 2:
        return { op: 'line-to', x: reader.f64('path x'), y: reader.f64('path y') };
      case 3:
        return {
          op: 'arc',
          cx: reader.f64('arc center x'),
          cy: reader.f64('arc center y'),
          rx: reader.f64('arc radius x'),
          ry: reader.f64('arc radius y'),
          start: reader.f64('arc start'),
          sweep: reader.f64('arc sweep'),
        };
      case 4:
        return {
          op: 'ellipse',
          cx: reader.f64('ellipse center x'),
          cy: reader.f64('ellipse center y'),
          rx: reader.f64('ellipse radius x'),
          ry: reader.f64('ellipse radius y'),
        };
      case 5:
        return { op: 'rect', ...readRitoDisplayRectV1(reader, 'path rect') };
      case 6:
        return { op: 'close' };
      default:
        reader.fail(`unknown path op tag: ${String(tag)}`);
    }
  });
}

function readTilePlan(reader) {
  return {
    origin: readPoint(reader, 'tile origin'),
    stepX: reader.f64('tile step x'),
    stepY: reader.f64('tile step y'),
    columns: reader.u32('tile columns'),
    rows: reader.u32('tile rows'),
  };
}

function readPoint(reader, field) {
  return { x: reader.f64(`${field} x`), y: reader.f64(`${field} y`) };
}
