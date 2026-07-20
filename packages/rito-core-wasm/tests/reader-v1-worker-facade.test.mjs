import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  decodeRitoReaderArtifactV1,
  decodeRitoReaderResourceV1,
} from '../src/reader-v1-artifact-decoder-runtime.js';
import { decodeRitoReaderDisplayListV1 } from '../src/reader-v1-display-decoder-runtime.js';
import {
  decodeRitoReaderForegroundHandoffAckV1,
  encodeRitoReaderForegroundHandoffV1,
} from '../src/reader-v1-foreground-runtime.js';
import { decodeRitoReaderPublicationV1 } from '../src/reader-v1-publication-runtime.js';
import { createRitoCoreWasmReaderV1WorkerClient } from '../src/reader-v1-worker-client-runtime.js';
import { createRitoCoreWasmReaderV1WorkerHandler } from '../src/reader-v1-worker-runtime.js';
import { ReaderWireReaderV1, ReaderWireWriterV1 } from '../src/reader-v1-wire-base-runtime.js';

const layout = {
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
const work = {
  maxTopLevelNodesPerQuantum: 64,
  maxForegroundQuanta: 8,
  localPageCap: 16,
};

test('foreground continuations reuse the shared host-turn primitive without a timer retry loop', () => {
  const source = readFileSync(
    new URL('../src/reader-v1-worker-client-runtime.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /defaultYieldControl/);
  assert.match(source, /MAX_EXACT_CONTINUATION_QUANTA\s*=\s*4_096/);
  assert.match(source, /MAX_ADJACENT_CONTINUATION_QUANTA\s*=\s*4_096/);
  assert.doesNotMatch(source, /setTimeout\(\s*resolve\s*,\s*0/);
  assert.doesNotMatch(source, /function\s+.*yield.*setTimeout/i);
});

test('foreground handoff wire is fixed-width, bigint-safe, and rejects noncanonical options', () => {
  const highId = (1n << 60n) + 91n;
  for (const expectedVisibleArtifactId of [undefined, highId + 1n]) {
    const requestValue = {
      sessionId: highId,
      expectedVisibleArtifactId,
      candidateArtifactId: highId + 2n,
    };
    const bytes = encodeRitoReaderForegroundHandoffV1(requestValue);
    assert.equal(bytes.byteLength, 48);
    assert.deepEqual(foregroundHandoffRequest(bytes), requestValue);

    const ackBytes = foregroundHandoffAckWire(highId + 3n, expectedVisibleArtifactId, highId + 2n);
    assert.equal(ackBytes.byteLength, 48);
    assert.deepEqual(decodeRitoReaderForegroundHandoffAckV1(ackBytes), {
      intentRequestId: highId + 3n,
      replacedArtifactId: expectedVisibleArtifactId,
      visibleArtifactId: highId + 2n,
    });
  }

  assert.throws(
    () =>
      encodeRitoReaderForegroundHandoffV1({
        sessionId: 1n,
        expectedVisibleArtifactId: 0n,
        candidateArtifactId: 2n,
      }),
    /valid external ID/,
  );
  assert.throws(
    () => decodeRitoReaderForegroundHandoffAckV1(foregroundHandoffAckWire(1n, undefined, 2n, 2)),
    /option tag/,
  );
  assert.throws(
    () =>
      decodeRitoReaderForegroundHandoffAckV1(foregroundHandoffAckWire(1n, undefined, 2n, 0, 9n)),
    /None value must be zero/,
  );
  assert.throws(
    () =>
      decodeRitoReaderForegroundHandoffAckV1(foregroundHandoffAckWire(1n, undefined, 2n, 1, 0n)),
    /valid external ID/,
  );
  const valid = foregroundHandoffAckWire(1n, undefined, 2n);
  assert.throws(() => decodeRitoReaderForegroundHandoffAckV1(valid.subarray(0, 47)));
});

test('worker open sends the initial locator as Core first and only artifact request', async () => {
  const requests = [];
  const scope = workerScope();
  class RawSession {
    constructor(_publication, sessionId) {
      this.sessionId = sessionId;
    }

    requestArtifactV1(request) {
      requests.push(request.slice());
      const identity = requestIdentity(request);
      return artifactWire(identity.sessionId, identity.requestId, 41n, 'Text/Section040.xhtml');
    }

    disposeV1() {
      return true;
    }

    free() {}
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(8),
    sessionId: 7n,
    request: {
      sessionId: 7n,
      requestId: 1n,
      layout,
      locator: { href: 'Text/Section040.xhtml', progression: 0.75 },
      work,
      textProfile: 'platform-string-runs',
    },
  });
  await settle();

  assert.equal(requests.length, 1);
  assert.deepEqual(requestLocator(requests[0]), {
    href: 'Text/Section040.xhtml',
    progression: 0.75,
  });
  assert.equal(scope.responses.length, 1);
  assert.equal(scope.responses[0].message.ok, true);
  assert.equal(scope.responses[0].message.payload.identity.artifactId, 41n);
});

test('worker makes an initial candidate visible only after foreground adoption', async () => {
  const scope = workerScope();
  let backgroundCalls = 0;
  const releases = [];
  class RawSession {
    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      return artifactWire(identity.sessionId, identity.requestId, 41n, 'Text/initial.xhtml');
    }

    adoptForegroundCandidateV1(requestBytes) {
      const handoff = foregroundHandoffRequest(requestBytes);
      return foregroundHandoffAckWire(1n, handoff.expectedVisibleArtifactId, 41n);
    }

    advanceBackgroundOnceV1(requestBytes) {
      backgroundCalls += 1;
      const requestValue = backgroundRequestIdentity(requestBytes);
      return backgroundAdvanceWire(4, 1n, requestValue.expectedVisibleArtifactId);
    }

    releaseArtifactV1(artifactId) {
      releases.push(artifactId);
      return true;
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestValue = { sessionId: 7n, requestId: 1n, ...request('Text/initial.xhtml') };
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 7n,
    request: requestValue,
  });
  await settle();

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 2,
    kind: 'advance-background-once',
    request: { sessionId: 7n, expectedVisibleArtifactId: 41n, maxTopLevelNodesPerQuantum: 1 },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'stale-request');
  assert.equal(backgroundCalls, 0);

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 3,
    kind: 'adopt-foreground-candidate',
    request: {
      sessionId: 7n,
      expectedVisibleArtifactId: undefined,
      candidateArtifactId: 41n,
    },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.kind, 'foreground-handoff');

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 4,
    kind: 'advance-background-once',
    request: { sessionId: 7n, expectedVisibleArtifactId: 41n, maxTopLevelNodesPerQuantum: 1 },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.kind, 'background-advance');
  assert.equal(backgroundCalls, 1);

  scope.dispatch({ protocol: 'rito-reader-v1', id: 5, kind: 'release', artifactId: 41n });
  await settle();
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 6,
    kind: 'advance-background-once',
    request: { sessionId: 7n, expectedVisibleArtifactId: 41n, maxTopLevelNodesPerQuantum: 1 },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'stale-request');
  assert.deepEqual(releases, [41n]);
});

