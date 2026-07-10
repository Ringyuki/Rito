const RUNTIME_BUNDLE_MAGIC = 'RITORB1';
const RUNTIME_BUNDLE_VERSION = 1;
const RUNTIME_BUNDLE_HEADER_BYTES = 56;
const FNV64_OFFSET_LOW = 0x84222325;
const FNV64_OFFSET_HIGH = 0xcbf29ce4;
const FNV64_PRIME_LOW = 0x1b3;
const FNV64_PRIME_HIGH = 0x100;
const U32_RANGE = 0x1_0000_0000;

const TAG_NULL = 0;
const TAG_FALSE = 1;
const TAG_TRUE = 2;
const TAG_I64 = 3;
const TAG_U64 = 4;
const TAG_F64 = 5;
const TAG_STRING = 6;
const TAG_ARRAY = 7;
const TAG_OBJECT = 8;

const utf8Decoder = new globalThis.TextDecoder('utf-8', { fatal: true });

export function decodeRitoRuntimeBundle(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error('RITORB1 payload must be a Uint8Array.');
  }
  if (bytes.byteLength < RUNTIME_BUNDLE_HEADER_BYTES) {
    throw new Error('RITORB1 payload is shorter than its header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = readHeader(view, bytes.byteLength);
  const checksum = runtimeBundleChecksum(bytes.subarray(RUNTIME_BUNDLE_HEADER_BYTES));
  if (checksum !== header.checksum) {
    throw new Error('RITORB1 checksum mismatch.');
  }
  const strings = decodeStringTable(bytes, view, header);
  const values = decodeValueTable(view, header, strings);
  if (header.rootIndex >= values.length) {
    throw new Error('RITORB1 root value index is out of bounds.');
  }
  return {
    protocolVersion: header.version,
    stringCount: strings.length,
    valueCount: values.length,
    byteLength: bytes.byteLength,
    checksum: checksum.toString(16).padStart(16, '0'),
    payload: values[header.rootIndex],
  };
}

function readHeader(view, byteLength) {
  if (readAscii(view, 0, 7) !== RUNTIME_BUNDLE_MAGIC || view.getUint8(7) !== 0) {
    throw new Error('Invalid RITORB1 magic.');
  }
  const version = view.getUint32(8, true);
  if (version !== RUNTIME_BUNDLE_VERSION) {
    throw new Error(`Unsupported RITORB1 version: ${String(version)}`);
  }
  const headerBytes = view.getUint32(12, true);
  if (headerBytes !== RUNTIME_BUNDLE_HEADER_BYTES) {
    throw new Error('RITORB1 header length mismatch.');
  }
  const declaredByteLength = view.getUint32(16, true);
  if (declaredByteLength !== byteLength) {
    throw new Error('RITORB1 byte length mismatch.');
  }
  const header = {
    version,
    stringCount: view.getUint32(20, true),
    valueCount: view.getUint32(24, true),
    stringOffset: view.getUint32(28, true),
    stringLength: view.getUint32(32, true),
    valueOffset: view.getUint32(36, true),
    valueLength: view.getUint32(40, true),
    rootIndex: view.getUint32(44, true),
    checksum: readUint64(view, 48),
  };
  validateRanges(header, byteLength);
  return header;
}

function validateRanges(header, byteLength) {
  if (header.stringOffset !== RUNTIME_BUNDLE_HEADER_BYTES) {
    throw new Error('RITORB1 string table offset is not after the header.');
  }
  const stringEnd = checkedEnd(header.stringOffset, header.stringLength, byteLength, 'string');
  if (header.valueOffset !== stringEnd) {
    throw new Error('RITORB1 table ranges are not sorted.');
  }
  const valueEnd = checkedEnd(header.valueOffset, header.valueLength, byteLength, 'value');
  if (valueEnd !== byteLength) {
    throw new Error('RITORB1 value table does not end at payload boundary.');
  }
}

function decodeStringTable(bytes, view, header) {
  const end = header.stringOffset + header.stringLength;
  let cursor = header.stringOffset;
  const strings = [];
  for (let index = 0; index < header.stringCount; index += 1) {
    const byteLength = readUint32At(view, cursor, end, 'RITORB1 string length');
    cursor += 4;
    const stringEnd = checkedEnd(cursor, byteLength, end, 'string');
    try {
      strings.push(utf8Decoder.decode(bytes.subarray(cursor, stringEnd)));
    } catch (error) {
      throw new Error(
        `RITORB1 string is not UTF-8: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    cursor = stringEnd;
  }
  if (cursor !== end) {
    throw new Error('RITORB1 string table has trailing bytes.');
  }
  return strings;
}

function decodeValueTable(view, header, strings) {
  const end = header.valueOffset + header.valueLength;
  let cursor = header.valueOffset;
  const values = [];
  const readUint32 = (label) => {
    const value = readUint32At(view, cursor, end, label);
    cursor += 4;
    return value;
  };
  for (let index = 0; index < header.valueCount; index += 1) {
    checkedEnd(cursor, 1, end, 'value tag');
    const tag = view.getUint8(cursor);
    cursor += 1;
    switch (tag) {
      case TAG_NULL:
        values.push(null);
        break;
      case TAG_FALSE:
        values.push(false);
        break;
      case TAG_TRUE:
        values.push(true);
        break;
      case TAG_I64:
        checkedEnd(cursor, 8, end, 'i64');
        values.push(safeInteger(view.getBigInt64(cursor, true), 'i64'));
        cursor += 8;
        break;
      case TAG_U64:
        checkedEnd(cursor, 8, end, 'u64');
        values.push(safeInteger(view.getBigUint64(cursor, true), 'u64'));
        cursor += 8;
        break;
      case TAG_F64:
        checkedEnd(cursor, 8, end, 'f64');
        values.push(finiteNumber(view.getFloat64(cursor, true)));
        cursor += 8;
        break;
      case TAG_STRING:
        values.push(readString(strings, readUint32('RITORB1 string index')));
        break;
      case TAG_ARRAY:
        values.push(readArray(values, readUint32, readUint32('RITORB1 array length')));
        break;
      case TAG_OBJECT:
        values.push(readObject(values, strings, readUint32, readUint32('RITORB1 object length')));
        break;
      default:
        throw new Error(`Unsupported RITORB1 value tag: ${String(tag)}`);
    }
  }
  if (cursor !== end) {
    throw new Error('RITORB1 value table has trailing bytes.');
  }
  return values;
}

function readArray(values, readUint32, count) {
  const result = [];
  for (let index = 0; index < count; index += 1) {
    result.push(readValue(values, readUint32('RITORB1 array index')));
  }
  return result;
}

function readObject(values, strings, readUint32, count) {
  const result = {};
  for (let index = 0; index < count; index += 1) {
    const key = readString(strings, readUint32('RITORB1 object key index'));
    const value = readValue(values, readUint32('RITORB1 object value index'));
    if (key in result) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readString(strings, index) {
  if (index >= strings.length) {
    throw new Error('RITORB1 string index is out of bounds.');
  }
  return strings[index];
}

function readValue(values, index) {
  if (index >= values.length) {
    throw new Error('RITORB1 value index is out of bounds.');
  }
  return values[index];
}

function safeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`RITORB1 ${label} exceeds JavaScript safe integer range.`);
  }
  return number;
}

function finiteNumber(value) {
  if (!Number.isFinite(value)) {
    throw new Error('RITORB1 f64 is not finite.');
  }
  return value;
}

function readUint32At(view, offset, end, label) {
  checkedEnd(offset, 4, end, label);
  return view.getUint32(offset, true);
}

function readUint64(view, offset) {
  const low = BigInt(view.getUint32(offset, true));
  const high = BigInt(view.getUint32(offset + 4, true));
  return low | (high << 32n);
}

function checkedEnd(offset, length, limit, label) {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > limit) {
    throw new Error(`RITORB1 ${label} range exceeds payload length.`);
  }
  return end;
}

function runtimeBundleChecksum(bytes) {
  // FNV-1a's prime is 0x00000100_000001b3. Two u32 lanes avoid a temporary
  // BigInt per byte; mixedLow * 0x1b3 stays below 2^41 and remains exact.
  let low = FNV64_OFFSET_LOW;
  let high = FNV64_OFFSET_HIGH;
  for (let index = 0; index < bytes.length; index += 1) {
    const mixedLow = (low ^ bytes[index]) >>> 0;
    const lowProduct = mixedLow * FNV64_PRIME_LOW;
    const carry = Math.floor(lowProduct / U32_RANGE);
    high = (Math.imul(high, FNV64_PRIME_LOW) + Math.imul(mixedLow, FNV64_PRIME_HIGH) + carry) >>> 0;
    low = lowProduct >>> 0;
  }
  return (BigInt(high) << 32n) | BigInt(low);
}

function readAscii(view, offset, length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}
