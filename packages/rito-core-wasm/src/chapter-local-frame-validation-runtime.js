import { validateFrameCommandBufferMetadata } from './frame-command-buffer-decoder-validation.js';
import {
  requireChapterLocalIndex,
  requireChapterLocalTransferCount,
  requireCount,
  requireMatchingChapterLocalOwner,
  requireNonEmptyString,
  requireRecord,
} from './chapter-local-owner-validation-runtime.js';

const LOCAL_TRANSFER_PREFIX = 'local-transfer-';

export function requireChapterLocalFrameBuffer(value, owner, localSpreadIndex, operation) {
  const frame = requireRecord(value, `${operation} frame`);
  const exactOwner = requireMatchingChapterLocalOwner(frame.owner, owner, `${operation} frame`);
  requireMatchingLocalSpread(frame.localSpreadIndex, localSpreadIndex, operation);
  const bytes = requireOwnedBytes(frame.bytes, `${operation} frame bytes`);
  const metadata = requireChapterLocalFrameMetadata(
    frame.metadata,
    exactOwner,
    localSpreadIndex,
    bytes,
    operation,
  );
  return { owner: exactOwner, localSpreadIndex, metadata, bytes };
}

export function requireChapterLocalFrameResources(value, owner, localSpreadIndex, operation) {
  const response = requireRecord(value, `${operation} resources`);
  const exactOwner = requireMatchingChapterLocalOwner(
    response.owner,
    owner,
    `${operation} resources`,
  );
  requireMatchingLocalSpread(response.localSpreadIndex, localSpreadIndex, operation);
  if (!Array.isArray(response.resources) || !Array.isArray(response.missingResources)) {
    throw new Error(`${operation} returned malformed chapter-local frame resources`);
  }
  const resources = response.resources.map((resource) =>
    requireChapterLocalResourceBytes(resource, exactOwner, operation),
  );
  const missingResources = response.missingResources.map((missing) =>
    requireMissingResource(missing, operation),
  );
  requireUniqueResources(resources, missingResources, operation);
  return { owner: exactOwner, localSpreadIndex, resources, missingResources };
}

export function requireReaderChapterLocalFrame(value, owner, localSpreadIndex, operation) {
  const frame = requireChapterLocalFrameBuffer(value, owner, localSpreadIndex, operation);
  const resources = requireChapterLocalFrameResources(value, owner, localSpreadIndex, operation);
  requireFrameResourceRefs(frame.metadata, resources, operation);
  return { ...frame, resources: resources.resources, missingResources: resources.missingResources };
}

export function requireRawChapterLocalResourcePrefetch(value, owner, localSpreadIndex, operation) {
  const response = requireRecord(value, `${operation} raw resources`);
  const exactOwner = requireMatchingChapterLocalOwner(
    response.owner,
    owner,
    `${operation} raw resources`,
  );
  requireMatchingLocalSpread(response.localSpreadIndex, localSpreadIndex, operation);
  if (!Array.isArray(response.payloads) || !Array.isArray(response.missingResources)) {
    throw new Error(`${operation} returned malformed raw chapter-local resources`);
  }
  const payloads = response.payloads.map((payload) =>
    requireChapterLocalResourcePayload(payload, exactOwner, operation),
  );
  const missingResources = response.missingResources.map((missing) =>
    requireMissingResource(missing, operation),
  );
  const pending = requireChapterLocalTransferCount(
    response.pendingChapterLocalTransferCount,
    operation,
  );
  if (pending < payloads.length) {
    throw new Error(`${operation} returned an inconsistent pending local transfer count`);
  }
  requireUniquePayloads(payloads, missingResources, operation);
  return {
    owner: exactOwner,
    localSpreadIndex,
    payloads,
    missingResources,
    pendingChapterLocalTransferCount: pending,
  };
}

export function requireChapterLocalResourceTransferBytes(value, payload, operation) {
  const bytes = requireOwnedBytes(value, `${operation} resource bytes`);
  if (bytes.byteLength !== payload.byteLength) {
    throw new Error(`${operation} returned resource bytes with a mismatched byteLength`);
  }
  return { payload, bytes };
}

