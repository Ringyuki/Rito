import type { DisposableCollection } from '../../utils/disposable';
import type { WiringDeps } from '../core/wiring-deps';
import { resolveVisibleAnnotations } from '../annotation-resolution';

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  wireSelectionEvents(deps, disposables);
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

      const focusRect = computeFocusRect(engines.selection, viewportRects);

      emitter.emit('selectionChange', {
        range,
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
): { x: number; y: number; width: number; height: number } | null {
  if (viewportRects.length === 0) return null;
  const snapshot = selection.getSnapshot();
  const isForward = !snapshot || snapshot.anchor === snapshot.start;
  const fr = isForward ? viewportRects[viewportRects.length - 1] : viewportRects[0];
  if (!fr) return null;
  return { x: isForward ? fr.x + fr.width : fr.x, y: fr.y, width: 0, height: fr.height };
}

function wireSearchEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;
  disposables.add(
    engines.search.onResultsChange((results) => {
      emitter.emit('searchResults', { results, activeIndex: engines.search.getActiveIndex() });
      // Search results are global — invalidate ALL slots so adjacent pages update too
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
  disposables.add(
    engines.search.onActiveResultChange((idx) => {
      const results = engines.search.getResults();
      emitter.emit('searchActiveChange', { activeIndex: idx, result: results[idx] });
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
}

function wireAnnotationStoreEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const store = deps.coordState.annotationStore;
  if (!store) return;
  disposables.add(
    store.onChange((records) => {
      deps.coordState.resolvedAnnotations = resolveVisibleAnnotations(
        store,
        deps.coordState,
        deps.reader,
      );
      deps.emitter.emit('annotationsChange', { annotations: records });
      // Annotations are global — invalidate ALL slots
      deps.frameDriver.markAllOverlaysDirty();
    }),
  );
}
