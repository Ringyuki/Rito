import { readerEventLogEntries } from '../reader-event-log';
import { ensureSessionReaderFrame } from './frames';
import type { SessionReaderState } from './state';

/**
 * Conformance-instrument surface: read-only views of the live reader the
 * pixel oracle uses to tell a layout defect from a delivery defect.
 */
export function installSessionReaderDiagnostics(state: SessionReaderState): void {
  (globalThis as { __ritoReaderDiagnostics?: unknown }).__ritoReaderDiagnostics = {
    /** What the committed layout covers and how many layouts were committed before it. */
    layout: () => ({
      scope: state.view.scope,
      pageCount: state.view.pageCount,
      spreadCount: state.view.spreads.length,
      generation: state.layoutGeneration,
    }),
    /** The artifact a spread is painted from, loading the spread when it is not held. */
    artifact: async (spreadIndex: number) =>
      (await ensureSessionReaderFrame(state, spreadIndex))?.artifact,
    // Whether every image the spread draws has settled: landed, or failed
    // for good. A spread paints before its images do and paints again as
    // each lands, so a harness that screenshots on arrival can capture a
    // placeholder — it must await this first. False means the spread is
    // not in the committed layout.
    spreadImagesSettled: async (spreadIndex: number) => {
      const frame = await ensureSessionReaderFrame(state, spreadIndex);
      if (!frame) return false;
      await frame.prepared.imagesSettled;
      return true;
    },
    /** The reader's work on artifacts: whether an operation runs, and how many wait. */
    queue: () => ({
      running: state.queue.running,
      asked: state.queue.asked.length,
      ahead: state.queue.ahead.length,
    }),
    /** Publication faces the browser refused to decode, laid out without. */
    rejectedFontFamilies: () => [...state.rejectedFontFamilies],
    /**
     * What every reader on this page asked its session and was answered,
     * with timings, warnings and layout commits, oldest first: what a
     * report of something going wrong should carry.
     */
    log: () => readerEventLogEntries(),
  };
}