function requireChapterLocalFrameMetadata(value, owner, localSpreadIndex, bytes, operation) {
  const metadata = requireRecord(value, `${operation} metadata`);
  requireMatchingChapterLocalOwner(metadata.owner, owner, `${operation} metadata`);
  requireMatchingLocalSpread(metadata.localSpreadIndex, localSpreadIndex, operation);
  for (const field of ['width', 'height']) {
    if (!Number.isFinite(metadata[field]) || metadata[field] < 0) {
      throw new Error(`${operation} returned invalid frame metadata ${field}`);
    }
  }
  requireNonEmptyString(metadata.commandHash, `${operation} metadata commandHash`);
  if (!Array.isArray(metadata.fontFamilies) || metadata.fontFamilies.some(notString)) {
    throw new Error(`${operation} returned invalid frame metadata font families`);
  }
  if (typeof metadata.imageDominated !== 'boolean') {
    throw new Error(`${operation} returned invalid frame metadata imageDominated`);
  }
  validateFrameCommandBufferMetadata(metadata, bytes);
  if (metadata.resourceTable.length > metadata.resourceRefCount) {
    throw new Error(`${operation} returned more unique frame resources than references`);
  }
  return metadata;
}

function requireChapterLocalResourceBytes(value, owner, operation) {
  const resource = requireRecord(value, `${operation} resource`);
  const payload = requireChapterLocalResourcePayload(resource.payload, owner, operation);
  return requireChapterLocalResourceTransferBytes(resource.bytes, payload, operation);
}

function requireChapterLocalResourcePayload(value, owner, operation) {
  const payload = requireRecord(value, `${operation} resource payload`);
  requireMatchingChapterLocalOwner(payload.owner, owner, `${operation} resource payload`);
  const transferId = requireNonEmptyString(payload.transferId, `${operation} resource transferId`);
  if (!transferId.startsWith(LOCAL_TRANSFER_PREFIX)) {
    throw new Error(`${operation} crossed a generic resource transfer into chapter-local state`);
  }
  if (payload.kind !== 'image') {
    throw new Error(`${operation} returned a non-image chapter-local frame resource`);
  }
  const href = requireNonEmptyString(payload.href, `${operation} resource href`);
  const mediaType = requireNonEmptyString(payload.mediaType, `${operation} resource mediaType`);
  const byteLength = requireCount(payload.byteLength, `${operation} resource byteLength`);
  requireOptionalU32(payload.width, `${operation} resource width`);
  requireOptionalU32(payload.height, `${operation} resource height`);
  return {
    owner,
    transferId,
    kind: payload.kind,
    href,
    mediaType,
    byteLength,
    ...(payload.width === undefined ? {} : { width: payload.width }),
    ...(payload.height === undefined ? {} : { height: payload.height }),
  };
}

function requireMissingResource(value, operation) {
  const missing = requireRecord(value, `${operation} missing resource`);
  if (missing.kind !== 'image') {
    throw new Error(`${operation} returned a non-image missing frame resource`);
  }
  return {
    kind: missing.kind,
    href: requireNonEmptyString(missing.href, `${operation} missing resource href`),
    message: requireNonEmptyString(missing.message, `${operation} missing resource message`),
  };
}

function requireFrameResourceRefs(metadata, response, operation) {
  const referenced = new Set(metadata.resourceTable);
  for (const resource of response.resources) {
    if (!referenced.has(resource.payload.href)) {
      throw new Error(`${operation} returned an unreferenced frame resource`);
    }
  }
  for (const missing of response.missingResources) {
    if (!referenced.has(missing.href)) {
      throw new Error(`${operation} returned an unreferenced missing frame resource`);
    }
  }
}

function requireUniqueResources(resources, missing, operation) {
  requireUniquePayloads(
    resources.map(({ payload }) => payload),
    missing,
    operation,
  );
}

function requireUniquePayloads(payloads, missing, operation) {
  const transferIds = new Set();
  const hrefs = new Set();
  for (const payload of payloads) {
    if (transferIds.has(payload.transferId) || hrefs.has(payload.href)) {
      throw new Error(`${operation} returned duplicate chapter-local resources`);
    }
    transferIds.add(payload.transferId);
    hrefs.add(payload.href);
  }
  for (const resource of missing) {
    if (hrefs.has(resource.href)) {
      throw new Error(`${operation} returned conflicting chapter-local resource results`);
    }
    hrefs.add(resource.href);
  }
}

function requireMatchingLocalSpread(value, expected, operation) {
  const index = requireChapterLocalIndex(value, `${operation} localSpreadIndex`);
  if (index !== expected) throw new Error(`${operation} returned a mismatched localSpreadIndex`);
}

function requireOwnedBytes(value, operation) {
  if (!(value instanceof Uint8Array)) throw new Error(`${operation} must be a Uint8Array`);
  if (
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength
  ) {
    return value;
  }
  return Uint8Array.from(value);
}

function requireOptionalU32(value, operation) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)) {
    throw new Error(`${operation} must be an unsigned 32-bit integer`);
  }
}

function notString(value) {
  return typeof value !== 'string';
}
