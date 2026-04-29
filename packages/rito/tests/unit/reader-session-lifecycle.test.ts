// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  BASE_REQUEST,
  frameFromInput,
  makePage,
  paginationResult,
  testSession,
} from './reader-session-test-utils';

describe('createReaderSession revision lifecycle', () => {
  it('keeps in-flight revisions warming and preserves cancellation over late pagination', async () => {
    const pendingPagination = deferred<ReturnType<typeof paginationResult>>();
    const session = testSession({
      paginateRevision: () => pendingPagination.promise,
      buildFrame: frameFromInput,
    });

    const pendingRevision = session.createRevision(BASE_REQUEST);
    await Promise.resolve();

    expect(session.getRevision('rev-1')?.status).toBe('warming');

    session.cancelRevision('rev-1');
    pendingPagination.resolve(paginationResult([makePage(0)]));

    await expect(pendingRevision).resolves.toMatchObject({
      id: 'rev-1',
      status: 'cancelled',
    });
    expect(session.getRevision('rev-1')?.status).toBe('cancelled');
    await expect(
      session.getSpreadFrame({ revisionId: 'rev-1', spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: { code: 'cancelled' },
    });
  });

  it('does not start pagination after a warming revision is cancelled during font setup', async () => {
    const pendingFonts = deferred<undefined>();
    const calls: string[] = [];
    const session = testSession({
      registerFonts: () => pendingFonts.promise,
      paginateRevision: () => {
        calls.push('paginate');
        return paginationResult([makePage(0)]);
      },
    });

    const pendingRevision = session.createRevision(BASE_REQUEST);
    await Promise.resolve();

    session.cancelRevision('rev-1');
    pendingFonts.resolve(undefined);

    await expect(pendingRevision).resolves.toMatchObject({
      id: 'rev-1',
      status: 'cancelled',
    });
    expect(calls).toEqual([]);
  });

  it('rejects in-flight revision creation when disposed during font setup', async () => {
    const pendingFonts = deferred<undefined>();
    const calls: string[] = [];
    const session = testSession({
      registerFonts: () => pendingFonts.promise,
      paginateRevision: () => {
        calls.push('paginate');
        return paginationResult([makePage(0)]);
      },
    });

    const pendingRevision = session.createRevision(BASE_REQUEST);
    await Promise.resolve();

    session.dispose();
    pendingFonts.resolve(undefined);

    await expect(pendingRevision).rejects.toMatchObject({
      protocolError: { code: 'bad-request' },
    });
    expect(calls).toEqual([]);
  });

  it('rejects in-flight revision creation when disposed during pagination', async () => {
    const pendingPagination = deferred<ReturnType<typeof paginationResult>>();
    const session = testSession({
      paginateRevision: () => pendingPagination.promise,
    });

    const pendingRevision = session.createRevision(BASE_REQUEST);
    await Promise.resolve();

    session.dispose();
    pendingPagination.resolve(paginationResult([makePage(0)]));

    await expect(pendingRevision).rejects.toMatchObject({
      protocolError: { code: 'bad-request' },
    });
  });

  it('registers publication fonts once before creating revisions', async () => {
    const calls: string[] = [];
    const session = testSession({
      registerFonts(input) {
        calls.push(`fonts:${input.sessionId}`);
        return Promise.resolve().then(() => {
          calls.push('fonts-ready');
        });
      },
      paginateRevision: () => {
        calls.push('paginate');
        return paginationResult([makePage(0)]);
      },
    });

    const first = await session.createRevision(BASE_REQUEST);
    const second = await session.createRevision(BASE_REQUEST);

    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    expect(calls).toEqual(['fonts:session-1', 'fonts-ready', 'paginate', 'paginate']);
  });

  it('turns font registration failures into failed revisions without paginating', async () => {
    const calls: string[] = [];
    const session = testSession({
      registerFonts: () => {
        throw new Error('font registration failed');
      },
      paginateRevision: () => {
        calls.push('paginate');
        return paginationResult([makePage(0)]);
      },
    });

    const revision = await session.createRevision(BASE_REQUEST);

    expect(revision.status).toBe('failed');
    expect(calls).toEqual([]);
    await expect(
      session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: {
        code: 'internal-error',
        details: { cause: 'font registration failed' },
      },
    });
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolveValue: (value: T) => void = () => undefined;
  let rejectValue: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}
