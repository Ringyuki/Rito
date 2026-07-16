import type { BrowserReaderRevisionHandle, BrowserReaderState } from './reader/types';
import type { BrowserReaderResourceBytes, CoreRevisionHandle } from './core-contracts';
import {
  ensureHostFontFamilyMetrics,
  ensureHostFontVerticalMetrics,
  ensureHostGenericSerifMetrics,
} from './font-metrics';
import { isCurrentRevisionHandle } from './reader/pipeline/revision-handle';
import { prepareBrowserReaderRevisionFonts } from './publication-fonts';

export {
  browserFontFaceRegistry,
  prepareBrowserReaderRevisionFonts,
  unregisterReaderFonts,
  type BrowserFontFaceRegistry,
} from './publication-fonts';

export function createBrowserReaderResourceState(): Pick<
  BrowserReaderState,
  'pendingImageLoads' | 'images' | 'registeredFontFaces'
> {
  return {
    pendingImageLoads: new Map(),
    images: new Map(),
    registeredFontFaces: new Map(),
  };
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
): Promise<void> {
  if (typeof createImageBitmap === 'undefined') return;
  await Promise.all(
    resources
      .filter((resource) => resource.payload.kind === 'image')
      .map((resource) =>
        preloadImageBytes(
          state,
          resource.payload.href,
          resource.payload.mediaType,
          resource.bytes,
        ).catch(() => undefined),
      ),
  );
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
): Promise<void> {
  if (state.images.has(href)) return;
  const pending = state.pendingImageLoads.get(href);
  if (pending) {
    await pending;
    if (state.images.has(href)) return;
  }
  const task = loadImageBytes(state, href, mediaType, bytes).finally(() => {
    state.pendingImageLoads.delete(href);
  });
  state.pendingImageLoads.set(href, task);
  return task;
}

async function loadImageBytes(
  state: BrowserReaderState,
  href: string,
  mediaType: string,
  bytes: Uint8Array,
): Promise<void> {
  const image = await createImageBitmap(new Blob([ownedArrayBuffer(bytes)], { type: mediaType }));
  if (state.disposed) {
    image.close();
    return;
  }
  const previous = state.images.get(href);
  previous?.close();
  state.images.set(href, image);
}

function coreRevisionHandle(revision: CoreRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}
