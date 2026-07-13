import type {
  BrowserReaderRevisionHandle,
  BrowserReaderState,
  BrowserReaderWorkerRevisionHandle,
} from './reader/types';
import type { BrowserReaderResourceBytes, CoreRevisionHandle } from './core-contracts';
import { ensureHostFontFamilyMetrics, ensureHostGenericSerifMetrics } from './font-metrics';
import { isCurrentRevisionHandle } from './reader/pipeline/revision-handle';

export function createBrowserReaderResourceState(): Pick<
  BrowserReaderState,
  'pendingImageLoads' | 'images' | 'imageObjectUrls' | 'registeredFontFaces'
> {
  return {
    pendingImageLoads: new Map(),
    images: new Map(),
    imageObjectUrls: new Map(),
    registeredFontFaces: new Map(),
  };
}

export async function preloadReaderFonts(state: BrowserReaderState): Promise<boolean> {
  if (state.pinnedFonts.summary.faces.length > 0) return false;
  const revision = state.revisionHandle;
  if (!revision) return false;
  const worker = state.worker;
  if (worker.sessionId !== revision.workerSessionId || !isCurrentRevisionHandle(state, revision))
    return false;
  const registeredBefore = state.registeredFontFaces.size;
  let metricsChanged = ensureHostGenericSerifMetrics(state.fontMetrics, state.ctx);
  await registerRevisionFonts(state, worker, revision);
  if (!isCurrentRevisionHandle(state, revision)) return false;
  metricsChanged =
    ensureHostFontFamilyMetrics(
      state.fontMetrics,
      state.ctx,
      [...state.registeredFontFaces.values()].map((face) => face.family),
    ) || metricsChanged;
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

export function getImageObjectUrl(state: BrowserReaderState, href: string): string | undefined {
  if (typeof URL === 'undefined') return undefined;
  const cached = state.imageObjectUrls.get(href);
  if (cached) return cached;
  void preloadImageObjectUrl(state, href);
  return undefined;
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

interface ReaderFontFaceInput {
  readonly family: string;
  readonly href: string;
  readonly style?: string | undefined;
  readonly weight?: string | undefined;
}

interface PreparedReaderFontFace {
  readonly key: string;
  readonly face: FontFace;
}

export interface BrowserFontFaceRegistry {
  readonly add: (face: FontFace) => void;
  readonly delete: (face: FontFace) => boolean;
}

async function registerRevisionFonts(
  state: BrowserReaderState,
  worker: BrowserReaderState['worker'],
  revision: BrowserReaderRevisionHandle,
): Promise<void> {
  const registry = browserFontFaceRegistry();
  if (typeof FontFace === 'undefined' || !registry) return;
  const prepared = await Promise.all(
    readerFontFaceInputs(state).map((input) =>
      prepareReaderFontFace(state, worker, revision, input).catch(() => undefined),
    ),
  );
  if (!isCurrentRevisionHandle(state, revision)) return;
  for (const item of prepared) {
    if (item) commitReaderFontFace(state, item, registry);
  }
}

function readerFontFaceInputs(state: BrowserReaderState): readonly ReaderFontFaceInput[] {
  if (state.publication.fontFaces.length > 0) return state.publication.fontFaces;
  const family = state.revisionBundle.fontFamilies[0];
  const font = state.publication.resources.fonts[0];
  if (!family || !font || state.publication.resources.fonts.length !== 1) return [];
  return [{ family, href: font.href }];
}

async function prepareReaderFontFace(
  state: BrowserReaderState,
  worker: BrowserReaderState['worker'],
  revision: BrowserReaderRevisionHandle,
  input: ReaderFontFaceInput,
): Promise<PreparedReaderFontFace | undefined> {
  const key = fontFaceKey(input);
  if (state.registeredFontFaces.has(key) || hasPinnedFontFamily(state, input.family)) return;
  const { bytes } = (
    await worker.readResourceAtRevision(coreRevisionHandle(revision), 'font', input.href)
  ).value;
  if (!isCurrentRevisionHandle(state, revision)) return;
  const face = new FontFace(input.family, ownedArrayBuffer(bytes), fontFaceDescriptors(input));
  await face.load();
  return { key, face };
}

function hasPinnedFontFamily(state: BrowserReaderState, family: string): boolean {
  const expected = asciiLowerCase(family);
  for (const alias of state.pinnedFonts.faces.keys()) {
    if (asciiLowerCase(alias) === expected) return true;
  }
  return false;
}

function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function commitReaderFontFace(
  state: BrowserReaderState,
  prepared: PreparedReaderFontFace,
  registry: BrowserFontFaceRegistry,
): void {
  if (state.registeredFontFaces.has(prepared.key)) return;
  try {
    registry.add(prepared.face);
    state.registeredFontFaces.set(prepared.key, prepared.face);
  } catch {
    // A failed face is isolated so later source-order entries can still register.
  }
}

export function unregisterReaderFonts(state: BrowserReaderState): void {
  const registry = browserFontFaceRegistry();
  if (registry) {
    for (const face of state.registeredFontFaces.values()) registry.delete(face);
  }
  state.registeredFontFaces.clear();
}

export function browserFontFaceRegistry(): BrowserFontFaceRegistry | undefined {
  if (typeof document !== 'undefined' && 'fonts' in document) return document.fonts;
  return (globalThis as typeof globalThis & { readonly fonts?: BrowserFontFaceRegistry }).fonts;
}

function fontFaceDescriptors(input: ReaderFontFaceInput): FontFaceDescriptors {
  return {
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  };
}

function fontFaceKey(input: ReaderFontFaceInput): string {
  return [input.family, input.href, input.style ?? '', input.weight ?? ''].join('\u0000');
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

async function preloadImageObjectUrl(state: BrowserReaderState, href: string): Promise<void> {
  try {
    const revision = state.revisionHandle;
    if (!revision) return;
    const worker = state.worker;
    if (worker.sessionId !== revision.workerSessionId || !isCurrentRevisionHandle(state, revision))
      return;
    const { payload, bytes } = (
      await worker.readResourceAtRevision(coreRevisionHandle(revision), 'image', href)
    ).value;
    if (!isCurrentRevisionHandle(state, revision) || state.imageObjectUrls.has(href)) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([ownedArrayBuffer(bytes)], { type: payload.mediaType }),
    );
    state.imageObjectUrls.set(href, url);
  } catch {
    // Image lightbox object URLs are opportunistic; rendering uses ImageBitmap cache.
  }
}

function coreRevisionHandle(revision: BrowserReaderWorkerRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}
