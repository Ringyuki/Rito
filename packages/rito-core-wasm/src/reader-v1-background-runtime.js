import { decodeRitoReaderArtifactV1 } from './reader-v1-artifact-decoder-runtime.js';
import { ReaderWireWriterV1, validateReaderWireMessageV1 } from './reader-v1-wire-base-runtime.js';

const BACKGROUND_STATES = [
  'started',
  'advanced',
  'reused',
  'candidate-pending',
  'complete',
  'indexing',
];

export function encodeRitoReaderBackgroundRequestV1(request) {
  const writer = ReaderWireWriterV1.message('RITOBGQ1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.expectedVisibleArtifactId, 'expected visible artifact id');
  if (request.maxTopLevelNodesPerQuantum === 0) {
    throw new RangeError('max top-level nodes per quantum must be non-zero');
  }
  writer.u32(request.maxTopLevelNodesPerQuantum, 'max top-level nodes per quantum');
  const bytes = writer.finish();
  if (bytes.byteLength !== 40) throw new Error('RITOBGQ1 must be exactly 40 bytes');
  return bytes;
}

export function decodeRitoReaderBackgroundAdvanceV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITOBGA1', 'background advance');
  const stateTag = reader.u32('background state');
  const state = BACKGROUND_STATES[stateTag];
  if (state === undefined) reader.fail(`unknown background state: ${String(stateTag)}`);
  const intentRequestId = reader.externalId('intent request id');
  const replacesArtifactId = reader.externalId('replaces artifact id');
  const artifactBytes = reader.blob('background artifact');
  const artifact =
    artifactBytes.byteLength === 0 ? undefined : decodeRitoReaderArtifactV1(artifactBytes);
  reader.finish('background advance');
  // 'complete' may carry exactly one artifact: the completion handoff
  // that delivers the book page count to a reader who never turned a
  // page. The other quiet states carry nothing by definition.
  if ((state === 'indexing' || state === 'candidate-pending') && artifact !== undefined) {
    reader.fail(`${state} background advance must not carry an artifact`);
  }
  return { state, intentRequestId, replacesArtifactId, artifact };
}

export function encodeRitoReaderBackgroundHandoffV1(request) {
  const writer = ReaderWireWriterV1.message('RITOHOF1');
  writer.externalId(request.sessionId, 'session id');
  writer.externalId(request.expectedVisibleArtifactId, 'expected visible artifact id');
  writer.externalId(request.candidateArtifactId, 'candidate artifact id');
  const bytes = writer.finish();
  if (bytes.byteLength !== 44) throw new Error('RITOHOF1 must be exactly 44 bytes');
  return bytes;
}

export function decodeRitoReaderBackgroundHandoffAckV1(value) {
  const reader = validateReaderWireMessageV1(value, 'RITOHOA1', 'background handoff ack');
  const intentRequestId = reader.externalId('intent request id');
  const replacedArtifactId = reader.externalId('replaced artifact id');
  const visibleArtifactId = reader.externalId('visible artifact id');
  reader.finish('background handoff ack');
  return { intentRequestId, replacedArtifactId, visibleArtifactId };
}
