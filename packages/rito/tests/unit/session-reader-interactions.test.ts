import { RitoReaderError } from '@ritojs/core-wasm/decoder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLayoutConfig } from '../../src/reader';
import type { Reader, ReaderInteractions, ReaderOptions, ReaderTextCaret } from '../../src/reader';
import type {
  BrowserReaderSessionOpenOptions,
  BrowserReaderTextInteractionResponse,
} from '../../src/bindings/browser/reader-session';
import { sessionReaderPagePlace } from '../../src/bindings/browser/session-reader/page-space';
import { createReader } from '../../src/bindings/browser/session-reader/reader';
import { FakeReaderSession, fakeCanvasContext, type FakeChapter } from './session-reader-fixtures';

const harness = vi.hoisted(() => ({ fake: undefined as unknown, chapters: [] as unknown[] }));

vi.mock('../../src/bindings/browser/reader-session', async (importOriginal) => {
  const original = await importOriginal<object>();
  return {
    ...original,
    openBrowserReaderSession: async (_data: unknown, options: BrowserReaderSessionOpenOptions) => {
      const fixtures = await import('./session-reader-fixtures');
      const fake = new fixtures.FakeReaderSession(harness.chapters as FakeChapter[], {
        layout: options.layout,
        locator: options.initialLocator,
        textProfile: 'platform-string-runs',
      });
      harness.fake = fake;
      return fake.session();
    },
  };
});

vi.mock('../../src/bindings/browser/reader-session-canvas', () => ({
  createBrowserReaderSessionCanvasPresenter: () => ({
    prepare: (artifact: unknown) =>
      Promise.resolve({
        artifact,
        ratio: 2,
        disposed: false,
        onImagesChanged: () => () => undefined,
        imagesSettled: Promise.resolve(),
        dispose: () => undefined,
      }),
    paint: () => undefined,
    dispose: () => undefined,
  }),
}));

const CHAPTERS: readonly FakeChapter[] = [
  { idref: 'cover', href: 'cover.xhtml', pages: 1 },
  { idref: 'one', href: 'one.xhtml', pages: 8 },
  { idref: 'two', href: 'two.xhtml', pages: 5 },
];
/** The reader's margin: a page's content starts this far into its display list. */
const MARGIN = 40;

type Selection = Extract<
  BrowserReaderTextInteractionResponse['result'],
  { readonly kind: 'selection' }
>;
type SessionCaret = NonNullable<Selection['anchorCaret']>;

function sessionCaret(pageIndex: number, charIndex: number): SessionCaret {
  return {
    address: {
      pageIndex,
      position: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex },
      affinity: 'downstream',
    },
    geometry: { x: MARGIN + 10 * charIndex, y: MARGIN + 20, height: 18 },
    href: 'one.xhtml',
    sourcePoint: { nodePath: [0, 0], textOffset: BigInt(charIndex) },
  };
}

/** A selection from one caret to another, with a rect on each page it covers. */
function sessionSelection(anchor: SessionCaret, focus: SessionCaret): Selection {
  const pages = [...new Set([anchor.address.pageIndex, focus.address.pageIndex])];
  return {
    kind: 'selection',
    anchorCaret: anchor,
    focusCaret: focus,
    selection: {
      anchor: anchor.address,
      focus: focus.address,
      start: anchor.address,
      end: focus.address,
      selectedText: 'selected',
      sourceStartHref: anchor.href,
      sourceStart: anchor.sourcePoint,
      sourceEndHref: focus.href,
      sourceEnd: focus.sourcePoint,
      rects: pages.map((pageIndex) => ({
        pageIndex,
        bounds: { x: MARGIN + 5, y: MARGIN + 20, width: 60, height: 18 },
        blockIndex: 0,
        lineIndex: 0,
        runIndex: 0,
        startCharIndex: 0,
        endCharIndex: 6,
      })),
    },
  };
}

interface Opened {
  readonly reader: Reader;
  readonly interactions: ReaderInteractions;
  readonly fake: FakeReaderSession;
}

