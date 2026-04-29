import { expect } from 'vitest';
import type { Page } from '../../src/layout/core/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  assertProtocolSerializable,
  type BuildReaderSessionFrame,
  type CreateReaderRuntimeDispatcherInput,
  type OpenSessionCommand,
  type ReaderRuntimeResponse,
  type ReaderSpreadFrame,
} from '../../src/runtime/reader-session';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

export const LAYOUT = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single' as const,
  margin: 20,
};

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

export function makeDocument(options?: {
  readonly images?: ReadonlyMap<string, Uint8Array>;
  readonly onClose?: () => void;
}): EpubDocument {
  return {
    packageDocument: {
      metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
      manifest: [{ id: 'ch1', href: 'ch1.xhtml', mediaType: 'application/xhtml+xml' }],
      spine: [{ idref: 'ch1', linear: true }],
    },
    readChapter: () => undefined,
    stylesheets: new Map<string, string>(),
    fonts: new Map<string, Uint8Array>(),
    images: options?.images ?? new Map<string, Uint8Array>(),
    toc: [],
    close: () => {
      options?.onClose?.();
    },
  };
}

export function frameFromInput(input: Parameters<BuildReaderSessionFrame>[0]): ReaderSpreadFrame {
  const pageIndexes = [input.spread.left?.index, input.spread.right?.index].filter(
    (index): index is number => index !== undefined,
  );
  return {
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    spreadIndex: input.spread.index,
    pageIndexes,
    viewport: { width: input.layout.viewportWidth, height: input.layout.viewportHeight },
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

export function baseDeps(
  overrides?: Partial<CreateReaderRuntimeDispatcherInput>,
): CreateReaderRuntimeDispatcherInput {
  return {
    openPublication: () =>
      Promise.resolve(
        makeDocument({ images: new Map([['Images/cover.png', new Uint8Array([7])]]) }),
      ),
    createTextMeasurer: (): TextMeasurer => createMockTextMeasurer(),
    createSessionId: () => 'session-1',
    createRevisionId: () => 'rev-1',
    paginateRevision: () => paginationResult([makePage(0), makePage(1)]),
    buildFrame: frameFromInput,
    storeResourceTransfer: () => 'transfer-1',
    releaseResourceTransfers: () => undefined,
    ...(overrides ?? {}),
  };
}

export function openCommand(requestId = 'open-1'): OpenSessionCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'openSession',
    payload: { publicationRef: 'book.epub' },
  };
}

export function expectSerializable(response: ReaderRuntimeResponse): void {
  expect(() => {
    assertProtocolSerializable(response);
  }).not.toThrow();
}

export function deferred<T>(): {
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