test('worker preserves a replacement candidate after a stale foreground CAS', async () => {
  const scope = workerScope();
  let artifactId = 0n;
  class RawSession {
    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      artifactId += 1n;
      return artifactWire(
        identity.sessionId,
        identity.requestId,
        artifactId,
        'Text/replacement.xhtml',
      );
    }

    adoptForegroundCandidateV1(requestBytes) {
      const handoff = foregroundHandoffRequest(requestBytes);
      if (handoff.candidateArtifactId === 2n && handoff.expectedVisibleArtifactId === undefined) {
        const error = new Error('stale foreground CAS');
        error.code = 'stale-request';
        throw error;
      }
      return foregroundHandoffAckWire(
        handoff.candidateArtifactId,
        handoff.expectedVisibleArtifactId,
        handoff.candidateArtifactId,
      );
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestFor = (requestId) => ({
    sessionId: 13n,
    requestId,
    ...request('Text/replacement.xhtml'),
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 13n,
    request: requestFor(1n),
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 2,
    kind: 'adopt-foreground-candidate',
    request: {
      sessionId: 13n,
      expectedVisibleArtifactId: undefined,
      candidateArtifactId: 1n,
    },
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 3,
    kind: 'request-artifact',
    request: requestFor(2n),
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 4,
    kind: 'adopt-foreground-candidate',
    request: {
      sessionId: 13n,
      expectedVisibleArtifactId: undefined,
      candidateArtifactId: 2n,
    },
  });
  await settle();
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'stale-request');

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 5,
    kind: 'adopt-foreground-candidate',
    request: {
      sessionId: 13n,
      expectedVisibleArtifactId: 1n,
      candidateArtifactId: 2n,
    },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.kind, 'foreground-handoff');
  const ack = decodeRitoReaderForegroundHandoffAckV1(scope.responses.at(-1).message.payload.wire);
  assert.equal(ack.replacedArtifactId, 1n);
  assert.equal(ack.visibleArtifactId, 2n);
});

test('worker reads publication lazily and transfers a standalone owned RITOPUB1 buffer', async () => {
  const scope = workerScope();
  let publicationBacking;
  class RawSession {
    constructor(_publication, sessionId) {
      this.sessionId = sessionId;
    }

    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      return artifactWire(identity.sessionId, identity.requestId, 1n, 'Text/chapter.xhtml');
    }

    publicationV1() {
      const wire = publicationWire(this.sessionId);
      const backing = Buffer.alloc(wire.byteLength + 32);
      backing.set(wire, 16);
      publicationBacking = backing.buffer;
      return backing.subarray(16, 16 + wire.byteLength);
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 23n,
    request: { sessionId: 23n, requestId: 1n, ...request('Text/chapter.xhtml') },
  });
  await settle();

  scope.dispatch({ protocol: 'rito-reader-v1', id: 2, kind: 'read-publication' });
  await settle();

  const response = scope.responses.at(-1);
  assert.equal(response.message.ok, true);
  assert.equal(response.message.payload.kind, 'publication');
  assert.equal(response.transfer.length, 1);
  assert.equal(response.transfer[0], response.message.payload.wire);
  assert.notEqual(response.message.payload.wire, publicationBacking);
  assert.equal(response.message.payload.wire.byteLength + 32, publicationBacking.byteLength);
  const publication = decodeRitoReaderPublicationV1(response.message.payload.wire);
  assert.equal(publication.sessionId, 23n);
  assert.equal(publication.metadata.title, 'Reader v1 Book');
});

test('client returns typed publication data and rejects a mismatched session identity', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/chapter.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/chapter.xhtml', 'open');
  await opening;

  const reading = client.readPublication();
  const readMessage = worker.take('read-publication');
  worker.respond(readMessage, {
    kind: 'publication',
    wire: publicationWire(openMessage.sessionId).buffer,
  });
  const publication = await reading;
  assert.equal(publication.sessionId, openMessage.sessionId);
  assert.equal(typeof publication.sessionId, 'bigint');
  assert.equal(publication.toc[0].target.kind, 'locator');

  const mismatched = client.readPublication();
  worker.respond(worker.take('read-publication'), {
    kind: 'publication',
    wire: publicationWire(openMessage.sessionId + 1n).buffer,
  });
  await assert.rejects(mismatched, (error) => error.code === 'invalid-wire');

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;
});

test('client exposes foreground candidates and commits visibility only after a matching ACK', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/initial.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/initial.xhtml', 'open');
  const initial = await opening;

  await assert.rejects(
    client.advanceBackgroundOnce(initial.artifactId, 1),
    (error) => error.code === 'stale-request',
  );
  assert.equal(worker.count('advance-background-once'), 0);
  const initialAck = await adoptClientForeground(worker, client, undefined, initial);
  assert.equal(initialAck.replacedArtifactId, undefined);

  const replacementPromise = client.seek({ href: 'Text/replacement.xhtml' });
  await settle();
  const replacementMessage = worker.take('request-artifact');
  worker.respondArtifact(replacementMessage, 2n, 'Text/replacement.xhtml');
  const replacement = await replacementPromise;
  await assert.rejects(
    client.adoptForegroundCandidate(undefined, replacement.artifactId),
    (error) => error.code === 'stale-request',
  );
  assert.equal(worker.count('adopt-foreground-candidate'), 0);

  const replacementAck = await adoptClientForeground(
    worker,
    client,
    initial.artifactId,
    replacement,
  );
  assert.equal(replacementAck.replacedArtifactId, initial.artifactId);

  const releaseInitial = client.release(initial.artifactId);
  const releaseMessage = worker.take('release');
  worker.respond(releaseMessage, { kind: 'release', released: true });
  assert.equal(await releaseInitial, true, 'adoption keeps the animation source live');

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;
});

test('unadopted reflow candidate does not change the next seek request template', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/initial.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/initial.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const rejectedLayout = { ...layout, rootFontSize: 27 };
  const rejectedWork = { ...work, maxTopLevelNodesPerQuantum: 3, localPageCap: 5 };
  const reflowing = client.seek(
    { href: 'Text/unprepared.xhtml' },
    { layout: rejectedLayout, work: rejectedWork },
  );
  await settle();
  const reflowMessage = worker.take('request-artifact');
  worker.respondArtifact(reflowMessage, 2n, 'Text/unprepared.xhtml');
  const unprepared = await reflowing;
  await assert.rejects(
    client.advanceBackgroundOnce(initial.artifactId, 1),
    (error) => error.code === 'request-busy',
  );
  assert.equal(worker.count('advance-background-once'), 0);
  const releasing = client.release(unprepared.artifactId);
  worker.respond(worker.take('release'), { kind: 'release', released: true });
  await releasing;
  const advancing = client.advanceBackgroundOnce(initial.artifactId, 1);
  const advanceMessage = worker.take('advance-background-once');
  worker.respond(advanceMessage, {
    kind: 'background-advance',
    wire: backgroundAdvanceWire(4, initial.requestId, initial.artifactId).buffer,
  });
  await advancing;

  const next = client.seek({ href: 'Text/next.xhtml' });
  await settle();
  const nextMessage = worker.take('request-artifact');
  assert.equal(nextMessage.request.layout.rootFontSize, layout.rootFontSize);
  assert.equal(
    nextMessage.request.work.maxTopLevelNodesPerQuantum,
    work.maxTopLevelNodesPerQuantum,
  );
  assert.equal(nextMessage.request.work.localPageCap, work.localPageCap);
  worker.respondError(nextMessage, 'target-not-published', 'terminal target');
  await assert.rejects(next, (error) => error.code === 'target-not-published');

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;
});

