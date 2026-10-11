import { describe, expect, it } from 'vitest';
import type { TransitionPage } from '../src/driver/effects';
import { createPageTextures, type Gl } from '../src/driver/paper/gl';

/** A GPU that only counts the textures it is asked for, filled and told to forget. */
function gpu() {
  const made: object[] = [];
  const deleted: object[] = [];
  const uploads: unknown[] = [];
  let bound: object | null = null;
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    TEXTURE_2D: 2,
    getParameter: () => 8192,
    createTexture: () => {
      const texture = { id: made.length };
      made.push(texture);
      return texture;
    },
    deleteTexture: (texture: object) => deleted.push(texture),
    bindTexture: (_target: number, texture: object | null) => {
      bound = texture;
    },
    pixelStorei: () => undefined,
    texParameteri: () => undefined,
    texImage2D: () => uploads.push(bound),
  } as unknown as Gl;
  return { gl, made, deleted, uploads };
}

const canvas = { width: 800, height: 600 };
const page = (content: object, version: number): TransitionPage => ({
  spread: 0,
  content: content as unknown as CanvasImageSource,
  overlay: null,
  pixelRatio: 1,
  version,
});

describe('the pages a paper turn keeps as textures', () => {
  it('uploads a page once for as long as it is not painted again', () => {
    const { gl, made, uploads } = gpu();
    const textures = createPageTextures(gl);
    const first = textures.take(page(canvas, 1));
    expect(textures.take(page(canvas, 1))).toBe(first);
    expect(made).toHaveLength(1);
    expect(uploads).toHaveLength(1);
  });

  it('keeps a painting a leaf in the air still shows when the page is painted again', () => {
    const { gl, made, deleted } = gpu();
    const textures = createPageTextures(gl);
    const shown = textures.take(page(canvas, 1));
    // The buffer is given another spread while the leaf is still coming down.
    const later = textures.take(page(canvas, 2));
    expect(later).not.toBe(shown);
    expect(later.texture).not.toBe(shown.texture);
    expect(deleted).toEqual([]);
    // Landed, the leaf lets its page go: nothing shows that painting any more.
    textures.release(shown);
    expect(deleted).toEqual([shown.texture]);
    expect(made).toHaveLength(2);
  });

  it('paints over a texture nothing shows rather than making another', () => {
    const { gl, made, deleted } = gpu();
    const textures = createPageTextures(gl);
    const first = textures.take(page(canvas, 1));
    textures.release(first);
    const again = textures.take(page(canvas, 2));
    expect(again.texture).toBe(first.texture);
    expect(made).toHaveLength(1);
    expect(deleted).toEqual([]);
  });

  it('forgets pages nothing shows beyond the few a next turn may want', () => {
    const { gl, deleted } = gpu();
    const textures = createPageTextures(gl);
    const pages = [1, 2, 3, 4, 5].map((id) => textures.take(page({ id, width: 8, height: 8 }, 1)));
    for (const taken of pages) textures.release(taken);
    expect(deleted).toEqual([pages[0]?.texture, pages[1]?.texture]);
  });
});
