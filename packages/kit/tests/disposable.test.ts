import { describe, expect, it, vi } from 'vitest';
import { createDisposableCollection } from '../src/utils/disposable';

describe('DisposableCollection', () => {
  it('runs every disposer before rethrowing the first failure', () => {
    const disposables = createDisposableCollection();
    const first = vi.fn();
    const failure = new Error('cleanup failed');
    const last = vi.fn();
    disposables.add(first);
    disposables.add(() => {
      throw failure;
    });
    disposables.add(last);

    expect(() => {
      disposables.disposeAll();
    }).toThrow(failure);
    expect(first).toHaveBeenCalledOnce();
    expect(last).toHaveBeenCalledOnce();
    expect(() => {
      disposables.disposeAll();
    }).not.toThrow();
  });
});
