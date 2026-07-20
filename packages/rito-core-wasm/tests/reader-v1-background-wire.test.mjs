import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeRitoReaderBackgroundAdvanceV1,
  decodeRitoReaderBackgroundHandoffAckV1,
  encodeRitoReaderBackgroundHandoffV1,
  encodeRitoReaderBackgroundRequestV1,
} from '../src/reader-v1-background-runtime.js';
import { ReaderWireReaderV1, ReaderWireWriterV1 } from '../src/reader-v1-wire-base-runtime.js';

const HIGH_ID = 0x7fff_ffff_ffff_fffen;

test('background request and handoff keep all u64 identities as bigint', () => {
  const request = encodeRitoReaderBackgroundRequestV1({
    sessionId: HIGH_ID,
    expectedVisibleArtifactId: HIGH_ID - 1n,
    maxTopLevelNodesPerQuantum: 0xffff_ffff,
  });
  assert.equal(request.byteLength, 40);
  const requestReader = messageReader(request, 'RITOBGQ1');
  assert.equal(requestReader.externalId('session'), HIGH_ID);
  assert.equal(requestReader.externalId('visible'), HIGH_ID - 1n);
  assert.equal(requestReader.u32('quantum'), 0xffff_ffff);
  requestReader.finish('request');

  const handoff = encodeRitoReaderBackgroundHandoffV1({
    sessionId: HIGH_ID,
    expectedVisibleArtifactId: HIGH_ID - 1n,
    candidateArtifactId: HIGH_ID - 2n,
  });
  assert.equal(handoff.byteLength, 44);
  const handoffReader = messageReader(handoff, 'RITOHOF1');
  assert.equal(handoffReader.externalId('session'), HIGH_ID);
  assert.equal(handoffReader.externalId('visible'), HIGH_ID - 1n);
  assert.equal(handoffReader.externalId('candidate'), HIGH_ID - 2n);
  handoffReader.finish('handoff');
});

test('background advance and handoff acknowledgement decode high-bit identities exactly', () => {
  const advance = backgroundAdvanceWire(1, HIGH_ID, HIGH_ID - 1n);
  assert.deepEqual(decodeRitoReaderBackgroundAdvanceV1(advance), {
    state: 'advanced',
    intentRequestId: HIGH_ID,
    replacesArtifactId: HIGH_ID - 1n,
    artifact: undefined,
  });

  const ackWriter = ReaderWireWriterV1.message('RITOHOA1');
  ackWriter.externalId(HIGH_ID, 'intent');
  ackWriter.externalId(HIGH_ID - 1n, 'replaced');
  ackWriter.externalId(HIGH_ID - 2n, 'visible');
  assert.deepEqual(decodeRitoReaderBackgroundHandoffAckV1(ackWriter.finish()), {
    intentRequestId: HIGH_ID,
    replacedArtifactId: HIGH_ID - 1n,
    visibleArtifactId: HIGH_ID - 2n,
  });
});

test('background decoders fail closed on truncation, trailing bytes, and unknown state', () => {
  const advance = backgroundAdvanceWire(0, 7n, 9n);
  assert.throws(
    () => decodeRitoReaderBackgroundAdvanceV1(advance.subarray(0, advance.byteLength - 1)),
    /total length does not match|truncated/,
  );
  const trailing = new Uint8Array(advance.byteLength + 1);
  trailing.set(advance);
  assert.throws(() => decodeRitoReaderBackgroundAdvanceV1(trailing), /total length does not match/);
  assert.throws(
    () => decodeRitoReaderBackgroundAdvanceV1(backgroundAdvanceWire(99, 7n, 9n)),
    /unknown background state/,
  );

  const ack = handoffAckWire(7n, 8n, 9n);
  assert.throws(
    () => decodeRitoReaderBackgroundHandoffAckV1(ack.subarray(0, ack.byteLength - 1)),
    /total length does not match|truncated/,
  );
});

test('background request rejects zero quantum before it crosses the worker boundary', () => {
  assert.throws(
    () =>
      encodeRitoReaderBackgroundRequestV1({
        sessionId: 1n,
        expectedVisibleArtifactId: 2n,
        maxTopLevelNodesPerQuantum: 0,
      }),
    /must be non-zero/,
  );
});

function backgroundAdvanceWire(state, intentRequestId, replacesArtifactId) {
  const writer = ReaderWireWriterV1.message('RITOBGA1');
  writer.u32(state, 'state');
  writer.externalId(intentRequestId, 'intent');
  writer.externalId(replacesArtifactId, 'replaces');
  writer.u64(0n, 'artifact length');
  return writer.finish();
}

function handoffAckWire(intentRequestId, replacedArtifactId, visibleArtifactId) {
  const writer = ReaderWireWriterV1.message('RITOHOA1');
  writer.externalId(intentRequestId, 'intent');
  writer.externalId(replacedArtifactId, 'replaced');
  writer.externalId(visibleArtifactId, 'visible');
  return writer.finish();
}

function messageReader(bytes, magic) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic(magic, 'magic');
  assert.equal(reader.u32('version'), 1);
  assert.equal(reader.u64('length'), BigInt(bytes.byteLength));
  return reader;
}
