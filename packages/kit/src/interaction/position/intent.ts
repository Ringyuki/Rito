import type { ReadingPosition } from './model';

const supersessionSignals = new WeakMap<PositionIntent, AbortSignal>();

export interface PositionIntent {
  readonly generation: number;
}

export interface ResolvedPositionIntent {
  readonly intent: PositionIntent;
  readonly position: ReadingPosition;
}

/**
 * How the tracker carries the current position across a layout commit:
 * `portable` resolves the source locator against the new revision asynchronously,
 * `synchronous` re-projects the preserved position by chapter progress at commit time.
 */
export type LayoutPositionPlan =
  | { readonly kind: 'portable' }
  | {
      readonly kind: 'synchronous';
      readonly intent: PositionIntent;
      readonly position: ReadingPosition | null;
    };

export interface PositionTracker {
  update(spreadIndex: number): void;
  project(position: ReadingPosition): ReadingPosition;
  setCurrent(position: ReadingPosition): void;
  getCurrent(): ReadingPosition | null;
  getPreservableCurrent(): ReadingPosition | null;
  resolve(position: ReadingPosition): number | undefined;
  claimIntent(): PositionIntent;
  claimPortableIntent(): PositionIntent;
  cancelPortableIntent(intent: PositionIntent): boolean;
  owns(intent: PositionIntent): boolean;
  resolveForNavigation(
    position: ReadingPosition,
    intent?: PositionIntent,
  ): Promise<ResolvedPositionIntent | undefined>;
  commit(intent: PositionIntent, position: ReadingPosition): boolean;
  prepareLayoutCommit(
    position: ReadingPosition | null | undefined,
    committedSpreadIndex: number,
  ): LayoutPositionPlan;
  settle(): Promise<void>;
  serialize(): string | undefined;
  restore(serialized: string, intent?: PositionIntent): Promise<number | undefined>;
  invalidate(): void;
  dispose(): void;
  onPositionChange(cb: (position: ReadingPosition) => void): () => void;
}

export function registerPositionIntentSupersession(
  intent: PositionIntent,
  signal: AbortSignal,
): void {
  supersessionSignals.set(intent, signal);
}

export function getPositionIntentSupersessionSignal(
  intent: PositionIntent,
): AbortSignal | undefined {
  return supersessionSignals.get(intent);
}