test('worker retains explicit exact-seek pending state until the exact artifact is ready', async () => {
  const scope = workerScope();
  const requests = [];
  class RawSession {
    constructor(_publication, sessionId) {
      this.sessionId = sessionId;
      this.pending = false;
    }

    hasPendingExactSeekV1() {
      return this.pending;
    }

    requestArtifactV1(requestBytes) {
      requests.push(requestBytes.slice());
      if (requests.length < 3) {
        this.pending = true;
        const error = new Error('opaque typed Core error');
        error.code = 'target-not-published';
        throw error;
      }
      this.pending = false;
      const identity = requestIdentity(requestBytes);
      return artifactWire(identity.sessionId, identity.requestId, 71n, 'Text/exact.xhtml');
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestFor = (requestId) => ({
    sessionId: 31n,
    requestId,
    ...request('Text/exact.xhtml'),
  });

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 31n,
    request: requestFor(1n),
  });
  await settle();
  assert.deepEqual(scope.responses.at(-1).message.payload, {
    kind: 'pending-exact',
    sessionId: 31n,
    requestId: 1n,
  });

  for (let id = 2; id <= 3; id += 1) {
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id,
      kind: 'request-artifact',
      request: requestFor(BigInt(id)),
    });
    await settle();
  }

  assert.deepEqual(
    requests.map((bytes) => requestIdentity(bytes).requestId),
    [1n, 2n, 3n],
  );
  assert.deepEqual(
    requests.map((bytes) => requestWorkBudget(bytes).maxForegroundQuanta),
    [1, 1, 1],
  );
  assert.equal(scope.responses[1].message.payload.kind, 'pending-exact');
  assert.equal(scope.responses[2].message.payload.identity.requestId, 3n);
  assert.equal(scope.responses[2].message.payload.identity.revisionId, 1n);
  assert.equal(scope.responses[2].message.payload.identity.revisionVersion, 1);
});

test('worker retries adjacent only from typed Core pending state and forces one quantum', async () => {
  const scope = workerScope();
  const requests = [];
  let pending = false;
  let adjacentCalls = 0;
  let disposals = 0;
  class RawSession {
    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      return artifactWire(identity.sessionId, identity.requestId, 1n, 'Text/source.xhtml');
    }

    hasPendingAdjacentV1() {
      return pending;
    }

    requestAdjacentV1(requestBytes) {
      const requestValue = adjacentRequestValue(requestBytes);
      requests.push(requestValue);
      adjacentCalls += 1;
      if (adjacentCalls <= 2) {
        pending = true;
        const error = new Error('opaque adjacent suspension');
        error.code = 'target-not-published';
        throw error;
      }
      if (adjacentCalls === 4) {
        pending = false;
        const error = new Error('opaque terminal boundary');
        error.code = 'target-not-published';
        throw error;
      }
      pending = false;
      return artifactWire(
        requestValue.sessionId,
        requestValue.requestId,
        2n,
        'Text/adjacent.xhtml',
      );
    }

    releaseArtifactV1() {
      return true;
    }

    disposeV1() {
      disposals += 1;
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const initialRequest = { sessionId: 32n, requestId: 1n, ...request('Text/source.xhtml') };
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 32n,
    request: initialRequest,
  });
  await settle();

  for (let id = 2; id <= 4; id += 1) {
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id,
      kind: 'request-adjacent',
      request: {
        sessionId: 32n,
        requestId: BigInt(id),
        fromArtifactId: 1n,
        direction: 'next',
        work,
      },
    });
    await settle();
  }

  assert.equal(scope.responses[1].message.payload.kind, 'pending-adjacent');
  assert.equal(scope.responses[2].message.payload.kind, 'pending-adjacent');
  assert.equal(scope.responses[3].message.payload.identity.artifactId, 2n);
  assert.deepEqual(
    requests.map((requestValue) => requestValue.requestId),
    [2n, 3n, 4n],
  );
  assert.deepEqual(
    requests.map((requestValue) => requestValue.work.maxForegroundQuanta),
    [1, 1, 1],
  );

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 5,
    kind: 'request-adjacent',
    request: {
      sessionId: 32n,
      requestId: 5n,
      fromArtifactId: 1n,
      direction: 'next',
      work,
    },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'target-not-published');
  assert.equal(scope.responses.at(-1).message.payload, undefined);
  assert.equal(disposals, 0, 'terminal adjacent keeps the ready session usable');
  scope.dispatch({ protocol: 'rito-reader-v1', id: 6, kind: 'release', artifactId: 1n });
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.kind, 'release');
});

test('worker keeps a ready session after a terminal seek and fails closed on engine failure', async () => {
  const scope = workerScope();
  let calls = 0;
  let pending = false;
  let disposals = 0;
  class RawSession {
    hasPendingExactSeekV1() {
      return pending;
    }

    requestArtifactV1(requestBytes) {
      calls += 1;
      const identity = requestIdentity(requestBytes);
      if (calls === 2) {
        const error = new Error('pending text must not control retry');
        error.code = 'target-not-published';
        throw error;
      }
      if (calls === 4) {
        pending = true;
        const error = new Error('typed engine failure while query remains true');
        error.code = 'engine-failure';
        throw error;
      }
      return artifactWire(
        identity.sessionId,
        identity.requestId,
        BigInt(calls),
        'Text/exact.xhtml',
      );
    }

    disposeV1() {
      disposals += 1;
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestFor = (requestId) => ({
    sessionId: 37n,
    requestId,
    ...request('Text/exact.xhtml'),
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 37n,
    request: requestFor(1n),
  });
  await settle();

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 2,
    kind: 'request-artifact',
    request: requestFor(2n),
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'target-not-published');
  assert.equal(disposals, 0, 'a terminal seek preserves the current visible session');

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 3,
    kind: 'request-artifact',
    request: requestFor(3n),
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.identity.requestId, 3n);

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 4,
    kind: 'request-artifact',
    request: requestFor(4n),
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'engine-failure');
  assert.equal(disposals, 1, 'query=true must not swallow a typed engine failure');
});

test('worker disposes a terminal initial open instead of retaining an unusable session', async () => {
  const scope = workerScope();
  let disposals = 0;
  let frees = 0;
  class RawSession {
    hasPendingExactSeekV1() {
      return false;
    }

    requestArtifactV1() {
      const error = new Error('terminal initial locator');
      error.code = 'invalid-locator';
      throw error;
    }

    disposeV1() {
      disposals += 1;
      return true;
    }

    free() {
      frees += 1;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 41n,
    request: { sessionId: 41n, requestId: 1n, ...request('Text/missing.xhtml') },
  });
  await settle();

  assert.equal(scope.responses.at(-1).message.error.code, 'invalid-locator');
  assert.equal(disposals, 1);
  assert.equal(frees, 1);
  scope.dispatch({ protocol: 'rito-reader-v1', id: 2, kind: 'read-publication' });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'session-disposed');
});

test('client preserves its current artifact after a terminal exact seek', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/current.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/current.xhtml', 'open');
  const current = await opening;
  await adoptClientForeground(worker, client, undefined, current);

  const terminal = client.seek({ href: 'Text/missing.xhtml' });
  await settle();
  worker.respondError(
    worker.take('request-artifact'),
    'target-not-published',
    'terminal exact target',
  );
  await assert.rejects(terminal, (error) => error.code === 'target-not-published');

  const adjacent = client.requestAdjacent(current.artifactId, 'next');
  await settle();
  const adjacentMessage = worker.take('request-adjacent');
  worker.respondArtifact(adjacentMessage, 2n, 'Text/next.xhtml');
  assert.equal((await adjacent).artifactId, 2n);

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;
});

