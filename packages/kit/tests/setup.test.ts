import { describe, it, expect } from 'vitest';

describe('@rito/kit', () => {
  it('exports createController', async () => {
    const mod = await import('../src/index');
    expect(mod.createController).toBeDefined();
  });

  it('exports createTransitionEngine', async () => {
    const mod = await import('../src/transition');
    expect(mod.createTransitionEngine).toBeDefined();
  });

  it('exports createOverlayRenderer', async () => {
    const mod = await import('../src/overlay');
    expect(mod.createOverlayRenderer).toBeDefined();
  });

  it('exports createKeyboardManager', async () => {
    const mod = await import('../src/keyboard');
    expect(mod.createKeyboardManager).toBeDefined();
  });

  it('exports storage adapters', async () => {
    const mod = await import('../src/storage');
    expect(mod.createLocalStorageAdapter).toBeDefined();
    expect(mod.createLocalStoragePositionAdapter).toBeDefined();
  });
});
