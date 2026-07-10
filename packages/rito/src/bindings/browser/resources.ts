import type { BrowserReaderState } from './reader/types';
import type { BrowserReaderResourceBytes } from './core-contracts';

export async function preloadReaderFonts(state: BrowserReaderState): Promise<void> {
  const revisionId = state.revisionBundle.revision.revisionId;
  const registeredBefore = state.registeredFontFaces.size;
  await registerRevisionFonts(state);
  if (state.disposed || state.revisionBundle.revision.revisionId !== revisionId) return;
  if (state.registeredFontFaces.size > registeredBefore) {
    for (const spreadIndex of [...state.frames.keys()])
      notifySpreadContentInvalidated(state, spreadIndex);
  }
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

async function registerRevisionFonts(state: BrowserReaderState): Promise<void> {
  if (typeof FontFace === 'undefined' || !('fonts' in document)) return;
  const faces = state.publication.fontFaces;
  if (faces.length === 0) {
    await registerSingleFontFallback(state);
    return;
  }
  await Promise.all(
    faces.map((face) =>
      registerFontFace(state, {
        family: face.family,
        href: face.href,
        style: face.style,
        weight: face.weight,
      }).catch(() => undefined),
    ),
  );
}

async function registerSingleFontFallback(state: BrowserReaderState): Promise<void> {
  const family = state.revisionBundle.fontFamilies[0];
  const font = state.publication.resources.fonts[0];
  if (!family || !font || state.publication.resources.fonts.length !== 1) return;
  await registerFontFace(state, { family, href: font.href }).catch(() => undefined);
}

async function registerFontFace(
  state: BrowserReaderState,
  input: {
    readonly family: string;
    readonly href: string;
    readonly style?: string | undefined;
    readonly weight?: string | undefined;
  },
): Promise<void> {
  const key = fontFaceKey(input);
  if (state.registeredFontFaces.has(key)) return;
  const { bytes } = await state.worker.readResource(
    state.revisionBundle.revision.revisionId,
    'font',
    input.href,
  );
  const face = new FontFace(input.family, ownedArrayBuffer(bytes), fontFaceDescriptors(input));
  await face.load();
  document.fonts.add(face);
  state.registeredFontFaces.set(key, face);
}

function fontFaceDescriptors(input: {
  readonly style?: string | undefined;
  readonly weight?: string | undefined;
}): FontFaceDescriptors {
  return {
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  };
}

function fontFaceKey(input: {
  readonly family: string;
  readonly href: string;
  readonly style?: string | undefined;
  readonly weight?: string | undefined;
}): string {
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
    const revisionId = state.revisionBundle.revision.revisionId;
    const { payload, bytes } = await state.worker.readResource(revisionId, 'image', href);
    if (
      state.disposed ||
      state.revisionBundle.revision.revisionId !== revisionId ||
      state.imageObjectUrls.has(href)
    ) {
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