test('client immediately fails closed after a fatal exact engine failure', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/current.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/current.xhtml', 'open');
  const current = await opening;
  await adoptClientForeground(worker, client, undefined, current);

  const fatal = client.seek({ href: 'Text/fatal.xhtml' });
  await settle();
  worker.respondError(worker.take('request-artifact'), 'engine-failure', 'fatal Core failure');
  await assert.rejects(fatal, (error) => error.code === 'engine-failure');

  await assert.rejects(
    client.requestAdjacent(current.artifactId, 'next'),
    (error) => error.code === 'engine-failure',
  );
  assert.equal(worker.count('request-adjacent'), 0);
  assert.equal(worker.terminateCount, 1);
});

test('client yields once per explicit pending response and caps exact continuation attempts', async () => {
  const worker = fakeWorker();
  let yields = 0;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: async () => {
      yields += 1;
    },
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/exact.xhtml'));
  const first = worker.take('open');
  worker.respond(first, pendingExactPayload(first.request));
  await settle();
  const second = worker.take('request-artifact');
  worker.respond(second, pendingExactPayload(second.request));
  await settle();
  const third = worker.take('request-artifact');
  worker.respondArtifact(third, 81n, 'Text/exact.xhtml');
  const artifact = await opening;

  assert.equal(yields, 2);
  assert.deepEqual(
    [first, second, third].map((message) => message.request.requestId),
    [first.request.requestId, first.request.requestId + 1n, first.request.requestId + 2n],
  );
  assert.deepEqual(
    [first, second, third].map((message) => message.request.work.maxForegroundQuanta),
    [1, 1, 1],
  );
  assert.equal(artifact.revisionId, 1n);
  assert.equal(artifact.revisionVersion, 1);

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;

  const cappedWorker = fakeWorker();
  const capped = createRitoCoreWasmReaderV1WorkerClient(cappedWorker, {
    yieldControl: async () => undefined,
    maxExactContinuationQuanta: 2,
  });
  const cappedRequest = request('Text/never-ready.xhtml');
  const cappedOpening = capped.open(new ArrayBuffer(4), cappedRequest);
  const cappedFirst = cappedWorker.take('open');
  cappedWorker.respond(cappedFirst, pendingExactPayload(cappedFirst.request));
  await settle();
  const cappedSecond = cappedWorker.take('request-artifact');
  cappedWorker.respond(cappedSecond, pendingExactPayload(cappedSecond.request));
  await settle();
  const cappedDispose = cappedWorker.take('dispose');
  cappedWorker.respond(cappedDispose, { kind: 'dispose', releasedArtifacts: 0 });
  await assert.rejects(
    cappedOpening,
    (error) => error.code === 'target-not-published' && /continuation quanta/.test(error.message),
  );
  assert.equal(cappedWorker.count('request-artifact'), 0);
});

test('client yields once per adjacent quantum with strict request ids and an explicit cap', async () => {
  const worker = fakeWorker();
  let yields = 0;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: async () => {
      yields += 1;
    },
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const adjacent = client.requestAdjacent(source.artifactId, 'next');
  await settle();
  const first = worker.take('request-adjacent');
  worker.respond(first, pendingAdjacentPayload(first.request));
  await settle();
  const second = worker.take('request-adjacent');
  worker.respond(second, pendingAdjacentPayload(second.request));
  await settle();
  const third = worker.take('request-adjacent');
  worker.respondArtifact(third, 2n, 'Text/adjacent.xhtml');
  const artifact = await adjacent;

  assert.equal(yields, 2);
  assert.deepEqual(
    [first, second, third].map((message) => message.request.requestId),
    [first.request.requestId, first.request.requestId + 1n, first.request.requestId + 2n],
  );
  assert.deepEqual(
    [first, second, third].map((message) => message.request.work.maxForegroundQuanta),
    [1, 1, 1],
  );
  assert.deepEqual(
    [first, second, third].map((message) => message.request.fromArtifactId),
    [source.artifactId, source.artifactId, source.artifactId],
  );
  assert.equal(artifact.artifactId, 2n);
  assert.equal(worker.count('release'), 0, 'source and candidate stay live for host animation');

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;

  const cappedWorker = fakeWorker();
  const capped = createRitoCoreWasmReaderV1WorkerClient(cappedWorker, {
    yieldControl: async () => undefined,
    maxAdjacentContinuationQuanta: 2,
  });
  const cappedOpening = capped.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const cappedOpen = cappedWorker.take('open');
  cappedWorker.respondArtifact(cappedOpen, 1n, 'Text/source.xhtml', 'open');
  const cappedSource = await cappedOpening;
  await adoptClientForeground(cappedWorker, capped, undefined, cappedSource);
  const cappedAdjacent = capped.requestAdjacent(cappedSource.artifactId, 'next');
  await settle();
  const cappedFirst = cappedWorker.take('request-adjacent');
  cappedWorker.respond(cappedFirst, pendingAdjacentPayload(cappedFirst.request));
  await settle();
  const cappedSecond = cappedWorker.take('request-adjacent');
  cappedWorker.respond(cappedSecond, pendingAdjacentPayload(cappedSecond.request));
  await assert.rejects(
    cappedAdjacent,
    (error) => error.code === 'target-not-published' && /continuation quanta/.test(error.message),
  );
  assert.equal(cappedWorker.count('request-adjacent'), 0);
  const cappedDisposing = capped.dispose();
  cappedWorker.respond(cappedWorker.take('dispose'), { kind: 'dispose', releasedArtifacts: 1 });
  await cappedDisposing;
});

test('a newer foreground intent cancels adjacent before its next host turn', async () => {
  const worker = fakeWorker();
  let resumeYield;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: () =>
      new Promise((resolve) => {
        resumeYield = resolve;
      }),
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const adjacent = client.requestAdjacent(source.artifactId, 'next');
  await settle();
  const adjacentMessage = worker.take('request-adjacent');
  worker.respond(adjacentMessage, pendingAdjacentPayload(adjacentMessage.request));
  await settle();
  const latest = client.seek({ href: 'Text/latest.xhtml' });
  assert.equal(worker.count('request-artifact'), 0, 'latest intent waits for lane ownership');
  resumeYield();
  await assert.rejects(adjacent, (error) => error.code === 'stale-request');
  await settle();
  assert.equal(worker.count('request-adjacent'), 0, 'cancelled adjacent sends no retry');
  const latestMessage = worker.take('request-artifact');
  assert.equal(latestMessage.request.requestId, adjacentMessage.request.requestId + 1n);
  worker.respondArtifact(latestMessage, 2n, 'Text/latest.xhtml');
  assert.equal((await latest).artifactId, 2n);

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;
});

