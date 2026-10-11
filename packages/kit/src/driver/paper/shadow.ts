import {
  attribute,
  createProgram,
  createRenderTarget,
  type Gl,
  type Program,
  type RenderTarget,
} from './gl';
import { BLUR_FRAGMENT, CAST_FRAGMENT, CAST_VERTEX, QUAD_VERTEX, SHADOW_FRAGMENT } from './shaders';

/** What a shadow is cast from: the sheet's surface, as the GPU holds it, in a frame. */
export interface ShadowCaster {
  readonly width: number;
  readonly height: number;
  /** How far the sheet reaches from the spine. */
  readonly reach: number;
  readonly eye: number;
  readonly light: readonly [number, number, number];
  readonly positions: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly indexCount: number;
}

export interface ShadowPass {
  /**
   * Draws the shadow the sheet casts on the pages, soft, into what is
   * bound to draw to when it is called, as darkness over what is there.
   */
  draw(caster: ShadowCaster): void;
}

/** How far a shadow falls sideways for each unit its paper rises. */
const CAST_REACH = 0.36;
const SHADOW_STRENGTH = 0.36;
/** Shadows are drawn this many times smaller than the frame, and blurred. */
const SHADOW_SCALE = 6;

interface ShadowPrograms {
  readonly cast: Program;
  readonly blur: Program;
  readonly lay: Program;
  /** The two triangles that cover whatever is drawn to. */
  readonly quad: WebGLBuffer;
}

export function createShadowPass(gl: Gl): ShadowPass {
  const uniforms = ['uSize', 'uEye', 'uCast', 'uReach'];
  const programs: ShadowPrograms = {
    cast: createProgram(gl, CAST_VERTEX, CAST_FRAGMENT, ['aPosition'], uniforms),
    blur: createProgram(gl, QUAD_VERTEX, BLUR_FRAGMENT, ['aCorner'], ['uSource', 'uStep']),
    lay: createProgram(gl, QUAD_VERTEX, SHADOW_FRAGMENT, ['aCorner'], ['uSource', 'uStrength']),
    quad: gl.createBuffer(),
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, programs.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  let targets: [RenderTarget, RenderTarget] | null = null;
  return {
    draw(caster): void {
      const drawingTo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      targets = sized(gl, targets, caster.width, caster.height);
      const [first, second] = targets;
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      castOnto(gl, programs.cast, first, caster);
      gl.disable(gl.BLEND);
      blurInto(gl, programs, first, second, 1 / first.width, 0);
      blurInto(gl, programs, second, first, 0, 1 / first.height);

      gl.bindFramebuffer(gl.FRAMEBUFFER, drawingTo);
      gl.viewport(0, 0, caster.width, caster.height);
      gl.enable(gl.BLEND);
      across(gl, programs.lay, programs.quad, first.texture);
      gl.uniform1f(programs.lay.uniforms['uStrength'] ?? null, SHADOW_STRENGTH);
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

/** The pair of small textures shadows are drawn and blurred in, for a frame of this size. */
function sized(
  gl: Gl,
  targets: [RenderTarget, RenderTarget] | null,
  width: number,
  height: number,
): [RenderTarget, RenderTarget] {
  const w = Math.min(384, Math.max(64, Math.round(width / SHADOW_SCALE)));
  const h = Math.max(1, Math.round((w * height) / width));
  if (targets && targets[0].width === w && targets[0].height === h) return targets;
  for (const target of targets ?? []) {
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }
  return [createRenderTarget(gl, w, h), createRenderTarget(gl, w, h)];
}

/** The sheet as the light throws it onto the pages. */
function castOnto(gl: Gl, cast: Program, target: RenderTarget, caster: ShadowCaster): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(cast.program);
  gl.uniform2f(cast.uniforms['uSize'] ?? null, caster.width, caster.height);
  gl.uniform1f(cast.uniforms['uEye'] ?? null, caster.eye);
  const sideways = -CAST_REACH / caster.light[2];
  gl.uniform2f(
    cast.uniforms['uCast'] ?? null,
    caster.light[0] * sideways,
    caster.light[1] * sideways,
  );
  gl.uniform1f(cast.uniforms['uReach'] ?? null, caster.reach);
  attribute(gl, cast, 'aPosition', caster.positions, 3);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, caster.indices);
  gl.drawElements(gl.TRIANGLES, caster.indexCount, gl.UNSIGNED_SHORT, 0);
}
