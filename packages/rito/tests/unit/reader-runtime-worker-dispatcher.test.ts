// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { EpubDocument } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  type ReaderRuntimeCommand,
} from '../../src/runtime/reader-session';
import { createReaderRuntimeWorkerDispatcherFactory } from '../../src/web/reader-runtime-worker-dispatcher';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

const LAYOUT = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single' as const,
  margin: 20,
};

function openCommand(): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: 'open-1',
    kind: 'openSession',
    payload: { publicationRef: 'book.epub' },
  };
}

function createRevisionCommand(): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: 'revision-1',
    kind: 'createRevision',
    sessionId: 'session-1',
    payload: LAYOUT,
  };
}

function getCoverResourceCommand(): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: 'resource-1',
    kind: 'getResource',
    sessionId: 'session-1',
    revisionId: 'revision-1',
    payload: {
      resource: {
        id: 'cover',
        kind: 'image',
        href: 'Images/cover.png',
        mediaType: 'image/png',
      },
    },
  };
}

function closeCommand(): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: 'close-1',
    kind: 'closeSession',
    sessionId: 'session-1',
  };
}

function bookBytes(): ArrayBuffer {
  return buildMinimalEpub({
    title: 'Worker Book',
    identifier: 'worker-book-id',
    images: [
      {
        id: 'cover',
        href: 'Images/cover.png',
        mediaType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      },
    ],
  });
}

describe('createReaderRuntimeWorkerDispatcherFactory', () => {
  it('builds dispatcher deps from publication bytes and injected platform capabilities', async () => {
    const publicationRefs: string[] = [];
    const textMeasurerTitles: string[] = [];
    const imageDimensionTitles: string[] = [];
    const factory = createReaderRuntimeWorkerDispatcherFactory({
      readPublicationBytes(publicationRef) {
        publicationRefs.push(publicationRef);
        return Promise.resolve(bookBytes());
      },
      createTextMeasurer(document: EpubDocument) {
        textMeasurerTitles.push(document.packageDocument.metadata.title);
        return createMockTextMeasurer();
      },
      loadImageDimensions(document) {
        imageDimensionTitles.push(document.packageDocument.metadata.title);
        return Promise.resolve(new Map([['Images/cover.png', { width: 100, height: 200 }]]));
      },
      createSessionId: () => 'session-1',
      createRevisionId: () => 'revision-1',
    });
    const workerDispatcher = factory.createDispatcher();

    const open = await workerDispatcher.dispatcher.handleCommand(openCommand());

    expect(open).toMatchObject({
      kind: 'openSession',
      ok: true,
      sessionId: 'session-1',
      payload: { publication: { metadata: { title: 'Worker Book' } } },
    });
    expect(publicationRefs).toEqual(['book.epub']);
    expect(textMeasurerTitles).toEqual(['Worker Book']);
    expect(imageDimensionTitles).toEqual(['Worker Book']);
    workerDispatcher.dispatcher.dispose();
  });

  it('wires resource transfers into dispatcher sessions and releases them on close', async () => {
    const factory = createReaderRuntimeWorkerDispatcherFactory({
      readPublicationBytes: () => Promise.resolve(bookBytes()),
      createTextMeasurer: () => createMockTextMeasurer(),
      createSessionId: () => 'session-1',
      createRevisionId: () => 'revision-1',
    });
    const workerDispatcher = factory.createDispatcher();

    await workerDispatcher.dispatcher.handleCommand(openCommand());
    await workerDispatcher.dispatcher.handleCommand(createRevisionCommand());
    const resource = await workerDispatcher.dispatcher.handleCommand(getCoverResourceCommand());

    expect(resource).toMatchObject({
      kind: 'getResource',
      ok: true,
      payload: {
        byteLength: 3,
        transferId: 'transfer-1',
        mediaType: 'image/png',
      },
    });
    expect(workerDispatcher.resourceTransfers.readTransfer('transfer-1')).toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(workerDispatcher.resourceTransfers.getTransferCount()).toBe(1);

    await workerDispatcher.dispatcher.handleCommand(closeCommand());

    expect(workerDispatcher.resourceTransfers.getTransferCount()).toBe(0);
  });

  it('isolates transfer stores across dispatchers created by one factory', async () => {
    const factory = createReaderRuntimeWorkerDispatcherFactory({
      readPublicationBytes: () => Promise.resolve(bookBytes()),
      createTextMeasurer: () => createMockTextMeasurer(),
      createSessionId: () => 'session-1',
      createRevisionId: () => 'revision-1',
    });
    const first = factory.createDispatcher();
    const second = factory.createDispatcher();

    await first.dispatcher.handleCommand(openCommand());
    await first.dispatcher.handleCommand(createRevisionCommand());
    await first.dispatcher.handleCommand(getCoverResourceCommand());
    await second.dispatcher.handleCommand(openCommand());
    await second.dispatcher.handleCommand(createRevisionCommand());
    await second.dispatcher.handleCommand(getCoverResourceCommand());

    expect(first.resourceTransfers.readTransfer('transfer-1')).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(second.resourceTransfers.readTransfer('transfer-1')).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
    });

    await first.dispatcher.handleCommand(closeCommand());

    expect(first.resourceTransfers.getTransferCount()).toBe(0);
    expect(second.resourceTransfers.readTransfer('transfer-1')).toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
    });
    second.dispatcher.dispose();
  });

  it('passes byte budgets to default resource transfer stores', async () => {
    const factory = createReaderRuntimeWorkerDispatcherFactory({
      readPublicationBytes: () => Promise.resolve(bookBytes()),
      createTextMeasurer: () => createMockTextMeasurer(),
      createSessionId: () => 'session-1',
      createRevisionId: () => 'revision-1',
      maxResourceTransferBytes: 2,
    });
    const workerDispatcher = factory.createDispatcher();

    await workerDispatcher.dispatcher.handleCommand(openCommand());
    await workerDispatcher.dispatcher.handleCommand(createRevisionCommand());
    const resource = await workerDispatcher.dispatcher.handleCommand(getCoverResourceCommand());

    expect(resource).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'resource-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'internal-error' },
    });
    expect(workerDispatcher.resourceTransfers.getTransferCount()).toBe(0);
    expect(workerDispatcher.resourceTransfers.getTransferByteLength()).toBe(0);
  });
});