test('dispose cancels retained adjacent before another host turn is sent', async () => {
  const worker = fakeWorker();
  let resumeYield;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: () =>
      new Promise((resolve) => {
        resumeYield = resolve;
      }),
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const adjacent = client.requestAdjacent(source.artifactId, 'next');
  await settle();
  const attempt = worker.take('request-adjacent');
  worker.respond(attempt, pendingAdjacentPayload(attempt.request));
  await settle();
  const disposing = client.dispose();
  const disposeMessage = worker.take('dispose');
  resumeYield();
  await assert.rejects(adjacent, (error) => error.code === 'session-disposed');
  assert.equal(worker.count('request-adjacent'), 0);
  worker.respond(disposeMessage, { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;
});

test('latest-wins seek keeps one active + one replaceable request and releases stale output first', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/Section001.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/Section001.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const first = client.seek({ href: 'Text/Section020.xhtml' });
  await settle();
  const firstMessage = worker.take('request-artifact');
  const second = client.seek({ href: 'Text/Section030.xhtml' });
  const third = client.seek({ href: 'Text/Section040.xhtml' });
  await assert.rejects(first, (error) => error.code === 'stale-request');
  await assert.rejects(second, (error) => error.code === 'stale-request');
  assert.equal(
    worker.count('request-artifact'),
    0,
    'queued seeks must not cross the worker boundary',
  );

  worker.respondArtifact(firstMessage, 2n, 'Text/Section020.xhtml');
  await settle();
  const release = worker.take('release');
  assert.equal(release.artifactId, 2n);
  assert.equal(worker.count('request-artifact'), 0, 'latest seek waits until stale owner release');
  worker.respond(release, { kind: 'release', released: true });
  await settle();

  const latestMessage = worker.take('request-artifact');
  assert.equal(latestMessage.request.locator.href, 'Text/Section040.xhtml');
  worker.respondArtifact(latestMessage, 3n, 'Text/Section040.xhtml');
  const latest = await third;
  assert.equal(latest.artifactId, 3n);
  assert.equal(initial.artifactId, 1n, 'visible source remains live until the host releases it');
});

test('pending seek and adjacent navigation share one latest-wins foreground lane', async () => {
  const worker = fakeWorker();
  let resumeYield;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: () =>
      new Promise((resolve) => {
        resumeYield = resolve;
      }),
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/start.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/start.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const pendingSeek = client.seek({ href: 'Text/old.xhtml' });
  await settle();
  const oldMessage = worker.take('request-artifact');
  worker.respond(oldMessage, pendingExactPayload(oldMessage.request));
  await settle();
  await assert.rejects(
    client.advanceBackgroundOnce(initial.artifactId, 1),
    (error) => error.code === 'request-busy',
  );
  assert.equal(worker.count('advance-background-once'), 0);

  const adjacent = client.requestAdjacent(initial.artifactId, 'next');
  await assert.rejects(pendingSeek, (error) => error.code === 'stale-request');
  assert.equal(worker.count('request-adjacent'), 0, 'adjacent waits for the old lane owner');
  resumeYield();
  await settle();

  const adjacentMessage = worker.take('request-adjacent');
  const latest = client.seek({ href: 'Text/latest.xhtml' });
  worker.respondArtifact(adjacentMessage, 2n, 'Text/adjacent.xhtml');
  await settle();
  const staleRelease = worker.take('release');
  assert.equal(staleRelease.artifactId, 2n);
  worker.respond(staleRelease, { kind: 'release', released: true });
  await assert.rejects(adjacent, (error) => error.code === 'stale-request');
  await settle();

  const latestMessage = worker.take('request-artifact');
  assert.equal(latestMessage.request.requestId, adjacentMessage.request.requestId + 1n);
  assert.equal(latestMessage.request.locator.href, 'Text/latest.xhtml');
  worker.respondArtifact(latestMessage, 3n, 'Text/latest.xhtml');
  assert.equal((await latest).artifactId, 3n);

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;
});

test('dispose stops a pending exact retry before another host turn can send it', async () => {
  const worker = fakeWorker();
  let resumeYield;
  const client = createRitoCoreWasmReaderV1WorkerClient(worker, {
    yieldControl: () =>
      new Promise((resolve) => {
        resumeYield = resolve;
      }),
  });
  const opening = client.open(new ArrayBuffer(4), request('Text/start.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/start.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const seeking = client.seek({ href: 'Text/pending.xhtml' });
  await settle();
  const seekMessage = worker.take('request-artifact');
  worker.respond(seekMessage, pendingExactPayload(seekMessage.request));
  await settle();

  const disposing = client.dispose();
  const disposeMessage = worker.take('dispose');
  worker.respond(disposeMessage, { kind: 'dispose', releasedArtifacts: 1 });
  await disposing;
  resumeYield();
  await settle();

  await assert.rejects(seeking);
  assert.equal(worker.count('request-artifact'), 0);
});

test('worker bounds live artifact ownership and reopens capacity only after release', async () => {
  const scope = workerScope();
  let artifactId = 0n;
  class RawSession {
    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      artifactId += 1n;
      return artifactWire(identity.sessionId, identity.requestId, artifactId, 'Text/chapter.xhtml');
    }

    releaseArtifactV1() {
      return true;
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestFor = (requestId) => ({
    sessionId: 9n,
    requestId,
    ...request('Text/chapter.xhtml'),
  });

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 9n,
    request: requestFor(1n),
  });
  for (let id = 2; id <= 4; id += 1) {
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id,
      kind: 'request-artifact',
      request: requestFor(BigInt(id)),
    });
  }
  await settle();
  await settle();
  assert.equal(scope.responses.filter(({ message }) => message.ok).length, 4);

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 5,
    kind: 'request-artifact',
    request: requestFor(5n),
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'artifact-capacity');
  assert.equal(artifactId, 4n, 'capacity failure must happen before Core creates another artifact');

  scope.dispatch({ protocol: 'rito-reader-v1', id: 6, kind: 'release', artifactId: 1n });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 7,
    kind: 'request-artifact',
    request: requestFor(7n),
  });
  await settle();
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.identity.artifactId, 5n);
});

test('client adopts one background candidate and keeps the replaced artifact for animation', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/Section001.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/Section001.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const advancing = client.advanceBackgroundOnce(initial.artifactId, 64);
  const advanceMessage = worker.take('advance-background-once');
  assert.equal(advanceMessage.request.sessionId, openMessage.request.sessionId);
  assert.equal(advanceMessage.request.expectedVisibleArtifactId, 1n);
  const candidateWire = artifactWire(
    openMessage.request.sessionId,
    openMessage.request.requestId,
    2n,
    'Text/Section001.xhtml',
  );
  worker.respond(advanceMessage, {
    kind: 'background-advance',
    candidateIdentity: artifactIdentity(openMessage.request, 2n),
    wire: backgroundAdvanceWire(2, openMessage.request.requestId, 1n, candidateWire).buffer,
  });
  const advance = await advancing;
  assert.equal(advance.artifact?.artifactId, 2n);

  const adopting = client.adoptBackgroundCandidate(1n, 2n);
  const adoptMessage = worker.take('adopt-background-candidate');
  worker.respond(adoptMessage, {
    kind: 'background-handoff',
    wire: handoffAckWire(openMessage.request.requestId, 1n, 2n).buffer,
  });
  const ack = await adopting;
  assert.equal(ack.visibleArtifactId, 2n);
  assert.equal(worker.count('release'), 0, 'handoff must not release the animation source');

  const adjacentPromise = client.requestAdjacent(2n, 'next');
  await settle();
  const adjacentMessage = worker.take('request-adjacent');
  worker.respondArtifact(adjacentMessage, 3n, 'Text/Section001.xhtml');
  const adjacent = await adjacentPromise;
  assert.equal(adjacent.artifactId, 3n);
  assert.equal(worker.count('release'), 0, 'adjacent keeps source and incoming artifacts live');

  const releaseInitial = client.release(1n);
  const releaseMessage = worker.take('release');
  assert.equal(releaseMessage.artifactId, 1n);
  worker.respond(releaseMessage, { kind: 'release', released: true });
  assert.equal(await releaseInitial, true);

  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;
});

