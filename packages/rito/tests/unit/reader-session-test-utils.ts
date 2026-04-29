import type { Page } from '../../src/layout/core/types';
import { loadEpub } from '../../src/runtime/load-epub';
import { createReaderSession } from '../../src/runtime/reader-session/session';
import type { BuildReaderSpreadFrameInput } from '../../src/runtime/reader-session/frame';
import type {
  CreateReaderSessionInput,
  ReaderSession,
} from '../../src/runtime/reader-session/session';
import type {
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderResourceRef,
  ReaderSpreadFrame,
} from '../../src/runtime/reader-session/types';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

export const BASE_REQUEST: ReaderLayoutRequest = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single',
  margin: 20,
};

export function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

export function makeLoadedDocument() {
  return loadEpub(
    buildMinimalEpub({
      chapters: [
        { id: 'ch1', href: 'ch1.xhtml', content: xhtml('<p>Chapter one.</p>') },
        { id: 'ch2', href: 'ch2.xhtml', content: xhtml('<p>Chapter two.</p>') },
      ],
    }),
  );
}

export function makeResourceDocument(options?: {
  readonly images?: ReadonlyMap<string, Uint8Array>;
  readonly fonts?: ReadonlyMap<string, Uint8Array>;
  readonly stylesheets?: ReadonlyMap<string, string>;
}): EpubDocument {
  return {
    packageDocument: {
      metadata: { title: 'Test', language: 'en', identifier: 'test' },
      manifest: [{ id: 'ch1', href: 'ch1.xhtml', mediaType: 'application/xhtml+xml' }],
      spine: [{ idref: 'ch1', linear: true }],
    },
    readChapter: () => xhtml('<p>Chapter one.</p>'),
    stylesheets: options?.stylesheets ?? new Map<string, string>(),
    fonts: options?.fonts ?? new Map<string, Uint8Array>(),
    images: options?.images ?? new Map<string, Uint8Array>(),
    toc: [],
    close: () => undefined,
  };
}

export function makePage(index: number): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: 400, height: 600 },
    content: [],
  };
}

export function paginationResult(pages: readonly Page[]): PaginationResult {
  return {
    pages,
    chapterMap: new Map([['ch1', { startPage: 0, endPage: Math.max(0, pages.length - 1) }]]),
    anchorMap: new Map<string, never>(),
    chapterTextIndices: new Map<string, never>(),
    footnoteMap: new Map<string, never>(),
  };
}

export function locator(href: string, extra?: Partial<Omit<ReaderLocator, 'href'>>): ReaderLocator {
  return {
    href,
    mediaType: 'application/xhtml+xml',
    progression: 0,
    ...(extra ?? {}),
  };
}

export function resource(
  kind: ReaderResourceRef['kind'],
  href: string,
  mediaType?: string,
): ReaderResourceRef {
  return {
    id: `${kind}:${href}`,
    kind,
    href,
    ...(mediaType !== undefined ? { mediaType } : {}),
  };
}

export function testSession(
  input: Omit<Partial<CreateReaderSessionInput>, 'sessionId' | 'measurer'> = {},
): ReaderSession {
  return createReaderSession({
    sessionId: 'session-1',
    document: makeLoadedDocument(),
    measurer: createMockTextMeasurer(),
    now: () => 1000,
    ...input,
  });
}

export function frameFromInput(input: BuildReaderSpreadFrameInput): ReaderSpreadFrame {
  const pageIndexes = [input.spread.left?.index, input.spread.right?.index].filter(
    (index): index is number => index !== undefined,
  );

  return {
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    spreadIndex: input.spread.index,
    pageIndexes,
    viewport: {
      width: input.layout.viewportWidth,
      height: input.layout.viewportHeight,
    },
    displayList: {
      width: input.layout.viewportWidth,
      height: input.layout.viewportHeight,
      commands: [],
    },
    textRuns: [],
    targets: [],
    resourceRefs: [],
    primaryLocator: {
      href: `spread:${String(input.spread.index)}`,
      mediaType: 'application/xhtml+xml',
      progression: 0,
    },
  };
}
