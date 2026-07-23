import type {
  BrowserReaderWorkerClient,
  CoreRequiredFontFace,
  CoreRevisionHandle,
  CoreRevisionBundle,
} from './core-contracts';
import type { BrowserReaderState } from './reader/types';
import type { BrowserFontFaceRegistry } from './resources';

interface PendingRequiredFontFace {
  readonly key: string;
  readonly face: CoreRequiredFontFace;
}

interface PreparedRequiredFontFace {
  readonly key: string;
  readonly face: FontFace;
}

export function prepareControllerOwnedRevisionFonts(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  bundle: CoreRevisionBundle,
  isCurrent: () => boolean,
): Promise<(() => void) | undefined> {
  return prepareRevisionFonts(state, worker, bundle, isCurrent);
}

async function prepareRevisionFonts(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  bundle: CoreRevisionBundle,
  isCurrent: () => boolean,
): Promise<(() => void) | undefined> {
  const rollback = await registerRequiredRevisionFonts(state, worker, bundle, isCurrent);
  if (isCurrent()) return rollback;
  rollback();
  return undefined;
}

async function registerRequiredRevisionFonts(
  state: BrowserReaderState,
  worker: BrowserReaderWorkerClient,
  bundle: CoreRevisionBundle,
  isCurrent: () => boolean,
): Promise<() => void> {
  if (state.pinnedFonts.summary.faces.length === 0) return noopRollback;
  const manifest = bundle.requiredFontFaces;
  if (!manifest || manifest.revisionId !== bundle.revision.revisionId) {
    throw new Error('Pinned reader revision is missing its required font manifest');
  }
  const registry = state.pinnedFonts.registry;
  if (typeof FontFace === 'undefined' || !registry) {
    throw new Error('Pinned reader required fonts need FontFace and a mutable FontFaceSet');
  }
  const pending = pendingRequiredFontFaces(state, manifest.faces);
  if (pending.length === 0) return noopRollback;
  const sources = await requiredFontSources(worker, bundle.revision, pending);
  const prepared = await Promise.all(
    pending.map(async ({ face, key }) => {
      const source = sources.get(face.href);
      if (!source) throw new Error('Pinned reader required font source is unavailable');
      // A face the canvas sanitizer rejects is skipped: paint falls
      // through the family stack instead of the book failing to open.
      try {
        const loaded = new FontFace(face.family, source, {
          style: face.style,
          weight: String(face.weight),
        });
        await loaded.load();
        return { key, face: loaded };
      } catch (error) {
        console.warn(
          `[rito] required font could not be loaded, paint falls back: ${face.family} (${face.href}): ${String(error)}`,
        );
        return undefined;
      }
    }),
  );
  if (!isCurrent()) return noopRollback;
  return commitRequiredFontFaces(
    state,
    prepared.filter((face) => face !== undefined),
    registry,
  );
}

function pendingRequiredFontFaces(
  state: BrowserReaderState,
  faces: readonly CoreRequiredFontFace[],
): PendingRequiredFontFace[] {
  const pending: PendingRequiredFontFace[] = [];
  for (const face of faces) {
    const key = requiredFontFaceKey(face);
    const prefix = `required\u0000${String(face.sourceOrder)}\u0000`;
    const existing = [...state.registeredFontFaces.keys()].find((value) =>
      value.startsWith(prefix),
    );
    if (existing === key) continue;
    if (existing !== undefined) {
      throw new Error('Pinned reader required font contract changed across revisions');
    }
    pending.push({ key, face });
  }
  return pending;
}

async function requiredFontSources(
  worker: BrowserReaderWorkerClient,
  revision: CoreRevisionHandle,
  pending: readonly PendingRequiredFontFace[],
): Promise<Map<string, ArrayBuffer>> {
  const contracts = new Map<string, CoreRequiredFontFace>();
  for (const { face } of pending) {
    const existing = contracts.get(face.href);
    if (existing) {
      if (
        existing.byteLength !== face.byteLength ||
        existing.shapeFingerprint !== face.shapeFingerprint
      ) {
        throw new Error('Pinned reader required font resource contract is inconsistent');
      }
      continue;
    }
    contracts.set(face.href, face);
  }
  return new Map(
    await Promise.all(
      [...contracts].map(
        async ([href, face]) =>
          [href, await readRequiredFontSource(worker, revision, face)] as const,
      ),
    ),
  );
}

async function readRequiredFontSource(
  worker: BrowserReaderWorkerClient,
  revision: CoreRevisionHandle,
  face: CoreRequiredFontFace,
): Promise<ArrayBuffer> {
  const { payload, bytes } = (
    await worker.readResourceAtRevision(coreRevisionHandle(revision), 'font', face.href)
  ).value;
  if (
    payload.revisionId !== revision.revisionId ||
    payload.kind !== 'font' ||
    payload.href !== face.href ||
    payload.byteLength !== face.byteLength ||
    bytes.byteLength !== face.byteLength
  ) {
    throw new Error('Pinned reader required font bytes do not match their manifest');
  }
  const source = ownedArrayBuffer(bytes);
  await requireShapeFingerprint(source, face.shapeFingerprint);
  return source;
}

async function requireShapeFingerprint(source: ArrayBuffer, expected: string): Promise<void> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', source));
  let actual = '';
  for (const byte of digest.subarray(0, 8)) {
    actual += byte.toString(16).padStart(2, '0');
  }
  if (actual !== expected) {
    throw new Error('Pinned reader required font fingerprint mismatch');
  }
}

function commitRequiredFontFaces(
  state: BrowserReaderState,
  prepared: readonly PreparedRequiredFontFace[],
  registry: BrowserFontFaceRegistry,
): () => void {
  const committed: PreparedRequiredFontFace[] = [];
  const rollback = (): void => {
    rollbackRequiredFontFaces(state, committed, registry);
  };
  try {
    for (const item of prepared) {
      registry.add(item.face);
      state.registeredFontFaces.set(item.key, item.face);
      committed.push(item);
    }
  } catch (error) {
    rollback();
    throw error;
  }
  return rollback;
}

function rollbackRequiredFontFaces(
  state: BrowserReaderState,
  committed: readonly PreparedRequiredFontFace[],
  registry: BrowserFontFaceRegistry,
): void {
  for (const item of committed) {
    if (state.registeredFontFaces.get(item.key) !== item.face) continue;
    try {
      registry.delete(item.face);
    } catch {
      // Preserve the failure or stale-result decision that triggered rollback.
    }
    state.registeredFontFaces.delete(item.key);
  }
}

function requiredFontFaceKey(face: CoreRequiredFontFace): string {
  return [
    'required',
    face.sourceOrder,
    face.shapeFingerprint,
    face.byteLength,
    face.family,
    face.href,
    face.style,
    face.weight,
  ].join('\u0000');
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

function noopRollback(): void {}

function coreRevisionHandle(revision: CoreRevisionHandle): CoreRevisionHandle {
  return {
    revisionId: revision.revisionId,
    revisionVersion: revision.revisionVersion,
  };
}
