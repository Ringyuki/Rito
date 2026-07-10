import {
  FRAME_COMMAND_BUFFER_MAGIC,
  FRAME_COMMAND_BUFFER_VERSION,
  FRAME_COMMAND_HEADER_BYTES,
  FRAME_COMMAND_RECORD_BYTES,
  RECORD_STAT_KEYS,
} from './frame-command-buffer-decoder-constants.js';

export function validateFrameCommandBufferMetadata(metadata, bytes) {
  if (metadata.protocolVersion !== FRAME_COMMAND_BUFFER_VERSION) {
    throw new Error(
      `Unsupported Rito frame command buffer version: ${String(metadata.protocolVersion)}`,
    );
  }
  validateNonNegativeInteger(metadata.commandCount, 'command count');
  validateNonNegativeInteger(metadata.byteLength, 'byte length');
  validateNonNegativeInteger(metadata.resourceRefCount, 'resource ref count');
  validateCommandCounts(metadata.commandCounts, metadata.commandCount);
  validateRecordStats(metadata.recordStats, metadata.commandCount);
  validateStringTable(metadata.resourceTable, 'resource');
  validateStringTable(metadata.stringTable, 'string');
  validateStringTable(metadata.payloadTable, 'payload');
  validateFrameCommandBufferBytes(metadata, bytes);
}

export function validateStableJsonMatch(expected, actual, message) {
  if (stableJson(expected) !== stableJson(actual)) {
    throw new Error(message);
  }
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
  if (readAscii(view, 0, 8) !== FRAME_COMMAND_BUFFER_MAGIC) {
    throw new Error('Invalid Rito frame command buffer magic.');
  }
  if (view.getUint32(8, true) !== FRAME_COMMAND_BUFFER_VERSION) {
    throw new Error('Rito frame command buffer header version does not match metadata.');
  }
  if (view.getUint32(12, true) !== metadata.commandCount) {
    throw new Error('Rito frame command buffer command count does not match metadata.');
  }
  const expectedBytes =
    FRAME_COMMAND_HEADER_BYTES + metadata.commandCount * FRAME_COMMAND_RECORD_BYTES;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(
      `Rito frame command buffer record length mismatch: expected=${String(expectedBytes)} actual=${String(bytes.byteLength)}`,
    );
  }
}

function validateRecordStats(recordStats, commandCount) {
  if (recordStats === null || typeof recordStats !== 'object' || Array.isArray(recordStats)) {
    throw new Error('Rito frame command buffer record stats must be an object.');
  }
  for (const key of RECORD_STAT_KEYS) {
    const count = recordStats[key];
    if (!Number.isSafeInteger(count) || count < 0 || count > commandCount) {
      throw new Error(`Invalid Rito frame command buffer record stat for ${key}: ${String(count)}`);
    }
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

function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(',')}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function readAscii(view, offset, length) {
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}