async function open(extra: Partial<ReaderOptions> = {}): Promise<Opened> {
  const ctx = fakeCanvasContext(800, 1200);
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  const reader = await createReader(new ArrayBuffer(4), canvas as never, {
    width: 400,
    height: 600,
    devicePixelRatio: 2,
    logLevel: 'silent',
    initialLocator: { href: 'one.xhtml' },
    pinnedFontPolicy: {
      schemaVersion: 1,
      faces: [{ bytes: new ArrayBuffer(8), expectedSha256: 'ab'.repeat(32), genericRole: 'serif' }],
    },
    ...extra,
  });
  const interactions = reader.interactions;
  if (!interactions) throw new Error('the reader has no interactions');
  return { reader, interactions, fake: harness.fake as FakeReaderSession };
}

async function bookScope(reader: Reader): Promise<void> {
  await vi.waitFor(() => {
    expect(reader.layoutScope).toBe('book');
  });
}

async function resolvedCaret(
  opened: Opened,
  pageIndex: number,
  x: number,
): Promise<ReaderTextCaret> {
  const resolution = await opened.interactions.textSelection?.resolveCaret({ pageIndex, x, y: 25 });
  if (resolution?.status !== 'resolved') throw new Error('the caret did not resolve');
  return resolution.caret;
}

