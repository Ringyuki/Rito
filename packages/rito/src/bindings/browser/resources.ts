import {
  type BrowserReaderDecodedImage,
  closeBrowserReaderDecodedImage,
  evictColdBrowserReaderDecodedImages,
  registerDecodedImageObjectUrl,
} from './decoded-image-cache';
import type { BrowserReaderRevisionHandle, BrowserReaderState } from './reader/types';
import type {
  BrowserReaderResourceBytes,
  CoreRevisionHandle,
  CoreResourceKind,
} from './core-contracts';
import {
  ensureHostFontFamilyMetrics,
  ensureHostFontVerticalMetrics,
  ensureHostGenericSerifMetrics,
} from './font-metrics';
import { isCurrentRevisionHandle } from './reader/pipeline/revision-handle';
import { trackBrowserReaderHostTask } from './reader-host-tasks';
import { prepareBrowserReaderRevisionFonts } from './publication-fonts';
import {
  BrowserReaderImageResourceError,
  type BrowserReaderImageLoadOutcome,
  type BrowserReaderImageResourceFailureReason,
} from './image-resource-error';
import type { BrowserReaderWorkerRevisionHandle } from './reader/types';

export {
  browserFontFaceRegistry,
  prepareBrowserReaderRevisionFonts,
  unregisterReaderFonts,
  type BrowserFontFaceRegistry,
} from './publication-fonts';

export function createBrowserReaderResourceState(): Pick<
  BrowserReaderState,
  | 'pendingImageLoads'
  | 'imageResourceFailures'
  | 'settledImageResourceSpreads'
  | 'images'
  | 'registeredFontFaces'
> {
  return {
    pendingImageLoads: new Map(),
    imageResourceFailures: new Map(),
    settledImageResourceSpreads: new Set(),
    images: new Map(),
    registeredFontFaces: new Map(),
  };
}

export interface BrowserReaderMissingFrameResource {
  readonly kind: CoreResourceKind;
  readonly href: string;
  readonly message: string;
}

export async function preloadReaderFonts(state: BrowserReaderState): Promise<boolean> {
  const verticalDemands = state.revisionBundle.fontVerticalMetricDemands ?? [];
  if (state.pinnedFonts.summary.faces.length > 0) {
    return ensureHostFontVerticalMetrics(state.fontMetrics, state.ctx, verticalDemands);
  }
  const revision = state.revisionHandle;
  if (!revision) return false;
  const worker = state.worker;
  if (worker.sessionId !== revision.workerSessionId || !isCurrentRevisionHandle(state, revision))
    return false;
  const registeredBefore = state.registeredFontFaces.size;
  let metricsChanged = ensureHostGenericSerifMetrics(state.fontMetrics, state.ctx);
  const publicationFontsReady = await prepareBrowserReaderRevisionFonts(
    state,
    worker,
    revision,
    () => isCurrentRevisionHandle(state, revision),
  );
  if (!isCurrentRevisionHandle(state, revision)) return false;
  if (publicationFontsReady) {
    metricsChanged =
      ensureHostFontFamilyMetrics(
        state.fontMetrics,
        state.ctx,
        [...state.registeredFontFaces.values()].map((face) => face.family),
      ) || metricsChanged;
    metricsChanged =
      ensureHostFontVerticalMetrics(state.fontMetrics, state.ctx, verticalDemands) ||
      metricsChanged;
  }
  if (state.registeredFontFaces.size > registeredBefore) {
    for (const spreadIndex of [...state.frames.keys()])
      notifySpreadContentInvalidated(state, spreadIndex);
  }
  return metricsChanged;
}

export async function preloadCurrentReaderFonts(state: BrowserReaderState): Promise<boolean> {
  let revision: BrowserReaderRevisionHandle | undefined;
  let metricsChanged = false;
  do {
    revision = state.revisionHandle;
    metricsChanged = (await preloadReaderFonts(state)) || metricsChanged;
  } while (!state.disposed && revision !== state.revisionHandle);
  return metricsChanged;
}

export async function preloadFrameResourceBytes(
  state: BrowserReaderState,
  resources: readonly BrowserReaderResourceBytes[],
  revision?: BrowserReaderRevisionHandle,
): Promise<void> {
  await Promise.all(
    resources
      .filter((resource) => resource.payload.kind === 'image')
      .map((resource) =>
        preloadImageBytes(
          state,
          resource.payload.href,
          resource.payload.mediaType,
          resource.bytes,
          revision,
        ),
      ),
  );
}

export function recordMissingFrameImageResources(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  resources: readonly BrowserReaderMissingFrameResource[],
): void {
  for (const resource of resources) {
    if (resource.kind !== 'image' || state.images.has(resource.href)) continue;
    recordImageFailure(state, revision, resource.href, {
      status: 'failed',
      reason: 'resource-unavailable',
      detail: resource.message,
    });
  }
}

