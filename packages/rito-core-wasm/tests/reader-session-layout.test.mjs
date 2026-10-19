import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { decodeRitoReaderNavigationResult } from '../src/reader-session-query-decoder-runtime.js';
import { encodeRitoReaderNavigationRequest } from '../src/reader-session-query-request-runtime.js';
import { encodeRitoReaderSpreadRequest } from '../src/reader-session-request-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerClient } from '../src/reader-session-worker-client-runtime.js';
import { createRitoCoreWasmReaderSessionWorkerHandler } from '../src/reader-session-worker-runtime.js';
import { ReaderWireReader } from '../src/reader-session-wire-base-runtime.js';
import {
  artifactWire,
  fakeWorker,
  foregroundHandoffAckWire,
  request,
  settle,
  workerScope,
} from './helpers/reader-session-fixtures.mjs';

// The bytes are the Rust encoder's output, read from the Rust test that
// pins them, so this mirror can never drift onto bytes only it produces.
const RUST_FIXTURES = readFileSync(
  new URL('../../../crates/rito-core/src/runtime/reader_session/layout_tests.rs', import.meta.url),
  'utf8',
);

function rustHex(name) {
  const match = new RegExp(`const ${name}: &str =\\s*concat!\\(([^)]*)\\)`).exec(RUST_FIXTURES);
  if (!match) throw new Error(`Rust fixture ${name} is missing`);
  const hex = [...match[1].matchAll(/"([0-9a-f]*)"/g)].map((part) => part[1]).join('');
  return Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

const LAYOUT = {
  pageCount: 5,
  spreads: [
    { leftPageIndex: 0, rightPageIndex: undefined },
    { leftPageIndex: 1, rightPageIndex: 2 },
    { leftPageIndex: 3, rightPageIndex: 4 },
  ],
  chapters: [
    { spineIndex: 1, startPage: 0, endPage: 2 },
    { spineIndex: 3, startPage: 3, endPage: 4 },
  ],
  tocTargets: [
    { tocId: 2, pageIndex: 0 },
    { tocId: 6, pageIndex: 3 },
  ],
  activeTocEntryByPage: [undefined, 2, 2, 6, 6],
  complete: false,
};

test('the layout query and the spread request encode to the Rust bytes', () => {
  assert.deepEqual(
    encodeRitoReaderNavigationRequest({
      sessionId: 7n,
      query: { kind: 'layout', artifactId: 9n, whole: false },
    }),
    rustHex('LAYOUT_REQUEST_HEX'),
  );
  assert.deepEqual(
    encodeRitoReaderSpreadRequest({
      sessionId: 7n,
      requestId: 12n,
      fromArtifactId: 9n,
      spreadIndex: 258,
    }),
    rustHex('SPREAD_REQUEST_HEX'),
  );
  assert.throws(() =>
    encodeRitoReaderSpreadRequest({
      sessionId: 7n,
      requestId: 12n,
      fromArtifactId: 0n,
      spreadIndex: 0,
    }),
  );
  assert.throws(() =>
    encodeRitoReaderSpreadRequest({
      sessionId: 7n,
      requestId: 12n,
      fromArtifactId: 9n,
      spreadIndex: -1,
    }),
  );
});

test('a revision layout decodes from the Rust bytes', () => {
  assert.deepEqual(decodeRitoReaderNavigationResult(rustHex('LAYOUT_RESULT_HEX')), {
    kind: 'layout',
    layout: LAYOUT,
  });
});

test('a revision layout rejects truncation and trailing bytes', () => {
  const bytes = rustHex('LAYOUT_RESULT_HEX');
  for (let length = 0; length < bytes.byteLength; length += 1) {
    assert.throws(() => decodeRitoReaderNavigationResult(bytes.subarray(0, length)));
  }
  // A message that declares its own length correctly but carries a byte
  // no field reads.
  const longer = new Uint8Array(bytes.byteLength + 1);
  longer.set(bytes);
  new DataView(longer.buffer).setBigUint64(12, BigInt(longer.byteLength), true);
  assert.throws(() => decodeRitoReaderNavigationResult(longer));
});

function requestFields(bytes) {
  const reader = new ReaderWireReader(bytes);
  reader.u64('magic');
  reader.u32('version');
  reader.u64('length');
  return {
    sessionId: reader.externalId('session'),
    requestId: reader.externalId('request'),
    fromArtifactId: reader.externalId('from artifact'),
    spreadIndex: reader.u32('spread index'),
  };
}

function openWorker(rawSession) {
  const scope = workerScope();
  createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSession: rawSession,
  });
  scope.dispatch({
    protocol: 'rito-reader-session',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 7n,
    request: { sessionId: 7n, requestId: 1n, ...request('Text/initial.xhtml') },
  });
  return scope;
}

