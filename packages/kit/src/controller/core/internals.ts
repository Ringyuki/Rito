import type { Reader } from '@ritojs/core';
import type { ControllerOptions } from '../types';
import type { CoordinatorEngines, CoordinatorState } from './coordinator-state';

export interface Internals {
  reader: Reader;
  currentSpread: number;
  renderScale: number;
  options: ControllerOptions;
  engines: CoordinatorEngines;
  coordState: CoordinatorState;
}
