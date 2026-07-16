import { describe, expect, it, vi } from 'vitest';
import { createConstructionOwner } from '../src/controller/construction-owner';

describe('ConstructionOwner', () => {
  it('rolls resources back in reverse order without stopping at a cleanup failure', () => {
    const owner = createConstructionOwner();
    const calls: string[] = [];
    const failure = new Error('second cleanup failed');
    owner.own(() => {
      calls.push('first');
    });
    owner.own(() => {
      calls.push('second');
      throw failure;
    });
    owner.own(() => {
      calls.push('third');
    });

    expect(() => {
      owner.rollback();
    }).toThrow(failure);
    expect(calls).toEqual(['third', 'second', 'first']);
    expect(() => {
      owner.rollback();
    }).not.toThrow();
  });

  it('disarms rollback after construction commits', () => {
    const dispose = vi.fn();
    const owner = createConstructionOwner();
    owner.own(dispose);

    owner.commit();
    owner.rollback();

    expect(dispose).not.toHaveBeenCalled();
  });

  it('shares one disposer between construction rollback and the committed lifecycle', () => {
    const dispose = vi.fn();
    const owner = createConstructionOwner();
    const release = owner.own(dispose);

    release();
    owner.rollback();
    release();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it('keeps the returned lifecycle disposer armed after commit', () => {
    const dispose = vi.fn();
    const owner = createConstructionOwner();
    const release = owner.own(dispose);

    owner.commit();
    release();
    release();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
