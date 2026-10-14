import { attribute, type Gl, type Program, type RenderTarget } from './gl';
import type { Curl } from './curl';
import { HANDED_BACK, KEY_DIRECTION, KEY_SHARE, KEY_SIZE, PAPER_THROUGH } from './light';
import { finishShadowPrograms, type ShadowPrograms, type StartedShadow } from './shadow-programs';
import { sidesOf, targetsFor, type ShadowTargets, type SpineSides } from './shadow-targets';

/** What a shadow is cast from: the leaf's surface, as the GPU holds it, in a frame. */
export interface ShadowCaster {
  readonly width: number;
  readonly height: number;
  readonly eye: number;
  /** The highest any of the leaf stands above the pages. */
  readonly tallest: number;
  /**
   * The curl of a page curled over, whose paper this side of the line it
   * leaves the pages at lies on them and hides nothing of them; null for a
   * leaf, whose shape is told by `profile`.
   */
  readonly curl: Curl | null;
  /**
   * The leaf's shape as its shadow needs it: eight rows down the leaf, four
   * points out from the spine in each, x, y and z of each.
   */
  readonly profile: Float32Array;
  readonly positions: WebGLBuffer;
  /** Where each point of the surface is on the sheet. */
  readonly uvs: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly indexCount: number;
}

/**
 * The darkness the leaves in the air leave on the pages: begun for a frame,
 * told each leaf that stands off them, then worked out and laid over
 * whatever was bound to draw to when it began.
 *
 * It is worked out for every point of the pages and smoothed among those
 * the eye sees. Under a leaf a page is in deep shade, and where the leaf
 * leans toward the eye some of that is in sight; the rest, behind the leaf,
 * must not darken what shows beside it.
 */
export interface ShadowPass {
  /** Begins the shadows of a frame `width` by `height` whose pages meet at `spine`. */
  begin(width: number, height: number, spine: number): void;
  /** Tells of a leaf that stands off the pages. */
  cast(caster: ShadowCaster): void;
  lay(width: number, height: number): void;
}

/** How far from the spine the page beside a standing leaf shares its shade, in leaf widths. */
const GUTTER = 0.07;
/**
 * How far this side of its line a curled page's paper is already counted as
 * hiding the pages, in the frame's units. What hides them and what shades
 * them are worked out apart, and must not differ over a point on the line:
 * taken for in sight and for under the paper at once, it would be a speck
 * of the deepest shade on the open page.
 */
const ON_THE_LINE = 0.5;

/** The shadows of one frame: where they are worked out, what was drawn to, the leaves that cast them. */
interface ShadowFrame {
  targets: ShadowTargets | null;
  drawingTo: WebGLFramebuffer | null;
  casters: ShadowCaster[];
  /** Where the frame's pages meet, in its own units. */
  spine: number;
  sides: SpineSides;
}

export function createShadowPass(gl: Gl, started: StartedShadow): ShadowPass {
  const programs = finishShadowPrograms(gl, started);
  const frame: ShadowFrame = {
    targets: null,
    drawingTo: null,
    casters: [],
    spine: 0,
    sides: sidesOf(0, 1, 1),
  };
  return {
    begin(width, height, spine): void {
      frame.drawingTo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      frame.targets = targetsFor(gl, frame.targets, width, height);
      frame.casters = [];
      frame.spine = spine;
      frame.sides = sidesOf(spine, width, frame.targets.dark.width);
    },
    cast(caster): void {
      frame.casters.push(caster);
    },
    lay(width, height): void {
      if (!frame.targets) return;
      gl.disable(gl.DEPTH_TEST);
      if (frame.casters.length > 0) workOut(gl, programs, frame, frame.targets);
      gl.bindFramebuffer(gl.FRAMEBUFFER, frame.drawingTo);
      gl.viewport(0, 0, width, height);
      if (frame.casters.length === 0) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // What is drawn to is finer than what the shadow was worked out in: there a page ends at the spine itself.
      const { dark } = frame.targets;
      across(gl, programs.lay, programs.quad, dark.texture, frame.sides, frame.sides.spine);
      gl.uniform1f(programs.lay.uniforms['uStrength'] ?? null, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);
    },
  };
}

/**
 * Works out the darkness the leaves of a frame leave on its pages: what
 * they hide from the eye first, then what each keeps of the light from what
 * is left in sight, then a light blur among those points.
 */
function workOut(
  gl: Gl,
  programs: ShadowPrograms,
  frame: ShadowFrame,
  targets: ShadowTargets,
): void {
  const { dark, spare } = targets;
  gl.disable(gl.BLEND);
  hide(gl, programs.cover, targets.cover, frame);
  clear(gl, dark);
  for (const caster of frame.casters) {
    castOnto(gl, programs.cast, targets.blockers, caster);
    // In sight stays as it is told; what two leaves keep of the light is kept by both, each
    // taking its share of what the other left.
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    occlude(gl, programs, frame, targets, caster);
    gl.disable(gl.BLEND);
  }
  // The shadow is sampled with a pattern turned from pixel to pixel; a light blur takes its grain out.
  blurInto(gl, programs, dark, spare, frame.sides, 1.2 / dark.width, 0);
  blurInto(gl, programs, spare, dark, frame.sides, 0, 1.2 / dark.height);
}

