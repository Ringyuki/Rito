import type { DisposableCollection } from '../../utils/disposable';
import { refreshCurrentOverlay } from './spread';
import type { WiringDeps } from '../core/wiring-deps';
import { resolveVisibleAnnotations } from '../annotation-resolution';

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;

  disposables.add(
    engines.selection.onSelectionChange((range) => {
      const rawRects = engines.selection.getRects();
      const { mapper } = deps.coordState;
      const viewportRects = mapper
        ? rawRects.map((r) => mapper.spreadContentRectToViewport(r))
        : rawRects;

      // focusRect: the rect at the active (focus) end of the selection.
      // Rects are in document order, so forward selection → focus is last,
      // backward selection → focus is first.
      let focusRect: (typeof viewportRects)[number] | null = null;
      if (viewportRects.length > 0) {
        const snapshot = engines.selection.getSnapshot();
        const isForward = !snapshot || snapshot.anchor === snapshot.start;
        focusRect = isForward
          ? (viewportRects[viewportRects.length - 1] ?? null)
          : (viewportRects[0] ?? null);
      }

      emitter.emit('selectionChange', {
        range,
        text: engines.selection.getText(),
        rects: rawRects,
        viewportRects,
        focusRect,
      });
      refreshCurrentOverlay(deps);
    }),
  );

  disposables.add(
    engines.search.onResultsChange((results) => {
      emitter.emit('searchResults', { results, activeIndex: engines.search.getActiveIndex() });
      refreshCurrentOverlay(deps);
    }),
  );

  disposables.add(
    engines.search.onActiveResultChange((idx) => {
      const results = engines.search.getResults();
      emitter.emit('searchActiveChange', { activeIndex: idx, result: results[idx] });
      refreshCurrentOverlay(deps);
    }),
  );

  // Wire annotation store changes (new source-anchored system)
  const store = deps.coordState.annotationStore;
  if (store) {
    disposables.add(
      store.onChange((records) => {
        // Re-resolve annotations against current layout
        deps.coordState.resolvedAnnotations = resolveVisibleAnnotations(
          store,
          deps.coordState,
          deps.reader,
        );
        emitter.emit('annotationsChange', { annotations: records });
        refreshCurrentOverlay(deps);
      }),
    );
  }
}