describe('session reader interactions', () => {
  beforeEach(() => {
    harness.chapters = [...CHAPTERS];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('places the second page of a spread one page and a gap after the first', () => {
    const config = createLayoutConfig({
      width: 1000,
      height: 600,
      margin: { top: 30, right: 20, bottom: 30, left: 24 },
      spread: 'double',
      spreadGap: 16,
    });
    const view = {
      spreadIndexByPage: [0, 1, 1],
      spreads: [
        { index: 0, pageIndexes: [0], leftPageIndex: 0 },
        { index: 1, pageIndexes: [1, 2], leftPageIndex: 1, rightPageIndex: 2 },
      ],
    } as never;
    expect(sessionReaderPagePlace({ view, config }, 1)).toEqual({
      spreadIndex: 1,
      originX: 24,
      originY: 30,
    });
    expect(sessionReaderPagePlace({ view, config }, 2)).toEqual({
      spreadIndex: 1,
      originX: 492 + 16 + 24,
      originY: 30,
    });
    expect(sessionReaderPagePlace({ view, config }, 3)).toBeUndefined();
  });

  it('reads a page’s targets and semantics from its spread, in page coordinates', async () => {
    const opened = await open();
    opened.fake.pageContent = (pageIndex) => ({
      hits: [
        {
          pageIndex,
          bounds: { x: MARGIN + 12, y: MARGIN + 30, width: 80, height: 18 },
          kind: 'footnote-pending',
          text: '注',
          href: '#n1',
          sourcePoint: { nodePath: [1, 0], textOffset: 4n },
          targetLocator: { href: 'two.xhtml', anchorId: 'n1' },
          footnoteKey: 'two.xhtml#n1',
        },
        {
          pageIndex,
          bounds: { x: MARGIN, y: MARGIN + 60, width: 200, height: 120 },
          kind: 'image',
          text: '',
          imageSrc: 'images/plate.png',
          imageAlt: 'A plate',
        },
      ],
      semantics: [
        {
          role: 'list',
          bounds: { x: MARGIN, y: MARGIN, width: 320, height: 60 },
          children: [
            {
              role: 'list-item',
              text: 'first',
              bounds: { x: MARGIN + 16, y: MARGIN, width: 304, height: 20 },
              children: [],
            },
          ],
        },
      ],
    });
    await bookScope(opened.reader);
    // Chapter `one` starts on book page 1; its third page is book page 3.
    const targets = await opened.interactions.getPageTargets(3);
    expect(targets).toEqual({
      pageIndex: 3,
      spreadIndex: 3,
      targets: [
        {
          kind: 'footnotePending',
          bounds: { x: 12, y: 30, width: 80, height: 18 },
          label: '注',
          href: '#n1',
          sourceLocator: { href: 'one.xhtml', sourcePoint: { nodePath: [1, 0], textOffset: 4 } },
          targetLocator: { href: 'two.xhtml', anchorId: 'n1' },
          footnoteKey: 'two.xhtml#n1',
        },
        {
          kind: 'image',
          bounds: { x: 0, y: 60, width: 200, height: 120 },
          label: 'A plate',
          imageSrc: 'images/plate.png',
          imageAlt: 'A plate',
        },
      ],
    });
    const semantics = await opened.interactions.getPageSemantics?.(3);
    expect(semantics?.nodes).toEqual([
      {
        role: 'list',
        bounds: { x: 0, y: 0, width: 320, height: 60 },
        children: [
          {
            role: 'listitem',
            text: 'first',
            bounds: { x: 16, y: 0, width: 304, height: 20 },
            children: [],
          },
        ],
      },
    ]);
    expect(await opened.interactions.getPageTargets(99)).toBeUndefined();
  });

  it('anchors a page at the locator its spread was published with', async () => {
    const opened = await open({
      initialLocator: { href: 'one.xhtml', sourcePoint: { nodePath: [3, 0], textOffset: 7 } },
    });
    expect(await opened.interactions.getPageReadingAnchor?.(0)).toEqual({
      status: 'resolved',
      pageIndex: 0,
      spreadIndex: 0,
      locator: { href: 'one.xhtml', sourcePoint: { nodePath: [3, 0], textOffset: 7 } },
    });
  });

  it('asks a caret in display space of every page and answers in page coordinates', async () => {
    const opened = await open();
    opened.fake.answerInteraction = () => ({ kind: 'caret', caret: sessionCaret(2, 3) });
    const resolution = await opened.interactions.textSelection?.resolveCaret({
      pageIndex: 2,
      x: 31,
      y: 25,
    });
    expect(opened.fake.interactions.at(-1)).toMatchObject({
      question: { kind: 'caret', point: { pageIndex: 2, x: 31 + MARGIN, y: 25 + MARGIN } },
      options: { everyPage: true },
    });
    expect(resolution).toMatchObject({
      status: 'resolved',
      pageIndex: 2,
      spreadIndex: 2,
      caret: {
        pageIndex: 2,
        geometry: { x: 30, y: 20, height: 18 },
        sourceLocator: { href: 'one.xhtml', sourcePoint: { nodePath: [0, 0], textOffset: 3 } },
      },
    });

    opened.fake.answerInteraction = () => ({ kind: 'miss' });
    expect(
      await opened.interactions.textSelection?.resolveCaret({ pageIndex: 2, x: 0, y: 0 }),
    ).toEqual({ status: 'miss', pageIndex: 2, spreadIndex: 2 });
    opened.fake.answerInteraction = () => ({ kind: 'unavailable', reason: 'shape-unavailable' });
    expect(
      await opened.interactions.textSelection?.resolveCaret({ pageIndex: 2, x: 0, y: 0 }),
    ).toEqual({ status: 'unavailable', pageIndex: 2, spreadIndex: 2, reason: 'shapeUnavailable' });
    // A page the committed layout does not have is a superseded question.
    expect(
      await opened.interactions.textSelection?.resolveCaret({ pageIndex: 80, x: 0, y: 0 }),
    ).toBeUndefined();
  });

  it('extends a caret to a point with a rect on every page of the range', async () => {
    const opened = await open();
    opened.fake.answerInteraction = () => ({ kind: 'caret', caret: sessionCaret(2, 3) });
    const anchor = await resolvedCaret(opened, 2, 31);
    opened.fake.answerInteraction = () => sessionSelection(sessionCaret(2, 3), sessionCaret(3, 6));
    const resolution = await opened.interactions.textSelection?.resolveTextRangeToPoint(anchor, {
      pageIndex: 3,
      x: 64,
      y: 22,
    });
    expect(opened.fake.interactions.at(-1)).toMatchObject({
      question: {
        kind: 'range-to-point',
        anchor: { pageIndex: 2, position: { charIndex: 3 } },
        focus: { pageIndex: 3, x: 64 + MARGIN, y: 22 + MARGIN },
      },
      options: { everyPage: true },
    });
    if (resolution?.status !== 'resolved') throw new Error('the range did not resolve');
    const { range } = resolution;
    expect(range.start).toBe(range.anchor);
    expect(range.end).toBe(range.focus);
    expect(range.focus.pageIndex).toBe(3);
    expect(range.rects).toEqual([
      { pageIndex: 2, spreadIndex: 2, x: 5, y: 20, width: 60, height: 18 },
      { pageIndex: 3, spreadIndex: 3, x: 5, y: 20, width: 60, height: 18 },
    ]);
    expect(range.sourceLocator).toEqual({
      href: 'one.xhtml',
      sourceRange: {
        start: { nodePath: [0, 0], textOffset: 3 },
        end: { nodePath: [0, 0], textOffset: 6 },
      },
    });

    // The range between the two carets it returned, the other way round.
    opened.fake.answerInteraction = () => {
      const backward = sessionSelection(sessionCaret(3, 6), sessionCaret(2, 3));
      return {
        ...backward,
        selection: {
          ...backward.selection,
          start: sessionCaret(2, 3).address,
          end: sessionCaret(3, 6).address,
        },
      };
    };
    const reversed = await opened.interactions.textSelection?.resolveTextRange(
      range.focus,
      range.anchor,
    );
    if (reversed?.status !== 'resolved') throw new Error('the reversed range did not resolve');
    expect(reversed.range.start).toBe(range.anchor);
    expect(reversed.range.end).toBe(range.focus);
  });

  it('moves a selection by the session’s movement names and reports a boundary', async () => {
    const opened = await open();
    opened.fake.answerInteraction = () => ({ kind: 'caret', caret: sessionCaret(2, 3) });
    const caret = await resolvedCaret(opened, 2, 31);
    opened.fake.answerInteraction = () => ({
      ...sessionSelection(sessionCaret(2, 3), sessionCaret(3, 6)),
      preferredInlinePosition: 120.5,
    });
    const moved = await opened.interactions.textSelection?.resolveTextSelectionMovement?.({
      anchor: caret,
      focus: caret,
      movement: 'paragraphPreviousStart',
      preferredInlinePosition: 99,
    });
    expect(opened.fake.interactions.at(-1)?.question).toMatchObject({
      kind: 'movement',
      movement: 'paragraph-previous-start',
      preferredInlinePosition: 99,
    });
    expect(moved).toMatchObject({ status: 'resolved', preferredInlinePosition: 120.5 });

    opened.fake.answerInteraction = () => ({ kind: 'boundary', boundary: 'end' });
    expect(
      await opened.interactions.textSelection?.resolveTextSelectionMovement?.({
        anchor: caret,
        focus: caret,
        movement: 'documentEnd',
      }),
    ).toEqual({ status: 'boundary', boundary: 'end' });
  });

  it('answers undefined for a caret of a layout that was replaced', async () => {
    const opened = await open();
    opened.fake.answerInteraction = () => ({ kind: 'caret', caret: sessionCaret(2, 3) });
    const caret = await resolvedCaret(opened, 2, 31);
    const asked = opened.fake.interactions.length;
    await bookScope(opened.reader);
    expect(
      await opened.interactions.textSelection?.resolveTextRangeToPoint(caret, {
        pageIndex: 3,
        x: 1,
        y: 1,
      }),
    ).toBeUndefined();
    expect(await opened.interactions.textSelection?.resolveTextRange(caret, caret)).toBeUndefined();
    expect(opened.fake.interactions).toHaveLength(asked);
    await expect(
      opened.interactions.textSelection?.resolveTextRange({} as ReaderTextCaret, caret),
    ).rejects.toThrow(TypeError);
  });

  it('answers undefined when the layout is replaced under a question', async () => {
    const opened = await open();
    opened.fake.answerInteraction = () => {
      throw new RitoReaderError('unknown-artifact', 'the artifact was retired');
    };
    expect(
      await opened.interactions.textSelection?.resolveCaret({ pageIndex: 2, x: 1, y: 1 }),
    ).toBeUndefined();
    opened.fake.answerInteraction = () => {
      throw new RitoReaderError('invalid-request', 'the engine failed');
    };
    await expect(
      opened.interactions.textSelection?.resolveCaret({ pageIndex: 2, x: 1, y: 1 }),
    ).rejects.toThrow('the engine failed');
  });

  it('projects a source range onto every page it covers', async () => {
    const opened = await open();
    const sourceRange = {
      start: { nodePath: [0, 0], textOffset: 3 },
      end: { nodePath: [0, 0], textOffset: 60 },
    };
    opened.fake.answerSourceRange = () => ({
      status: 'resolved',
      firstPageIndex: 4,
      selectedText: 'across a page break',
      rects: [4, 5].map((pageIndex) => ({
        pageIndex,
        bounds: { x: MARGIN + 8, y: MARGIN + 500, width: 100, height: 18 },
        blockIndex: 0,
        lineIndex: 0,
        runIndex: 0,
        startCharIndex: 0,
        endCharIndex: 9,
      })),
    });
    const resolution = await opened.interactions.resolveExactSourceRange?.({
      href: 'one.xhtml',
      sourceRange,
    });
    expect(opened.fake.sourceRanges.at(-1)).toMatchObject({
      question: {
        href: 'one.xhtml',
        range: { start: { textOffset: 3n }, end: { textOffset: 60n } },
      },
      options: { everyPage: true },
    });
    expect(resolution).toEqual({
      status: 'resolved',
      range: {
        selectedText: 'across a page break',
        sourceLocator: { href: 'one.xhtml', sourceRange },
        rects: [
          { pageIndex: 4, spreadIndex: 4, x: 8, y: 500, width: 100, height: 18 },
          { pageIndex: 5, spreadIndex: 5, x: 8, y: 500, width: 100, height: 18 },
        ],
      },
    });

    // A chapter the committed layout does not cover is laid out with the book.
    opened.fake.answerSourceRange = () => ({ status: 'pending', selectedText: '', rects: [] });
    expect(
      await opened.interactions.resolveExactSourceRange?.({ href: 'two.xhtml', sourceRange }),
    ).toEqual({ status: 'pending', reason: 'notPaginated' });
  });

  it('builds and locates annotation targets in the engine’s field order', async () => {
    const opened = await open();
    const sessionTarget = {
      json: '',
      href: 'one.xhtml',
      sourceRange: {
        start: { nodePath: [1, 0, 4], textOffset: 12n },
        end: { nodePath: [1, 0, 4], textOffset: 28n },
      },
      exact: 'the quoted words',
      prefix: 'Before ',
      suffix: ' after',
      start: 12n,
      end: 28n,
      chapterLength: 34n,
    };
    const canonical =
      '{"version":1,"href":"one.xhtml","sourceRange":{"start":{"nodePath":[1,0,4],"textOffset":12},' +
      '"end":{"nodePath":[1,0,4],"textOffset":28}},"quote":{"exact":"the quoted words",' +
      '"prefix":"Before ","suffix":" after"},"position":{"start":12,"end":28,"chapterLength":34}}';
    opened.fake.answerAnnotation = () => ({ level: 'created', target: sessionTarget });
    const target = await opened.interactions.createAnnotationTarget?.({
      href: 'one.xhtml',
      sourceRange: {
        start: { nodePath: [1, 0, 4], textOffset: 12 },
        end: { nodePath: [1, 0, 4], textOffset: 28 },
      },
    });
    expect(JSON.stringify(target)).toBe(canonical);
    if (!target) throw new Error('no target was built');

    opened.fake.answerAnnotation = () => ({ level: 'quote', target: sessionTarget });
    // A target read back from storage with its fields in another order.
    const stored = {
      position: target.position,
      quote: target.quote,
      sourceRange: target.sourceRange,
      href: target.href,
      version: target.version,
    };
    const located = await opened.interactions.resolveAnnotationTarget?.(stored);
    expect(opened.fake.annotations.at(-1)).toEqual({ kind: 'resolve', targetJson: canonical });
    expect(located).toEqual({ level: 'quote', target });

    opened.fake.answerAnnotation = () => ({ level: 'orphaned-empty-chapter' });
    expect(await opened.interactions.resolveAnnotationTarget?.(target)).toEqual({
      level: 'orphaned',
      reason: 'emptyChapter',
    });
  });

  it('names the TOC entry at a position and orders two positions', async () => {
    const opened = await open();
    const position = { href: 'two.xhtml', point: { nodePath: [0], textOffset: 1 } };
    opened.fake.answerPosition = (query) =>
      query.kind === 'compare' ? { kind: 'order', order: -1 } : { kind: 'toc-entry', tocId: 2 };
    expect(await opened.interactions.tocEntryAtPosition?.(position)).toBe(opened.reader.toc[2]);
    expect(await opened.interactions.compareSourcePositions?.(position, position)).toBe(-1);
    opened.fake.answerPosition = () => ({ kind: 'toc-entry' });
    expect(await opened.interactions.tocEntryAtPosition?.(position)).toBeNull();
  });

  it('searches the whole book, waiting for it when only a chapter is laid out', async () => {
    const opened = await open();
    opened.fake.searchResults = [
      {
        pageIndex: 9,
        spreadIndex: 9,
        start: { blockIndex: 1, lineIndex: 2, runIndex: 0, charIndex: 4 },
        end: { blockIndex: 1, lineIndex: 2, runIndex: 0, charIndex: 6 },
        context: '…the snow fell…',
        locator: {
          href: 'two.xhtml',
          sourceRange: {
            start: { nodePath: [4, 0], textOffset: 14n },
            end: { nodePath: [4, 0], textOffset: 18n },
          },
        },
      },
      {
        pageIndex: 10,
        spreadIndex: 10,
        start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
        end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 4 },
        context: 'snow',
      },
    ];
    expect(opened.reader.layoutScope).toBe('chapter');
    const results = await opened.reader.search?.('snow', { wholeWord: true });
    expect(opened.reader.layoutScope).toBe('book');
    expect(opened.fake.searches).toEqual([{ book: true, query: 'snow' }]);
    expect(results).toEqual([
      {
        pageIndex: 9,
        range: {
          start: { blockIndex: 1, lineIndex: 2, runIndex: 0, charIndex: 4 },
          end: { blockIndex: 1, lineIndex: 2, runIndex: 0, charIndex: 6 },
        },
        context: '…the snow fell…',
        source: {
          status: 'resolved',
          href: 'two.xhtml',
          sourceRange: {
            start: { nodePath: [4, 0], textOffset: 14 },
            end: { nodePath: [4, 0], textOffset: 18 },
          },
        },
      },
      {
        pageIndex: 10,
        range: {
          start: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 },
          end: { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 4 },
        },
        context: 'snow',
        source: { status: 'unavailable', reason: 'sourceUnavailable' },
      },
    ]);
    expect(await opened.reader.search?.('')).toEqual([]);
  });

  it('hands out an object URL for an image a held spread draws', async () => {
    // The reader also makes object URLs of its own, for the host faces.
    const images: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((source) => {
      const blob = source as Blob;
      if (blob.type !== 'image/png') return 'blob:other';
      images.push(blob);
      return `blob:image-${String(images.length)}`;
    });
    const opened = await open();
    opened.fake.resources = [{ kind: 'image', href: 'images/plate.png' }];
    await bookScope(opened.reader);
    expect(await opened.reader.getImageBlobUrl('images/plate.png')).toBe('blob:image-1');
    expect(images[0]?.size).toBe(3);
    expect(await opened.reader.getImageBlobUrl('images/other.png')).toBeUndefined();
  });

  it('lays out again when host faces are added or removed', async () => {
    const opened = await open();
    await bookScope(opened.reader);
    const sha = 'cd'.repeat(32);
    const requests = opened.fake.requests.length;
    await opened.reader.addFontFaces?.([
      { bytes: new ArrayBuffer(8), expectedSha256: sha, genericRole: 'sansSerif' },
    ]);
    await vi.waitFor(() => {
      expect(opened.fake.requests).toHaveLength(requests + 1);
    });
    await bookScope(opened.reader);
    await opened.reader.removeFontFaces?.([sha]);
    await vi.waitFor(() => {
      expect(opened.fake.requests).toHaveLength(requests + 2);
    });
    expect(opened.fake.fontCalls).toEqual([`add ${sha}`, `remove ${sha}`]);
  });

  it('reads a footnote, and has none to show for one not indexed yet', async () => {
    const opened = await open();
    opened.fake.footnotes.set('two.xhtml#n1', { kind: 'endnote', text: 'A note', html: '<p/>' });
    expect(await opened.interactions.getFootnote('two.xhtml#n1')).toEqual({
      kind: 'endnote',
      text: 'A note',
      html: '<p/>',
    });
    expect(await opened.interactions.getFootnote('two.xhtml#n2')).toBeUndefined();
  });
});
