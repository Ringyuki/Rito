import type { InteractionMode } from '../types';
import type { TransitionDriverOptions } from '../../driver/types';
import type { Emitter, ModeManager, Keyboard, MiscSlice } from './types';

export function buildMisc(
  emitter: Emitter,
  modeManager: ModeManager,
  keyboard: Keyboard,
  _configureTransition: (opts: Partial<TransitionDriverOptions>) => void,
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
      _configureTransition(opts);
    },
    on,
    get emitter() {
      return emitter;
    },
    get keyboard() {
      return keyboard;
    },
  };
}