test('worker publishes a spread by position as a peek and answers the layout query', async () => {
  const spreads = [];
  const layouts = [];
  class RawSession {
    requestArtifact(bytes) {
      const ids = requestFields(bytes);
      return artifactWire(ids.sessionId, ids.requestId, 41n, 'Text/initial.xhtml');
    }

    adoptForegroundCandidate() {
      return foregroundHandoffAckWire(1n, undefined, 41n);
    }

    peekSpread(bytes) {
      const fields = requestFields(bytes);
      spreads.push(fields);
      return artifactWire(fields.sessionId, fields.requestId, 42n, 'Text/initial.xhtml');
    }

    commitPeekedArtifact() {
      return foregroundHandoffAckWire(2n, 41n, 42n);
    }

    navigation(bytes) {
      layouts.push(bytes);
      return rustHex('LAYOUT_RESULT_HEX');
    }

    dispose() {
      return true;
    }
  }
  const scope = openWorker(RawSession);
  await settle();
  const send = async (id, kind, body) => {
    scope.dispatch({ protocol: 'rito-reader-session', id, kind, ...body });
    await settle();
    return scope.responses.at(-1).message;
  };
  await send(2, 'adopt-foreground-candidate', {
    request: { sessionId: 7n, expectedVisibleArtifactId: undefined, candidateArtifactId: 41n },
  });

  const layout = await send(3, 'navigation', {
    request: { sessionId: 7n, query: { kind: 'layout', artifactId: 41n } },
  });
  assert.deepEqual(decodeRitoReaderNavigationResult(layout.payload.wire).layout, LAYOUT);
  assert.equal(layouts.length, 1);
  const foreign = await send(4, 'navigation', {
    request: { sessionId: 7n, query: { kind: 'layout', artifactId: 99n } },
  });
  assert.equal(foreign.error.code, 'unknown-artifact');
  assert.equal(layouts.length, 1, 'a layout of an artifact the worker does not hold is not asked');

  const unowned = await send(5, 'peek-spread', {
    request: { sessionId: 7n, requestId: 2n, fromArtifactId: 99n, spreadIndex: 2 },
  });
  assert.equal(unowned.error.code, 'unknown-artifact');
  assert.equal(spreads.length, 0);

  const peeked = await send(6, 'peek-spread', {
    request: { sessionId: 7n, requestId: 2n, fromArtifactId: 41n, spreadIndex: 2 },
  });
  assert.equal(peeked.payload.kind, 'artifact');
  assert.equal(peeked.payload.identity.artifactId, 42n);
  assert.deepEqual(spreads, [
    { sessionId: 7n, requestId: 2n, fromArtifactId: 41n, spreadIndex: 2 },
  ]);

  const committed = await send(7, 'commit-peeked-artifact', {
    request: { sessionId: 7n, expectedVisibleArtifactId: 41n, candidateArtifactId: 42n },
  });
  assert.equal(committed.payload.kind, 'foreground-handoff');
});

