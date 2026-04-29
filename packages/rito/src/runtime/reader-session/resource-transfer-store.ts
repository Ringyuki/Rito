import type { ReaderResourceRef, ReaderRevisionId, ReaderSessionId } from './types';
import type {
  ReleaseReaderResourceTransfersInput,
  StoreReaderResourceTransfer,
  StoreReaderResourceTransferInput,
} from './resource';

export interface ReaderResourceTransferRecord {
  readonly transferId: string;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly resource: ReaderResourceRef;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly mediaType?: string;
}

export interface ReaderResourceTransferStore {
  readonly storeTransfer: StoreReaderResourceTransfer;
  readTransfer(transferId: string): ReaderResourceTransferRecord | undefined;
  releaseTransfer(transferId: string): boolean;
  releaseTransfers(input: ReleaseReaderResourceTransfersInput): number;
  clearTransfers(): void;
  getTransferCount(): number;
  getTransferByteLength(): number;
}

export interface CreateInMemoryReaderResourceTransferStoreInput {
  readonly maxTransfers?: number;
  readonly maxTransferBytes?: number;
  readonly createTransferId?: CreateReaderResourceTransferId;
}

type CreateReaderResourceTransferId = (
  input: StoreReaderResourceTransferInput,
  sequence: number,
) => string;

interface InMemoryReaderResourceTransferStoreState {
  readonly transfers: Map<string, InMemoryReaderResourceTransferRecord>;
  readonly maxTransfers: number;
  readonly maxTransferBytes: number;
  readonly createTransferId: CreateReaderResourceTransferId;
  currentTransferBytes: number;
  nextSequence: number;
}

interface InMemoryReaderResourceTransferRecord extends ReaderResourceTransferRecord {
  leaseCount: number;
}

export function createInMemoryReaderResourceTransferStore(
  input: CreateInMemoryReaderResourceTransferStoreInput = {},
): ReaderResourceTransferStore {
  const state = createTransferStoreState(input);

  return {
    storeTransfer(transferInput) {
      return storeTransfer(state, transferInput);
    },
    readTransfer(transferId) {
      return readTransfer(state, transferId);
    },
    releaseTransfer(transferId) {
      return releaseTransfer(state, transferId);
    },
    releaseTransfers(releaseInput) {
      return releaseTransfers(state, releaseInput);
    },
    clearTransfers() {
      state.transfers.clear();
      state.currentTransferBytes = 0;
    },
    getTransferCount() {
      return state.transfers.size;
    },
    getTransferByteLength() {
      return state.currentTransferBytes;
    },
  };
}

function createTransferStoreState(
  input: CreateInMemoryReaderResourceTransferStoreInput,
): InMemoryReaderResourceTransferStoreState {
  const maxTransfers = input.maxTransfers ?? Number.POSITIVE_INFINITY;
  const maxTransferBytes = input.maxTransferBytes ?? Number.POSITIVE_INFINITY;
  if (input.maxTransfers !== undefined && (!Number.isInteger(maxTransfers) || maxTransfers <= 0)) {
    throw new Error('Reader resource transfer maxTransfers must be a positive integer');
  }
  if (
    input.maxTransferBytes !== undefined &&
    (!Number.isInteger(maxTransferBytes) || maxTransferBytes <= 0)
  ) {
    throw new Error('Reader resource transfer maxTransferBytes must be a positive integer');
  }
  return {
    transfers: new Map<string, InMemoryReaderResourceTransferRecord>(),
    maxTransfers,
    maxTransferBytes,
    createTransferId: input.createTransferId ?? defaultTransferId,
    currentTransferBytes: 0,
    nextSequence: 1,
  };
}

