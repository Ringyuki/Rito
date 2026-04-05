import type { DisposableCollection } from '../../utils/disposable';
import { refreshCurrentOverlay } from './spread';
import type { WiringDeps } from '../core/wiring-deps';

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;

  disposables.add(
    engines.selection.onSelectionChange((range) => {
      const rawRects = engines.selection.getRects();
      const { mapper } = deps.coordState;
      const viewportRects = mapper
        ? rawRects.map((r) => mapper.spreadContentRectToViewport(r))
        : rawRects;
      emitter.emit('selectionChange', {
        range,
        text: engines.selection.getText(),
        rects: rawRects,
        viewportRects,
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

  disposables.add(
    engines.annotation.onAnnotationsChange((annotations) => {
      emitter.emit('annotationsChange', { annotations });
      refreshCurrentOverlay(deps);
    }),
  );
}