test('foreground candidate survives a stale concurrent background handoff', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/Section001.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 10n, 'Text/Section001.xhtml', 'open');
  const initial = await opening;
  await adoptClientForeground(worker, client, undefined, initial);

  const advancing = client.advanceBackgroundOnce(10n, 8);
  const advanceMessage = worker.take('advance-background-once');
  const candidateWire = artifactWire(
    openMessage.request.sessionId,
    openMessage.request.requestId,
    11n,
    'Text/Section001.xhtml',
  );
  worker.respond(advanceMessage, {
    kind: 'background-advance',
    candidateIdentity: artifactIdentity(openMessage.request, 11n),
    wire: backgroundAdvanceWire(0, openMessage.request.requestId, 10n, candidateWire).buffer,
  });
  await advancing;

  const seeking = client.seek({ href: 'Text/Section020.xhtml' });
  await settle();
  const seekMessage = worker.take('request-artifact');
  worker.respondArtifact(seekMessage, 12n, 'Text/Section020.xhtml');
  const foregroundCandidate = await seeking;

  await assert.rejects(
    client.adoptBackgroundCandidate(10n, 11n),
    (error) => error.code === 'request-busy',
  );
  assert.equal(worker.count('adopt-background-candidate'), 0);
  assert.equal(worker.count('release'), 0, 'neither candidate is implicitly released');

  const foregroundAck = await adoptClientForeground(
    worker,
    client,
    initial.artifactId,
    foregroundCandidate,
  );
  assert.equal(foregroundAck.visibleArtifactId, foregroundCandidate.artifactId);

  const releasing = client.release(11n);
  const releaseMessage = worker.take('release');
  worker.respond(releaseMessage, { kind: 'release', released: true });
  await releasing;
  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 2 });
  await disposing;
});

test('worker tracks candidate capacity and defers stale background eligibility to Core', async () => {
  const scope = workerScope();
  const releases = [];
  let handoffCalls = 0;
  let nextArtifactId = 1n;
  class RawSession {
    constructor(_publication, sessionId) {
      this.sessionId = sessionId;
    }

    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      const artifactId = nextArtifactId;
      nextArtifactId += 1n;
      return artifactWire(identity.sessionId, identity.requestId, artifactId, 'Text/chapter.xhtml');
    }

    adoptForegroundCandidateV1(requestBytes) {
      const requestValue = foregroundHandoffRequest(requestBytes);
      return foregroundHandoffAckWire(1n, requestValue.expectedVisibleArtifactId, 1n);
    }

    advanceBackgroundOnceV1(requestBytes) {
      const request = backgroundRequestIdentity(requestBytes);
      const candidate = artifactWire(this.sessionId, 1n, 2n, 'Text/chapter.xhtml');
      nextArtifactId = 3n;
      return backgroundAdvanceWire(2, 1n, request.expectedVisibleArtifactId, candidate);
    }

    adoptBackgroundCandidateV1() {
      handoffCalls += 1;
      const error = new Error('foreground candidate has priority');
      error.code = 'stale-request';
      throw error;
    }

    releaseArtifactV1(artifactId) {
      releases.push(artifactId);
      return true;
    }

    disposeV1() {
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  const requestFor = (requestId) => ({
    sessionId: 17n,
    requestId,
    ...request('Text/chapter.xhtml'),
  });

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 17n,
    request: requestFor(1n),
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 2,
    kind: 'adopt-foreground-candidate',
    request: {
      sessionId: 17n,
      expectedVisibleArtifactId: undefined,
      candidateArtifactId: 1n,
    },
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 3,
    kind: 'advance-background-once',
    request: {
      sessionId: 17n,
      expectedVisibleArtifactId: 1n,
      maxTopLevelNodesPerQuantum: 8,
    },
  });
  await settle();
  await settle();
  assert.equal(scope.responses.at(-1).message.payload.candidateIdentity.artifactId, 2n);

  for (let id = 4; id <= 5; id += 1) {
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id,
      kind: 'request-artifact',
      request: requestFor(BigInt(id - 1)),
    });
  }
  await settle();
  await settle();
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 6,
    kind: 'request-artifact',
    request: requestFor(5n),
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'artifact-capacity');

  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 7,
    kind: 'adopt-background-candidate',
    request: {
      sessionId: 17n,
      expectedVisibleArtifactId: 1n,
      candidateArtifactId: 2n,
    },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'stale-request');
  assert.equal(handoffCalls, 1);

  scope.dispatch({ protocol: 'rito-reader-v1', id: 8, kind: 'release', artifactId: 2n });
  scope.dispatch({ protocol: 'rito-reader-v1', id: 9, kind: 'dispose' });
  await settle();
  assert.deepEqual(releases, [2n]);
  assert.equal(scope.responses.at(-1).message.payload.releasedArtifacts, 3);
});

test('worker fail-closes when an adjacent artifact identity is lost during wire decode', async () => {
  const scope = workerScope();
  let disposals = 0;
  class RawSession {
    requestArtifactV1(requestBytes) {
      const identity = requestIdentity(requestBytes);
      return artifactWire(identity.sessionId, identity.requestId, 1n, 'Text/source.xhtml');
    }

    hasPendingAdjacentV1() {
      return false;
    }

    requestAdjacentV1() {
      return Uint8Array.of(1, 2, 3);
    }

    disposeV1() {
      disposals += 1;
      return true;
    }
  }
  createRitoCoreWasmReaderV1WorkerHandler(scope, {
    initRitoCoreWasm: async () => undefined,
    RitoReaderSessionV1: RawSession,
  });
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 1,
    kind: 'open',
    publication: new ArrayBuffer(1),
    sessionId: 51n,
    request: { sessionId: 51n, requestId: 1n, ...request('Text/source.xhtml') },
  });
  await settle();
  scope.dispatch({
    protocol: 'rito-reader-v1',
    id: 2,
    kind: 'request-adjacent',
    request: {
      sessionId: 51n,
      requestId: 2n,
      fromArtifactId: 1n,
      direction: 'next',
      work,
    },
  });
  await settle();
  assert.equal(scope.responses.at(-1).message.error.code, 'engine-failure');
  assert.equal(disposals, 1);
});

