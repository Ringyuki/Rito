import type { createTransitionEngine } from '../../transition/index';
import type { createOverlayRenderer } from '../../overlay/index';
import type { createEmitter } from '../../utils/event-emitter';
import type { createDisposableCollection } from '../../utils/disposable';
import type { createInteractionModeManager } from '../interaction-mode/index';
import type { createNavigation } from '../navigation/index';
import type { ReaderController, ReaderControllerEvents } from '../types';

export type { Internals } from '../core/internals';
export type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
export type Disposables = ReturnType<typeof createDisposableCollection>;
export type Transition = ReturnType<typeof createTransitionEngine>;
export type Overlay = ReturnType<typeof createOverlayRenderer>;
export type ModeManager = ReturnType<typeof createInteractionModeManager>;
export type Nav = ReturnType<typeof createNavigation>;

export type LifecycleSlice = Pick<ReaderController, 'mount' | 'dispose'>;
export type ReaderProxiesSlice = Pick<
  ReaderController,
  'reader' | 'metadata' | 'toc' | 'spreads' | 'pages' | 'currentSpread' | 'totalSpreads'
>;
export type LayoutActionsSlice = Pick<
  ReaderController,
  'resize' | 'setSpreadMode' | 'setTheme' | 'setTypography' | 'setRenderScale' | 'renderScale'
>;
export type SearchActionsSlice = Pick<
  ReaderController,
  | 'search'
  | 'searchNext'
  | 'searchPrev'
  | 'goToSearchResult'
  | 'clearSearch'
  | 'searchResults'
  | 'searchActiveIndex'
>;
export type SelectionAccessorsSlice = Pick<
  ReaderController,
  'clearSelection' | 'selectionText' | 'selectionRange'
>;
export type AnnotationActionsSlice = Pick<
  ReaderController,
  'addAnnotation' | 'removeAnnotation' | 'updateAnnotation' | 'annotations'
>;
export type PositionActionsSlice = Pick<ReaderController, 'restorePosition' | 'savePosition'>;
export type MiscSlice = Pick<
  ReaderController,
  | 'setInteractionMode'
  | 'interactionMode'
  | 'configureTransition'
  | 'on'
  | 'transitionEngine'
  | 'overlayRenderer'
  | 'emitter'
>;
