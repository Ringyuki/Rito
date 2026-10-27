import type { Reader, ReaderExactSourceRangeRequest, ReaderTextPoint } from '@ritojs/core';
import { createNativeSelectionEngine } from '../interaction/selection/native-engine';
import type {
  NativeSelectionCapability,
  NativeSelectionEngine,
  NativeSelectionGranularity,
  NativeSelectionSnapshot,
} from '../interaction/selection/native-types';

/**
 * Text selected in a scrolled view, through the reader's own text
 * selection: points are page points of the windows (see `pointAt`), so a
 * selection runs on from one window into the next.
 */
export interface ScrollSelection {
  begin(point: ReaderTextPoint, granularity: NativeSelectionGranularity): void;
  move(point: ReaderTextPoint): void;
  end(point: ReaderTextPoint): void;
  clear(): void;
  /** What is selected, as a gesture selects it and once it has. */
  readonly snapshot: NativeSelectionSnapshot | null;
  /** Whether a gesture is selecting. */
  readonly selecting: boolean;
  /** Counts every change of what is selected. */
  readonly version: number;
  /** Before a layout is replaced: where the selection reads in the source. */
  carry(): ReaderExactSourceRangeRequest | null;
  /** Shows a carried selection again in the layout just committed. */
  restore(carried: ReaderExactSourceRangeRequest | null): void;
  dispose(): void;
}

/** A scrolled view's selection; undefined for a reader that cannot select text. */
export function createScrollSelection(
  reader: Reader,
  changed: () => void,
): ScrollSelection | undefined {
  const capability = reader.interactions?.textSelection;
  if (capability === undefined) return undefined;
  const engine = createNativeSelectionEngine(capability, { onError: report });
  let version = 0;
  const stop = engine.onChange(() => {
    version += 1;
    changed();
  });
  return {
    begin: (point, granularity) => {
      engine.handlePointerDown(point, granularity);
    },
    move: (point) => {
      engine.handlePointerMove(point);
    },
    end: (point) => {
      engine.handlePointerUp(point);
    },
    clear: () => {
      engine.clear();
    },
    get snapshot() {
      return engine.getSnapshot();
    },
    get selecting() {
      return engine.getState() === 'selecting';
    },
    get version() {
      return version;
    },
    carry: () => carried(engine),
    restore: restorer(engine, capability),
    dispose() {
      stop();
      engine.dispose();
    },
  };
}

function report(error: unknown): void {
  console.error('[rito] the scroll view could not select text', error);
}

/** Where a selection made reads in the source, as another layout can find it. */
function carried(engine: NativeSelectionEngine): ReaderExactSourceRangeRequest | null {
  const locator = engine.getState() === 'selected' ? engine.getSnapshot()?.sourceLocator : null;
  if (!locator?.sourceRange) return null;
  return { href: locator.href, sourceRange: locator.sourceRange };
}

/**
 * Shows a carried selection in each layout committed, as a browser keeps a
 * selection through a resize: found anew in that layout, and shown unless
 * a later layout replaced it or a gesture selected meanwhile.
 */
function restorer(
  engine: NativeSelectionEngine,
  capability: NativeSelectionCapability,
): (request: ReaderExactSourceRangeRequest | null) => void {
  let layouts = 0;
  return (request) => {
    layouts += 1;
    engine.invalidate();
    if (request === null) return;
    const layout = layouts;
    capability.resolveTextRangeFromSource?.(request).then((resolution) => {
      if (layout === layouts && resolution?.status === 'resolved') {
        engine.restore(resolution.range);
      }
    }, report);
  };
}
