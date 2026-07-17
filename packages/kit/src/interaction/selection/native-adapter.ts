import type { ReaderTextPoint, ReaderTextSelectionInteractions } from '@ritojs/core';
import type { Rect } from '../layout-types';
import type { SelectionEngine, NativeSelectionProjection, PointerInput } from './engine';
import type {
  SelectionHandleCarets,
  SelectionHandleDrag,
  SelectionHandleEdge,
} from './handle-types';
import { beginNativeSelectionHandleDrag } from './native-adapter-handle';
import {
  registerNativeAdapterGestureOwner,
  shouldPreserveNativeAdapterGesture,
} from './native-adapter-gesture';
import {
  projectNativeSelectionCaret,
  projectNativeSelectionPoint,
} from './native-adapter-projection';
import { getNativeSelectionFocusEdge } from './native-adapter-snapshot';
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
  projectedHandleCarets: SelectionHandleCarets | null;
  owner: SelectionEngine | undefined;
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
    projectedHandleCarets: null,
    owner: undefined,
    disposed: false,
  };
  data.native.onChange(() => {
    handleNativeChange(data);
  });
  const adapter = buildAdapter(data);
  data.owner = adapter;
  return registerNativeAdapterGestureOwner(adapter, data.native);
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
  'beginHandleDrag' | 'handlePointerDown' | 'handlePointerMove' | 'handlePointerUp' | 'setSpread'
> {
  return {
    beginHandleDrag: (edge) => beginHandleDrag(data, edge),
    handlePointerDown(input, granularity) {
      handleDown(data, input, granularity);
    },
    handlePointerMove(input) {
      handleMove(data, input);
    },
    handlePointerUp(input) {
      handleUp(data, input);
    },
    setSpread(_spread, _config, _measurer, projection, update) {
      setSpread(
        data,
        projection,
        shouldPreserveNativeAdapterGesture(
          data.owner,
          data.native,
          update?.preserveNativeHandleDrag === true,
        ),
      );
    },
  };
}

function beginHandleDrag(data: AdapterData, edge: SelectionHandleEdge): SelectionHandleDrag | null {
  if (data.disposed || !data.projection) return null;
  return beginNativeSelectionHandleDrag(data.native, edge, (input) =>
    projectNativeSelectionPoint(input, data.projection),
  );
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
  | 'getHandleCarets'
  | 'getState'
> {
  return {
    getSelection: () => null,
    getSnapshot: () => null,
    hasSelection: () => hasNonCollapsedSnapshot(data),
    getText: () => data.native.getSnapshot()?.text ?? '',
    getSourceLocator: () =>
      hasNonCollapsedSnapshot(data) ? (data.native.getSnapshot()?.sourceLocator ?? null) : null,
    getRects: () => data.projectedRects,
    getFocusRect: () => data.projectedFocusRect,
    getFocusEdge: () => getFocusEdge(data),
    getHandleCarets: () => data.projectedHandleCarets,
    getState: () => getState(data),
  };
}

function buildLifecycleMethods(
  data: AdapterData,
): Pick<
  SelectionEngine,
  'acceptRevisionAppend' | 'clear' | 'invalidate' | 'dispose' | 'onSelectionChange' | 'onError'
> {
  return {
    acceptRevisionAppend() {
      if (data.disposed) return;
      data.native.acceptRevisionAppend();
    },
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
  const point = projectNativeSelectionPoint(input, data.projection);
  data.lastValidPoint = point;
  if (point) data.native.handlePointerDown(point, granularity);
  else data.native.clear();
}

function handleMove(data: AdapterData, input: PointerInput): void {
  if (data.disposed) return;
  const point = projectNativeSelectionPoint(input, data.projection);
  if (!point) return;
  data.lastValidPoint = point;
  data.native.handlePointerMove(point);
}

function handleUp(data: AdapterData, input: PointerInput): void {
  if (data.disposed) return;
  const point = projectNativeSelectionPoint(input, data.projection) ?? data.lastValidPoint;
  data.lastValidPoint = undefined;
  if (point) data.native.handlePointerUp(point);
  else data.native.clear();
}

function setSpread(
  data: AdapterData,
  projection: NativeSelectionProjection | undefined,
  preserveNativeGesture: boolean,
): void {
  if (data.disposed) return;
  data.projection = projection;
  data.lastValidPoint = undefined;
  if (preserveNativeGesture) {
    handleNativeChange(data);
    return;
  }
  clearProjectedSelection(data);
  data.native.invalidate();
}

function handleNativeChange(data: AdapterData): void {
  const snapshot = data.native.getSnapshot();
  if (!snapshot || snapshot.text.length === 0) {
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

function hasNonCollapsedSnapshot(data: AdapterData): boolean {
  return (data.native.getSnapshot()?.text.length ?? 0) > 0;
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
  data.projectedFocusRect = projectNativeSelectionCaret(projection, focus);
  data.projectedHandleCarets = {
    start: projectNativeSelectionCaret(projection, snapshot.range.start),
    end: projectNativeSelectionCaret(projection, snapshot.range.end),
    focusEdge: getNativeSelectionFocusEdge(snapshot),
  };
}

function clearProjectedSelection(data: AdapterData): void {
  data.projectedRects = [];
  data.projectedFocusRect = null;
  data.projectedHandleCarets = null;
}

function notifySelection(data: AdapterData): void {
  for (const listener of data.listeners) listener(null);
}

function notifyError(data: AdapterData, error: unknown): void {
  for (const listener of data.errorListeners) listener(error);
}

function getFocusEdge(data: AdapterData): 'start' | 'end' | null {
  const snapshot = data.native.getSnapshot();
  return snapshot ? getNativeSelectionFocusEdge(snapshot) : null;
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
