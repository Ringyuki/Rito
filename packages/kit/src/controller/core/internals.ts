import type { Reader } from '@ritojs/core';
import type { ControllerOptions } from '../types';
import type { CoordinatorEngines, CoordinatorState } from './coordinator-state';
import type { PositionPersistence } from '../position-persistence';

export interface Internals {
  reader: Reader;
  currentSpread: number;
  renderScale: number;
  options: ControllerOptions;
  engines: CoordinatorEngines;
  coordState: CoordinatorState;
  positionPersistence: PositionPersistence;
  pendingPositionAction: Promise<unknown> | undefined;
  /**
   * `true` once {@link ReaderController.restorePosition} has resolved at least once
   * (regardless of whether saved state was found). Used to gate automatic
   * `positionStorage.save` calls so the consumer's hydrated value is never overwritten
   * by the controller's own initial `positionChange` event.
   */
  restoreCompleted: boolean;
}
