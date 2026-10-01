import assert from 'node:assert/strict';

import {
  READER_PROTOCOL_VERSION,
  ReaderWireWriter,
} from '../../src/reader-session-wire-base-runtime.js';

// Shared reader-session test scaffolding: hand-built wires for the
// pagination messages and in-process stand-ins for the worker transport.
export const layout = {
  viewportWidth: 800,
  viewportHeight: 600,
  marginTop: 24,
  marginRight: 24,
  marginBottom: 24,
  marginLeft: 24,
  spreadMode: 'single',
  firstPageAlone: false,
  spreadGap: 24,
  rootFontSize: 16,
};

export function request(href) {
  return { layout, locator: { href }, textProfile: 'platform-string-runs' };
}

export function artifactWire(sessionId, requestId, artifactId, href, options = {}) {
  const writer = ReaderWireWriter.message('RITOART1');
  writer.u32(READER_PROTOCOL_VERSION, 'protocol');
  writer.u32(1, 'capability');
  writer.externalId(sessionId, 'session');
  writer.externalId(requestId, 'request');
  writer.externalId(1n, 'revision');
  writer.u32(1, 'revision version');
  writer.externalId(artifactId, 'artifact');
  writer.record((record) => writeLocator(record, { href }));
  writer.u32(4, 'locator match');
  writer.u32(0, 'page index');
  writer.u32(0, 'spread index');
  writer.count(1, 'page indexes');
  writer.u32(0, 'page index');
  writer.f64(800, 'width');
  writer.f64(600, 'height');
  writer.option(undefined, () => undefined);
  writer.option(undefined, () => undefined);
  writer.u32(2, 'previous');
  writer.u32(2, 'next');
  writer.u32(0, 'text profile');
  writer.record((record) => {
    const display = displayWire(0);
    record.u32(2, 'display version');
    record.u32(options.displayCommandCount ?? 0, 'display commands');
    record.u32(32, 'digest length');
    record.raw(new Uint8Array(32));
    record.u64(BigInt(display.byteLength), 'display bytes length');
    record.raw(display);
  });
  writer.count(0, 'resources');
  writer.count(0, 'fonts');
  writer.count(0, 'pages');
  return writer.finish();
}

export function displayWire(count, write = () => undefined) {
  const writer = new ReaderWireWriter();
  writer.raw(new TextEncoder().encode('RITODL1'));
  writer.u32(2, 'display version');
  writer.f64(1, 'display ratio');
  writer.count(count, 'display commands');
  write(writer);
  return Uint8Array.from(writer.bytes);
}

export function foregroundHandoffAckWire(
  intentRequestId,
  replacedArtifactId,
  visibleArtifactId,
  optionTag = replacedArtifactId === undefined ? 0 : 1,
  optionValue = replacedArtifactId ?? 0n,
) {
  const writer = ReaderWireWriter.message('RITOFGA1');
  writer.externalId(intentRequestId, 'intent');
  writer.u32(optionTag, 'replaced option tag');
  writer.u64(optionValue, 'replaced option value');
  writer.externalId(visibleArtifactId, 'visible');
  return writer.finish();
}

export function writeLocator(writer, locator) {
  writer.string(locator.href, 'href');
  writer.option(undefined, () => undefined);
  writer.option(undefined, () => undefined);
  writer.option(undefined, () => undefined);
  writer.option(locator.progression, (value) => writer.f64(value, 'progression'));
}

export function workerScope() {
  let listener;
  const responses = [];
  return {
    responses,
    addEventListener(type, value) {
      if (type === 'message') listener = value;
    },
    postMessage(message, transfer = []) {
      responses.push({ message, transfer });
    },
    dispatch(message) {
      listener({ data: message });
    },
  };
}

export function fakeWorker() {
  const listeners = new Map();
  const messages = [];
  return {
    messages,
    terminateCount: 0,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    postMessage(message) {
      messages.push(message);
    },
    terminate() {
      this.terminateCount += 1;
    },
    count(kind) {
      return messages.filter((message) => message.kind === kind).length;
    },
    take(kind) {
      const index = messages.findIndex((message) => message.kind === kind);
      assert.notEqual(index, -1, `missing ${kind} message`);
      return messages.splice(index, 1)[0];
    },
    respond(requestMessage, payload) {
      listeners.get('message')({
        data: {
          protocol: 'rito-reader-session',
          id: requestMessage.id,
          ok: true,
          payload,
        },
      });
    },
    respondError(requestMessage, code, message) {
      listeners.get('message')({
        data: {
          protocol: 'rito-reader-session',
          id: requestMessage.id,
          ok: false,
          error: { name: 'RitoReaderError', code, message },
        },
      });
    },
    respondArtifact(requestMessage, artifactId, href, kind = 'artifact') {
      const wire = artifactWire(
        requestMessage.request.sessionId,
        requestMessage.request.requestId,
        artifactId,
        href,
      );
      this.respond(requestMessage, {
        kind,
        identity: {
          sessionId: requestMessage.request.sessionId,
          requestId: requestMessage.request.requestId,
          revisionId: 1n,
          revisionVersion: 1,
          artifactId,
        },
        wire: wire.buffer,
      });
    },
  };
}

export async function settle() {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}
