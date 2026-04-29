import { describe, expect, it } from 'vitest';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  assertProtocolSerializable,
  createProtocolError,
  createReaderRuntimeClient,
  type DispatchReaderRuntimeCommand,
  type GetSpreadFrameResponse,
  type OpenSessionResponse,
  type ReaderLocator,
  type ReaderPublication,
  type ReaderFootnotePayload,
  type ReaderResourcePayload,
  type ReaderResourceRef,
  type ReaderRevision,
  type ReaderRuntimeCommand,
  type ReaderRuntimeRequestId,
  type ReaderRuntimeResponse,
  type ReaderSessionId,
  type ReaderSpreadFrame,
} from '../../src/runtime/reader-session';

const LAYOUT = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single' as const,
  margin: 20,
};

const PUBLICATION: ReaderPublication = {
  metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
  spineItemCount: 1,
};

const LOCATOR: ReaderLocator = {
  href: 'page:0',
  mediaType: 'application/xhtml+xml',
  progression: 0,
};

const RESOURCE: ReaderResourceRef = {
  id: 'cover',
  kind: 'image',
  href: 'Images/cover.png',
  mediaType: 'image/png',
};

function requestIds(...ids: readonly ReaderRuntimeRequestId[]): () => ReaderRuntimeRequestId {
  let index = 0;
  return () => ids[index++] ?? `request-extra-${String(index)}`;
}

function revision(id: string, sessionId: ReaderSessionId = 'session-1'): ReaderRevision {
  return {
    id,
    sessionId,
    layoutKey: `layout-${id}`,
    status: 'ready',
    knownSpreadCount: 1,
    finalSpreadCount: 1,
    createdAt: 1,
  };
}

function frame(revisionId: string): ReaderSpreadFrame {
  return {
    sessionId: 'session-1',
    revisionId,
    spreadIndex: 0,
    pageIndexes: [0],
    viewport: { width: 400, height: 600 },
    displayList: { width: 400, height: 600, commands: [] },
    textRuns: [],
    targets: [],
    resourceRefs: [RESOURCE],
    primaryLocator: LOCATOR,
  };
}

function resourcePayload(): ReaderResourcePayload {
  return {
    resource: RESOURCE,
    byteLength: 3,
    transferId: 'transfer-cover',
    mediaType: 'image/png',
  };
}

function footnotePayload(): ReaderFootnotePayload {
  return {
    ref: { href: 'chapter.xhtml#fn1' },
    footnote: {
      kind: 'footnote',
      text: 'Footnote text',
      html: '<p>Footnote text</p>',
    },
  };
}

function openSuccess(command: ReaderRuntimeCommand): OpenSessionResponse {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    kind: 'openSession',
    ok: true,
    sessionId: 'session-1',
    payload: { publication: PUBLICATION },
  };
}

function protocolErrorResponse(command: ReaderRuntimeCommand): ReaderRuntimeResponse {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    kind: 'error',
    ok: false,
    ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    ...(command.revisionId !== undefined ? { revisionId: command.revisionId } : {}),
    error: createProtocolError('not-found', 'not found'),
  };
}

function expectClientError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: 'ReaderRuntimeClientError',
    protocolError: { code },
  });
}

function controlledDispatch(): {
  readonly commands: ReaderRuntimeCommand[];
  readonly dispatch: DispatchReaderRuntimeCommand;
  readonly resolve: (requestId: ReaderRuntimeRequestId, response: ReaderRuntimeResponse) => void;
} {
  const commands: ReaderRuntimeCommand[] = [];
  const resolvers = new Map<ReaderRuntimeRequestId, (response: ReaderRuntimeResponse) => void>();
  return {
    commands,
    dispatch(command) {
      commands.push(command);
      return new Promise<ReaderRuntimeResponse>((resolve) => {
        resolvers.set(command.requestId, resolve);
      });
    },
    resolve(requestId, response) {
      const resolve = resolvers.get(requestId);
      if (!resolve) throw new Error(`No pending command ${requestId}`);
      resolvers.delete(requestId);
      resolve(response);
    },
  };
}