function storeTransfer(
  state: InMemoryReaderResourceTransferStoreState,
  transferInput: StoreReaderResourceTransferInput,
): string {
  const existing = findExistingTransfer(state, transferInput);
  if (existing) {
    existing.leaseCount++;
    touchTransfer(state, existing.transferId);
    return existing.transferId;
  }
  const sequence = state.nextSequence++;
  const transferId = state.createTransferId(transferInput, sequence);
  if (state.transfers.has(transferId)) {
    throw new Error(`Reader resource transfer ${transferId} already exists`);
  }
  const record = transferRecord(transferId, transferInput);
  if (record.byteLength > state.maxTransferBytes) {
    throw new Error(`Reader resource transfer ${transferId} exceeds maxTransferBytes`);
  }
  state.transfers.set(transferId, record);
  state.currentTransferBytes += record.byteLength;
  try {
    assertTransferLimits(state, transferId);
  } catch (error) {
    removeTransfer(state, transferId);
    throw error;
  }
  return transferId;
}

function findExistingTransfer(
  state: InMemoryReaderResourceTransferStoreState,
  input: StoreReaderResourceTransferInput,
): InMemoryReaderResourceTransferRecord | undefined {
  for (const record of state.transfers.values()) {
    if (isSameTransferResource(record, input)) return record;
  }
  return undefined;
}

function isSameTransferResource(
  record: ReaderResourceTransferRecord,
  input: StoreReaderResourceTransferInput,
): boolean {
  return (
    record.sessionId === input.sessionId &&
    record.revisionId === input.revisionId &&
    record.byteLength === input.bytes.byteLength &&
    record.mediaType === input.mediaType &&
    record.resource.id === input.resource.id &&
    record.resource.kind === input.resource.kind &&
    record.resource.href === input.resource.href &&
    record.resource.mediaType === input.resource.mediaType &&
    record.resource.hash === input.resource.hash
  );
}

function readTransfer(
  state: InMemoryReaderResourceTransferStoreState,
  transferId: string,
): ReaderResourceTransferRecord | undefined {
  const record = touchTransfer(state, transferId);
  if (!record) return undefined;
  return {
    ...record,
    bytes: copyBytes(record.bytes),
  };
}

function touchTransfer(
  state: InMemoryReaderResourceTransferStoreState,
  transferId: string,
): InMemoryReaderResourceTransferRecord | undefined {
  const record = state.transfers.get(transferId);
  if (!record) return undefined;
  state.transfers.delete(transferId);
  state.transfers.set(transferId, record);
  return record;
}

function defaultTransferId(
  _transferInput: StoreReaderResourceTransferInput,
  sequence: number,
): string {
  return `transfer-${String(sequence)}`;
}

function transferRecord(
  transferId: string,
  input: StoreReaderResourceTransferInput,
): InMemoryReaderResourceTransferRecord {
  return {
    transferId,
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    resource: input.resource,
    bytes: copyBytes(input.bytes),
    byteLength: input.bytes.byteLength,
    leaseCount: 1,
    ...(input.mediaType !== undefined ? { mediaType: input.mediaType } : {}),
  };
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

function releaseTransfer(
  state: InMemoryReaderResourceTransferStoreState,
  transferId: string,
): boolean {
  const record = state.transfers.get(transferId);
  if (!record) return false;
  record.leaseCount--;
  if (record.leaseCount <= 0) removeTransfer(state, transferId);
  return true;
}

function releaseTransfers(
  state: InMemoryReaderResourceTransferStoreState,
  input: ReleaseReaderResourceTransfersInput,
): number {
  let released = 0;
  for (const [transferId, record] of state.transfers) {
    if (record.sessionId !== input.sessionId) continue;
    if (input.revisionId !== undefined && record.revisionId !== input.revisionId) continue;
    removeTransfer(state, transferId);
    released++;
  }
  return released;
}

function assertTransferLimits(
  state: InMemoryReaderResourceTransferStoreState,
  transferId: string,
): void {
  if (state.transfers.size > state.maxTransfers) {
    throw new Error(`Reader resource transfer ${transferId} would exceed maxTransfers`);
  }
  if (state.currentTransferBytes > state.maxTransferBytes) {
    throw new Error(`Reader resource transfer ${transferId} would exceed maxTransferBytes`);
  }
}

function removeTransfer(state: InMemoryReaderResourceTransferStoreState, transferId: string): void {
  const record = state.transfers.get(transferId);
  if (!record) return;
  state.transfers.delete(transferId);
  state.currentTransferBytes -= record.byteLength;
}
