import { describe, expect, it } from 'vitest';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  assertProtocolSerializable,
  createInProcessReaderRuntimeTransport,
  createProtocolError,
  isCurrentRevisionResponse,
  isRevisionScopedResponse,
  type GetFootnoteCommand,
  type GetResourceCommand,
  type GetResourceResponse,
  type GetSpreadFrameCommand,
  type GetSpreadFrameResponse,
  type OpenSessionResponse,
  type PrefetchCommand,
  type ReaderRuntimeCommand,
  type ReaderRuntimeErrorResponse,
  type ReaderRuntimeResponse,
  type ReaderSpreadFrame,
  type ResolveLocatorGeometryCommand,
  type ResolveLocatorCommand,
  type SearchCommand,
} from '../../src/runtime/reader-session';
import {
  readProtocolFixtures,
  replayJson,
  type RuntimeProtocolFixtureScenario,
} from '../helpers/reader-runtime-fixtures';

const locator = {
  href: 'Text/chapter-1.xhtml',
  mediaType: 'application/xhtml+xml',
  progression: 0.25,
  totalProgression: 0.1,
  position: 42,
  sourceRange: { start: 10, end: 18 },
};

function frame(revisionId = 'rev-1'): ReaderSpreadFrame {
  return {
    sessionId: 'session-1',
    revisionId,
    spreadIndex: 2,
    pageIndexes: [4, 5],
    viewport: { width: 800, height: 600 },
    displayList: { width: 800, height: 600, commands: [] },
    textRuns: [
      {
        rect: { x: 40, y: 80, width: 120, height: 20 },
        text: 'highlight',
        locator,
        sourceTextOffset: 10,
      },
    ],
    targets: [
      {
        kind: 'link',
        rect: { x: 40, y: 80, width: 120, height: 20 },
        locator,
        href: 'chapter-2.xhtml',
        label: 'chapter link',
      },
    ],
    resourceRefs: [
      {
        id: 'image-1',
        kind: 'image',
        href: 'Images/cover.jpg',
        mediaType: 'image/jpeg',
      },
    ],
    primaryLocator: locator,
  };
}

