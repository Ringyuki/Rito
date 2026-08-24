import {
  FRAME_COMMAND_HEADER_BYTES,
  FRAME_COMMAND_RECORD_BYTES,
} from './frame-command-buffer-decoder-constants.js';
import {
  countDecodedRecords,
  countDecodedRecordStats,
  readFrameCommandRecord,
  recordToDisplayCommand,
} from './frame-command-buffer-decoder-records.js';
import {
  validateFrameCommandBufferMetadata,
  validateStableJsonMatch,
} from './frame-command-buffer-decoder-validation.js';
import {
  validateDecodedFrameCommandRecord,
  validateFrameCommand,
  validateFrameCommandSequence,
} from './frame-command-buffer-command-validation.js';

export function decodeRitoFrameCommandBuffer(metadata, bytes) {
  validateFrameCommandBufferMetadata(metadata, bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records = [];
  for (let index = 0; index < metadata.commandCount; index += 1) {
    const record = readFrameCommandRecord(
      metadata,
      view,
      FRAME_COMMAND_HEADER_BYTES + index * FRAME_COMMAND_RECORD_BYTES,
    );
    validateDecodedFrameCommandRecord(record, index);
    records.push(record);
  }
  const commandCounts = countDecodedRecords(records);
  validateStableJsonMatch(
    metadata.commandCounts,
    commandCounts,
    'Rito frame command buffer command counts do not match decoded records.',
  );
  const recordStats = countDecodedRecordStats(records);
  validateStableJsonMatch(
    metadata.recordStats,
    recordStats,
    'Rito frame command buffer record stats do not match decoded records.',
  );
  const commands = records.map((record, index) =>
    validateFrameCommand(recordToDisplayCommand(record), index),
  );
  validateFrameCommandSequence(commands);
  return {
    protocolVersion: metadata.protocolVersion,
    commandCount: metadata.commandCount,
    commandCounts,
    recordStats,
    commandHash: metadata.commandHash,
    resourceRefCount: metadata.resourceRefCount,
    resourceTable: metadata.resourceTable,
    records,
    commands,
  };
}
