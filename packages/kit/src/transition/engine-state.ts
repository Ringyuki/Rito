import type { TransitionDOM } from './dom';
import type { GestureState } from './gesture';
import type { NavigationContext, TransitionOptions } from './types';

/** Internal mutable state shared across the transition engine. */
export interface EngineState {
  dom: TransitionDOM;
  options: TransitionOptions;
  animating: boolean;
  mounted: boolean;
  navContext: NavigationContext | null;
  gesture: GestureState;
  /** The spread index that was pre-rendered on mainCanvas during a gesture. */
  preRenderedSpread: number | null;
  /** The spread that was showing before the gesture started. */
  originalSpread: number | null;
}
