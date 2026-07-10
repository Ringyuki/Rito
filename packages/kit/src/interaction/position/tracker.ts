import {
  createReadingPosition,
  projectReadingPosition,
  resolveReadingPosition,
  type PositionLayout,
  type ReadingPosition,
} from './model';

export interface PositionTracker {
  /** Capture a new canonical locator from the current layout spread. */
  update(spreadIndex: number): void;
  /** Project an existing canonical locator onto the current layout. */
  project(position: ReadingPosition): ReadingPosition;
  /** Publish an already computed position without recapturing from layout. */
  setCurrent(position: ReadingPosition): void;
  getCurrent(): ReadingPosition | null;
  resolve(position: ReadingPosition): number | undefined;
  serialize(): string;
  restore(serialized: string): number | undefined;
  onPositionChange(cb: (position: ReadingPosition) => void): () => void;
}

export function createPositionTracker(getLayout: () => PositionLayout): PositionTracker {
  let current: ReadingPosition | null = null;
  const listeners = new Set<(position: ReadingPosition) => void>();

  function publish(position: ReadingPosition): void {
    current = position;
    for (const listener of listeners) listener(position);
  }

  return {
    update(spreadIndex) {
      publish(createReadingPosition(getLayout(), spreadIndex));
    },
    project(position) {
      return projectReadingPosition(position, getLayout());
    },
    setCurrent(position) {
      publish(position);
    },
    getCurrent: () => current,
    resolve(position) {
      return resolveReadingPosition(position, getLayout());
    },
    serialize() {
      return JSON.stringify(current);
    },
    restore(serialized) {
      const parsed = parsePosition(serialized);
      if (!parsed) return undefined;
      const projected = projectReadingPosition(parsed, getLayout());
      publish(projected);
      return projected.projection.spreadIndex;
    },
    onPositionChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function parsePosition(serialized: string): ReadingPosition | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    return isPosition(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isPosition(value: unknown): value is ReadingPosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { readonly projection?: { readonly spreadIndex?: unknown } };
  return typeof candidate.projection?.spreadIndex === 'number';
}