test('worker fail-closes when background advance or committed handoff wire is unreadable', async () => {
  async function runCase(malformedOperation) {
    const scope = workerScope();
    let disposals = 0;
    class RawSession {
      requestArtifactV1(requestBytes) {
        const identity = requestIdentity(requestBytes);
        return artifactWire(identity.sessionId, identity.requestId, 1n, 'Text/source.xhtml');
      }

      adoptForegroundCandidateV1(requestBytes) {
        const handoff = foregroundHandoffRequest(requestBytes);
        return foregroundHandoffAckWire(1n, handoff.expectedVisibleArtifactId, 1n);
      }

      advanceBackgroundOnceV1(requestBytes) {
        if (malformedOperation === 'advance') return Uint8Array.of(1, 2, 3);
        const requestValue = backgroundRequestIdentity(requestBytes);
        const candidate = artifactWire(52n, 1n, 2n, 'Text/source.xhtml');
        return backgroundAdvanceWire(2, 1n, requestValue.expectedVisibleArtifactId, candidate);
      }

      adoptBackgroundCandidateV1() {
        if (malformedOperation === 'handoff-identity') {
          return handoffAckWire(1n, 1n, 99n);
        }
        return Uint8Array.of(1, 2, 3);
      }

      disposeV1() {
        disposals += 1;
        return true;
      }
    }
    createRitoCoreWasmReaderV1WorkerHandler(scope, {
      initRitoCoreWasm: async () => undefined,
      RitoReaderSessionV1: RawSession,
    });
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id: 1,
      kind: 'open',
      publication: new ArrayBuffer(1),
      sessionId: 52n,
      request: { sessionId: 52n, requestId: 1n, ...request('Text/source.xhtml') },
    });
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id: 2,
      kind: 'adopt-foreground-candidate',
      request: {
        sessionId: 52n,
        expectedVisibleArtifactId: undefined,
        candidateArtifactId: 1n,
      },
    });
    scope.dispatch({
      protocol: 'rito-reader-v1',
      id: 3,
      kind: 'advance-background-once',
      request: {
        sessionId: 52n,
        expectedVisibleArtifactId: 1n,
        maxTopLevelNodesPerQuantum: 1,
      },
    });
    await settle();
    await settle();
    if (malformedOperation !== 'advance') {
      assert.equal(scope.responses.at(-1).message.payload.kind, 'background-advance');
      scope.dispatch({
        protocol: 'rito-reader-v1',
        id: 4,
        kind: 'adopt-background-candidate',
        request: {
          sessionId: 52n,
          expectedVisibleArtifactId: 1n,
          candidateArtifactId: 2n,
        },
      });
      await settle();
    }
    assert.equal(
      scope.responses.at(-1).message.error.code,
      malformedOperation === 'handoff-identity' ? 'invalid-wire' : 'engine-failure',
    );
    assert.equal(disposals, 1);
  }

  await runCase('advance');
  await runCase('handoff');
  await runCase('handoff-identity');
});

test('client fail-closes after Core commits a background handoff with a malformed ACK', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const advancing = client.advanceBackgroundOnce(source.artifactId, 1);
  const advanceMessage = worker.take('advance-background-once');
  const candidateWire = artifactWire(
    openMessage.request.sessionId,
    openMessage.request.requestId,
    2n,
    'Text/source.xhtml',
  );
  worker.respond(advanceMessage, {
    kind: 'background-advance',
    candidateIdentity: artifactIdentity(openMessage.request, 2n),
    wire: backgroundAdvanceWire(2, openMessage.request.requestId, 1n, candidateWire).buffer,
  });
  await advancing;

  const adopting = client.adoptBackgroundCandidate(1n, 2n);
  const adoptMessage = worker.take('adopt-background-candidate');
  worker.respond(adoptMessage, {
    kind: 'background-handoff',
    wire: Uint8Array.of(1, 2, 3).buffer,
  });
  await assert.rejects(adopting);
  assert.equal(worker.terminateCount, 1);
  await assert.rejects(client.requestAdjacent(1n, 'next'), (error) => error instanceof Error);
});

test('client fail-closes when a background advance response is unreadable', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const advancing = client.advanceBackgroundOnce(source.artifactId, 1);
  const advanceMessage = worker.take('advance-background-once');
  worker.respond(advanceMessage, {
    kind: 'background-advance',
    wire: Uint8Array.of(1, 2, 3).buffer,
  });

  await assert.rejects(advancing);
  assert.equal(worker.terminateCount, 1);
  await assert.rejects(client.requestAdjacent(1n, 'next'), (error) => error instanceof Error);
});

test('client fail-closes when a release acknowledgement is unreadable', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const releasing = client.release(source.artifactId);
  worker.respond(worker.take('release'), { kind: 'release', released: 'yes' });

  await assert.rejects(releasing);
  assert.equal(worker.terminateCount, 1);
  await assert.rejects(client.requestAdjacent(1n, 'next'), (error) => error instanceof Error);
});

test('client coalesces concurrent releases of the same live artifact', async () => {
  const worker = fakeWorker();
  const client = createRitoCoreWasmReaderV1WorkerClient(worker);
  const opening = client.open(new ArrayBuffer(4), request('Text/source.xhtml'));
  const openMessage = worker.take('open');
  worker.respondArtifact(openMessage, 1n, 'Text/source.xhtml', 'open');
  const source = await opening;
  await adoptClientForeground(worker, client, undefined, source);

  const first = client.release(source.artifactId);
  const second = client.release(source.artifactId);
  assert.equal(worker.count('release'), 1);
  worker.respond(worker.take('release'), { kind: 'release', released: true });

  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(worker.terminateCount, 0);
  const disposing = client.dispose();
  worker.respond(worker.take('dispose'), { kind: 'dispose', releasedArtifacts: 0 });
  await disposing;
});

test('typed decoders reject unknown RITODL1 commands and artifact metadata mismatches', () => {
  const invalidDisplay = displayWire(1, (writer) => writer.u16(99, 'opcode'));
  assert.throws(
    () => decodeRitoReaderDisplayListV1(invalidDisplay),
    /unknown display command opcode/,
  );

  const mismatched = artifactWire(1n, 1n, 1n, 'Text/Section001.xhtml', {
    displayCommandCount: 1,
  });
  assert.throws(() => decodeRitoReaderArtifactV1(mismatched), /metadata does not match RITODL1/);
});

test('resource decoder rejects a kind-specific oversized blob before slicing it', () => {
  const writer = ReaderWireWriterV1.message('RITORES1');
  writer.externalId(1n, 'artifact');
  writer.u32(0, 'image kind');
  writer.string('Images/cover.png', 'href');
  writer.string('image/png', 'media type');
  writer.u64(BigInt(32 * 1024 * 1024 + 1), 'resource bytes length');
  writer.option(undefined, () => {});
  writer.option(undefined, () => {});

  assert.throws(
    () => decodeRitoReaderResourceV1(writer.finish()),
    /resource bytes exceeds its operation byte limit/,
  );
});

function pendingExactPayload(requestValue) {
  return {
    kind: 'pending-exact',
    sessionId: requestValue.sessionId,
    requestId: requestValue.requestId,
  };
}

function pendingAdjacentPayload(requestValue) {
  return {
    kind: 'pending-adjacent',
    sessionId: requestValue.sessionId,
    requestId: requestValue.requestId,
    fromArtifactId: requestValue.fromArtifactId,
    direction: requestValue.direction,
  };
}

async function adoptClientForeground(worker, client, expectedVisibleArtifactId, candidate) {
  const adopting = client.adoptForegroundCandidate(expectedVisibleArtifactId, candidate.artifactId);
  await settle();
  const message = worker.take('adopt-foreground-candidate');
  assert.deepEqual(message.request, {
    sessionId: client.sessionId,
    expectedVisibleArtifactId,
    candidateArtifactId: candidate.artifactId,
  });
  worker.respond(message, {
    kind: 'foreground-handoff',
    wire: foregroundHandoffAckWire(
      candidate.requestId,
      expectedVisibleArtifactId,
      candidate.artifactId,
    ).buffer,
  });
  return adopting;
}

