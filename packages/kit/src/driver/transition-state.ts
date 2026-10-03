import type { SettledEvent, TransitionDriverOptions, TransitionMode } from './types';
import type { VelocitySample } from './transition-velocity';

export interface TransitionDriverState {
  opts: TransitionDriverOptions;
  mode: TransitionMode;
  viewportWidth: number;
  /** The system asks for reduced motion (set by the host environment). */
  reducedMotion: boolean;
  velocitySamples: VelocitySample[];
  readonly settledListeners: Set<(event: SettledEvent) => void>;
}
