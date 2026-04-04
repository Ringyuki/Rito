import type { Reader } from 'rito';
import { bindPointerEvents, bindClipboard, bindLinkCursor } from 'rito/dom';
import type { DisposableCollection } from '../utils/disposable';
import type { TypedEmitter } from '../utils/event-emitter';
import type { OverlayRenderer } from '../overlay/types';
import {
  coordinateOnSpreadRendered,
  type CoordinatorEngines,
  type CoordinatorState,
} from './engine-coordinator';
import { handleLinkClick } from './link-handler';
import type { ReaderControllerEvents, ReaderControllerOptions } from './types';

interface WiringDeps {
  reader: Reader;
  engines: CoordinatorEngines;
  emitter: TypedEmitter<ReaderControllerEvents>;
  overlay: OverlayRenderer;
  options: ReaderControllerOptions;
  coordState: CoordinatorState;
  canvas: HTMLCanvasElement;
  getCurrentSpread: () => number;
  setCurrentSpread: (idx: number) => void;
}

export function wireSpreadRendered(deps: WiringDeps, disposables: DisposableCollection): void {
  disposables.add(
    deps.reader.onSpreadRendered((idx, spread) => {
      coordinateOnSpreadRendered(
        idx,
        spread,
        deps.engines,
        deps.reader,
        deps.overlay,
        deps.coordState,
        deps.options,
      );
    }),
  );
}

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;

  disposables.add(
    engines.selection.onSelectionChange((range) => {
      emitter.emit('selectionChange', {
        range,
        text: engines.selection.getText(),
        rects: engines.selection.getRects(),
      });
    }),
  );

  disposables.add(
    engines.search.onResultsChange((results) => {
      emitter.emit('searchResults', { results, activeIndex: engines.search.getActiveIndex() });
    }),
  );

  disposables.add(
    engines.search.onActiveResultChange((idx) => {
      const results = engines.search.getResults();
      emitter.emit('searchActiveChange', { activeIndex: idx, result: results[idx] });
    }),
  );

  disposables.add(
    engines.annotation.onAnnotationsChange((annotations) => {
      emitter.emit('annotationsChange', { annotations });
    }),
  );
}

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter, options } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(
    tracker.onPositionChange((position) => {
      emitter.emit('positionChange', { position });
      options.positionStorage?.save(tracker.serialize());
    }),
  );
}

export function wireDomHelpers(deps: WiringDeps, disposables: DisposableCollection): void {
  const { canvas, engines, reader, emitter, coordState } = deps;
  disposables.add(bindPointerEvents(canvas, engines.selection));
  disposables.add(bindClipboard(canvas, engines.selection));
  disposables.add(
    bindLinkCursor(
      canvas,
      () => coordState.linkRegions,
      (region) => {
        handleLinkClick(region, reader, deps.getCurrentSpread, deps.setCurrentSpread, emitter);
      },
    ),
  );
}
