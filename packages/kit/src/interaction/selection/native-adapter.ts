import type { ReaderTextPoint, ReaderTextSelectionInteractions } from '@ritojs/core';
import type { Rect } from '../layout-types';
import type { SelectionEngine, NativeSelectionProjection, PointerInput } from './engine';
import { createNativeSelectionEngine } from './native-engine';
import type { NativeSelectionGranularity, NativeSelectionSnapshot } from './native-types';

interface AdapterData {
  readonly native: ReturnType<typeof createNativeSelectionEngine>;
  readonly listeners: Set<Parameters<SelectionEngine['onSelectionChange']>[0]>;
  readonly errorListeners: Set<(error: unknown) => void>;
  projection: NativeSelectionProjection | undefined;
  lastValidPoint: ReaderTextPoint | undefined;
  projectedRects: readonly Rect[];
  projectedFocusRect: Rect | null;
  disposed: boolean;
}

/** Adapt the async exact native state machine to SelectionEngine's synchronous read facade. */
export function createNativeSelectionAdapter(
  capability: ReaderTextSelectionInteractions,
): SelectionEngine {
  const errorListeners = new Set<(error: unknown) => void>();
  const data: AdapterData = {
    native: createNativeSelectionEngine(capability, {
      onError: (error) => {
        for (const listener of errorListeners) listener(error);
      },
    }),
    listeners: new Set(),
    errorListeners,
    projection: undefined,
    lastValidPoint: undefined,
    projectedRects: [],
    projectedFocusRect: null,
    disposed: false,
  };
  data.native.onChange(() => {
    handleNativeChange(data);
  });
  return buildAdapter(data);
}

function buildAdapter(data: AdapterData): SelectionEngine {
  return {
    ...buildPointerMethods(data),
    ...buildReadMethods(data),
    ...buildLifecycleMethods(data),
  };
}

function buildPointerMethods(
  data: AdapterData,
): Pick<
  SelectionEngine,
  'handlePointerDown' | 'handlePointerMove' | 'handlePointerUp' | 'setSpread'
> {
  return {
    handlePointerDown(input, granularity) {
      handleDown(data, input, granularity);
    },
    handlePointerMove(input) {
      handleMove(data, input);
    },
    handlePointerUp(input) {
      handleUp(data, input);
    },
    setSpread(_spread, _config, _measurer, projection) {
      setSpread(data, projection);
    },
  };
}

function buildReadMethods(
  data: AdapterData,
): Pick<
  SelectionEngine,
  | 'getSelection'
  | 'getSnapshot'
  | 'hasSelection'
  | 'getText'
  | 'getSourceLocator'
  | 'getRects'
  | 'getFocusRect'
  | 'getFocusEdge'
  | 'getState'
> {
  return {
    getSelection: () => null,
    getSnapshot: () => null,
    hasSelection: () => data.native.getSnapshot() !== null,
    getText: () => data.native.getSnapshot()?.text ?? '',
    getSourceLocator: () => data.native.getSnapshot()?.sourceLocator ?? null,
    getRects: () => data.projectedRects,
    getFocusRect: () => data.projectedFocusRect,
    getFocusEdge: () => getFocusEdge(data),
    getState: () => getState(data),
  };
}

function buildLifecycleMethods(
  data: AdapterData,
): Pick<SelectionEngine, 'clear' | 'invalidate' | 'dispose' | 'onSelectionChange' | 'onError'> {
  return {
    clear() {
      data.lastValidPoint = undefined;
      data.native.clear();
    },
    invalidate() {
      data.lastValidPoint = undefined;
      data.native.invalidate();
    },
    dispose() {
      disposeAdapter(data);
    },
    onSelectionChange(listener) {
      if (data.disposed) return () => undefined;
      data.listeners.add(listener);
      return () => data.listeners.delete(listener);
    },
    onError(listener) {
      if (data.disposed) return () => undefined;
      data.errorListeners.add(listener);
      return () => data.errorListeners.delete(listener);
    },
  };
}

function handleDown(
  data: AdapterData,
  input: PointerInput,
  granularity: NativeSelectionGranularity | undefined,
): void {
  if (data.disposed) return;
  const point = projectPoint(input, data.projection);
  data.lastValidPoint = point;
  if (point) data.native.handlePointerDown(point, granularity);
  else data.native.clear();
}

function handleMove(data: AdapterData, input: PointerInput): void {
  if (data.disposed) return;
  const point = projectPoint(input, data.projection);
  if (!point) return;
  data.lastValidPoint = point;
  data.native.handlePointerMove(point);
}

function handleUp(data: AdapterData, input: PointerInput): void {
  if (data.disposed) return;
  const point = projectPoint(input, data.projection) ?? data.lastValidPoint;
  data.lastValidPoint = undefined;
  if (point) data.native.handlePointerUp(point);
  else data.native.clear();
}

function setSpread(data: AdapterData, projection: NativeSelectionProjection | undefined): void {
  if (data.disposed) return;
  data.projection = projection;
  data.lastValidPoint = undefined;
  clearProjectedSelection(data);
  data.native.invalidate();
}

function handleNativeChange(data: AdapterData): void {
  const snapshot = data.native.getSnapshot();
  if (!snapshot) {
    clearProjectedSelection(data);
    notifySelection(data);
    return;
  }
  try {
    projectSnapshot(data, snapshot);
  } catch (error: unknown) {
    clearProjectedSelection(data);
    data.native.invalidate();
    notifyError(data, error);
    return;
  }
  notifySelection(data);
}

function projectSnapshot(data: AdapterData, snapshot: NativeSelectionSnapshot): void {
  const projection = data.projection;
  if (!projection) throw new Error('Native selection has no coordinate projection');
  const rects = snapshot.rects
    .filter((rect) => projection.isPageVisible(rect.pageIndex))
    .map((rect) =>
      projection.pageContentToSpread(rect.pageIndex, {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      }),
    );
  const focus = snapshot.focusCaret;
  data.projectedRects = rects;
  data.projectedFocusRect = projection.isPageVisible(focus.pageIndex)
    ? projection.pageContentToSpread(focus.pageIndex, {
        x: focus.geometry.x,
        y: focus.geometry.y,
        width: 0,
        height: focus.geometry.height,
      })
    : null;
}

function clearProjectedSelection(data: AdapterData): void {
  data.projectedRects = [];
  data.projectedFocusRect = null;
}

function notifySelection(data: AdapterData): void {
  for (const listener of data.listeners) listener(null);
}

function notifyError(data: AdapterData, error: unknown): void {
  for (const listener of data.errorListeners) listener(error);
}

function getFocusEdge(data: AdapterData): 'start' | 'end' | null {
  const direction = data.native.getSnapshot()?.focusDirection;
  if (!direction) return null;
  return direction === 'forward' ? 'end' : 'start';
}

function getState(data: AdapterData): ReturnType<SelectionEngine['getState']> {
  const state = data.native.getState();
  return state === 'disposed' ? 'idle' : state;
}

function disposeAdapter(data: AdapterData): void {
  if (data.disposed) return;
  data.disposed = true;
  data.lastValidPoint = undefined;
  data.projection = undefined;
  clearProjectedSelection(data);
  data.native.dispose();
  data.listeners.clear();
  data.errorListeners.clear();
}

function projectPoint(
  input: PointerInput,
  projection: NativeSelectionProjection | undefined,
): ReaderTextPoint | undefined {
  if (!projection) return undefined;
  return projection.spreadContentToPage(input.x, input.y) ?? undefined;
}
