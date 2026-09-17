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
  type InteractionMode,
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
  SearchResult,
} from './interaction/index';
export { parseReadingPosition } from './interaction/index';

export type { OverlayLayer, Rect } from './painter/types';
export type { TransitionDriverOptions } from './driver/types';

export { createEmitter, type TypedEmitter } from './utils/event-emitter';
export { createDisposableCollection, type DisposableCollection } from './utils/disposable';
