import { describe, it, expect } from 'vitest';

describe('@ritojs/react', () => {
  it('exports hooks', async () => {
    const mod = await import('../src/hooks');
    expect(mod.useRitoReader).toBeDefined();
    expect(mod.useSelection).toBeDefined();
    expect(mod.useSearch).toBeDefined();
    expect(mod.useAnnotations).toBeDefined();
    expect(mod.useReadingPosition).toBeDefined();
    expect(mod.useContainerSize).toBeDefined();
  });

  it('exports Reader component', async () => {
    const mod = await import('../src/components');
    expect(mod.Reader).toBeDefined();
  });
});