test('client reaches a spread by position and commits it like a peeked turn', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderSessionWorkerClient(worker);
  const opening = client.open(new ArrayBuffer(1), request('Text/initial.xhtml'));
  await settle();
  worker.respondArtifact(worker.take('open'), 41n, 'Text/initial.xhtml', 'open');
  const initial = await opening;
  const adopting = client.adoptForegroundCandidate(undefined, 41n);
  await settle();
  worker.respond(worker.take('adopt-foreground-candidate'), {
    kind: 'foreground-handoff',
    wire: foregroundHandoffAckWire(initial.requestId, undefined, 41n).buffer,
  });
  await adopting;

  const asking = client.navigation({ kind: 'layout', artifactId: 41n });
  await settle();
  const question = worker.take('navigation');
  assert.deepEqual(question.request, {
    sessionId: client.sessionId,
    query: { kind: 'layout', artifactId: 41n },
  });
  worker.respond(question, { kind: 'navigation', wire: rustHex('LAYOUT_RESULT_HEX').buffer });
  assert.deepEqual(await asking, { kind: 'layout', layout: LAYOUT });
  await assert.rejects(client.navigation({ kind: 'layout', artifactId: 99n }), {
    code: 'unknown-artifact',
  });

  await assert.rejects(client.peekSpread(99n, 0), { code: 'unknown-artifact' });
  const peeking = client.peekSpread(41n, 2);
  await settle();
  const peekMessage = worker.take('peek-spread');
  assert.equal(peekMessage.request.fromArtifactId, 41n);
  assert.equal(peekMessage.request.spreadIndex, 2);
  worker.respondArtifact(peekMessage, 42n, 'Text/initial.xhtml');
  const peeked = await peeking;
  assert.equal(peeked.artifactId, 42n);

  const committing = client.commitPeekedArtifact(41n, 42n);
  await settle();
  worker.respond(worker.take('commit-peeked-artifact'), {
    kind: 'foreground-handoff',
    wire: foregroundHandoffAckWire(peekMessage.request.requestId, 41n, 42n).buffer,
  });
  assert.equal((await committing).visibleArtifactId, 42n);
});

test('an artifact request encodes to the Rust bytes, force flags included', async () => {
  const { encodeRitoReaderArtifactRequest } =
    await import('../src/reader-session-request-runtime.js');
  const fixtures = readFileSync(
    new URL(
      '../../../crates/rito-core/src/runtime/reader_session/typography_tests.rs',
      import.meta.url,
    ),
    'utf8',
  );
  const match = /const ARTIFACT_REQUEST_HEX: &str =\s*concat!\(([^)]*)\)/.exec(fixtures);
  const hex = [...match[1].matchAll(/"([0-9a-f]*)"/g)].map((part) => part[1]).join('');
  const expected = Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
  const layout = {
    viewportWidth: 393,
    viewportHeight: 760,
    marginTop: 24,
    marginRight: 20,
    marginBottom: 24,
    marginLeft: 20,
    spreadMode: 'double',
    firstPageAlone: true,
    spreadGap: 20,
    rootFontSize: 18,
    lineHeightOverride: 1.5,
    fontFamilyOverride: 'serif',
    lineHeightForce: false,
    fontFamilyForce: true,
    renderRatio: 3,
  };
  const request = {
    sessionId: 7n,
    requestId: 12n,
    layout,
    locator: { href: 'OEBPS/chapter-2.xhtml', progression: 0.25 },
    textProfile: 'platform-string-runs',
  };
  assert.deepEqual(encodeRitoReaderArtifactRequest(request), expected);
  // A layout that does not say forces both overrides.
  const unspecified = { ...layout };
  delete unspecified.lineHeightForce;
  delete unspecified.fontFamilyForce;
  const defaulted = encodeRitoReaderArtifactRequest({ ...request, layout: unspecified });
  const flagsOffset = 44 + Number(new DataView(expected.buffer).getBigUint64(36, true)) - 2;
  assert.deepEqual([...defaulted.subarray(flagsOffset, flagsOffset + 2)], [1, 1]);
  assert.deepEqual([...expected.subarray(flagsOffset, flagsOffset + 2)], [0, 1]);
});
