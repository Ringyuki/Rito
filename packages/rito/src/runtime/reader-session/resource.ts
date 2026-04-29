import type { EpubDocument } from '../types';
import { createReaderSessionError } from './errors';
import type {
  ReaderResourcePayload,
  ReaderResourceRef,
  ReaderRevisionId,
  ReaderSessionId,
} from './types';

export interface StoreReaderResourceTransferInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly resource: ReaderResourceRef;
  readonly bytes: Uint8Array;
  readonly mediaType?: string;
}

export type StoreReaderResourceTransfer = (input: StoreReaderResourceTransferInput) => string;

export interface ReleaseReaderResourceTransfersInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
}

export type ReleaseReaderResourceTransfers = (input: ReleaseReaderResourceTransfersInput) => void;

export interface ReadReaderResourceInput {
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly document: EpubDocument;
  readonly resource: ReaderResourceRef;
  readonly storeTransfer?: StoreReaderResourceTransfer;
}

export function readReaderResource(input: ReadReaderResourceInput): ReaderResourcePayload {
  if (input.resource.kind === 'publication') {
    throw createReaderSessionError(
      input.sessionId,
      input.revisionId,
      'not-supported',
      'Publication resource payloads are not supported yet',
    );
  }

  const entry = readResourceBytes(input.document, input.resource);
  if (!entry) {
    throw createReaderSessionError(
      input.sessionId,
      input.revisionId,
      'resource-unavailable',
      `Resource ${input.resource.href} is not available`,
    );
  }
  if (!input.storeTransfer) {
    throw createReaderSessionError(
      input.sessionId,
      input.revisionId,
      'internal-error',
      'Reader resource transfer store is not configured',
    );
  }

  const transferId = input.storeTransfer({
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    resource: input.resource,
    bytes: entry.bytes,
    ...(entry.mediaType !== undefined ? { mediaType: entry.mediaType } : {}),
  });
  return {
    resource: input.resource,
    byteLength: entry.bytes.byteLength,
    transferId,
    ...(entry.mediaType !== undefined ? { mediaType: entry.mediaType } : {}),
  };
}

function readResourceBytes(
  document: EpubDocument,
  resource: ReaderResourceRef,
): { readonly bytes: Uint8Array; readonly mediaType?: string } | undefined {
  switch (resource.kind) {
    case 'image':
      return readBinaryResource(document.images, resource);
    case 'font':
      return readBinaryResource(document.fonts, resource);
    case 'stylesheet':
      return readStylesheetResource(document.stylesheets, resource);
    case 'publication':
      return undefined;
  }
}

function readBinaryResource(
  resources: ReadonlyMap<string, Uint8Array>,
  resource: ReaderResourceRef,
): { readonly bytes: Uint8Array; readonly mediaType?: string } | undefined {
  const bytes = resources.get(resource.href);
  if (!bytes) return undefined;
  return {
    bytes,
    ...(resource.mediaType !== undefined ? { mediaType: resource.mediaType } : {}),
  };
}

function readStylesheetResource(
  stylesheets: ReadonlyMap<string, string>,
  resource: ReaderResourceRef,
): { readonly bytes: Uint8Array; readonly mediaType?: string } | undefined {
  const css = stylesheets.get(resource.href);
  if (css === undefined) return undefined;
  return {
    bytes: new TextEncoder().encode(css),
    mediaType: resource.mediaType ?? 'text/css',
  };
}