describe('createReaderRuntimeClient', () => {
  it('sends protocol commands and consumes success payloads', async () => {
    const commands: ReaderRuntimeCommand[] = [];
    const client = createReaderRuntimeClient({
      createRequestId: requestIds(
        'open-1',
        'rev-1',
        'frame-1',
        'loc-1',
        'geom-1',
        'res-1',
        'prefetch-1',
        'search-1',
        'footnote-1',
        'cancel-1',
        'close-1',
      ),
      dispatch(command) {
        commands.push(command);
        switch (command.kind) {
          case 'openSession':
            return Promise.resolve(openSuccess(command));
          case 'createRevision':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'createRevision',
              ok: true,
              sessionId: command.sessionId,
              revisionId: 'revision-1',
              payload: { revision: revision('revision-1') },
            });
          case 'getSpreadFrame':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'getSpreadFrame',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: { frame: frame(command.revisionId) },
            });
          case 'resolveLocator':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'resolveLocator',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: {
                locator: LOCATOR,
                revisionId: command.revisionId,
                spreadIndex: 0,
                pageIndex: 0,
              },
            });
          case 'resolveLocatorGeometry':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'resolveLocatorGeometry',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: {
                locator: command.payload.locator,
                revisionId: command.revisionId,
                segments: [{ pageIndex: 0, spreadIndex: 0, rects: [] }],
              },
            });
          case 'getResource':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'getResource',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: resourcePayload(),
            });
          case 'prefetch':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'prefetch',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: { spreadIndexes: [0] },
            });
          case 'search':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'search',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: {
                results: [{ locator: LOCATOR, snippet: 'Chapter one.', rects: [] }],
                hasMore: false,
              },
            });
          case 'getFootnote':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'getFootnote',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: footnotePayload(),
            });
          case 'cancelRevision':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'cancelRevision',
              ok: true,
              sessionId: command.sessionId,
              revisionId: command.revisionId,
              payload: { cancelled: true },
            });
          case 'closeSession':
            return Promise.resolve({
              protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
              requestId: command.requestId,
              kind: 'closeSession',
              ok: true,
              sessionId: command.sessionId,
              payload: { closed: true },
            });
        }
      },
    });

    expect(await client.openSession('book.epub')).toEqual(PUBLICATION);
    expect(client.sessionId).toBe('session-1');
    expect((await client.createRevision(LAYOUT)).id).toBe('revision-1');
    expect(client.activeRevisionId).toBe('revision-1');
    expect((await client.getSpreadFrame({ spreadIndex: 0 })).revisionId).toBe('revision-1');
    expect((await client.resolveLocator({ locator: LOCATOR })).revisionId).toBe('revision-1');
    const geometry = await client.resolveLocatorGeometry({ locator: LOCATOR });
    const resource = await client.getResource({ resource: RESOURCE });
    const prefetched = await client.prefetch({ spreadIndexes: [0, 1] });
    const search = await client.search({ query: 'Chapter', limit: 1 });
    const footnote = await client.getFootnote({ ref: { href: 'chapter.xhtml#fn1' } });
    await client.cancelRevision();
    await client.close();

    expect(resource).toEqual(resourcePayload());
    expect(geometry).toMatchObject({ revisionId: 'revision-1', segments: [{ pageIndex: 0 }] });
    expect(resource).not.toHaveProperty('bytes');
    expect(prefetched).toEqual([0]);
    expect(search.results).toHaveLength(1);
    expect(footnote).toEqual(footnotePayload());
    expect(commands.map((command) => command.requestId)).toEqual([
      'open-1',
      'rev-1',
      'frame-1',
      'loc-1',
      'geom-1',
      'res-1',
      'prefetch-1',
      'search-1',
      'footnote-1',
      'cancel-1',
      'close-1',
    ]);
    expect(commands.map((command) => runtimeProtocolVersion(command))).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it('does not save session state when openSession returns an error', async () => {
    const commands: ReaderRuntimeCommand[] = [];
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1'),
      dispatch(command) {
        commands.push(command);
        return Promise.resolve(protocolErrorResponse(command));
      },
    });

    await expectClientError(client.openSession('book.epub'), 'not-found');

    expect(client.sessionId).toBeUndefined();
    expect(client.activeRevisionId).toBeUndefined();
    expect(commands).toHaveLength(1);
  });

  it('keeps only the latest out-of-order createRevision response active', async () => {
    const runtime = controlledDispatch();
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1', 'create-2'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        return runtime.dispatch(command);
      },
    });
    await client.openSession('book.epub');

    const first = client.createRevision(LAYOUT);
    const second = client.createRevision({ ...LAYOUT, margin: 24 });
    runtime.resolve('create-2', {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'create-2',
      kind: 'createRevision',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'revision-2',
      payload: { revision: revision('revision-2') },
    });
    await expect(second).resolves.toMatchObject({ id: 'revision-2' });
    runtime.resolve('create-1', {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'create-1',
      kind: 'createRevision',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'revision-1',
      payload: { revision: revision('revision-1') },
    });

    await expectClientError(first, 'stale-revision');
    expect(client.activeRevisionId).toBe('revision-2');
  });

  it('rejects stale revision-scoped responses when active revision changes', async () => {
    const runtime = controlledDispatch();
    let createCount = 0;
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1', 'frame-1', 'create-2'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        if (command.kind === 'createRevision') {
          createCount++;
          const revisionId = `revision-${String(createCount)}`;
          return Promise.resolve({
            protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            kind: 'createRevision',
            ok: true,
            sessionId: command.sessionId,
            revisionId,
            payload: { revision: revision(revisionId) },
          });
        }
        return runtime.dispatch(command);
      },
    });
    await client.openSession('book.epub');
    await client.createRevision(LAYOUT);
    const staleFrame = client.getSpreadFrame({ spreadIndex: 0 });
    await client.createRevision({ ...LAYOUT, margin: 24 });
    runtime.resolve('frame-1', {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'frame-1',
      kind: 'getSpreadFrame',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'revision-1',
      payload: { frame: frame('revision-1') },
    } satisfies GetSpreadFrameResponse);

    await expectClientError(staleFrame, 'stale-revision');
    expect(client.activeRevisionId).toBe('revision-2');
  });

  it('rejects malformed envelopes and does not update state', async () => {
    const badOpenClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1'),
      dispatch(command) {
        return Promise.resolve({ ...openSuccess(command), requestId: 'wrong-request' });
      },
    });
    await expectClientError(badOpenClient.openSession('book.epub'), 'bad-request');
    expect(badOpenClient.sessionId).toBeUndefined();

    const missingOpenSessionClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1'),
      dispatch(command) {
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'openSession',
          ok: true,
          payload: { publication: PUBLICATION },
        } as unknown as ReaderRuntimeResponse);
      },
    });
    await expectClientError(missingOpenSessionClient.openSession('book.epub'), 'bad-request');
    expect(missingOpenSessionClient.sessionId).toBeUndefined();

    const invalidOpenSessionClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1'),
      dispatch(command) {
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'openSession',
          ok: true,
          sessionId: 123,
          payload: { publication: PUBLICATION },
        } as unknown as ReaderRuntimeResponse);
      },
    });
    await expectClientError(invalidOpenSessionClient.openSession('book.epub'), 'bad-request');
    expect(invalidOpenSessionClient.sessionId).toBeUndefined();

    const missingSessionClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'createRevision',
          ok: true,
          revisionId: 'revision-1',
          payload: { revision: revision('revision-1') },
        } as unknown as ReaderRuntimeResponse);
      },
    });
    await missingSessionClient.openSession('book.epub');
    await expectClientError(missingSessionClient.createRevision(LAYOUT), 'bad-request');
    expect(missingSessionClient.activeRevisionId).toBeUndefined();

    const missingRevisionClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'createRevision',
          ok: true,
          sessionId: command.sessionId,
          payload: { revision: revision('revision-1') },
        } as unknown as ReaderRuntimeResponse);
      },
    });
    await missingRevisionClient.openSession('book.epub');
    await expectClientError(missingRevisionClient.createRevision(LAYOUT), 'bad-request');
    expect(missingRevisionClient.activeRevisionId).toBeUndefined();

    const invalidRevisionClient = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'createRevision',
          ok: true,
          sessionId: command.sessionId,
          revisionId: '',
          payload: { revision: revision('revision-1') },
        } as unknown as ReaderRuntimeResponse);
      },
    });
    await invalidRevisionClient.openSession('book.epub');
    await expectClientError(invalidRevisionClient.createRevision(LAYOUT), 'bad-request');
    expect(invalidRevisionClient.activeRevisionId).toBeUndefined();
  });

  it('rejects malformed revision-scoped envelopes', async () => {
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1', 'frame-1'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        if (command.kind === 'createRevision') {
          return Promise.resolve({
            protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            kind: 'createRevision',
            ok: true,
            sessionId: command.sessionId,
            revisionId: 'revision-1',
            payload: { revision: revision('revision-1') },
          });
        }
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'getSpreadFrame',
          ok: true,
          sessionId: command.sessionId,
          payload: { frame: frame('revision-1') },
        } as unknown as ReaderRuntimeResponse);
      },
    });

    await client.openSession('book.epub');
    await client.createRevision(LAYOUT);

    await expectClientError(client.getSpreadFrame({ spreadIndex: 0 }), 'bad-request');
    expect(client.activeRevisionId).toBe('revision-1');
  });

  it('rejects geometry payload revision ids that disagree with the envelope', async () => {
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1', 'geometry-1'),
      dispatch(command) {
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        if (command.kind === 'createRevision') {
          return Promise.resolve({
            protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            kind: 'createRevision',
            ok: true,
            sessionId: command.sessionId,
            revisionId: 'revision-1',
            payload: { revision: revision('revision-1') },
          });
        }
        return Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'resolveLocatorGeometry',
          ok: true,
          sessionId: command.sessionId,
          revisionId: command.revisionId,
          payload: {
            locator: LOCATOR,
            revisionId: 'revision-old',
            segments: [],
          },
        } as unknown as ReaderRuntimeResponse);
      },
    });

    await client.openSession('book.epub');
    await client.createRevision(LAYOUT);

    await expectClientError(client.resolveLocatorGeometry({ locator: LOCATOR }), 'bad-request');
    expect(client.activeRevisionId).toBe('revision-1');
  });

  it('clears local state on close and prevents later dispatch', async () => {
    const commands: ReaderRuntimeCommand[] = [];
    const client = createReaderRuntimeClient({
      createRequestId: requestIds('open-1', 'create-1', 'close-1', 'after-close'),
      dispatch(command) {
        commands.push(command);
        if (command.kind === 'openSession') return Promise.resolve(openSuccess(command));
        if (command.kind === 'createRevision') {
          return Promise.resolve({
            protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            kind: 'createRevision',
            ok: true,
            sessionId: command.sessionId,
            revisionId: 'revision-1',
            payload: { revision: revision('revision-1') },
          });
        }
        return Promise.resolve(protocolErrorResponse(command));
      },
    });
    await client.openSession('book.epub');
    await client.createRevision(LAYOUT);

    await client.close();
    const dispatchedAfterClose = commands.length;
    await expectClientError(client.getSpreadFrame({ spreadIndex: 0 }), 'bad-request');

    expect(client.sessionId).toBeUndefined();
    expect(client.activeRevisionId).toBeUndefined();
    expect(commands).toHaveLength(dispatchedAfterClose);
    for (const command of commands) {
      expect(() => {
        assertProtocolSerializable(command);
      }).not.toThrow();
    }
  });
});

function runtimeProtocolVersion(command: ReaderRuntimeCommand): unknown {
  return (command as { readonly protocolVersion?: unknown }).protocolVersion;
}