function clear(gl: Gl, target: RenderTarget): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/**
 * From where a sheet's paper hides the pages, as the cover is told it: the
 * direction across the page it is rolled back from, and how far along it
 * its paper begins to count. A page curled over hides them from its line
 * on, and a leaf wherever it is.
 */
export function hidesFrom(curl: Curl | null): readonly [number, number, number] {
  return curl ? [curl.dx, curl.dy, curl.at - ON_THE_LINE] : [0, 0, -1];
}

/** Marks in `target` what the leaves hide of the pages from the eye: each drawn where it is seen. */
function hide(gl: Gl, cover: Program, target: RenderTarget, frame: ShadowFrame): void {
  clear(gl, target);
  gl.useProgram(cover.program);
  for (const caster of frame.casters) {
    gl.uniform2f(cover.uniforms['uSize'] ?? null, caster.width, caster.height);
    gl.uniform1f(cover.uniforms['uEye'] ?? null, caster.eye);
    gl.uniform1f(cover.uniforms['uSpine'] ?? null, frame.spine);
    gl.uniform3f(cover.uniforms['uLine'] ?? null, ...hidesFrom(caster.curl));
    attribute(gl, cover, 'aPosition', caster.positions, 3);
    attribute(gl, cover, 'aUv', caster.uvs, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, caster.indices);
    gl.drawElements(gl.TRIANGLES, caster.indexCount, gl.UNSIGNED_SHORT, 0);
  }
}

/**
 * Readies `program` to draw `source` across whatever is drawn to, each page
 * read from its own side of the spine; `parts` is where the pages of what is
 * drawn to part.
 */
function across(
  gl: Gl,
  program: Program,
  quad: WebGLBuffer,
  source: WebGLTexture,
  sides: SpineSides,
  parts: number,
): void {
  gl.useProgram(program.program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, source);
  gl.uniform1i(program.uniforms['uSource'] ?? null, 0);
  parted(gl, program, sides, parts);
  attribute(gl, program, 'aCorner', quad, 2);
}

function parted(gl: Gl, program: Program, sides: SpineSides, parts: number): void {
  gl.uniform1f(program.uniforms['uSpineAt'] ?? null, parts);
  gl.uniform2f(program.uniforms['uBeside'] ?? null, sides.left, sides.right);
}

function blurInto(
  gl: Gl,
  programs: ShadowPrograms,
  from: RenderTarget,
  to: RenderTarget,
  sides: SpineSides,
  x: number,
  y: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer);
  gl.viewport(0, 0, to.width, to.height);
  across(gl, programs.blur, programs.quad, from.texture, sides, sides.edge);
  gl.uniform2f(programs.blur.uniforms['uStep'] ?? null, x, y);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * Where the leaf stands between the lamp and the pages, and how high: each
 * point of it drawn where the middle of the lamp would throw its shadow.
 */
function castOnto(gl: Gl, cast: Program, target: RenderTarget, caster: ShadowCaster): void {
  clear(gl, target);
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

/** How much darker the leaf leaves each point of the frame's pages in sight, into the darkness of its shadows. */
function occlude(
  gl: Gl,
  programs: ShadowPrograms,
  frame: ShadowFrame,
  { blockers, cover, dark }: ShadowTargets,
  caster: ShadowCaster,
): void {
  const { uniforms } = programs.occlusion;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dark.framebuffer);
  gl.viewport(0, 0, dark.width, dark.height);
  gl.useProgram(programs.occlusion.program);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, cover.texture);
  gl.uniform1i(uniforms['uCover'] ?? null, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blockers.texture);
  gl.uniform1i(uniforms['uBlockers'] ?? null, 0);
  gl.uniform2f(uniforms['uSize'] ?? null, caster.width, caster.height);
  gl.uniform1f(uniforms['uTallest'] ?? null, caster.tallest);
  gl.uniform1f(uniforms['uKeySize'] ?? null, KEY_SIZE);
  gl.uniform1f(uniforms['uKeyShare'] ?? null, KEY_SHARE);
  gl.uniform1f(uniforms['uThrough'] ?? null, PAPER_THROUGH);
  gl.uniform1f(uniforms['uHandedBack'] ?? null, HANDED_BACK);
  gl.uniform1f(uniforms['uSpine'] ?? null, frame.spine);
  parted(gl, programs.occlusion, frame.sides, frame.sides.edge);
  gl.uniform3fv(uniforms['uProfile'] ?? null, caster.profile);
  const { curl } = caster;
  gl.uniform4f(
    uniforms['uRoll'] ?? null,
    curl?.dx ?? 0,
    curl?.dy ?? 0,
    curl?.at ?? 0,
    curl?.radius ?? -1,
  );
  gl.uniform1f(uniforms['uGutter'] ?? null, GUTTER * (caster.width - frame.spine));
  gl.uniform3f(uniforms['uLight'] ?? null, ...KEY_DIRECTION);
  attribute(gl, programs.occlusion, 'aCorner', programs.quad, 2);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
