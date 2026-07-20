import { ReaderWireWriterV1, validateReaderWireMessageV1 } from './reader-v1-wire-base-runtime.js';

export function encodeRitoReaderForegroundHandoffV1(request) {
  const writer = ReaderWireWriterV1.message('RITOFGH1');
  writer.externalId(request.sessionId, 'session id');
  writeOptionalExternalId(
    writer,
    request.expectedVisibleArtifactId,
    'expected visible artifact id',
  );
  writer.externalId(request.candidateArtifactId, 'candidate artifact id');
  const bytes = writer.finish();
  if (bytes.byteLength !== 48) throw new Error('RITOFGH1 must be exactly 48 bytes');
  return bytes;
}

export function decodeRitoReaderForegroundHandoffAckV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITOFGA1', 'foreground handoff ack');
  const intentRequestId = reader.externalId('intent request id');
  const replacedArtifactId = readOptionalExternalId(reader, 'replaced artifact id');
  const visibleArtifactId = reader.externalId('visible artifact id');
  reader.finish('foreground handoff ack');
  return { intentRequestId, replacedArtifactId, visibleArtifactId };
}

function writeOptionalExternalId(writer, value, field) {
  if (value === undefined) {
    writer.u32(0, `${field} option tag`);
    writer.u64(0n, `${field} option value`);
    return;
  }
  writer.u32(1, `${field} option tag`);
  writer.externalId(value, field);
}

function readOptionalExternalId(reader, field) {
  const tag = reader.u32(`${field} option tag`);
  if (tag === 0) {
    const value = reader.u64(`${field} option value`);
    if (value !== 0n) reader.fail(`${field} None value must be zero`);
    return undefined;
  }
  if (tag === 1) return reader.externalId(field);
  reader.fail(`unknown ${field} option tag: ${String(tag)}`);
}