export function frameImageResourcesAreLoadingOrSettled(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  hrefs: readonly string[],
): boolean {
  return hrefs.every(
    (href) =>
      state.images.has(href) ||
      state.pendingImageLoads.has(href) ||
      imageFailureAtRevision(state, revision, href) !== undefined,
  );
}

export function frameImageResourcesAreSettled(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  hrefs: readonly string[],
): boolean {
  return hrefs.every(
    (href) => state.images.has(href) || imageFailureAtRevision(state, revision, href) !== undefined,
  );
}

/**
 * Render-time self-heal: a bitmap that is neither decoded, loading, nor
 * terminally failed was never delivered at all — a frame-window prefetch
 * that aborted, an evicted decode, a keying miss. Fetch its bytes
 * directly so a spread can never be stranded painting the previous
 * canvas (degrade-never-block). Terminal failures record so the paint
 * path stops waiting; successes invalidate every cached frame that
 * references the image.
 */
export function ensureFrameImageResourceLoaded(state: BrowserReaderState, href: string): void {
  const revision = state.revisionHandle;
  if (!revision || state.disposed) return;
  if (
    state.images.has(href) ||
    state.pendingImageLoads.has(href) ||
    imageFailureAtRevision(state, revision, href) !== undefined
  ) {
    return;
  }
  const worker = state.worker;
  if (worker.sessionId !== revision.workerSessionId || !isCurrentRevisionHandle(state, revision)) {
    return;
  }
  const task: Promise<BrowserReaderImageLoadOutcome> = worker
    .readResourceAtRevision(coreRevisionHandle(revision), 'image', href)
    .then(
      ({ value }) => loadImageBytes(state, href, value.payload.mediaType, value.bytes),
      (error): BrowserReaderImageLoadOutcome => ({
        status: 'failed',
        reason: 'resource-unavailable',
        detail: String(error).slice(0, 400),
      }),
    )
    .then((outcome) => {
      if (outcome.status === 'failed') recordImageFailure(state, revision, href, outcome);
      return outcome;
    });
  const tracked = { task };
  state.pendingImageLoads.set(href, tracked);
  void trackBrowserReaderHostTask(
    state,
    task.then(() => {
      if (state.pendingImageLoads.get(href) === tracked) state.pendingImageLoads.delete(href);
      if (state.disposed) return;
      // Decoded or terminally failed, the spread can now paint (with or
      // without the image); wake everyone holding the previous canvas.
      for (const [spreadIndex, frame] of state.frames) {
        if (frame.resourceRefs.images.includes(href)) {
          notifySpreadContentInvalidated(state, spreadIndex);
        }
      }
    }),
  );
}

/** Called before painting so a terminal resource never becomes an endless false/warm loop. */
export function throwIfBrowserReaderImageResourceFailed(
  state: BrowserReaderState,
  href: string,
): void {
  const revision = state.revisionHandle;
  if (!revision) return;
  const failure = imageFailureAtRevision(state, revision, href);
  if (failure) throw failure.error;
}

export async function getImageObjectUrl(
  state: BrowserReaderState,
  href: string,
): Promise<string | undefined> {
  if (typeof URL === 'undefined') return undefined;
  try {
    const revision = state.revisionHandle;
    if (!revision) return undefined;
    const worker = state.worker;
    if (worker.sessionId !== revision.workerSessionId || !isCurrentRevisionHandle(state, revision))
      return undefined;
    const { payload, bytes } = (
      await worker.readResourceAtRevision(coreRevisionHandle(revision), 'image', href)
    ).value;
    if (!isCurrentRevisionHandle(state, revision)) return undefined;
    return URL.createObjectURL(new Blob([ownedArrayBuffer(bytes)], { type: payload.mediaType }));
  } catch {
    // Lightbox URLs are optional; rendering uses the independently decoded bitmap cache.
    return undefined;
  }
}

