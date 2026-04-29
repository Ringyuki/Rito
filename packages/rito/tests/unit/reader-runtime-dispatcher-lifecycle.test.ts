import { describe, expect, it } from 'vitest';
import type { PaginationResult } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createReaderRuntimeDispatcher,
} from '../../src/runtime/reader-session';
import {
  LAYOUT,
  baseDeps,
  deferred,
  expectSerializable,
  makePage,
  openCommand,
  paginationResult,
} from './reader-runtime-dispatcher-test-utils';

describe('createReaderRuntimeDispatcher revision lifecycle', () => {
  it('returns an error when closeSession disposes an in-flight createRevision', async () => {
    const paginationStarted = deferred<undefined>();
    const pendingPagination = deferred<PaginationResult>();
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        paginateRevision: () => {
          paginationStarted.resolve(undefined);
          return pendingPagination.promise;
        },
      }),
    );
    await dispatcher.handleCommand(openCommand());

    const createRevision = dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-in-flight',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });
    await paginationStarted.promise;
    const close = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'close-during-revision',
      kind: 'closeSession',
      sessionId: 'session-1',
    });
    pendingPagination.resolve(paginationResult([makePage(0)]));
    const revision = await createRevision;

    expect(close).toMatchObject({
      kind: 'closeSession',
      ok: true,
      sessionId: 'session-1',
    });
    expect(revision).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'revision-in-flight',
      sessionId: 'session-1',
      error: { code: 'bad-request' },
    });
    expectSerializable(revision);
  });
});
