import { createRenderTarget, type Gl, type RenderTarget } from './gl';

/** The shadow is worked out this many times smaller than the frame. */
const SHADOW_SCALE = 2;

/**
 * The small textures a shadow is worked out in: where a leaf blocks the
 * lamp, what the leaves hide of the pages from the eye, and the darkness.
 */
export interface ShadowTargets {
  readonly blockers: RenderTarget;
  readonly cover: RenderTarget;
  readonly dark: RenderTarget;
  readonly spare: RenderTarget;
}

/**
 * Where the spine falls across what a shadow is worked out in, 0–1: the
 * spine itself, the edge between two texels nearest it, and the middles of
 * the texels either side of that edge.
 */
export interface SpineSides {
  readonly spine: number;
  readonly edge: number;
  readonly left: number;
  readonly right: number;
}

/**
 * The sides of a spine `spine` across a frame `width` wide, in a texture
 * `texels` wide laid over it. A texel is worked out for the page its middle
 * is on, so the two pages part at the edge between texels nearest the spine.
 */
export function sidesOf(spine: number, width: number, texels: number): SpineSides {
  const edge = Math.round((spine / width) * texels);
  return {
    spine: spine / width,
    edge: edge / texels,
    left: (edge - 0.5) / texels,
    right: (edge + 0.5) / texels,
  };
}

/** The textures for a frame `width` by `height`: those kept, if they are the size for it. */
export function targetsFor(
  gl: Gl,
  kept: ShadowTargets | null,
  width: number,
  height: number,
): ShadowTargets {
  const w = Math.min(1024, Math.max(64, Math.round(width / SHADOW_SCALE)));
  const h = Math.max(1, Math.round((w * height) / width));
  if (kept && kept.dark.width === w && kept.dark.height === h) return kept;
  for (const target of kept ? [kept.blockers, kept.cover, kept.dark, kept.spare] : []) {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  return {
    blockers: createRenderTarget(gl, w, h),
    cover: createRenderTarget(gl, w, h),
    dark: createRenderTarget(gl, w, h),
    spare: createRenderTarget(gl, w, h),
  };
}
