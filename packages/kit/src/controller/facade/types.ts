import type { createEmitter } from '../../utils/event-emitter';
import type { createDisposableCollection } from '../../utils/disposable';
import type { createInteractionModeManager } from '../interaction-mode/index';
import type { createNavigation } from '../navigation/index';
import type { KeyboardManager } from '../../keyboard/types';
import type { ReaderController, ReaderControllerEvents } from '../types';
import type { TransitionDriver } from '../../driver/transition-driver';
import type { FrameDriver } from '../../driver/frame-driver';
import type { PageBufferPool } from '../../painter/buffer-pool';
import type { DisplaySurface } from '../../painter/display-surface';
import type { PrerenderScheduler } from '../prerender';

export type { Internals } from '../core/internals';
export type Emitter = ReturnType<typeof createEmitter<ReaderControllerEvents>>;
export type Disposables = ReturnType<typeof createDisposableCollection>;
export type ModeManager = ReturnType<typeof createInteractionModeManager>;
export type Nav = ReturnType<typeof createNavigation>;

export type LifecycleSlice = Pick<ReaderController, 'mount' | 'dispose'>;
export type NavigationActionsSlice = Pick<
  ReaderController,
  'goToSpread' | 'nextSpread' | 'prevSpread' | 'navigateToTocEntry' | 'jumpToSpread'
>;
export type ReaderProxiesSlice = Pick<
  ReaderController,
  | 'reader'
  | 'metadata'
  | 'toc'
  | 'spreads'
  | 'pages'
  | 'currentSpread'
  | 'totalSpreads'
  | 'paginationComplete'
>;
export type LayoutActionsSlice = Pick<
  ReaderController,
  | 'resize'
  | 'setSpreadMode'
  | 'setLineBreaking'
  | 'setTheme'
  | 'setTypography'
  | 'setRenderScale'
  | 'renderScale'
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
  | 'clearSelection'
  | 'hasSelection'
  | 'selectionText'
  | 'selectionRange'
  | 'selectionSourceLocator'
  | 'selectionSourceSpan'
  | 'beginSelectionHandleDrag'
>;
export type AnnotationActionsSlice = Pick<
  ReaderController,
  'addAnnotation' | 'removeAnnotation' | 'updateAnnotation' | 'annotations'
>;
export type PositionActionsSlice = Pick<
  ReaderController,
  'restorePosition' | 'savePosition' | 'goToPosition'
>;
export type Keyboard = KeyboardManager;
export type MiscSlice = Pick<
  ReaderController,
  'setInteractionMode' | 'interactionMode' | 'configureTransition' | 'on' | 'emitter' | 'keyboard'
>;

/** Runtime components passed through the facade builders. */
export interface RuntimeComponents {
  readonly td: TransitionDriver;
  readonly frameDriver: FrameDriver;
  readonly pool: PageBufferPool;
  readonly prerenderScheduler: PrerenderScheduler;
  readonly disposeSettledEvents: () => void;
  readonly surface: DisplaySurface;
}
