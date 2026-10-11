import {
  attribute,
  createRenderTarget,
  finishProgram,
  startProgram,
  type Gl,
  type Program,
  type RenderTarget,
  type StartedProgram,
} from './gl';
import { KEY_DIRECTION, KEY_SHARE, KEY_SIZE, PAPER_ALBEDO, PAPER_THROUGH } from './light';
import {
  BLUR_FRAGMENT,
  CAST_FRAGMENT,
  CAST_VERTEX,
  OCCLUSION_FRAGMENT,
  QUAD_VERTEX,
  SHADOW_FRAGMENT,
} from './shadow-shaders';

/** What a shadow is cast from: the leaf's surface, as the GPU holds it, in a frame. */
export interface ShadowCaster {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  readonly eye: number;
  /** The highest any of the leaf stands above the pages. */
  readonly tallest: number;
  /**
   * The leaf's shape as its shadow needs it: eight rows down the leaf, four
   * points out from the spine in each, x, y and z of each.
   */
  readonly profile: Float32Array;
  readonly positions: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly indexCount: number;
}

/**
 * The darkness the leaves in the air leave on the pages: begun for a frame,
 * added to by each leaf that stands off them, then laid over whatever is
 * bound to draw to.
 */
export interface ShadowPass {
  begin(width: number, height: number): void;
  /** Adds what one leaf keeps of the light from each point of the pages. */
  cast(caster: ShadowCaster): void;
  lay(width: number, height: number): void;
}

/** How far from the spine the page beside a standing leaf shares its shade, in leaf widths. */
const GUTTER = 0.07;
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

/** The shadows of one frame: where they are worked out, what was drawn to, how many leaves cast. */
interface ShadowFrame {
  targets: ShadowTargets | null;
  drawingTo: WebGLFramebuffer | null;
  cast: number;
}

/** The shadow's programs, handed to the GPU and not yet asked for. */
export interface StartedShadow {
  readonly cast: StartedProgram;
  readonly occlusion: StartedProgram;
  readonly blur: StartedProgram;
  readonly lay: StartedProgram;
}

export function startShadowPrograms(gl: Gl): StartedShadow {
  const occlusion = ['uBlockers', 'uSize', 'uTallest', 'uKeySize', 'uKeyShare', 'uThrough'].concat([
    'uAlbedo',
    'uSpine',
    'uProfile',
    'uGutter',
    'uLight',
  ]);
  const cast = ['uSize', 'uEye', 'uCast', 'uTallest', 'uPixel'];
  return {
    cast: startProgram(gl, CAST_VERTEX, CAST_FRAGMENT, ['aPosition'], cast),
    occlusion: startProgram(gl, QUAD_VERTEX, OCCLUSION_FRAGMENT, ['aCorner'], occlusion),
    blur: startProgram(gl, QUAD_VERTEX, BLUR_FRAGMENT, ['aCorner'], ['uSource', 'uStep']),
    lay: startProgram(gl, QUAD_VERTEX, SHADOW_FRAGMENT, ['aCorner'], ['uSource', 'uStrength']),
  };
}

export function createShadowPass(gl: Gl, started: StartedShadow): ShadowPass {
  const programs: ShadowPrograms = {
    cast: finishProgram(gl, started.cast),
    occlusion: finishProgram(gl, started.occlusion),
    blur: finishProgram(gl, started.blur),
    lay: finishProgram(gl, started.lay),
    quad: gl.createBuffer(),
  };
  gl.bindBuffer(gl.ARRAY_BUFFER, programs.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const frame: ShadowFrame = { targets: null, drawingTo: null, cast: 0 };
  return {
    begin(width, height): void {
      frame.drawingTo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      frame.targets = sized(gl, frame.targets, width, height);
      frame.cast = 0;
      gl.disable(gl.DEPTH_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.targets.dark.framebuffer);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
    cast(caster): void {
      if (!frame.targets) return;
      frame.cast += 1;
      castOnto(gl, programs.cast, frame.targets.blockers, caster);
      // What two leaves keep of the light is kept by both: each takes its share of what the other left.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      occlude(gl, programs, frame.targets.blockers, frame.targets.dark, caster);
      gl.disable(gl.BLEND);
    },
    lay(width, height): void {
      layOver(gl, programs, frame, width, height);
    },
  };
}

/** Lays the darkness the leaves of a frame left over whatever was being drawn to before it began. */
function layOver(
  gl: Gl,
  programs: ShadowPrograms,
  frame: ShadowFrame,
  width: number,
  height: number,
): void {
  if (!frame.targets) return;
  const { dark, spare } = frame.targets;
  if (frame.cast > 0) {
    // The shadow is sampled with a pattern turned from pixel to pixel; a light blur takes its grain out.
    blurInto(gl, programs, dark, spare, 1.2 / dark.width, 0);
    blurInto(gl, programs, spare, dark, 0, 1.2 / dark.height);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, frame.drawingTo);
  gl.viewport(0, 0, width, height);
  if (frame.cast === 0) return;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  across(gl, programs.lay, programs.quad, dark.texture);
  gl.uniform1f(programs.lay.uniforms['uStrength'] ?? null, 1);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.BLEND);
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
  gl.uniform3fv(uniforms['uProfile'] ?? null, caster.profile);
  gl.uniform1f(uniforms['uGutter'] ?? null, GUTTER * (caster.width - caster.spine));
  gl.uniform3f(uniforms['uLight'] ?? null, ...KEY_DIRECTION);
  attribute(gl, programs.occlusion, 'aCorner', programs.quad, 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
