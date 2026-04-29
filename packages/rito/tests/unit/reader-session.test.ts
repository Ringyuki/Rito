// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { loadEpub } from '../../src/runtime/load-epub';
import { ReaderSessionError } from '../../src/runtime/reader-session/session';
import { createReaderRevisionRecord } from '../../src/runtime/reader-session/revision';
import type { BuildReaderSpreadFrameInput } from '../../src/runtime/reader-session/frame';
import type { ReaderRevisionId } from '../../src/runtime/reader-session/types';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import {
  BASE_REQUEST,
  frameFromInput,
  locator,
  makeLoadedDocument,
  makePage,
  paginationResult,
  resource,
  testSession,
  xhtml,
} from './reader-session-test-utils';

describe('createReaderSession', () => {
  it('keeps pagination metadata on ready revision records', () => {
    const pages = [makePage(0), makePage(1)];
    const chapterMap = new Map([
      ['ch1', { startPage: 0, endPage: 0 }],
      ['ch2', { startPage: 1, endPage: 1 }],
    ]);
    const anchorMap = new Map([['intro', 0]]);
    const chapterTextIndices = new Map<string, never>();
    const footnoteMap = new Map<string, never>();

    const record = createReaderRevisionRecord({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      request: BASE_REQUEST,
      document: makeLoadedDocument(),
      measurer: createMockTextMeasurer(),
      createdAt: 1000,
      paginateRevision: () => ({
        pages,
        chapterMap,
        anchorMap,
        chapterTextIndices,
        footnoteMap,
      }),
    });

    expect(record.revision.status).toBe('ready');
    expect(record.pagination?.pages).toBe(pages);
    expect(record.pagination?.chapterMap).toBe(chapterMap);
    expect(record.pagination?.anchorMap).toBe(anchorMap);
    expect(record.pagination?.chapterTextIndices).toBe(chapterTextIndices);
    expect(record.pagination?.footnoteMap).toBe(footnoteMap);
  });

  it('creates ready revisions with deterministic ids, layout keys, and spread counts', async () => {
    const session = testSession();

    const revision = await session.createRevision(BASE_REQUEST);

    expect(revision).toMatchObject({
      id: 'rev-1',
      sessionId: 'session-1',
      status: 'ready',
      knownSpreadCount: 2,
      finalSpreadCount: 2,
      createdAt: 1000,
    });
    expect(revision.layoutKey).toBe(
      JSON.stringify({
        viewport: { width: 400, height: 600 },
        spreadMode: 'single',
        margin: 20,
        lineBreaking: null,
        typography: {
          fontSize: null,
          lineHeight: null,
          lineHeightForce: null,
          fontFamily: null,
          fontFamilyForce: null,
        },
      }),
    );

    session.dispose();
  });

  it('keeps layout keys stable for identical layout requests', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
    });

    const first = await session.createRevision(BASE_REQUEST);
    const second = await session.createRevision({ ...BASE_REQUEST });

    expect(first.id).toBe('rev-1');
    expect(second.id).toBe('rev-2');
    expect(second.layoutKey).toBe(first.layoutKey);
  });

  it('gets spread frames by delegating ready revisions to the frame builder', async () => {
    const calls: BuildReaderSpreadFrameInput[] = [];
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0), makePage(1)]),
      buildFrame(input) {
        calls.push(input);
        return frameFromInput(input);
      },
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const frame = await session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 1 });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      sessionId: 'session-1',
      revisionId: revision.id,
      spread: { index: 1 },
    });
    expect(frame).toMatchObject({
      sessionId: 'session-1',
      revisionId: revision.id,
      spreadIndex: 1,
      pageIndexes: [1],
    });
  });

  it('resolves same-document footnote refs for frames and reads footnote payloads', async () => {
    const footnote = {
      kind: 'footnote' as const,
      text: 'Footnote content',
      html: '<p>Footnote content</p>',
    };
    const resolvedRefs: Array<{ readonly href: string } | undefined> = [];
    const session = testSession({
      paginateRevision: () => ({
        pages: [makePage(0)],
        chapterMap: new Map([['ch1', { startPage: 0, endPage: 0 }]]),
        anchorMap: new Map<string, never>(),
        chapterTextIndices: new Map<string, never>(),
        footnoteMap: new Map([
          ['ch1.xhtml#fn1', footnote],
          ['ch2.xhtml#fn2', footnote],
        ]),
      }),
      buildFrame(input) {
        resolvedRefs.push(input.resolveFootnoteRef?.({ href: '#fn1', pageIndex: 0 }));
        resolvedRefs.push(input.resolveFootnoteRef?.({ href: 'ch2.xhtml#fn2', pageIndex: 0 }));
        resolvedRefs.push(
          input.resolveFootnoteRef?.({ href: 'https://host/ch2.xhtml#fn2', pageIndex: 0 }),
        );
        resolvedRefs.push(input.resolveFootnoteRef?.({ href: 'ch2.xhtml#ordinary', pageIndex: 0 }));
        return frameFromInput(input);
      },
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 0 });
    const payload = await session.getFootnote({
      revisionId: revision.id,
      ref: { href: 'ch1.xhtml#fn1' },
    });

    expect(resolvedRefs).toEqual([
      { href: 'ch1.xhtml#fn1' },
      { href: 'ch2.xhtml#fn2' },
      undefined,
      undefined,
    ]);
    expect(payload).toEqual({ ref: { href: 'ch1.xhtml#fn1' }, footnote });
    await expect(
      session.getFootnote({ revisionId: revision.id, ref: { href: 'ch1.xhtml#missing' } }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
  });

  it('prefetches available spread frames into the revision frame cache', async () => {
    const calls: BuildReaderSpreadFrameInput[] = [];
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0), makePage(1)]),
      buildFrame(input) {
        calls.push(input);
        return frameFromInput(input);
      },
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const spreadIndexes = await session.prefetch({
      revisionId: revision.id,
      spreadIndexes: [0, 1, 1, 99],
      displayListOptions: { foregroundColor: '#111111' },
    });
    const cachedFrame = await session.getSpreadFrame({
      revisionId: revision.id,
      spreadIndex: 0,
      displayListOptions: { foregroundColor: '#111111' },
    });
    const uncachedFrame = await session.getSpreadFrame({
      revisionId: revision.id,
      spreadIndex: 0,
    });

    expect(spreadIndexes).toEqual([0, 1]);
    expect(cachedFrame.spreadIndex).toBe(0);
    expect(uncachedFrame.spreadIndex).toBe(0);
    expect(calls.map((call) => call.spread.index)).toEqual([0, 1, 0]);
    expect(calls.map((call) => call.displayListOptions?.foregroundColor ?? null)).toEqual([
      '#111111',
      '#111111',
      null,
    ]);
  });

  it('resolves href anchors through publication href metadata', async () => {
    const target = locator('ch2.xhtml#target');
    const session = testSession({
      paginateRevision: () => ({
        pages: [makePage(0), makePage(1), makePage(2)],
        chapterMap: new Map([
          ['ch1', { startPage: 0, endPage: 0 }],
          ['ch2', { startPage: 1, endPage: 2 }],
        ]),
        anchorMap: new Map([['target', 2]]),
        chapterTextIndices: new Map<string, never>(),
        footnoteMap: new Map<string, never>(),
      }),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: target }),
    ).resolves.toEqual({
      locator: target,
      revisionId: revision.id,
      pageIndex: 2,
      spreadIndex: 2,
    });
  });

  it('resolves the same locator against each revision layout', async () => {
    const target = locator('ch1.xhtml#target');
    const session = testSession({
      paginateRevision: () => ({
        pages: [makePage(0), makePage(1), makePage(2)],
        chapterMap: new Map([['ch1', { startPage: 0, endPage: 2 }]]),
        anchorMap: new Map([['target', 2]]),
        chapterTextIndices: new Map<string, never>(),
        footnoteMap: new Map<string, never>(),
      }),
    });

    const single = await session.createRevision(BASE_REQUEST);
    const double = await session.createRevision({
      ...BASE_REQUEST,
      viewport: { width: 900, height: 600 },
      spreadMode: 'double',
    });

    await expect(
      session.resolveLocator({ revisionId: single.id, locator: target }),
    ).resolves.toMatchObject({
      revisionId: single.id,
      pageIndex: 2,
      spreadIndex: 2,
    });
    await expect(
      session.resolveLocator({ revisionId: double.id, locator: target }),
    ).resolves.toMatchObject({
      revisionId: double.id,
      pageIndex: 2,
      spreadIndex: 1,
    });
  });

  it('resolves explicit internal page and spread locators only', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0), makePage(1), makePage(2)]),
    });
    const revision = await session.createRevision({
      ...BASE_REQUEST,
      viewport: { width: 900, height: 600 },
      spreadMode: 'double',
    });

    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('page:2') }),
    ).resolves.toMatchObject({
      pageIndex: 2,
      spreadIndex: 1,
      revisionId: revision.id,
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('spread:1') }),
    ).resolves.toMatchObject({
      pageIndex: 1,
      spreadIndex: 1,
      revisionId: revision.id,
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('ch1.xhtml') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-supported' },
    });
  });

  it('does not silently resolve duplicate-risk fragment anchors outside the target chapter', async () => {
    const duplicateAnchor = locator('ch2.xhtml#same-id');
    const session = testSession({
      paginateRevision: () => ({
        pages: [makePage(0), makePage(1), makePage(2)],
        chapterMap: new Map([
          ['ch1', { startPage: 0, endPage: 0 }],
          ['ch2', { startPage: 1, endPage: 2 }],
        ]),
        anchorMap: new Map([['same-id', 0]]),
        chapterTextIndices: new Map<string, never>(),
        footnoteMap: new Map<string, never>(),
      }),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: duplicateAnchor }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
  });

  it('searches revision text and resolves source-range search locators', async () => {
    const session = testSession();
    const revision = await session.createRevision(BASE_REQUEST);

    const batch = await session.search({
      revisionId: revision.id,
      query: 'Chapter',
      limit: 1,
    });
    const result = batch.results[0];

    expect(result).toBeDefined();
    if (!result) throw new Error('Expected a search result');
    expect(batch).toMatchObject({ hasMore: true });
    expect(result).toMatchObject({
      snippet: 'Chapter one.',
      locator: {
        href: 'ch1.xhtml',
        mediaType: 'application/xhtml+xml',
        sourceRange: { start: 0, end: 7 },
        text: { highlight: 'Chapter' },
      },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: result.locator }),
    ).resolves.toMatchObject({
      revisionId: revision.id,
      pageIndex: 0,
      spreadIndex: 0,
    });
  });

  it('preserves source-range search locator intent across layout revisions', async () => {
    const session = testSession();
    const single = await session.createRevision(BASE_REQUEST);
    const batch = await session.search({
      revisionId: single.id,
      query: 'Chapter',
      limit: 1,
    });
    const result = batch.results[0];
    if (!result) throw new Error('Expected a search result');

    const double = await session.createRevision({
      ...BASE_REQUEST,
      viewport: { width: 900, height: 600 },
      spreadMode: 'double',
    });

    await expect(
      session.resolveLocator({ revisionId: single.id, locator: result.locator }),
    ).resolves.toMatchObject({
      revisionId: single.id,
      pageIndex: 0,
      spreadIndex: 0,
    });
    await expect(
      session.resolveLocator({ revisionId: double.id, locator: result.locator }),
    ).resolves.toMatchObject({
      revisionId: double.id,
      pageIndex: 0,
      spreadIndex: 0,
    });
    await expect(
      session.resolveLocatorGeometry({ revisionId: double.id, locator: result.locator }),
    ).resolves.toMatchObject({
      revisionId: double.id,
      locator: result.locator,
    });
  });

  it('keeps case-insensitive Unicode folded matches mapped to original source offsets', async () => {
    const session = testSession({
      document: loadEpub(
        buildMinimalEpub({
          chapters: [{ id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>İ Chapter one.</p>') }],
        }),
      ),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    const batch = await session.search({
      revisionId: revision.id,
      query: 'chapter',
      limit: 1,
    });
    const result = batch.results[0];

    expect(result).toBeDefined();
    if (!result) throw new Error('Expected a search result');
    expect(result.locator).toMatchObject({
      sourceRange: { start: 2, end: 9 },
      text: { highlight: 'Chapter' },
    });
    expect(result.snippet).toBe('İ Chapter one.');
  });

  it('rejects unsupported text locators instead of falling back', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.resolveLocator({
        revisionId: revision.id,
        locator: locator('ch1.xhtml', { text: { highlight: 'Chapter' } }),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-supported' },
    });
    await expect(
      session.resolveLocator({
        revisionId: revision.id,
        locator: locator('page:0', { text: { highlight: 'Chapter' } }),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-supported' },
    });
    await expect(
      session.resolveLocator({
        revisionId: revision.id,
        locator: locator('ch1.xhtml', { sourceRange: { start: 0, end: 7 } }),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
  });

  it('keeps cancelled revisions observable but blocks frame fetches', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
      buildFrame: frameFromInput,
    });
    const revision = await session.createRevision(BASE_REQUEST);

    session.cancelRevision(revision.id);

    expect(session.getRevision(revision.id)?.status).toBe('cancelled');
    await expect(
      session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: { code: 'cancelled' },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('page:0') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'cancelled' },
    });
    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Images/cover.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'cancelled' },
    });
  });

  it('blocks unknown revisions and out-of-range frames or locators', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
      buildFrame: frameFromInput,
    });
    const revision = await session.createRevision(BASE_REQUEST);

    await expect(
      session.getSpreadFrame({ revisionId: 'missing', spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
    await expect(
      session.getResource({
        revisionId: 'missing',
        resource: resource('image', 'Images/cover.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
    await expect(
      session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 2 }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('page:3') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('ch1.xhtml#missing') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-found' },
    });
  });

  it('keeps older ready revisions usable when new revisions are created or cancelled', async () => {
    const built: ReaderRevisionId[] = [];
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0), makePage(1)]),
      buildFrame(input) {
        built.push(input.revisionId);
        return frameFromInput(input);
      },
    });

    const first = await session.createRevision(BASE_REQUEST);
    const second = await session.createRevision({
      ...BASE_REQUEST,
      margin: 24,
    });
    const firstFrame = await session.getSpreadFrame({ revisionId: first.id, spreadIndex: 0 });
    const secondFrame = await session.getSpreadFrame({ revisionId: second.id, spreadIndex: 1 });

    session.cancelRevision(first.id);

    expect(firstFrame.revisionId).toBe(first.id);
    expect(secondFrame.revisionId).toBe(second.id);
    expect(session.getRevision(first.id)?.status).toBe('cancelled');
    expect(await session.getSpreadFrame({ revisionId: second.id, spreadIndex: 0 })).toMatchObject({
      revisionId: second.id,
    });
    expect(built).toEqual(['rev-1', 'rev-2', 'rev-2']);
  });

  it('turns injected pagination failures into failed revisions', async () => {
    const session = testSession({
      paginateRevision: () => {
        throw new Error('pagination exploded');
      },
      buildFrame: frameFromInput,
    });

    const revision = await session.createRevision(BASE_REQUEST);

    expect(revision.status).toBe('failed');
    expect(session.getRevision(revision.id)?.status).toBe('failed');
    await expect(
      session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: {
        code: 'internal-error',
        details: { cause: 'pagination exploded' },
      },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('page:0') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'internal-error' },
    });
    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Images/cover.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'internal-error' },
    });
  });

  it('fails all session operations after dispose', async () => {
    const session = testSession({
      paginateRevision: () => paginationResult([makePage(0)]),
      buildFrame: frameFromInput,
    });
    const revision = await session.createRevision(BASE_REQUEST);

    session.dispose();

    expect(() => session.getRevision(revision.id)).toThrow(ReaderSessionError);
    expect(() => {
      session.cancelRevision(revision.id);
    }).toThrow(ReaderSessionError);
    await expect(session.createRevision(BASE_REQUEST)).rejects.toBeInstanceOf(ReaderSessionError);
    await expect(
      session.getSpreadFrame({ revisionId: revision.id, spreadIndex: 0 }),
    ).rejects.toMatchObject({
      protocolError: { code: 'bad-request' },
    });
    await expect(
      session.resolveLocator({ revisionId: revision.id, locator: locator('page:0') }),
    ).rejects.toMatchObject({
      protocolError: { code: 'bad-request' },
    });
    await expect(
      session.getResource({
        revisionId: revision.id,
        resource: resource('image', 'Images/cover.png', 'image/png'),
      }),
    ).rejects.toMatchObject({
      protocolError: { code: 'bad-request' },
    });
  });
});
