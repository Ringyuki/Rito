import {
  READER_V1_PRIMITIVE_LIST_FORMAT_VERSION,
  decodeRitoReaderPrimitiveListV1,
} from './reader-v1-primitive-decoder-runtime.js';

// A cached frame's bytes are its display commands lowered to the device
// grid: the `RITODL1` format-2 primitive list. The metadata beside them
// describes the semantic frame the bytes were lowered from (command count,
// kind counts, hash, resources, fonts) and the bytes themselves (format
// version, ratio, primitive count, byte length); the header restates the
// latter so a buffer and its metadata cannot drift apart unnoticed.
const FRAME_COMMAND_BUFFER_MAGIC = 'RITODL1';
const FRAME_COMMAND_HEADER_BYTES = 7 + 4 + 8 + 4;

export function validateFrameCommandBufferMetadata(metadata, bytes) {
  if (metadata.protocolVersion !== READER_V1_PRIMITIVE_LIST_FORMAT_VERSION) {
    throw new Error(
      `Unsupported Rito frame command buffer version: ${String(metadata.protocolVersion)}`,
    );
  }
  if (!Number.isFinite(metadata.ratio) || metadata.ratio <= 0) {
    throw new Error(`Invalid Rito frame command buffer ratio: ${String(metadata.ratio)}`);
  }
  validateNonNegativeInteger(metadata.commandCount, 'command count');
  validateNonNegativeInteger(metadata.primitiveCount, 'primitive count');
  validateNonNegativeInteger(metadata.byteLength, 'byte length');
  validateNonNegativeInteger(metadata.resourceRefCount, 'resource ref count');
  validateCommandCounts(metadata.commandCounts, metadata.commandCount);
  validateStringTable(metadata.resourceTable, 'resource');
  validateFrameCommandBufferBytes(metadata, bytes);
}

export function decodeRitoFrameCommandBuffer(metadata, bytes) {
  validateFrameCommandBufferMetadata(metadata, bytes);
  const list = decodeRitoReaderPrimitiveListV1(bytes);
  if (list.ratio !== metadata.ratio) {
    throw new Error('Rito frame command buffer ratio does not match metadata.');
  }
  if (list.commandCount !== metadata.primitiveCount) {
    throw new Error('Rito frame command buffer primitive count does not match metadata.');
  }
  return {
    protocolVersion: metadata.protocolVersion,
    ratio: metadata.ratio,
    commandCount: metadata.commandCount,
    commandCounts: metadata.commandCounts,
    primitiveCount: metadata.primitiveCount,
    commandHash: metadata.commandHash,
    resourceRefCount: metadata.resourceRefCount,
    resourceTable: metadata.resourceTable,
    commands: list.commands,
  };
}

function validateNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid Rito frame command buffer ${label}: ${String(value)}`);
  }
}

function validateFrameCommandBufferBytes(metadata, bytes) {
  if (metadata.byteLength !== bytes.byteLength) {
    throw new Error(
      `Rito frame command buffer byte length mismatch: metadata=${String(metadata.byteLength)} actual=${String(bytes.byteLength)}`,
    );
  }
  if (bytes.byteLength < FRAME_COMMAND_HEADER_BYTES) {
    throw new Error('Rito frame command buffer is shorter than its header.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (readAscii(view, 0, FRAME_COMMAND_BUFFER_MAGIC.length) !== FRAME_COMMAND_BUFFER_MAGIC) {
    throw new Error('Invalid Rito frame command buffer magic.');
  }
  if (view.getUint32(7, true) !== metadata.protocolVersion) {
    throw new Error('Rito frame command buffer header version does not match metadata.');
  }
  if (view.getFloat64(11, true) !== metadata.ratio) {
    throw new Error('Rito frame command buffer header ratio does not match metadata.');
  }
  if (view.getUint32(19, true) !== metadata.primitiveCount) {
    throw new Error('Rito frame command buffer primitive count does not match metadata.');
  }
}

function validateCommandCounts(commandCounts, commandCount) {
  if (commandCounts === null || typeof commandCounts !== 'object' || Array.isArray(commandCounts)) {
    throw new Error('Rito frame command buffer command counts must be an object.');
  }
  let total = 0;
  for (const [kind, count] of Object.entries(commandCounts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(
        `Invalid Rito frame command buffer command count for ${kind}: ${String(count)}`,
      );
    }
    total += count;
  }
  if (total !== commandCount) {
    throw new Error(
      `Rito frame command buffer command counts total mismatch: metadata=${String(commandCount)} total=${String(total)}`,
    );
  }
}

function validateStringTable(table, tableName) {
  if (!Array.isArray(table)) {
    throw new Error(`Rito frame command buffer ${tableName} table must be an array.`);
  }
  for (const [index, value] of table.entries()) {
    if (typeof value !== 'string') {
      throw new Error(
        `Rito frame command buffer ${tableName} table entry ${String(index)} must be a string.`,
      );
    }
  }
}

function readAscii(view, offset, length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}
