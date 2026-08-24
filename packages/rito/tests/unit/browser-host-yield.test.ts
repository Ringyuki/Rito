import { afterEach, describe, expect, it, vi } from 'vitest';
import { yieldBrowserHostTask } from '../../src/bindings/browser/host-yield';

describe('Browser host-task yield', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resumes continuation work asynchronously', async () => {
    let synchronous = true;
    const yielded = yieldBrowserHostTask().then(() => {
      expect(synchronous).toBe(false);
    });

    synchronous = false;
    await yielded;
  });

  it('prefers scheduler.yield when the runtime provides it', async () => {
    const schedulerYield = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal('scheduler', { yield: schedulerYield });

    await yieldBrowserHostTask();

    expect(schedulerYield).toHaveBeenCalledOnce();
  });
});
