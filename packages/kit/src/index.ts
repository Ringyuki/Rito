export { createKeyboardManager, type KeyboardManager } from './keyboard/index';

export {
  createLocalStorageAnnotationAdapter,
  createLocalStoragePositionAdapter,
  type PositionStorageAdapter,
} from './storage/index';

export {
  createController,
  type ReaderController,
  type ReaderControllerEvents,
  type ControllerOptions,
  type ContentHitKind,
  type HighlightColors,
  type InteractionMode,
  type PagePaint,
  type PagePainter,
  type AddAnnotationInput,
  type ReaderClientPoint,
  type SelectionClientPoint,
  type SelectionHandleDrag,
  type SelectionHandleEdge,
  type SelectionHandleState,
} from './controller/index';

export type {
  AnnotationRecord,
  AnnotationRecordPatch,
  RecordStorageAdapter,
  ResolvedAnnotation,
  ReadingPosition,
  SearchOptions,
  SearchResult,
} from './interaction/index';
export { parseReadingPosition } from './interaction/index';

export { createScrollController } from './scroll/controller';
export { defaultScrollPhysics } from './scroll/physics';
export type { ScrollPhysics, ScrollSimulation } from './scroll/physics';
export type { ScrollPoint } from './scroll/hit';
export type { ScrollHighlight, ScrollPageRect } from './scroll/highlights';
export type { ScrollHighlightHit } from './scroll/highlight-hit';
export type {
  ScrollController,
  ScrollControllerEvents,
  ScrollControllerOptions,
} from './scroll/types';

export type { OverlayLayer, Rect } from './painter/types';
export { canDrawWithWebGl2, WebGlUnavailableError } from './painter/display-surface';
export type { TransitionDriverOptions } from './driver/types';
export {
  springPresets,
  transitionEffects,
  type LayeredTransitionEffect,
  type PaintedTransitionEffect,
  type TransitionEffect,
  type TransitionEffectName,
  type TransitionFrame,
  type TransitionLayer,
  type TransitionPage,
  type TransitionPhase,
  type TransitionPoint,
  type TransitionScene,
  type TransitionTouch,
} from './driver/effects';
export type {
  TransitionBounds,
  TransitionPhysics,
  TransitionLeftover,
  TransitionRelease,
  TransitionSettle,
} from './driver/physics';
export { createPaperTurn, type PaperTurnOptions } from './driver/paper/paper-turn';

export { createEmitter, type TypedEmitter } from './utils/event-emitter';
export { createDisposableCollection, type DisposableCollection } from './utils/disposable';
