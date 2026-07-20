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

async function loadImageBytes(
  state: BrowserReaderState,
  href: string,
  mediaType: string,
  bytes: Uint8Array,
): Promise<BrowserReaderImageLoadOutcome> {
  if (typeof createImageBitmap === 'undefined') {
    return { status: 'failed', reason: 'unsupported-runtime' };
  }
  try {
    const image = await createImageBitmap(new Blob([ownedArrayBuffer(bytes)], { type: mediaType }));
    if (state.disposed) {
      image.close();
      return { status: 'failed', reason: 'decode-failed' };
    }
    const previous = state.images.get(href);
    previous?.close();
    state.images.set(href, image);
    return { status: 'ready' };
  } catch {
    return { status: 'failed', reason: 'decode-failed' };
  }
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
