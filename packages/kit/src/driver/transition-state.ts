import type { SettledEvent, TransitionDriverOptions, TransitionMode } from './types';
import type { VelocitySample } from './transition-velocity';

export interface TransitionDriverState {
  opts: TransitionDriverOptions;
  mode: TransitionMode;
  viewportWidth: number;
  velocitySamples: VelocitySample[];
  readonly settledListeners: Set<(event: SettledEvent) => void>;
}
