import {
  ReaderWireReader,
  readerWireBytes,
  readerWireEnum,
} from './reader-session-wire-base-runtime.js';
import {
  readRitoDisplayRect,
  readRitoDisplayTextCommand,
} from './reader-session-display-decoder-runtime.js';
import { readRitoDisplayColor } from './reader-session-display-paint-runtime.js';

/**
 * `RITODL1` format version 2, mirroring `READER_PRIMITIVE_LIST_FORMAT_VERSION`
 * in crates/rito-core/src/render/commands/reader_wire.rs: the
 * device-resolved primitive list. Every coordinate is a device pixel and
 * every raster rule has been applied by the engine; a renderer blits.
 */
export const READER_V1_PRIMITIVE_LIST_FORMAT_VERSION = 2;

export function decodeRitoReaderPrimitiveList(value) {
  const bytes = readerWireBytes(value, 'RITODL1');
  const reader = new ReaderWireReader(bytes);
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
        rect: readRitoDisplayRect(reader, 'fill rect'),
        color: readRitoDisplayColor(reader),
        ...readGround(reader),
      };
    case 8:
      return {
        kind: 'fill-path',
        path: readPath(reader),
        rule: readerWireEnum(reader, 'fill rule', ['nonzero', 'evenodd']),
        color: readRitoDisplayColor(reader),
        ...readGround(reader),
      };
    case 9:
      return {
        kind: 'stroke-path',
        path: readPath(reader),
        width: reader.f64('stroke width'),
        color: readRitoDisplayColor(reader),
        cap: readerWireEnum(reader, 'stroke cap', ['butt', 'round']),
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
        color: readRitoDisplayColor(reader),
        clipOut: reader.option('shadow clip', () => readPath(reader)),
      };
    case 11:
      return {
        kind: 'draw-image',
        src: reader.string('image source'),
        dest: readRitoDisplayRect(reader, 'image dest'),
        sourceRect: reader.option('image source rect', () =>
          readRitoDisplayRect(reader, 'image source rect'),
        ),
        tiles: reader.option('image tiles', () => readTilePlan(reader)),
      };
    case 12:
      return { kind: 'text', ...readRitoDisplayTextCommand(reader) };
    case 13:
      return { kind: 'ruby', ...readRitoDisplayTextCommand(reader) };
    default:
      reader.fail(`unknown primitive opcode: ${String(opcode)}`);
  }
}

/** A fill's declared ground; a block ground carries the unsnapped box it
 * covers. */
function readGround(reader) {
  const ground = readerWireEnum(reader, 'fill ground', ['none', 'page', 'block']);
  if (ground === 'block') {
    return { ground, groundRect: readRitoDisplayRect(reader, 'ground rect') };
  }
  return { ground };
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
        return { op: 'rect', ...readRitoDisplayRect(reader, 'path rect') };
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
