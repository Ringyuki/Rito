/** Collects cleanup functions and disposes them all at once. */
export interface DisposableCollection {
  add(dispose: () => void): void;
  disposeAll(): void;
}

export function createDisposableCollection(): DisposableCollection {
  const fns: (() => void)[] = [];

  return {
    add(dispose: () => void): void {
      fns.push(dispose);
    },
    disposeAll(): void {
      for (const fn of fns.splice(0)) fn();
    },
  };
}
