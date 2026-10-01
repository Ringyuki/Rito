import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { encodeRitoReaderSearchRequest } from '../src/reader-session-query-request-runtime.js';
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

const SESSION = new URL('../../../crates/rito-core/src/runtime/reader_session/', import.meta.url);
const RUST_FIXTURES = [
  readFileSync(new URL('interaction_tests.rs', SESSION), 'utf8'),
  readFileSync(new URL('wire/query_tests.rs', SESSION), 'utf8'),
].join('\n');

function rustHex(name) {
  const match = new RegExp(`const ${name}: &str =\\s*(concat!\\(([^)]*)\\)|"([0-9a-f]*)")`).exec(
    RUST_FIXTURES,
  );
  const hex = match[3] ?? [...match[2].matchAll(/"([0-9a-f]*)"/g)].map((part) => part[1]).join('');
  return Uint8Array.from(hex.match(/../g).map((byte) => Number.parseInt(byte, 16)));
}

function requestIds(bytes) {
  const reader = new ReaderWireReader(bytes);
  reader.u64('magic');
  reader.u32('version');
  reader.u64('length');
  return { sessionId: reader.externalId('session'), requestId: reader.externalId('request') };
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

test("worker answers a query with Core's own message and guards artifact ownership", async () => {
  const searched = [];
  class RawSession {
    requestArtifact(bytes) {
      const ids = requestIds(bytes);
      return artifactWire(ids.sessionId, ids.requestId, 9n, 'Text/initial.xhtml');
    }

    search(bytes) {
      searched.push(bytes);
      return rustHex('SEARCH_RESPONSE_HEX');
    }

    dispose() {
      return true;
    }
  }
  const scope = openWorker(RawSession);
  await settle();
  const searchRequest = {
    sessionId: 7n,
    artifactId: 9n,
    query: '雪',
    caseSensitive: true,
    wholeWord: false,
    limit: 5,
  };
  scope.dispatch({
    protocol: 'rito-reader-session',
    id: 2,
    kind: 'search',
    request: searchRequest,
  });
  await settle();
  const answer = scope.responses.at(-1);
  assert.equal(answer.message.payload.kind, 'search');
  assert.deepEqual(new Uint8Array(answer.message.payload.wire), rustHex('SEARCH_RESPONSE_HEX'));
  assert.deepEqual(answer.transfer, [answer.message.payload.wire]);
  assert.deepEqual(searched, [encodeRitoReaderSearchRequest(searchRequest)]);

  scope.dispatch({
    protocol: 'rito-reader-session',
    id: 3,
    kind: 'search',
    request: { ...searchRequest, artifactId: 10n },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'unknown-artifact');
  assert.equal(searched.length, 1);
});

test('worker peek leaves the foreground alone and commit swaps the visible artifact', async () => {
  const backgroundGuards = [];
  class RawSession {
    requestArtifact(bytes) {
      const ids = requestIds(bytes);
      return artifactWire(ids.sessionId, ids.requestId, 41n, 'Text/initial.xhtml');
    }

    adoptForegroundCandidate() {
      return foregroundHandoffAckWire(1n, undefined, 41n);
    }

    peekAdjacent(bytes) {
      const ids = requestIds(bytes);
      return artifactWire(ids.sessionId, ids.requestId, 42n, 'Text/next.xhtml');
    }

    commitPeekedArtifact() {
      return foregroundHandoffAckWire(2n, 41n, 42n);
    }

    advanceBackgroundOnce(bytes) {
      backgroundGuards.push(bytes);
      throw Object.assign(new Error('stop'), { code: 'stale-request' });
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
  const peeked = await send(3, 'peek-adjacent', {
    request: { sessionId: 7n, requestId: 2n, fromArtifactId: 41n, direction: 'next' },
  });
  assert.equal(peeked.payload.kind, 'artifact');
  assert.equal(peeked.payload.identity.artifactId, 42n);

  const background = { sessionId: 7n, maxTopLevelNodesPerQuantum: 1 };
  const stale = await send(4, 'advance-background-once', {
    request: { ...background, expectedVisibleArtifactId: 42n },
  });
  assert.equal(stale.error.code, 'stale-request', 'a peek does not make its artifact visible');
  assert.equal(backgroundGuards.length, 0);

  const committed = await send(5, 'commit-peeked-artifact', {
    request: { sessionId: 7n, expectedVisibleArtifactId: 41n, candidateArtifactId: 42n },
  });
  assert.equal(committed.payload.kind, 'foreground-handoff');
  await send(6, 'advance-background-once', {
    request: { ...background, expectedVisibleArtifactId: 42n },
  });
  assert.equal(backgroundGuards.length, 1, 'the committed peek is the visible artifact');
});

test('client decodes query answers and rejects one about another artifact', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderSessionWorkerClient(worker);
  const opening = client.open(new ArrayBuffer(1), request('Text/initial.xhtml'));
  await settle();
  worker.respondArtifact(worker.take('open'), 9n, 'Text/initial.xhtml', 'open');
  await opening;

  const searching = client.search(9n, { query: '雪', caseSensitive: true, limit: 5 });
  await settle();
  const message = worker.take('search');
  assert.deepEqual(message.request, {
    sessionId: client.sessionId,
    artifactId: 9n,
    query: '雪',
    caseSensitive: true,
    wholeWord: false,
    limit: 5,
  });
  worker.respond(message, { kind: 'search', wire: rustHex('SEARCH_RESPONSE_HEX').buffer });
  const response = await searching;
  assert.equal(response.searchedPageCount, 42);
  assert.equal(response.results[0].context, '…初雪が…');

  const footnote = client.readFootnote(9n, 'OEBPS/notes.xhtml#n1');
  await settle();
  worker.respond(worker.take('read-footnote'), {
    kind: 'read-footnote',
    wire: rustHex('FOOTNOTE_HEX').buffer,
  });
  assert.equal((await footnote).kind, 'endnote');

  await assert.rejects(client.search(10n, { query: 'x' }), { code: 'unknown-artifact' });
});

test('client commits a peek once and only over the visible artifact', async () => {
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

  const peeking = client.peekAdjacent(41n, 'next');
  await settle();
  const peekMessage = worker.take('peek-adjacent');
  worker.respondArtifact(peekMessage, 42n, 'Text/next.xhtml');
  const peeked = await peeking;
  assert.equal(peeked.artifactId, 42n);

  await assert.rejects(client.commitPeekedArtifact(42n, 42n), { code: 'stale-request' });
  const committing = client.commitPeekedArtifact(41n, 42n);
  await settle();
  worker.respond(worker.take('commit-peeked-artifact'), {
    kind: 'foreground-handoff',
    wire: foregroundHandoffAckWire(peekMessage.request.requestId, 41n, 42n).buffer,
  });
  const ack = await committing;
  assert.equal(ack.visibleArtifactId, 42n);
  await assert.rejects(client.commitPeekedArtifact(41n, 42n), { code: 'stale-request' });
});

test('every query round-trips through the real worker and client', async () => {
  class RawSession {
    requestArtifact(bytes) {
      const ids = requestIds(bytes);
      return artifactWire(ids.sessionId, ids.requestId, 9n, 'Text/initial.xhtml');
    }

    search() {
      return rustHex('SEARCH_RESPONSE_HEX');
    }

    readFootnote() {
      return rustHex('FOOTNOTE_HEX');
    }

    textRangeGeometry() {
      return rustHex('TEXT_RANGE_GEOMETRY_HEX');
    }

    exactSourceRange() {
      return rustHex('EXACT_SOURCE_RANGE_RESOLUTION_HEX');
    }

    textInteraction() {
      return rustHex('SELECTION_HEX');
    }

    annotation() {
      return rustHex('QUOTE_HEX');
    }

    navigation() {
      return rustHex('LOCATION_HEX');
    }

    dispose() {
      return true;
    }
  }
  const client = createRitoCoreWasmReaderSessionWorkerClient(connectedWorker(RawSession));
  await client.open(new ArrayBuffer(1), request('Text/initial.xhtml'));
  const position = { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 };
  const point = { nodePath: [0], textOffset: 0n };
  const range = { start: point, end: point };

  assert.equal((await client.search(9n, { query: '雪' })).searchedPageCount, 42);
  assert.equal((await client.readFootnote(9n, 'OEBPS/notes.xhtml#n1')).kind, 'endnote');
  assert.equal((await client.textRangeGeometry(9n, 4, position, position)).pageIndex, 4);
  assert.equal((await client.exactSourceRange(9n, 'chapter.xhtml', range)).status, 'resolved');
  const interaction = await client.textInteraction(9n, {
    kind: 'caret',
    point: { pageIndex: 0, x: 1, y: 1 },
  });
  assert.equal(interaction.result.kind, 'selection');
  const annotation = await client.annotation({ kind: 'create', href: 'chapter.xhtml', range });
  assert.equal(annotation.level, 'quote');
  const location = await client.navigation({
    kind: 'locate',
    artifactId: 9n,
    locator: { href: 'chapter.xhtml' },
  });
  assert.equal(location.location.matchedBy, 'anchor');
  await client.dispose();
});

/** A client transport wired straight into a real worker handler. */
function connectedWorker(rawSession) {
  const listeners = new Map();
  const scope = {
    addEventListener(type, listener) {
      if (type === 'message') scope.listener = listener;
    },
    postMessage(message) {
      queueMicrotask(() => listeners.get('message')?.({ data: message }));
    },
  };
  createRitoCoreWasmReaderSessionWorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSession: rawSession,
  });
  return {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    postMessage(message) {
      queueMicrotask(() => scope.listener({ data: message }));
    },
    terminate() {},
  };
}
