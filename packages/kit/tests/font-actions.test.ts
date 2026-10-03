import { describe, expect, it, vi } from 'vitest';
import type { ReaderFontCatalog } from '@ritojs/core';
import type { Internals } from '../src/controller/core/internals';
import {
  buildFontActions,
  reportUnresolvedFontFamilies,
} from '../src/controller/facade/font-actions';
import type { Emitter } from '../src/controller/facade/types';

const CATALOG: ReaderFontCatalog = {
  families: [
    {
      name: 'Tinos',
      source: 'host',
      genericRole: 'serif',
      language: 'und',
      faces: [{ weight: 400, style: 'normal', sha256: 'a'.repeat(64) }],
    },
  ],
};

function setup(reader: Record<string, unknown>) {
  const emit = vi.fn();
  const internals = { reader } as unknown as Internals;
  const emitter = { emit } as unknown as Emitter;
  return { internals, emitter, emit };
}

describe('controller font actions', () => {
  it('delegate to the reader', async () => {
    const addFontFaces = vi.fn(() => Promise.resolve());
    const removeFontFaces = vi.fn(() => Promise.resolve());
    const { internals } = setup({
      fonts: () => Promise.resolve(CATALOG),
      unresolvedFontFamilies: () => Promise.resolve(['Nope']),
      addFontFaces,
      removeFontFaces,
    });
    const actions = buildFontActions(internals);
    expect(await actions.fonts()).toBe(CATALOG);
    expect(await actions.unresolvedFontFamilies('Nope')).toEqual(['Nope']);
    const face = {
      bytes: new ArrayBuffer(4),
      expectedSha256: 'b'.repeat(64),
      genericRole: 'sansSerif' as const,
    };
    await actions.addFontFaces([face]);
    expect(addFontFaces).toHaveBeenCalledWith([face]);
    await actions.removeFontFaces(['b'.repeat(64)]);
    expect(removeFontFaces).toHaveBeenCalledWith(['b'.repeat(64)]);
  });

  it('fail loudly on a reader without fonts', () => {
    const { internals } = setup({});
    expect(() => buildFontActions(internals).fonts()).toThrow(/does not support fonts/);
  });

  it('report the names of a font-family choice no face answers to', async () => {
    const { internals, emitter, emit } = setup({
      unresolvedFontFamilies: (list: string) =>
        Promise.resolve(list.includes('Nope') ? ['Nope'] : []),
    });
    reportUnresolvedFontFamilies(internals, emitter, 'Tinos, serif');
    reportUnresolvedFontFamilies(internals, emitter, '"Nope", serif');
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledTimes(1);
    });
    expect(emit).toHaveBeenCalledWith('error', {
      message: 'No face answers to "Nope"',
      source: 'font-family',
    });
  });
});
