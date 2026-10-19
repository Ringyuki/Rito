import { describe, expect, it, vi } from 'vitest';
import { holdBookWhileSelecting } from '../src/controller/wiring/engine-events';
import type { WiringDeps } from '../src/controller/core/wiring-deps';
import type { DisposableCollection } from '../src/utils/disposable';

describe('the whole-book layout while a selection is made', () => {
  it('waits from the gesture start until the selection is made, then goes on', () => {
    let state: 'idle' | 'selecting' | 'selected' = 'idle';
    let notify = (): void => undefined;
    const release = vi.fn();
    const holdBookLayout = vi.fn(() => release);
    const deps = {
      engines: {
        selection: {
          getState: () => state,
          onSelectionChange: (listener: () => void) => {
            notify = listener;
            return () => undefined;
          },
        },
      },
      reader: { holdBookLayout },
    } as unknown as WiringDeps;
    const disposers: (() => void)[] = [];
    const disposables = {
      add: (dispose: () => void) => disposers.push(dispose),
    } as unknown as DisposableCollection;

    holdBookWhileSelecting(deps, disposables);
    state = 'selecting';
    notify();
    notify();
    expect(holdBookLayout).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();

    state = 'selected';
    notify();
    expect(release).toHaveBeenCalledOnce();

    // A gesture still under way when the controller goes lets the book go.
    state = 'selecting';
    notify();
    for (const dispose of disposers) dispose();
    expect(release).toHaveBeenCalledTimes(2);
  });
});
