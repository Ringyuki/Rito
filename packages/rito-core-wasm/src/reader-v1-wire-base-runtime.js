/**
 * Reader v1 protocol version, mirroring `READER_PROTOCOL_VERSION_V1` in
 * crates/rito-core/src/runtime/reader_v1.rs. Every message the reader
 * protocol carries a protocol version on (artifact, publication) gates
 * against this one constant — the Rust side has a single constant too,
 * so scattering literals here is how the two drift apart unnoticed.
 */
export const READER_V1_PROTOCOL_VERSION = 2;

const MAX_WIRE_BYTES = 256 * 1024 * 1024;
const MAX_STRING_BYTES = 16 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 1_000_000;
const MAX_EXTERNAL_ID = 0x7fff_ffff_ffff_ffffn;
const textDecoder = new globalThis.TextDecoder('utf-8', { fatal: true });
const textEncoder = new globalThis.TextEncoder();

export class RitoReaderWireErrorV1 extends Error {
  constructor(message, offset) {
    super(`${message} (byte ${String(offset)})`);
    this.name = 'RitoReaderWireErrorV1';
    this.code = 'invalid-wire';
    this.offset = offset;
  }
}

export class ReaderWireReaderV1 {
  constructor(bytes, start = 0, end = bytes.byteLength) {
    if (!(bytes instanceof Uint8Array) || start < 0 || end < start || end > bytes.byteLength) {
      throw new TypeError('Invalid Reader v1 wire byte range');
    }
    this.bytes = bytes;
    this.start = start;
    this.end = end;
    this.cursor = start;
  }

  get offset() {
    return this.cursor - this.start;
  }

  record(field) {
    const length = this.length64(`${field} length`);
    const end = this.checkedEnd(length, field);
    const out = new ReaderWireReaderV1(this.bytes, this.cursor, end);
    this.cursor = end;
    return out;
  }

  count(field) {
    const value = this.u32(field);
    if (value > MAX_COLLECTION_ITEMS) this.fail(`${field} exceeds the item limit`);
    return value;
  }

  string(field) {
    const length = this.u32(`${field} length`);
    if (length > MAX_STRING_BYTES) this.fail(`${field} exceeds the string byte limit`);
    try {
      return textDecoder.decode(this.take(length, field));
    } catch {
      this.fail(`${field} is not valid UTF-8`);
    }
  }

  blob(field, maxBytes = MAX_WIRE_BYTES) {
    const length = this.length64(`${field} length`);
    if (length > maxBytes) this.fail(`${field} exceeds its operation byte limit`);
    return this.take(length, field).slice();
  }

  fixedBytes(expected, field) {
    const length = this.u32(`${field} length`);
    if (length !== expected) this.fail(`${field} must contain ${String(expected)} bytes`);
    return this.take(expected, field).slice();
  }

  option(field, read) {
    const tag = this.u8(`${field} option tag`);
    if (tag === 0) return undefined;
    if (tag === 1) return read();
    this.fail(`unknown ${field} option tag: ${String(tag)}`);
  }

  bool(field) {
    const tag = this.u8(`${field} boolean tag`);
    if (tag === 0) return false;
    if (tag === 1) return true;
    this.fail(`unknown ${field} boolean tag: ${String(tag)}`);
  }

  u8(field) {
    return this.take(1, field)[0];
  }

  u16(field) {
    return this.view(2, field).getUint16(0, true);
  }

  u32(field) {
    return this.view(4, field).getUint32(0, true);
  }

  u64(field) {
    return this.view(8, field).getBigUint64(0, true);
  }

  externalId(field) {
    const value = this.u64(field);
    if (value === 0n || value > MAX_EXTERNAL_ID) this.fail(`${field} is not a valid external ID`);
    return value;
  }

  f32(field) {
    return this.finite(this.view(4, field).getFloat32(0, true), field);
  }

  f64(field) {
    return this.finite(this.view(8, field).getFloat64(0, true), field);
  }

  expectMagic(expected, field) {
    const actual = this.take(expected.length, field);
    if (actual.some((value, index) => value !== expected.charCodeAt(index))) {
      this.fail(`${field} is invalid`);
    }
  }

  finish(field) {
    if (this.cursor !== this.end) this.fail(`${field} contains trailing bytes`);
  }

  fail(message) {
    throw new RitoReaderWireErrorV1(message, this.offset);
  }

  take(length, field) {
    const end = this.checkedEnd(length, field);
    const value = this.bytes.subarray(this.cursor, end);
    this.cursor = end;
    return value;
  }

