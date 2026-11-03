import type {
  Reader,
  ReaderExactSourceRangeRequest,
  ReaderTextPoint,
  ReaderTextSelectionMovement,
  ReaderWritingMode,
} from '@ritojs/core';
import { createNativeSelectionEngine } from '../interaction/selection/native-engine';
import type {
  NativeSelectionCapability,
  NativeSelectionEngine,
  NativeSelectionGranularity,
  NativeSelectionHandleDrag,
  NativeSelectionHandleEdge,
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
  /**
   * Moves what is selected's focus by `movement`, as a Shift chord does,
   * after the movements asked for before it; false when nothing selected
   * can move.
   */
  extend(movement: ReaderTextSelectionMovement): Promise<boolean>;
  /** Drags end `edge` of what is selected; null when nothing selected can be dragged. */
  handleDrag(edge: NativeSelectionHandleEdge): NativeSelectionHandleDrag | null;
  /** What is selected, as a gesture selects it and once it has. */
  readonly snapshot: NativeSelectionSnapshot | null;
  /** Whether a gesture is selecting. */
  readonly selecting: boolean;
  /** The writing mode of the line the focus is on, which turns its arrow keys. */
  readonly focusWritingMode: ReaderWritingMode;
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
  let movements = Promise.resolve(true);
  const book = holdBookWhileSelecting(reader, engine);
  const stop = engine.onChange(() => {
    version += 1;
    book.settle();
    changed();
  });
  return {
    ...gestures(engine),
    extend(movement) {
      movements = movements.then(
        () => moved(engine, movement),
        () => false,
      );
      return movements;
    },
    handleDrag: (edge) => engine.beginHandleDrag(edge),
    get snapshot() {
      return engine.getSnapshot();
    },
    get selecting() {
      return engine.getState() === 'selecting';
    },
    get focusWritingMode() {
      return engine.getSnapshot()?.range.focus.writingMode ?? 'horizontal-tb';
    },
    get version() {
      return version;
    },
    carry: () => carried(engine),
    restore: restorer(engine, capability),
    dispose() {
      stop();
      book.release();
      engine.dispose();
    },
  };
}

/**
 * A layout replacing the one a selection is being made in would end the
 * gesture: the whole-book layout waits until the selection is made, and
 * then carries it over like any relayout (as the page controller holds it).
 */
function holdBookWhileSelecting(
  reader: Reader,
  engine: NativeSelectionEngine,
): { settle(): void; release(): void } {
  let held: (() => void) | undefined;
  const release = (): void => {
    const done = held;
    held = undefined;
    done?.();
  };
  return {
    settle() {
      const selecting = engine.getState() === 'selecting';
      if (selecting && held === undefined) held = reader.holdBookLayout?.() ?? (() => undefined);
      else if (!selecting) release();
    },
    release,
  };
}

/** A pointer's gesture selecting, and letting the selection go. */
function gestures(
  engine: NativeSelectionEngine,
): Pick<ScrollSelection, 'begin' | 'move' | 'end' | 'clear'> {
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
  };
}

/** One movement of the focus, published once it resolved. */
async function moved(
  engine: NativeSelectionEngine,
  movement: ReaderTextSelectionMovement,
): Promise<boolean> {
  const command = engine.beginKeyboardMovement(movement);
  if (command === null) return false;
  try {
    const outcome = await command.result;
    // A boundary is committed too: it keeps the line position the next
    // vertical movement starts from.
    if (outcome.status === 'cancelled') return false;
    return command.commit() && outcome.status === 'resolved';
  } finally {
    command.finish();
  }
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
