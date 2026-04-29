import type { ImageDimensions } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import { loadEpub } from '../runtime/load-epub';
import type { EpubDocument, LoadOptions } from '../runtime/types';
import type { Logger } from '../utils/logger';
import {
  createInMemoryReaderResourceTransferStore,
  createReaderRuntimeDispatcher,
  type BuildReaderSessionFrame,
  type CreateReaderRevisionId,
  type CreateReaderRuntimeDispatcherInput,
  type PaginateReaderRevision,
  type RegisterReaderSessionFonts,
  type ReaderResourceTransferStore,
  type ReaderRuntimeDispatcher,
  type ReaderSessionId,
} from '../runtime/reader-session';

export interface CreateReaderRuntimeWorkerDispatcherFactoryInput {
  readonly readPublicationBytes: (publicationRef: string) => Promise<ArrayBuffer>;
  readonly createTextMeasurer: (document: EpubDocument) => TextMeasurer;
  readonly loadOptions?: LoadOptions;
  readonly loadImageDimensions?: (
    document: EpubDocument,
  ) => Promise<ReadonlyMap<string, ImageDimensions>>;
  readonly createResourceTransfers?: () => ReaderResourceTransferStore;
  readonly maxResourceTransfers?: number;
  readonly maxResourceTransferBytes?: number;
  readonly createSessionId?: () => ReaderSessionId;
  readonly createRevisionId?: CreateReaderRevisionId;
  readonly paginateRevision?: PaginateReaderRevision;
  readonly buildFrame?: BuildReaderSessionFrame;
  readonly registerFonts?: RegisterReaderSessionFonts;
  readonly onRuntimeEvent?: CreateReaderRuntimeDispatcherInput['onRuntimeEvent'];
  readonly now?: CreateReaderRuntimeDispatcherInput['now'];
  readonly logger?: Logger;
}

export interface ReaderRuntimeWorkerDispatcherFactory {
  createDispatcher(): ReaderRuntimeWorkerDispatcher;
}

export interface ReaderRuntimeWorkerDispatcher {
  readonly dispatcher: ReaderRuntimeDispatcher;
  readonly resourceTransfers: ReaderResourceTransferStore;
}

export function createReaderRuntimeWorkerDispatcherFactory(
  input: CreateReaderRuntimeWorkerDispatcherFactoryInput,
): ReaderRuntimeWorkerDispatcherFactory {
  return {
    createDispatcher() {
      return createWorkerDispatcher(input);
    },
  };
}

function createWorkerDispatcher(
  input: CreateReaderRuntimeWorkerDispatcherFactoryInput,
): ReaderRuntimeWorkerDispatcher {
  const resourceTransfers = createWorkerResourceTransfers(input);
  return {
    resourceTransfers,
    dispatcher: createReaderRuntimeDispatcher(createDispatcherInput(input, resourceTransfers)),
  };
}

function createWorkerResourceTransfers(
  input: CreateReaderRuntimeWorkerDispatcherFactoryInput,
): ReaderResourceTransferStore {
  return (
    input.createResourceTransfers?.() ??
    createInMemoryReaderResourceTransferStore({
      ...(input.maxResourceTransfers !== undefined
        ? { maxTransfers: input.maxResourceTransfers }
        : {}),
      ...(input.maxResourceTransferBytes !== undefined
        ? { maxTransferBytes: input.maxResourceTransferBytes }
        : {}),
    })
  );
}

function createDispatcherInput(
  input: CreateReaderRuntimeWorkerDispatcherFactoryInput,
  resourceTransfers: ReaderResourceTransferStore,
): CreateReaderRuntimeDispatcherInput {
  return {
    openPublication: (publicationRef) => openWorkerPublication(input, publicationRef),
    createTextMeasurer: input.createTextMeasurer,
    storeResourceTransfer: (transfer) => resourceTransfers.storeTransfer(transfer),
    releaseResourceTransfers: (release) => {
      resourceTransfers.releaseTransfers(release);
    },
    ...(input.loadImageDimensions !== undefined
      ? { loadImageDimensions: input.loadImageDimensions }
      : {}),
    ...(input.createSessionId !== undefined ? { createSessionId: input.createSessionId } : {}),
    ...(input.createRevisionId !== undefined ? { createRevisionId: input.createRevisionId } : {}),
    ...(input.paginateRevision !== undefined ? { paginateRevision: input.paginateRevision } : {}),
    ...(input.buildFrame !== undefined ? { buildFrame: input.buildFrame } : {}),
    ...(input.registerFonts !== undefined ? { registerFonts: input.registerFonts } : {}),
    ...(input.onRuntimeEvent !== undefined ? { onRuntimeEvent: input.onRuntimeEvent } : {}),
    ...(input.now !== undefined ? { now: input.now } : {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  };
}

async function openWorkerPublication(
  input: CreateReaderRuntimeWorkerDispatcherFactoryInput,
  publicationRef: string,
): Promise<EpubDocument> {
  const bytes = await input.readPublicationBytes(publicationRef);
  return loadEpub(bytes, {
    ...(input.loadOptions ?? {}),
    ...(input.logger !== undefined ? { logger: input.logger } : {}),
  });
}
