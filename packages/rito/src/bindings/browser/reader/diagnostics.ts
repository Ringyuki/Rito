import { frameImageResourcesAreSettled } from '../resources';
import { ensureFrameLoaded } from './frame-cache';
import type { BrowserReaderState } from './types';

/**
 * Conformance-instrument surface: read-only views of the live reader the
 * pixel oracle uses to tell a layout defect from a delivery defect.
 */
export function installBrowserReaderDiagnostics(state: BrowserReaderState): void {
  (globalThis as { __ritoReaderDiagnostics?: unknown }).__ritoReaderDiagnostics = {
    fontAvailabilityEpochs: () => ({
      current: state.fontAvailabilityEpoch,
      published: state.publishedFontAvailabilityEpoch,
    }),
    revision: () => state.revisionBundle.revision,
    frame: (spreadIndex: number) => ensureFrameLoaded(state, spreadIndex),
    // Whether every image the spread's frame references has settled
    // (decoded into the bitmap cache, or terminally failed). The paint
    // path deliberately keeps the PREVIOUS canvas when a bitmap is not
    // ready yet (degrade-never-block), so a harness that screenshots on
    // spread arrival can capture the prior spread's image as a ghost —
    // it must await this probe first.
    spreadImagesSettled: async (spreadIndex: number) => {
      const frame = await ensureFrameLoaded(state, spreadIndex);
      if (!frame) return false;
      const revision = state.revisionHandle;
      if (!revision) return false;
      const hrefs = frame.resourceRefs.images;
      if (hrefs.length === 0) return true;
      // Settled covers terminal failures too: a failed image never
      // repaints, so waiting beyond settlement would only hang.
      return frameImageResourcesAreSettled(state, revision, hrefs);
    },
    chapterFragmentProbe: (idref: string) =>
      state.worker.chapterFragmentProbe(state.revisionBundle.revision.revisionId, idref),
    // Per-image cache state, for wrong-plate forensics: whether the
    // bitmap decoded, a load is in flight, or a terminal failure was
    // recorded (with its reason).
    imageState: (href: string) => ({
      decoded: state.images.has(href),
      pending: state.pendingImageLoads.has(href),
      failure: state.imageResourceFailures.get(href) ?? null,
    }),
    // Raw frame-window delivery for one center spread: which spreads the
    // plan covered, which frames arrived, and per-spread payload hrefs /
    // missing records / prefetch errors — the boundary where a bitmap
    // that the frame references can silently fail to ship.
    warmFrameWindowDump: async (spreadIndex: number) => {
      const revision = state.revisionHandle;
      if (!revision) return null;
      const { value } = await state.worker.warmFrameWindowAtRevision(
        { revisionId: revision.revisionId, revisionVersion: revision.revisionVersion },
        spreadIndex,
      );
      const transport: {
        frameFaults?: readonly { spreadIndex: number; message: string }[];
      } = value;
      return {
        plan: value.plan.spreadIndexes,
        frames: value.frames.map((frame) => frame.metadata.spreadIndex),
        frameFaults: transport.frameFaults ?? null,
        spreads: value.spreads.map((spread) => ({
          spreadIndex: spread.spreadIndex,
          payloads: spread.resources.map((resource) => resource.payload.href),
          missing: spread.missingResources.map(
            (missing) => `${missing.href}: ${missing.message.slice(0, 80)}`,
          ),
          prefetchError: (spread as { prefetchError?: string }).prefetchError ?? null,
        })),
      };
    },
  };
}
