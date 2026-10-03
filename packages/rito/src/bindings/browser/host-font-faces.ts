import type { ReaderHostFontFace, ReaderOptions } from '../../reader';
import type {
  BrowserReaderWorkerClient,
  CorePinnedFontFaceSummary,
  CorePinnedFontPolicySummary,
} from './core-contracts';
import type { BrowserReaderPinnedFonts } from './pinned-fonts';
import type { BrowserReaderMethodSurface } from './reader/reader-methods';
import type { BrowserReaderState } from './reader/types';

/**
 * One change to a reader's host faces after it opened. Every worker that
 * opens the document replays the changes in order, so a reflow candidate
 * shapes with exactly the faces the committed layout does.
 */
export type BrowserReaderHostFontChange =
  | { readonly kind: 'add'; readonly faces: readonly ReaderHostFontFace[] }
  | { readonly kind: 'remove'; readonly sha256s: readonly string[] };

/** Replays the changes into a freshly opened worker; returns the final summary. */
export async function replayBrowserReaderHostFontChanges(
  worker: BrowserReaderWorkerClient,
  changes: readonly BrowserReaderHostFontChange[],
): Promise<CorePinnedFontPolicySummary | undefined> {
  let summary: CorePinnedFontPolicySummary | undefined;
  for (const change of changes) {
    summary =
      change.kind === 'add'
        ? await worker.addHostFontFaces(transferableFaces(change.faces))
        : await worker.removeHostFontFaces(change.sha256s);
  }
  return summary;
}

/**
 * Adds host faces to the committed worker and registers each for paint
 * under its alias. The caller lays the book out again: the change is
 * recorded, so the reflow candidate's worker replays it.
 */
export async function addBrowserReaderHostFontFaces(
  pinned: BrowserReaderPinnedFonts,
  worker: BrowserReaderWorkerClient,
  faces: readonly ReaderHostFontFace[],
): Promise<void> {
  const owned = faces.map((face, index) => ({ ...face, bytes: ownedBytes(face.bytes, index) }));
  const summary = await worker.addHostFontFaces(transferableFaces(owned));
  const added = summary.faces.slice(-owned.length);
  await registerHostFaces(pinned, added, owned);
  pinned.changes.push({ kind: 'add', faces: owned });
  pinned.summary = summary;
}

/** Removes host faces from the committed worker and from paint. */
export async function removeBrowserReaderHostFontFaces(
  pinned: BrowserReaderPinnedFonts,
  worker: BrowserReaderWorkerClient,
  sha256s: readonly string[],
): Promise<void> {
  const summary = await worker.removeHostFontFaces(sha256s);
  const kept = new Set(summary.faces.map((face) => face.familyAlias));
  for (const [alias, face] of pinned.faces) {
    if (kept.has(alias)) continue;
    pinned.registry?.delete(face);
    pinned.faces.delete(alias);
  }
  pinned.changes.push({ kind: 'remove', sha256s: [...sha256s] });
  pinned.summary = summary;
}

async function registerHostFaces(
  pinned: BrowserReaderPinnedFonts,
  summaries: readonly CorePinnedFontFaceSummary[],
  faces: readonly ReaderHostFontFace[],
): Promise<void> {
  const registry = pinned.registry;
  if (!registry) throw new Error('Browser host fonts require a FontFaceSet');
  const loaded = await Promise.all(
    summaries.map(async (summary, index) => {
      const face = new FontFace(summary.familyAlias, faces[index]?.bytes ?? new ArrayBuffer(0), {
        style: summary.style,
        weight: String(summary.weight),
      });
      await face.load();
      return { alias: summary.familyAlias, face };
    }),
  );
  for (const { alias, face } of loaded) {
    registry.add(face);
    pinned.faces.set(alias, face);
  }
}

/** Copies the faces' bytes for a worker to take: the retained ones are replayed. */
function transferableFaces(faces: readonly ReaderHostFontFace[]): ReaderHostFontFace[] {
  return faces.map((face) => ({ ...face, bytes: face.bytes.slice(0) }));
}

function ownedBytes(bytes: ArrayBuffer, index: number): ArrayBuffer {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength === 0) {
    throw new TypeError(`Host font face ${String(index)} bytes must be a non-empty ArrayBuffer`);
  }
  return bytes.slice(0);
}

type Reflow = (next?: ReaderOptions, force?: boolean) => void;

/**
 * The reader's fonts: the catalog a host builds its font choices from, the
 * names a choice would skip, and host faces added or removed while the
 * book is open. A change lays the book out again (forced: the layout
 * options did not change, the faces they resolve to did).
 */
export function browserReaderFontMethods(
  state: BrowserReaderState,
  layoutOptions: () => ReaderOptions,
  reflow: Reflow,
): Pick<
  BrowserReaderMethodSurface,
  'fonts' | 'unresolvedFontFamilies' | 'addFontFaces' | 'removeFontFaces'
> {
  return {
    fonts: () => state.worker.fontCatalog(),
    unresolvedFontFamilies: (familyList) => state.worker.unresolvedFontFamilies(familyList),
    async addFontFaces(faces) {
      if (faces.length === 0) return;
      await addBrowserReaderHostFontFaces(state.pinnedFonts, state.worker, faces);
      reflow(layoutOptions(), true);
    },
    async removeFontFaces(sha256s) {
      if (sha256s.length === 0) return;
      await removeBrowserReaderHostFontFaces(state.pinnedFonts, state.worker, sha256s);
      reflow(layoutOptions(), true);
    },
  };
}
