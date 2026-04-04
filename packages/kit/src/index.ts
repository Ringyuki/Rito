// Re-export all subpath modules for convenience
export {
  createTransitionEngine,
  type TransitionEngine,
  type TransitionOptions,
  type TransitionPreset,
} from './transition/index';

export {
  createOverlayRenderer,
  type OverlayLayer,
  type OverlayRenderer,
  type Rect,
} from './overlay/index';

export { createKeyboardManager, type KeyboardManager } from './keyboard/index';

export {
  createLocalStorageAdapter,
  createLocalStoragePositionAdapter,
  type PositionStorageAdapter,
  type StorageAdapter,
} from './storage/index';

export {
  createController,
  type ReaderController,
  type ReaderControllerEvents,
  type ControllerOptions,
  type InteractionMode,
} from './controller/index';

export { createEmitter, type TypedEmitter } from './utils/event-emitter';
export { createDisposableCollection, type DisposableCollection } from './utils/disposable';
