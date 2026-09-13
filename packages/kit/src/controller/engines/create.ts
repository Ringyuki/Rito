import type { Reader } from '@ritojs/core';
import { createSelectionEngine } from '../../interaction/index';
import { createSearchEngine } from '../../interaction/index';
import { createAnnotationStore } from '../../interaction/index';
import type { AnnotationStore } from '../../interaction/index';
import { createPositionTracker } from '../../interaction/index';
import type { PositionLocatorNavigator } from '../../interaction/position/native';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { ControllerOptions } from '../types';
import { runDisposers } from '../../utils/disposable';

export function createEngines(
  reader: Reader,
  _opts: ControllerOptions,
  coordState: CoordinatorState,
): CoordinatorEngines {
  const textSelection = reader.interactions?.textSelection;
  if (!textSelection) {
    throw new Error('Reader controller requires reader.interactions.textSelection');
  }
  // A temporarily disabled revision (visual preview) keeps the capability; reads settle empty.
  const selection = createSelectionEngine(textSelection);
  let store: AnnotationStore | undefined;
  try {
    const search = createSearchEngine();

    store = createAnnotationStore();
    coordState.annotationStore = store;

    const navigateToLocator: PositionLocatorNavigator | undefined =
      reader.navigateToLocator?.bind(reader);
    const position = createPositionTracker(
      () => ({
        spreads: reader.spreads,
        pageCount: reader.pageCount,
        chapterMap: reader.chapterMap,
        manifestHrefMap: reader.manifestHrefMap,
        chapterTextIndices: reader.getChapterTextIndices(),
      }),
      () => reader.interactions,
      navigateToLocator,
    );
    return { selection, search, position };
  } catch (error: unknown) {
    cleanupFailedEngineConstruction(() => {
      selection.dispose();
    }, store);
    throw error;
  }
}

function cleanupFailedEngineConstruction(
  disposeSelection: () => void,
  store: AnnotationStore | undefined,
): void {
  try {
    runDisposers([
      () => {
        disposeSelection();
      },
      () => {
        store?.dispose();
      },
    ]);
  } catch {
    // Preserve the engine construction error after best-effort cleanup.
  }
}

/** Get the annotation store from coordinator state (convenience accessor). */
export function getAnnotationStore(coordState: CoordinatorState): AnnotationStore | null {
  return coordState.annotationStore;
}
