import { describe, expect, it } from 'vitest';
import type { LayoutBlock, LineBox, Page, TextRun } from '../../src/layout/core/types';
import { DEFAULT_RUN_PAINT } from '../../src/layout/text/run-paint-from-style';
import { createReaderLayoutConfig } from '../../src/runtime/reader-session/revision';
import { createReaderSession } from '../../src/runtime/reader-session/session';
import type { ReaderLayoutRequest, ReaderLocator } from '../../src/runtime/reader-session/types';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

const SINGLE_REQUEST: ReaderLayoutRequest = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single',
  margin: 20,
};

const DOUBLE_REQUEST: ReaderLayoutRequest = {
  viewport: { width: 900, height: 600 },
  spreadMode: 'double',
  margin: 20,
};

function makeDocument(): EpubDocument {
  return {
    packageDocument: {
      metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
      manifest: [{ id: 'ch1', href: 'ch1.xhtml', mediaType: 'application/xhtml+xml' }],
      spine: [{ idref: 'ch1', linear: true }],
    },
    readChapter: () => undefined,
    stylesheets: new Map<string, string>(),
    fonts: new Map<string, Uint8Array>(),
    images: new Map<string, Uint8Array>(),
    toc: [],
    close: () => undefined,
  };
}

function sourcePage(index: number): Page {
  return page(index, [
    block([
      line([
        {
          type: 'text-run',
          text: 'Hello world',
          bounds: { x: 10, y: 8, width: 120, height: 20 },
          paint: DEFAULT_RUN_PAINT,
          sourceRef: { nodePath: [0] },
          sourceTextOffset: 0,
        } satisfies TextRun,
      ]),
    ]),
  ]);
}

function page(index: number, content: readonly LayoutBlock[] = []): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: 400, height: 600 },
    content,
  };
}

function block(children: LayoutBlock['children']): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 3, y: 4, width: 240, height: 120 },
    children,
  };
}

function line(runs: readonly TextRun[]): LineBox {
  return {
    type: 'line-box',
    bounds: { x: 5, y: 6, width: 200, height: 24 },
    runs,
  };
}

function paginationResult(pages: readonly Page[]): PaginationResult {
  return {
    pages,
    chapterMap: new Map([['ch1', { startPage: 0, endPage: Math.max(0, pages.length - 1) }]]),
    anchorMap: new Map<string, never>(),
    chapterTextIndices: new Map([
      [
        'ch1',
        {
          href: 'ch1.xhtml',
          normalizedText: 'Hello world',
          spans: [
            {
              nodePath: [0],
              sourceStart: 0,
              sourceEnd: 11,
              normalizedStart: 0,
              normalizedEnd: 11,
            },
          ],
        },
      ],
    ]),
    footnoteMap: new Map<string, never>(),
  };
}

function locator(extra?: Partial<ReaderLocator>): ReaderLocator {
  return {
    href: 'ch1.xhtml',
    mediaType: 'application/xhtml+xml',
    progression: 0,
    ...extra,
  };
}

describe('resolveLocatorGeometry', () => {
  it('resolves source-range geometry into single-spread coordinates', async () => {
    const session = createReaderSession({
      sessionId: 'session-1',
      document: makeDocument(),
      measurer: createMockTextMeasurer(1 / 16),
      paginateRevision: () => paginationResult([sourcePage(0)]),
    });
    const revision = await session.createRevision(SINGLE_REQUEST);

    const geometry = await session.resolveLocatorGeometry({
      revisionId: revision.id,
      locator: locator({ sourceRange: { start: 1, end: 5 } }),
    });

    expect(geometry).toEqual({
      locator: locator({ sourceRange: { start: 1, end: 5 } }),
      revisionId: revision.id,
      segments: [
        {
          pageIndex: 0,
          spreadIndex: 0,
          rects: [{ x: 39, y: 38, width: 4, height: 20 }],
        },
      ],
    });
  });

  it('resolves right-page source-range geometry with double-spread page offset', async () => {
    const request = DOUBLE_REQUEST;
    const layout = createReaderLayoutConfig(request);
    const session = createReaderSession({
      sessionId: 'session-1',
      document: makeDocument(),
      measurer: createMockTextMeasurer(1 / 16),
      paginateRevision: () => paginationResult([page(0), page(1), sourcePage(2)]),
    });
    const revision = await session.createRevision(request);

    const geometry = await session.resolveLocatorGeometry({
      revisionId: revision.id,
      locator: locator({ sourceRange: { start: 1, end: 5 } }),
    });

    expect(geometry.segments).toEqual([
      {
        pageIndex: 2,
        spreadIndex: 1,
        rects: [
          {
            x: layout.pageWidth + layout.spreadGap + layout.marginLeft + 19,
            y: layout.marginTop + 18,
            width: 4,
            height: 20,
          },
        ],
      },
    ]);
  });

  it('rejects non-source-range locator geometry without page fallback', async () => {
    const session = createReaderSession({
      sessionId: 'session-1',
      document: makeDocument(),
      measurer: createMockTextMeasurer(),
      paginateRevision: () => paginationResult([sourcePage(0)]),
    });
    const revision = await session.createRevision(SINGLE_REQUEST);

    await expect(
      session.resolveLocatorGeometry({ revisionId: revision.id, locator: locator() }),
    ).rejects.toMatchObject({
      protocolError: { code: 'not-supported' },
    });
  });
});