  length64(field) {
    const value = this.u64(field);
    if (value > BigInt(MAX_WIRE_BYTES)) this.fail(`${field} exceeds the byte limit`);
    return Number(value);
  }

  checkedEnd(length, field) {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.end - this.cursor) {
      this.fail(`${field} is truncated`);
    }
    return this.cursor + length;
  }

  view(length, field) {
    const bytes = this.take(length, field);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  finite(value, field) {
    if (!Number.isFinite(value)) this.fail(`${field} must be finite`);
    return value;
  }
}

export class ReaderWireWriterV1 {
  constructor() {
    this.bytes = [];
  }

  static message(magic) {
    const writer = new ReaderWireWriterV1();
    writer.raw(textEncoder.encode(magic));
    writer.u32(1, 'wire version');
    writer.u64(0n, 'wire length');
    return writer;
  }

  finish() {
    if (this.bytes.length > MAX_WIRE_BYTES)
      throw new RangeError('Reader request exceeds wire limit');
    this.patchU64(12, BigInt(this.bytes.length));
    return Uint8Array.from(this.bytes);
  }

  record(write) {
    const lengthOffset = this.bytes.length;
    this.u64(0n, 'record length');
    const start = this.bytes.length;
    write(this);
    this.patchU64(lengthOffset, BigInt(this.bytes.length - start));
  }

  count(value, field) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_COLLECTION_ITEMS) {
      throw new RangeError(`${field} exceeds protocol limits`);
    }
    this.u32(value, field);
  }

  string(value, field) {
    if (typeof value !== 'string') throw new TypeError(`${field} must be a string`);
    const bytes = textEncoder.encode(value);
    if (bytes.byteLength > MAX_STRING_BYTES)
      throw new RangeError(`${field} exceeds protocol limits`);
    this.u32(bytes.byteLength, `${field} length`);
    this.raw(bytes);
  }

  option(value, write) {
    this.u8(value === undefined ? 0 : 1, 'option tag');
    if (value !== undefined) write(value);
  }

  bool(value) {
    if (typeof value !== 'boolean') throw new TypeError('boolean value is invalid');
    this.u8(value ? 1 : 0, 'boolean');
  }

  externalId(value, field) {
    if (typeof value !== 'bigint' || value === 0n || value > MAX_EXTERNAL_ID) {
      throw new RangeError(`${field} is not a valid external ID`);
    }
    this.u64(value, field);
  }

  u8(value, field) {
    this.unsignedNumber(value, 0xff, field);
    this.bytes.push(value);
  }

  u16(value, field) {
    this.unsignedNumber(value, 0xffff, field);
    const data = new Uint8Array(2);
    new DataView(data.buffer).setUint16(0, value, true);
    this.raw(data);
  }

  u32(value, field) {
    this.unsignedNumber(value, 0xffff_ffff, field);
    const data = new Uint8Array(4);
    new DataView(data.buffer).setUint32(0, value, true);
    this.raw(data);
  }

  u64(value, field) {
    if (typeof value !== 'bigint' || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new RangeError(`${field} exceeds uint64`);
    }
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, value, true);
    this.raw(data);
  }

  f64(value, field) {
    if (!Number.isFinite(value)) throw new RangeError(`${field} must be finite`);
    const data = new Uint8Array(8);
    new DataView(data.buffer).setFloat64(0, value, true);
    this.raw(data);
  }

  raw(value) {
    for (const byte of value) this.bytes.push(byte);
  }

  unsignedNumber(value, max, field) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
      throw new RangeError(`${field} exceeds its unsigned width`);
    }
  }

  patchU64(offset, value) {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, value, true);
    for (let index = 0; index < data.length; index += 1) this.bytes[offset + index] = data[index];
  }
}

export function readerWireBytesV1(value, field) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(`${field} must be an ArrayBuffer or Uint8Array`);
}

export function readerWireEnumV1(reader, field, values) {
  const tag = reader.u8(`${field} tag`);
  const value = values[tag - 1];
  if (tag === 0 || value === undefined) reader.fail(`unknown ${field} tag: ${String(tag)}`);
  return value;
}

export function validateReaderWireMessageV1(value, magic, field) {
  const bytes = readerWireBytesV1(value, field);
  if (bytes.byteLength > MAX_WIRE_BYTES) throw new RangeError(`${field} exceeds the byte limit`);
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic(magic, `${field} magic`);
  const version = reader.u32(`${field} wire version`);
  if (version !== 1) reader.fail(`unsupported ${field} wire version: ${String(version)}`);
  const length = reader.u64(`${field} total length`);
  if (length !== BigInt(bytes.byteLength))
    reader.fail(`${field} total length does not match input`);
  return reader;
}
