export interface SelectionInteractionCapture {
  readonly generation: number;
  readonly readGeneration: () => number;
}

const generationReaders = new WeakMap<object, () => number>();

/** Register a private lifecycle owner without widening SelectionEngine's public API. */
export function registerSelectionInteractionOwner<T extends object>(
  owner: T,
  readGeneration: () => number,
): T {
  generationReaders.set(owner, readGeneration);
  return owner;
}

export function captureSelectionInteraction(owner: object): SelectionInteractionCapture | null {
  const readGeneration = generationReaders.get(owner);
  return readGeneration ? { generation: readGeneration(), readGeneration } : null;
}

export function ownsSelectionInteraction(capture: SelectionInteractionCapture): boolean {
  return capture.readGeneration() === capture.generation;
}
