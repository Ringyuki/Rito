import type { DisposableCollection } from '../../utils/disposable';
import type { WiringDeps } from '../core/wiring-deps';
import {
  refreshNativeAnnotations,
  resolveVisibleAnnotations,
  scheduleNativeAnnotationsForSpread,
  usesNativeAnnotationGeometry,
} from '../annotation-resolution';
import {
  disposeNativeSearchGeometry,
  replaceNativeSearchResults,
  usesNativeSearchGeometry,
} from '../search-resolution';
import { scheduleNativeSearchForCurrentSpread } from './native-search';
import type { ReaderControllerEvents } from '../types';

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  disposables.add(() => {
    deps.engines.selection.dispose();
  });
  wireSelectionEvents(deps, disposables);
  disposables.add(
    deps.engines.selection.onError((error) => {
      deps.emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'native-text-selection',
      });
    }),
  );
  wireSearchEvents(deps, disposables);
  wireAnnotationStoreEvents(deps, disposables);
}

function wireSelectionEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  disposables.add(
    engines.selection.onSelectionChange((range) => {
      const rawRects = engines.selection.getRects();
      const { mapper } = deps.coordState;
      const viewportRects = mapper
        ? rawRects.map((r) => mapper.spreadContentRectToViewport(r))
        : rawRects;

      const focusRect = computeFocusRect(engines.selection, viewportRects, mapper);

      emitter.emit('selectionChange', {
        range,
        sourceLocator: engines.selection.getSourceLocator(),
        hasSelection: engines.selection.hasSelection(),
        text: engines.selection.getText(),
        rects: rawRects,
        viewportRects,
        focusRect,
      });
      // Selection is per-spread — only invalidate current
      deps.frameDriver.markOverlayDirty(deps.getCurrentSpread());
    }),
  );
}

function computeFocusRect(
  selection: WiringDeps['engines']['selection'],
  viewportRects: readonly { x: number; y: number; width: number; height: number }[],
  mapper: WiringDeps['coordState']['mapper'],
): { x: number; y: number; width: number; height: number } | null {
  const exactFocus = selection.getFocusRect();
  if (exactFocus) {
    return mapper ? mapper.spreadContentRectToViewport(exactFocus) : exactFocus;
  }
  if (viewportRects.length === 0) return null;
  const isForward = selection.getFocusEdge() !== 'start';
  const fr = isForward ? viewportRects[viewportRects.length - 1] : viewportRects[0];
  if (!fr) return null;
  return { x: isForward ? fr.x + fr.width : fr.x, y: fr.y, width: 0, height: fr.height };
}

function wireSearchEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  if (usesNativeSearchGeometry(deps.reader)) {
    disposables.add(() => {
      disposeNativeSearchGeometry(deps.coordState);
    });
  }
  disposables.add(
    engines.search.onResultsChange((results) => {
      if (usesNativeSearchGeometry(deps.reader)) {
        replaceNativeSearchResults(deps.coordState, results);
        scheduleNativeSearchForCurrentSpread(deps);
      }
      emitContainedSearchEvent(
        emitter,
        'searchResults',
        { results, activeIndex: engines.search.getActiveIndex() },
        'search-results-listener',
      );
      // Search results are global — invalidate ALL slots so adjacent pages update too
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
  disposables.add(
    engines.search.onActiveResultChange((idx) => {
      const results = engines.search.getResults();
      scheduleNativeSearchForCurrentSpread(deps);
      emitContainedSearchEvent(
        emitter,
        'searchActiveChange',
        { activeIndex: idx, result: results[idx] },
        'search-active-listener',
      );
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
}

function emitContainedSearchEvent<K extends 'searchResults' | 'searchActiveChange'>(
  emitter: WiringDeps['emitter'],
  event: K,
  payload: ReaderControllerEvents[K],
  failureSource: string,
): void {
  try {
    emitter.emit(event, payload);
  } catch (error: unknown) {
    try {
      emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: failureSource,
      });
    } catch {
      // Search engine state and overlay invalidation must complete even if consumer listeners fail.
    }
  }
}

function wireAnnotationStoreEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const store = deps.coordState.annotationStore;
  if (!store) return;
  disposables.add(
    store.onChange((records) => {
      deps.emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
      if (usesNativeAnnotationGeometry(deps.reader)) {
        refreshNativeAnnotations(deps.reader, deps.coordState);
        const spread = deps.reader.spreads[deps.getCurrentSpread()];
        if (spread) {
          scheduleNativeAnnotationsForSpread(
            spread,
            deps.reader,
            deps.coordState,
            () => {
              deps.frameDriver.markAllOverlaysDirty();
            },
            (error) => {
              deps.emitter.emit('error', {
                message: error instanceof Error ? error.message : String(error),
                source: 'native-annotation-geometry',
              });
            },
          );
        }
      } else {
        deps.coordState.resolvedAnnotations = resolveVisibleAnnotations(
          store,
          deps.coordState,
          deps.reader,
        );
      }
      deps.emitter.emit('annotationsChange', { annotations: records });
      // Annotations are global — invalidate ALL slots
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
}
