import { describe, expect, it, vi } from 'vitest';
import {
  describeForLog,
  openReaderEventLog,
  readerEventLogEntries,
  recordReaderLogger,
  recordReaderSession,
} from '../../src/bindings/browser/reader-event-log';

/** The entries one log wrote, without the clock. */
function written(reader: number) {
  return readerEventLogEntries()
    .filter((entry) => entry.reader === reader)
    .map(({ at: _at, reader: _reader, ...rest }) => rest);
}

function lastReader(): number {
  const entries = readerEventLogEntries();
  return entries[entries.length - 1]?.reader ?? 0;
}

describe('reader event log', () => {
  it('writes a request when it is sent and closes it when it is answered', async () => {
    const log = openReaderEventLog();
    let answer!: (value: unknown) => void;
    const session = recordReaderSession(
      {
        sessionId: 7n,
        peekSpread: (_from: bigint, _spread: number) =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
      log,
    );
    const reader = (log.note('opened'), lastReader());

    const pending = session.peekSpread(11n, 4);
    expect(written(reader)).toEqual([
      { kind: 'opened' },
      { kind: 'peekSpread', detail: '[11, 4]', pending: true },
    ]);

    answer({ artifactId: 12n, localSpreadIndex: 4, pages: [{}, {}], bytes: new Uint8Array(900) });
    await pending;
    const [, request] = written(reader);
    expect(request?.result).toBe(
      '{artifactId: 12, localSpreadIndex: 4, pages: [2], bytes: <900 bytes>}',
    );
    expect(request?.ms).toBeGreaterThanOrEqual(0);
    expect(request?.failed).toBeUndefined();
    expect(session.sessionId).toBe(7n);
  });

  it('hands back the promise the session returned, so nothing awaited moves', () => {
    const promise = Promise.resolve(1);
    const session = recordReaderSession({ turn: () => promise }, openReaderEventLog());

    expect(session.turn()).toBe(promise);
    expect(session.turn).toBe(session.turn);
  });

  it('keeps a refused request with the reason it was refused', async () => {
    const log = openReaderEventLog();
    const refused = Object.assign(new Error('artifact 9 is not live'), {
      name: 'RitoReaderError',
      code: 'unknown-artifact',
    });
    const session = recordReaderSession({ readFootnote: () => Promise.reject(refused) }, log);

    await expect(session.readFootnote()).rejects.toBe(refused);
    await Promise.resolve();

    expect(written(lastReader())).toEqual([
      {
        kind: 'readFootnote',
        ms: expect.any(Number) as number,
        result: 'RitoReaderError(unknown-artifact): artifact 9 is not live',
        failed: true,
      },
    ]);
  });

  it('counts a request repeated with the same arguments on one entry', async () => {
    const log = openReaderEventLog();
    const session = recordReaderSession(
      { advanceBackgroundOnce: (_visible: bigint) => Promise.resolve({ complete: false }) },
      log,
    );

    await session.advanceBackgroundOnce(3n);
    await session.advanceBackgroundOnce(3n);
    await session.advanceBackgroundOnce(3n);
    await session.advanceBackgroundOnce(4n);
    await Promise.resolve();

    expect(
      written(lastReader()).map(({ kind, detail, times }) => ({ kind, detail, times })),
    ).toEqual([
      { kind: 'advanceBackgroundOnce', detail: '3', times: 3 },
      { kind: 'advanceBackgroundOnce', detail: '4', times: undefined },
    ]);
  });

  it('keeps what a reader warned of beside what it asked', () => {
    const log = openReaderEventLog();
    const warn = vi.fn();
    const logger = recordReaderLogger({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }, log);

    logger.warn('reader spread load failed', new Error('worker gone'));

    expect(warn).toHaveBeenCalledOnce();
    expect(written(lastReader())).toEqual([
      { kind: 'warn', detail: '"reader spread load failed Error: worker gone"' },
    ]);
  });

  it('numbers the readers of a page and keeps their entries apart', () => {
    const first = openReaderEventLog();
    first.note('commit', { scope: 'chapter' });
    const one = lastReader();
    const second = openReaderEventLog();
    second.note('commit', { scope: 'book' });

    expect(lastReader()).toBe(one + 1);
    expect(written(one)).toEqual([{ kind: 'commit', detail: '{scope: "chapter"}' }]);
  });

  it('describes a value by its numbers and sizes, never by a book’s content', () => {
    expect(
      describeForLog({ href: 'ch1.xhtml', progression: 0.123456, bytes: new ArrayBuffer(8) }),
    ).toBe('{href: "ch1.xhtml", progression: 0.1, bytes: <8 bytes>}');
    expect(describeForLog('x'.repeat(200))).toHaveLength(96 + 3);
    expect(describeForLog([1, 2, 3])).toBe('[1, 2, 3]');
    expect(describeForLog(Array.from({ length: 40 }, () => 'text'))).toBe('[40]');
    expect(describeForLog({ a: { b: { c: { d: 1 } } } })).toBe('{a: {b: {…}}}');
  });
});
