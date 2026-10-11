import {
  attribute,
  createProgram,
  createRenderTarget,
  type Gl,
  type Program,
  type RenderTarget,
} from './gl';
import { KEY_DIRECTION, KEY_SHARE, KEY_SIZE, PAPER_ALBEDO, PAPER_THROUGH } from './light';
import {
  BLUR_FRAGMENT,
  CAST_FRAGMENT,
  CAST_VERTEX,
  OCCLUSION_FRAGMENT,
  QUAD_VERTEX,
  SHADOW_FRAGMENT,
} from './shaders';

/** What a shadow is cast from: the leaf's surface, as the GPU holds it, in a frame. */
export interface ShadowCaster {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  readonly eye: number;
  /** The highest any of the leaf stands above the pages. */
  readonly tallest: number;
  /** Eight points down the leaf's outer edge, x, y and z of each. */
  readonly edge: Float32Array;
  readonly positions: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly indexCount: number;
}

export interface ShadowPass {
  /** Darkens whatever is bound to draw to by what the leaf keeps of the light from each point of the pages. */
  draw(caster: ShadowCaster): void;
}

/** The shadow is worked out this many times smaller than the frame. */
const SHADOW_SCALE = 2;

interface ShadowPrograms {
  readonly cast: Program;
  readonly occlusion: Program;
  readonly blur: Program;
  readonly lay: Program;
  /** The two triangles that cover whatever is drawn to. */
  readonly quad: WebGLBuffer;
}

/** The small textures a shadow is worked out in: where the leaf blocks the lamp, and the darkness. */
interface ShadowTargets {
  readonly blockers: RenderTarget;
  readonly dark: RenderTarget;
  readonly spare: RenderTarget;
}

export function createShadowPass(gl: Gl): ShadowPass {
  const occlusion = ['uBlockers', 'uSize', 'uTallest', 'uKeySize', 'uKeyShare', 'uThrough'].concat([
    'uAlbedo',
    'uSpine',
    'uEdge',
  ]);
  const programs: ShadowPrograms = {
    cast: createProgram(
      gl,
      CAST_VERTEX,
      CAST_FRAGMENT,
      ['aPosition'],
      ['uSize', 'uEye', 'uCast', 'uTallest', 'uPixel'],
    ),
    occlusion: createProgram(gl, QUAD_VERTEX, OCCLUSION_FRAGMENT, ['aCorner'], occlusion),
    blur: createProgram(gl, QUAD_VERTEX, BLUR_FRAGMENT, ['aCorner'], ['uSource', 'uStep']),
    lay: createProgram(gl, QUAD_VERTEX, SHADOW_FRAGMENT, ['aCorner'], ['uSource', 'uStrength']),
    quad: gl.createBuffer(),
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, programs.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  let targets: ShadowTargets | null = null;
  return {
    draw(caster): void {
      const drawingTo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      targets = sized(gl, targets, caster.width, caster.height);
      const { blockers, dark, spare } = targets;
      gl.disable(gl.DEPTH_TEST);
      castOnto(gl, programs.cast, blockers, caster);
      occlude(gl, programs, blockers, dark, caster);
      // The shadow is sampled with a pattern turned from pixel to pixel; a light blur takes its grain out.
      blurInto(gl, programs, dark, spare, 1.2 / dark.width, 0);
      blurInto(gl, programs, spare, dark, 0, 1.2 / dark.height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, drawingTo);
      gl.viewport(0, 0, caster.width, caster.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      across(gl, programs.lay, programs.quad, dark.texture);
      gl.uniform1f(programs.lay.uniforms['uStrength'] ?? null, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
}

/** Readies `program` to draw `source` across whatever is drawn to. */
function across(gl: Gl, program: Program, quad: WebGLBuffer, source: WebGLTexture): void {
  gl.useProgram(program.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.uniform1i(program.uniforms['uSource'] ?? null, 0);
  attribute(gl, program, 'aCorner', quad, 2);
}

function blurInto(
  gl: Gl,
  programs: ShadowPrograms,
  from: RenderTarget,
  to: RenderTarget,
  x: number,
  y: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
  gl.viewport(0, 0, to.width, to.height);
  across(gl, programs.blur, programs.quad, from.texture);
  gl.uniform2f(programs.blur.uniforms['uStep'] ?? null, x, y);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

function sized(
  gl: Gl,
  targets: ShadowTargets | null,
  width: number,
  height: number,
): ShadowTargets {
  const w = Math.min(1024, Math.max(64, Math.round(width / SHADOW_SCALE)));
  const h = Math.max(1, Math.round((w * height) / width));
  if (targets && targets.dark.width === w && targets.dark.height === h) return targets;
  for (const target of targets ? [targets.blockers, targets.dark, targets.spare] : []) {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  return {
    blockers: createRenderTarget(gl, w, h),
    dark: createRenderTarget(gl, w, h),
    spare: createRenderTarget(gl, w, h),
  };
}

/**
 * Where the leaf stands between the lamp and the pages, and how high: each
 * point of it drawn where the middle of the lamp would throw its shadow.
 */
function castOnto(gl: Gl, cast: Program, target: RenderTarget, caster: ShadowCaster): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.disable(gl.BLEND);
  gl.useProgram(cast.program);
  gl.uniform2f(cast.uniforms['uSize'] ?? null, caster.width, caster.height);
  gl.uniform1f(cast.uniforms['uEye'] ?? null, caster.eye);
  gl.uniform2f(
    cast.uniforms['uCast'] ?? null,
    -KEY_DIRECTION[0] / KEY_DIRECTION[2],
    -KEY_DIRECTION[1] / KEY_DIRECTION[2],
  );
  gl.uniform1f(cast.uniforms['uTallest'] ?? null, caster.tallest);
  gl.uniform1f(cast.uniforms['uPixel'] ?? null, caster.width / target.width);
  attribute(gl, cast, 'aPosition', caster.positions, 3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, caster.indices);
  gl.drawElements(gl.TRIANGLES, caster.indexCount, gl.UNSIGNED_SHORT, 0);
}

/** How much darker the leaf leaves each point of the pages, into `target`. */
function occlude(
  gl: Gl,
  programs: ShadowPrograms,
  blockers: RenderTarget,
  target: RenderTarget,
  caster: ShadowCaster,
): void {
  const { uniforms } = programs.occlusion;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.useProgram(programs.occlusion.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blockers.texture);
  gl.uniform1i(uniforms['uBlockers'] ?? null, 0);
  gl.uniform2f(uniforms['uSize'] ?? null, caster.width, caster.height);
  gl.uniform1f(uniforms['uTallest'] ?? null, caster.tallest);
  gl.uniform1f(uniforms['uKeySize'] ?? null, KEY_SIZE);
  gl.uniform1f(uniforms['uKeyShare'] ?? null, KEY_SHARE);
  gl.uniform1f(uniforms['uThrough'] ?? null, PAPER_THROUGH);
  gl.uniform1f(uniforms['uAlbedo'] ?? null, PAPER_ALBEDO);
  gl.uniform1f(uniforms['uSpine'] ?? null, caster.spine);
  gl.uniform3fv(uniforms['uEdge'] ?? null, caster.edge);
  attribute(gl, programs.occlusion, 'aCorner', programs.quad, 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
