import type { InteractionMode } from '../types';
import type { Emitter, ModeManager, Transition, Overlay, Keyboard, MiscSlice } from './types';

export function buildMisc(
  emitter: Emitter,
  modeManager: ModeManager,
  transition: Transition,
  overlay: Overlay,
  keyboard: Keyboard,
): MiscSlice {
  const on: MiscSlice['on'] = (event, handler) => emitter.on(event, handler);

  return {
    setInteractionMode(mode: InteractionMode): void {
      modeManager.setMode(mode);
    },
    get interactionMode(): InteractionMode {
      return modeManager.mode;
    },
    configureTransition(opts: Parameters<MiscSlice['configureTransition']>[0]): void {
      transition.configure(opts);
    },
    on,
    get transitionEngine() {
      return transition;
    },
    get overlayRenderer() {
      return overlay;
    },
    get emitter() {
      return emitter;
    },
    get keyboard() {
      return keyboard;
    },
  };
}
