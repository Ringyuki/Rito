import { describe, expect, it } from 'vitest';
import type { TransitionPage } from '../src/driver/effects';
import { createPageTextures } from '../src/driver/paper/gl';
import { createFakeGl } from './helpers/fake-gl';

/** A GPU that counts the textures it makes, the pages copied into them and the textures it forgets. */
function gpu() {
  const fake = createFakeGl();
  return {
    gl: fake.gl,
    made: () => fake.named('createTexture').length,
    copies: () => fake.draws.filter((draw) => draw.kind === 'blitFramebuffer').length,
    deleted: () => fake.named('deleteTexture').map((args) => args[0]),
  };
}

const shownIn = { id: 'slot texture' };
const page = (texture: object, version: number): TransitionPage => ({
  spread: 0,
  texture: texture as WebGLTexture,
  width: 800,
  height: 600,
  pixelRatio: 1,
  version,
});

describe('the pages a paper turn keeps as textures', () => {
  it('copies a page once for as long as it is not painted again', () => {
    const { gl, made, copies } = gpu();
    const textures = createPageTextures(gl);
    const first = textures.take(page(shownIn, 1));
    expect(textures.take(page(shownIn, 1))).toBe(first);
    expect(made()).toBe(1);
    expect(copies()).toBe(1);
  });

  it('keeps a painting a leaf in the air still shows when the page is painted again', () => {
    const { gl, made, deleted } = gpu();
    const textures = createPageTextures(gl);
    const shown = textures.take(page(shownIn, 1));
    // The buffer is given another spread while the leaf is still coming down.
    const later = textures.take(page(shownIn, 2));
    expect(later).not.toBe(shown);
    expect(later.texture).not.toBe(shown.texture);
    expect(deleted()).toEqual([]);
    // Landed, the leaf lets its page go: nothing shows that painting any more.
    textures.release(shown);
    expect(deleted()).toEqual([shown.texture]);
    expect(made()).toBe(2);
  });

  it('paints over a texture nothing shows rather than making another', () => {
    const { gl, made, deleted } = gpu();
    const textures = createPageTextures(gl);
    const first = textures.take(page(shownIn, 1));
    textures.release(first);
    const again = textures.take(page(shownIn, 2));
    expect(again.texture).toBe(first.texture);
    expect(made()).toBe(1);
    expect(deleted()).toEqual([]);
  });

  it('forgets pages nothing shows beyond the few a next turn may want', () => {
    const { gl, deleted } = gpu();
    const textures = createPageTextures(gl);
    const pages = [1, 2, 3, 4, 5].map((id) => textures.take(page({ id }, 1)));
    for (const taken of pages) textures.release(taken);
    expect(deleted()).toEqual([pages[0]?.texture, pages[1]?.texture]);
  });
});