function notifySpreadContentInvalidated(state: BrowserReaderState, spreadIndex: number): void {
  for (const cb of state.spreadContentInvalidatedListeners) cb(spreadIndex);
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function preloadImageBytes(
  state: BrowserReaderState,
  href: string,
  mediaType: string,
  bytes: Uint8Array,
  revision: BrowserReaderRevisionHandle | undefined,
): Promise<void> {
  if (state.images.has(href)) return;
  const pending = state.pendingImageLoads.get(href);
  if (pending) {
    const outcome = await pending.task;
    if (revision && outcome.status === 'failed') recordImageFailure(state, revision, href, outcome);
    return;
  }
  const load = { task: loadImageBytes(state, href, mediaType, bytes) };
  const task = load.task.then((outcome) => {
    if (revision && outcome.status === 'failed') recordImageFailure(state, revision, href, outcome);
    return outcome;
  });
  const tracked = { task };
  state.pendingImageLoads.set(href, tracked);
  await task.finally(() => {
    if (state.pendingImageLoads.get(href) === tracked) state.pendingImageLoads.delete(href);
  });
}

/**
 * Element-sourced decode where a DOM exists (bit-parity with the browser
 * raster), natural-size ImageBitmap elsewhere. Deliberately NOT an async
 * function: the bitmap path must add no extra microtask over a direct
 * `createImageBitmap` call — decode completion notifications are awaited
 * with exact tick counts by callers.
 */
function decodeReaderImage(
  bytes: Uint8Array,
  mediaType: string,
): Promise<BrowserReaderDecodedImage> | undefined {
  if (typeof Blob !== 'function') return undefined;
  const blob = new Blob([ownedArrayBuffer(bytes)], { type: mediaType });
  const bitmapFallback =
    typeof createImageBitmap === 'function' ? () => createImageBitmap(blob) : undefined;
  if (
    typeof Image === 'function' &&
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function'
  ) {
    return decodeReaderImageElement(blob).then((element) => {
      if (element) return element;
      if (!bitmapFallback) throw new Error('image element decode failed without a bitmap path');
      return bitmapFallback();
    });
  }
  return bitmapFallback?.();
}

async function decodeReaderImageElement(blob: Blob): Promise<HTMLImageElement | undefined> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const element = new Image();
    element.src = objectUrl;
    await element.decode();
    // A decode that reports no raster (a stub DOM, a broken image) falls
    // back to the bitmap path instead of caching a blank.
    if (element.naturalWidth > 0 && element.naturalHeight > 0) {
      registerDecodedImageObjectUrl(element, objectUrl);
      return element;
    }
  } catch {
    // An element decode that fails (a DOM stub without a loader, a codec
    // gap) is not fatal; the caller's bitmap path still decodes.
  }
  URL.revokeObjectURL(objectUrl);
  return undefined;
}

async function loadImageBytes(
  state: BrowserReaderState,
  href: string,
  mediaType: string,
  bytes: Uint8Array,
): Promise<BrowserReaderImageLoadOutcome> {
  const decoding = decodeReaderImage(bytes, mediaType);
  if (decoding === undefined) return { status: 'failed', reason: 'unsupported-runtime' };
  try {
    const image = await decoding;
    if (state.disposed) {
      closeBrowserReaderDecodedImage(image);
      return { status: 'failed', reason: 'decode-failed' };
    }
    const previous = state.images.get(href);
    if (previous) closeBrowserReaderDecodedImage(previous);
    state.images.set(href, image);
    evictColdBrowserReaderImages(state);
    return { status: 'ready' };
  } catch {
    return { status: 'failed', reason: 'decode-failed' };
  }
}

/**
 * Keeps decoded-bitmap residency under its byte budget. Pending loads and the
 * active spread's own frame references stay resident so the visible canvas
 * and in-flight decodes are never invalidated by their own eviction.
 */
function evictColdBrowserReaderImages(state: BrowserReaderState): void {
  const protectedHrefs = new Set(state.pendingImageLoads.keys());
  const activeFrame = state.frames.get(state.activeSpreadIndex);
  for (const href of activeFrame?.resourceRefs.images ?? []) protectedHrefs.add(href);
  evictColdBrowserReaderDecodedImages(state.images, protectedHrefs);
}

function recordImageFailure(
  state: BrowserReaderState,
  revision: BrowserReaderRevisionHandle,
  href: string,
  outcome: Extract<BrowserReaderImageLoadOutcome, { readonly status: 'failed' }>,
): void {
  if (state.disposed || !sameWorkerRevision(state.revisionHandle, revision)) return;
  const previous = imageFailureAtRevision(state, revision, href);
  if (previous) return;
  state.imageResourceFailures.set(href, {
    revision: workerRevision(revision),
    error: imageResourceError(outcome.reason, href, revision, outcome.detail),
  });
}

function imageFailureAtRevision(
  state: BrowserReaderState,
  revision: BrowserReaderWorkerRevisionHandle,
  href: string,
) {
  const failure = state.imageResourceFailures.get(href);
  return failure && sameWorkerRevision(failure.revision, revision) ? failure : undefined;
}

function sameWorkerRevision(
  left: BrowserReaderWorkerRevisionHandle | undefined,
  right: BrowserReaderWorkerRevisionHandle,
): boolean {
  return (
    left !== undefined &&
    left.workerSessionId === right.workerSessionId &&
    left.revisionId === right.revisionId &&
    left.revisionVersion === right.revisionVersion
  );
}

function workerRevision(revision: BrowserReaderRevisionHandle): BrowserReaderWorkerRevisionHandle {
  return {
    workerSessionId: revision.workerSessionId,
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}

function imageResourceError(
  reason: BrowserReaderImageResourceFailureReason,
  href: string,
  revision: BrowserReaderRevisionHandle,
  detail: string | undefined,
): BrowserReaderImageResourceError {
  return new BrowserReaderImageResourceError(
    reason,
    href,
    revision.revisionId,
    revision.revisionVersion,
    detail,
  );
}

function coreRevisionHandle(revision: CoreRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}