function request(href) {
  return { layout, locator: { href }, work, textProfile: 'platform-string-runs' };
}

function artifactWire(sessionId, requestId, artifactId, href, options = {}) {
  const writer = ReaderWireWriterV1.message('RITOART1');
  writer.u32(1, 'protocol');
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
  writer.bool(false);
  writer.u32(3, 'previous');
  writer.u32(3, 'next');
  writer.u32(0, 'text profile');
  writer.record((record) => {
    const display = displayWire(0);
    record.u32(1, 'display version');
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

function publicationWire(sessionId) {
  const writer = ReaderWireWriterV1.message('RITOPUB1');
  writer.u32(1, 'protocol');
  writer.externalId(sessionId, 'session');
  writer.record((record) => {
    record.string('Reader v1 Book', 'title');
    record.string('en', 'language');
    record.string('reader-v1-book', 'identifier');
    record.option('Rito', (creator) => record.string(creator, 'creator'));
  });
  writer.count(1, 'spine count');
  writer.record((record) => {
    record.u32(0, 'spine index');
    record.option(0, (linearIndex) => record.u32(linearIndex, 'linear index'));
    record.string('chapter', 'idref');
    record.string('Text/chapter.xhtml', 'href');
  });
  writer.count(1, 'TOC count');
  writer.record((record) => {
    record.u32(0, 'TOC ID');
    record.string('Chapter', 'TOC label');
    record.u8(0, 'locator target');
    record.u32(0, 'spine index');
    record.record((locator) => writeLocator(locator, { href: 'Text/chapter.xhtml' }));
    record.count(0, 'TOC children');
  });
  return writer.finish();
}

function displayWire(count, write = () => undefined) {
  const writer = new ReaderWireWriterV1();
  writer.raw(new TextEncoder().encode('RITODL1'));
  writer.u32(1, 'display version');
  writer.count(count, 'display commands');
  write(writer);
  return Uint8Array.from(writer.bytes);
}

function backgroundAdvanceWire(state, intentRequestId, replacesArtifactId, artifact) {
  const writer = ReaderWireWriterV1.message('RITOBGA1');
  writer.u32(state, 'state');
  writer.externalId(intentRequestId, 'intent');
  writer.externalId(replacesArtifactId, 'replaces');
  const bytes = artifact ?? new Uint8Array();
  writer.u64(BigInt(bytes.byteLength), 'artifact length');
  writer.raw(bytes);
  return writer.finish();
}

function handoffAckWire(intentRequestId, replacedArtifactId, visibleArtifactId) {
  const writer = ReaderWireWriterV1.message('RITOHOA1');
  writer.externalId(intentRequestId, 'intent');
  writer.externalId(replacedArtifactId, 'replaced');
  writer.externalId(visibleArtifactId, 'visible');
  return writer.finish();
}

function foregroundHandoffAckWire(
  intentRequestId,
  replacedArtifactId,
  visibleArtifactId,
  optionTag = replacedArtifactId === undefined ? 0 : 1,
  optionValue = replacedArtifactId ?? 0n,
) {
  const writer = ReaderWireWriterV1.message('RITOFGA1');
  writer.externalId(intentRequestId, 'intent');
  writer.u32(optionTag, 'replaced option tag');
  writer.u64(optionValue, 'replaced option value');
  writer.externalId(visibleArtifactId, 'visible');
  return writer.finish();
}

function artifactIdentity(requestValue, artifactId) {
  return {
    sessionId: requestValue.sessionId,
    requestId: requestValue.requestId,
    revisionId: 1n,
    revisionVersion: 1,
    artifactId,
  };
}

function writeLocator(writer, locator) {
  writer.string(locator.href, 'href');
  writer.option(undefined, () => undefined);
  writer.option(undefined, () => undefined);
  writer.option(undefined, () => undefined);
  writer.option(locator.progression, (value) => writer.f64(value, 'progression'));
}

function requestIdentity(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITOREQ1', 'magic');
  reader.u32('version');
  reader.u64('length');
  return { sessionId: reader.externalId('session'), requestId: reader.externalId('request') };
}

function requestWorkBudget(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITOREQ1', 'magic');
  reader.u32('version');
  reader.u64('length');
  reader.externalId('session');
  reader.externalId('request');
  reader.record('layout');
  reader.record('locator');
  const work = reader.record('work');
  return {
    maxTopLevelNodesPerQuantum: work.u32('top-level nodes'),
    maxForegroundQuanta: work.u32('foreground quanta'),
    localPageCap: work.u32('local page cap'),
  };
}

function adjacentRequestValue(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITONAV1', 'magic');
  reader.u32('version');
  reader.u64('length');
  const sessionId = reader.externalId('session');
  const requestId = reader.externalId('request');
  const fromArtifactId = reader.externalId('source');
  const directionTag = reader.u32('direction');
  // RITONAV1 is fixed-width: the work budget is three raw u32 fields.
  const requestWork = {
    maxTopLevelNodesPerQuantum: reader.u32('top-level nodes'),
    maxForegroundQuanta: reader.u32('foreground quanta'),
    localPageCap: reader.u32('local page cap'),
  };
  reader.finish('adjacent request');
  return {
    sessionId,
    requestId,
    fromArtifactId,
    direction: directionTag === 0 ? 'previous' : 'next',
    work: requestWork,
  };
}

function backgroundRequestIdentity(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITOBGQ1', 'magic');
  reader.u32('version');
  reader.u64('length');
  return {
    sessionId: reader.externalId('session'),
    expectedVisibleArtifactId: reader.externalId('visible'),
  };
}

function foregroundHandoffRequest(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITOFGH1', 'magic');
  reader.u32('version');
  reader.u64('length');
  const sessionId = reader.externalId('session');
  const optionTag = reader.u32('expected visible option tag');
  const optionValue = reader.u64('expected visible option value');
  const candidateArtifactId = reader.externalId('candidate');
  reader.finish('foreground handoff');
  assert.ok(optionTag === 0 || optionTag === 1);
  if (optionTag === 0) assert.equal(optionValue, 0n);
  else assert.notEqual(optionValue, 0n);
  return {
    sessionId,
    expectedVisibleArtifactId: optionTag === 0 ? undefined : optionValue,
    candidateArtifactId,
  };
}

function requestLocator(bytes) {
  const reader = new ReaderWireReaderV1(bytes);
  reader.expectMagic('RITOREQ1', 'magic');
  reader.u32('version');
  reader.u64('length');
  reader.externalId('session');
  reader.externalId('request');
  reader.record('layout');
  const locator = reader.record('locator');
  const href = locator.string('href');
  locator.option('anchor', () => locator.string('anchor'));
  locator.option('point', () => assert.fail('unexpected point'));
  locator.option('range', () => assert.fail('unexpected range'));
  const progression = locator.option('progression', () => locator.f64('progression'));
  return { href, progression };
}

function workerScope() {
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

function fakeWorker() {
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
          protocol: 'rito-reader-v1',
          id: requestMessage.id,
          ok: true,
          payload,
        },
      });
    },
    respondError(requestMessage, code, message) {
      listeners.get('message')({
        data: {
          protocol: 'rito-reader-v1',
          id: requestMessage.id,
          ok: false,
          error: { name: 'RitoReaderErrorV1', code, message },
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

async function settle() {
  for (let index = 0; index < 24; index += 1) await Promise.resolve();
}