describe('reader session protocol', () => {
  it('uses one explicit protocol version constant', () => {
    expect(READER_RUNTIME_PROTOCOL_VERSION).toBe(1);
  });

  it('does not require revisionId on session-scoped responses', () => {
    const response: OpenSessionResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-1',
      kind: 'openSession',
      ok: true,
      sessionId: 'session-1',
      payload: {
        publication: {
          metadata: {
            title: 'Book',
            language: 'en',
            identifier: 'book-id',
          },
          spineItemCount: 12,
        },
      },
    };

    expect(isRevisionScopedResponse(response)).toBe(false);
    expect(isCurrentRevisionResponse(response, 'rev-1')).toBe(true);
    expect(() => {
      assertProtocolSerializable(response);
    }).not.toThrow();
  });

  it('treats frame responses as revision-scoped and rejects stale revisions', () => {
    const response: GetSpreadFrameResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-2',
      kind: 'getSpreadFrame',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { frame: frame('rev-1') },
    };

    expect(isRevisionScopedResponse(response)).toBe(true);
    expect(isCurrentRevisionResponse(response, 'rev-1')).toBe(true);
    expect(isCurrentRevisionResponse(response, 'rev-2')).toBe(false);
  });

  it('keeps command routing ids on the envelope, not operation payloads', () => {
    const commands: readonly (
      | ResolveLocatorCommand
      | GetSpreadFrameCommand
      | PrefetchCommand
      | SearchCommand
      | GetFootnoteCommand
      | ResolveLocatorGeometryCommand
      | GetResourceCommand
    )[] = [
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-locator',
        kind: 'resolveLocator',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { locator },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-geometry',
        kind: 'resolveLocatorGeometry',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { locator },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-frame',
        kind: 'getSpreadFrame',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { spreadIndex: 3 },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-prefetch',
        kind: 'prefetch',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { spreadIndexes: [2, 4] },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-search',
        kind: 'search',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { query: 'term', limit: 20 },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-footnote',
        kind: 'getFootnote',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: { ref: { href: 'Text/chapter-1.xhtml#fn1' } },
      },
      {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'request-resource',
        kind: 'getResource',
        sessionId: 'session-1',
        revisionId: 'rev-1',
        payload: {
          resource: {
            id: 'image-1',
            kind: 'image',
            href: 'Images/cover.jpg',
            mediaType: 'image/jpeg',
          },
        },
      },
    ];

    for (const command of commands) {
      expect('sessionId' in command.payload).toBe(false);
      expect('revisionId' in command.payload).toBe(false);
      expect(() => {
        assertProtocolSerializable(command);
      }).not.toThrow();
    }
  });

  it('treats revision-bound errors as stale when their revision is no longer active', () => {
    const response: ReaderRuntimeErrorResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-3',
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      revisionId: 'rev-old',
      error: createProtocolError('stale-revision', 'Revision is no longer active', {
        details: { activeRevisionId: 'rev-new' },
      }),
    };

    expect(isRevisionScopedResponse(response)).toBe(true);
    expect(isCurrentRevisionResponse(response, 'rev-new')).toBe(false);
    expect(() => {
      assertProtocolSerializable(response);
    }).not.toThrow();
  });

  it('allows structured session-scoped errors without a revisionId', () => {
    const response: ReaderRuntimeErrorResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-4',
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      error: createProtocolError('bad-request', 'Missing layout request'),
    };

    expect(isRevisionScopedResponse(response)).toBe(false);
    expect(isCurrentRevisionResponse(response, 'rev-1')).toBe(true);
    expect(response.error).toEqual({ code: 'bad-request', message: 'Missing layout request' });
  });

  it('keeps resource responses as control payloads with refs, not bytes', () => {
    const response: GetResourceResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-5',
      kind: 'getResource',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        resource: {
          id: 'font-1',
          kind: 'font',
          href: 'Fonts/Book.otf',
          mediaType: 'font/otf',
        },
        byteLength: 4096,
        transferId: 'transfer-1',
        mediaType: 'font/otf',
      },
    };

    expect(() => {
      assertProtocolSerializable(response);
    }).not.toThrow();
    expect(isRevisionScopedResponse(response)).toBe(true);
    expect(isCurrentRevisionResponse(response, 'rev-1')).toBe(true);
    expect(isCurrentRevisionResponse(response, 'rev-2')).toBe(false);
    expect('bytes' in response.payload).toBe(false);
    expect(Object.values(response.payload).some((value) => value instanceof Uint8Array)).toBe(
      false,
    );
  });

  it('requires runtime control payloads to be JSON-safe', () => {
    const response: ReaderRuntimeResponse = {
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-6',
      kind: 'getSpreadFrame',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { frame: frame('rev-1') },
    };

    expect(() => {
      assertProtocolSerializable(response);
    }).not.toThrow();
    expect(JSON.parse(JSON.stringify(response))).toMatchObject({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'request-6',
      revisionId: 'rev-1',
    });
  });

  it('rejects functions, binary objects, class instances, and undefined values in control payloads', () => {
    class NotWireSafe {
      readonly value = 'x';
    }

    expect(() => {
      assertProtocolSerializable({ callback: () => undefined });
    }).toThrow(/non-JSON value/);
    expect(() => {
      assertProtocolSerializable({ bytes: new Uint8Array([1, 2, 3]) });
    }).toThrow(/plain JSON object/);
    expect(() => {
      assertProtocolSerializable({ instance: new NotWireSafe() });
    }).toThrow(/plain JSON object/);
    expect(() => {
      assertProtocolSerializable({ missing: undefined });
    }).toThrow(/non-JSON value/);
  });

  it('rejects circular control payloads', () => {
    const payload: { child?: unknown } = {};
    payload.child = payload;

    expect(() => {
      assertProtocolSerializable(payload);
    }).toThrow(/circular/);
  });

  it('replays fixed success and structured-error fixtures without executing the runtime dispatcher', async () => {
    const fixtures = readProtocolFixtures();

    for (const scenario of [...fixtures.successPath, ...fixtures.structuredErrors]) {
      const response = await replayFixtureScenario(scenario);
      expect(response).toEqual(scenario.response);
      expect(() => {
        assertProtocolSerializable({ command: scenario.command, response });
      }).not.toThrow();
    }
  });

  it('covers every supported runtime command kind in fixed success fixtures', () => {
    const fixtures = readProtocolFixtures();
    const covered = new Set(fixtures.successPath.map((scenario) => scenario.command.kind));
    const expected = [
      'openSession',
      'createRevision',
      'cancelRevision',
      'resolveLocator',
      'resolveLocatorGeometry',
      'getSpreadFrame',
      'prefetch',
      'search',
      'getFootnote',
      'getResource',
      'closeSession',
    ] satisfies readonly ReaderRuntimeCommand['kind'][];

    expect([...covered].sort()).toEqual([...expected].sort());
  });

  it('rejects fixed malformed and stale-envelope fixtures during replay', async () => {
    const fixtures = readProtocolFixtures();

    for (const scenario of fixtures.malformedOrStaleEnvelopes) {
      await expect(replayFixtureScenario(scenario)).rejects.toMatchObject({
        protocolError: { code: scenario.expectedErrorCode },
      });
    }
  });
});

async function replayFixtureScenario(
  scenario: RuntimeProtocolFixtureScenario,
): Promise<ReaderRuntimeResponse> {
  const transport = createInProcessReaderRuntimeTransport({
    handleCommand(command) {
      expect(command).toEqual(scenario.command);
      return Promise.resolve(replayJson(scenario.response));
    },
  });
  return transport.post(replayJson(scenario.command));
}
