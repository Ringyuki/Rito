import { runDisposers } from '../utils/disposable';

export interface ConstructionOwner {
  own(dispose: () => void): () => void;
  commit(): void;
  rollback(): void;
}

/** Owns partially constructed resources until the controller lifecycle takes over. */
export function createConstructionOwner(): ConstructionOwner {
  let active = true;
  const disposers: (() => void)[] = [];

  return {
    own(dispose): () => void {
      if (!active) throw new Error('Controller construction owner is no longer active');
      const ownedDispose = createOnceDisposer(dispose);
      disposers.push(ownedDispose);
      return ownedDispose;
    },
    commit(): void {
      if (!active) return;
      active = false;
      disposers.length = 0;
    },
    rollback(): void {
      if (!active) return;
      active = false;
      runDisposers(disposers.splice(0).reverse());
    },
  };
}

function createOnceDisposer(dispose: () => void): () => void {
  let pending = true;
  return (): void => {
    if (!pending) return;
    pending = false;
    dispose();
  };
}
