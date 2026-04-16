import { describe, it, expect } from 'vitest';

describe('@ritojs/kit', () => {
  it('exports createController', async () => {
    const mod = await import('../src/index');
    expect(mod.createController).toBeDefined();
  });

  it('exports createKeyboardManager', async () => {
    const mod = await import('../src/keyboard');
    expect(mod.createKeyboardManager).toBeDefined();
  });

  it('exports storage adapters', async () => {
    const mod = await import('../src/storage');
    expect(mod.createLocalStorageAnnotationAdapter).toBeDefined();
    expect(mod.createLocalStoragePositionAdapter).toBeDefined();
  });

  it('exports OverlayLayer and Rect types from painter', async () => {
    const mod = await import('../src/painter/types');
    // Type-only exports — just verify the module loads
    expect(mod).toBeDefined();
  });

  it('exports TransitionDriverOptions type from driver', async () => {
    const mod = await import('../src/driver/types');
    expect(mod.DEFAULT_TRANSITION_OPTIONS).toBeDefined();
  });
});
