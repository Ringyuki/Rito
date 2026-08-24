import type { SelectionClientPoint } from '../types';

/** Opaque latest-input barrier shared by selection starts derived from one physical press. */
export interface PrimarySelectionInputIntent {
  owns(): boolean;
}

/** Controller-owned continuation for one active primary selection gesture. */
export interface PrimarySelectionDragSession {
  update(point: SelectionClientPoint): void;
  /** Stop edge work and report whether the exact gesture still owns finalization. */
  finish(): boolean;
  /** Stop edge work and report exact-session ownership, independent of content navigation. */
  cancel(): boolean;
  owns(): boolean;
  /** Resolve release through the current projection; present for controller-managed sessions. */
  resolveFinalInput?(point: SelectionClientPoint): { readonly x: number; readonly y: number };
  /** An inactive gesture can settle naturally without being replaced. */
  wasSuperseded(): boolean;
  didNavigate(): boolean;
}

/** Starts selection and captures the exact native session created by that callback. */
export interface PrimarySelectionDragNavigation {
  claim(): PrimarySelectionInputIntent | null;
  begin(
    input: PrimarySelectionInputIntent,
    startSelection: () => void,
  ): PrimarySelectionDragSession | null;
}
