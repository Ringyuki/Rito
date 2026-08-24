import {
  COMMAND_KINDS,
  FRAME_COMMAND_RECORD_FLAG_MASK,
  NO_STRING_INDEX,
} from './frame-command-buffer-decoder-constants.js';

export function countDecodedRecords(records) {
  const counts = {};
  for (const record of records) {
    counts[record.kind] = (counts[record.kind] ?? 0) + 1;
  }
  return counts;
}

export function countDecodedRecordStats(records) {
  const stats = {
    geometryRecords: 0,
    paintRecords: 0,
    payloadRecords: 0,
    primaryStringRecords: 0,
    secondaryStringRecords: 0,
  };
  for (const record of records) {
    if (record.hasGeometry) stats.geometryRecords += 1;
    if (record.hasPaint) stats.paintRecords += 1;
    if (record.hasPayload) stats.payloadRecords += 1;
    if (record.hasPrimaryString) stats.primaryStringRecords += 1;
    if (record.hasSecondaryString) stats.secondaryStringRecords += 1;
  }
  return stats;
}

export function readFrameCommandRecord(metadata, view, offset) {
  const opcode = view.getUint16(offset, true);
  const flags = view.getUint16(offset + 2, true);
  const kind = COMMAND_KINDS[opcode];
  if (kind === undefined) {
    throw new Error(`Unsupported Rito frame command buffer opcode: ${String(opcode)}`);
  }
  const unsupportedFlags = flags & ~FRAME_COMMAND_RECORD_FLAG_MASK;
  if (unsupportedFlags !== 0) {
    throw new Error(
      `Unsupported Rito frame command buffer record flags: 0x${unsupportedFlags.toString(16)}`,
    );
  }
  const primaryIndex = view.getUint32(offset + 20, true);
  const secondaryIndex = view.getUint32(offset + 24, true);
  const payloadIndex = view.getUint32(offset + 28, true);
  const hasPrimaryString = hasFlag(flags, 1);
  const hasSecondaryString = hasFlag(flags, 2);
  const hasPayload = hasFlag(flags, 4);
  validateTableFlag(hasPrimaryString, primaryIndex, 'primary string');
  validateTableFlag(hasSecondaryString, secondaryIndex, 'secondary string');
  validateTableFlag(hasPayload, payloadIndex, 'payload');
  return {
    opcode,
    kind,
    flags,
    hasGeometry: hasFlag(flags, 0),
    hasPrimaryString,
    hasSecondaryString,
    hasPaint: hasFlag(flags, 3),
    hasPayload,
    x: view.getFloat32(offset + 4, true),
    y: view.getFloat32(offset + 8, true),
    width: view.getFloat32(offset + 12, true),
    height: view.getFloat32(offset + 16, true),
    primaryString: readTableValue(metadata.stringTable, primaryIndex, 'string'),
    secondaryString: readTableValue(metadata.stringTable, secondaryIndex, 'string'),
    payload: readTableValue(metadata.payloadTable, payloadIndex, 'payload'),
  };
}

export function recordToDisplayCommand(record) {
  if (record.payload !== undefined) return parsePayloadCommand(record);
  switch (record.kind) {
    case 'pushState':
    case 'popState':
      return { kind: record.kind };
    case 'translate':
      return { kind: record.kind, dx: record.x, dy: record.y };
    case 'opacity':
      return { kind: record.kind, value: record.x };
    case 'clipRect':
      return { kind: record.kind, rect: recordRect(record) };
    case 'paintImage':
      return imageRecordToCommand(record);
    default:
      throw new Error(
        `Rito frame command buffer record ${record.kind} requires a payload command.`,
      );
  }
}

function parsePayloadCommand(record) {
  let value;
  try {
    value = JSON.parse(record.payload);
  } catch (error) {
    throw new Error(
      `Rito frame command buffer payload for ${record.kind} is invalid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `Rito frame command buffer payload for ${record.kind} is not an object command.`,
    );
  }
  const payloadKind = value.kind;
  if (payloadKind !== record.kind) {
    throw new Error(
      `Rito frame command buffer payload kind mismatch: record=${
        record.kind
      } payload=${jsonValueText(payloadKind)}`,
    );
  }
  return value;
}

function jsonValueText(value) {
  if (value === undefined) return 'undefined';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function imageRecordToCommand(record) {
  if (record.primaryString === undefined) {
    throw new Error('Rito frame command buffer paintImage record is missing its src string.');
  }
  const command = {
    kind: 'paintImage',
    src: record.primaryString,
    rect: recordRect(record),
  };
  if (record.secondaryString !== undefined) command.href = record.secondaryString;
  return command;
}

function recordRect(record) {
  return {
    x: record.x,
    y: record.y,
    width: record.width,
    height: record.height,
  };
}

function validateTableFlag(hasValue, index, tableName) {
  if (hasValue && index === NO_STRING_INDEX) {
    throw new Error(
      `Rito frame command buffer has ${tableName} flag without ${tableName} table index.`,
    );
  }
  if (!hasValue && index !== NO_STRING_INDEX) {
    throw new Error(
      `Rito frame command buffer has ${tableName} table index without ${tableName} flag.`,
    );
  }
}

function readTableValue(table, index, tableName) {
  if (index === NO_STRING_INDEX) return undefined;
  const value = table[index];
  if (value === undefined) {
    throw new Error(
      `Rito frame command buffer references missing ${tableName} table index ${String(index)}.`,
    );
  }
  return value;
}

function hasFlag(flags, bit) {
  return (flags & (1 << bit)) !== 0;
}
