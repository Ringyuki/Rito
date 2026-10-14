import { finishProgram, startProgram, type Gl, type Program, type StartedProgram } from './gl';
import {
  BLUR_FRAGMENT,
  CAST_FRAGMENT,
  CAST_VERTEX,
  COVER_FRAGMENT,
  COVER_VERTEX,
  OCCLUSION_FRAGMENT,
  QUAD_VERTEX,
  SHADOW_FRAGMENT,
} from './shadow-shaders';

/** The shadow's programs, handed to the GPU and not yet asked for. */
export interface StartedShadow {
  readonly cast: StartedProgram;
  readonly cover: StartedProgram;
  readonly occlusion: StartedProgram;
  readonly blur: StartedProgram;
  readonly lay: StartedProgram;
}

export interface ShadowPrograms {
  readonly cast: Program;
  readonly cover: Program;
  readonly occlusion: Program;
  readonly blur: Program;
  readonly lay: Program;
  /** The two triangles that cover whatever is drawn to. */
  readonly quad: WebGLBuffer;
}

/** What tells a program reading a texture where the pages part across it. */
const PARTED = ['uSpineAt', 'uBeside'];

export function startShadowPrograms(gl: Gl): StartedShadow {
  const occlusion = ['uBlockers', 'uCover', 'uSize', 'uTallest', 'uKeySize', 'uKeyShare'].concat(
    ['uThrough', 'uHandedBack', 'uSpine', 'uProfile', 'uGutter', 'uLight', 'uRoll'],
    PARTED,
  );
  const cast = ['uSize', 'uEye', 'uCast', 'uTallest', 'uPixel'];
  const read = ['uSource', ...PARTED];
  return {
    cast: startProgram(gl, CAST_VERTEX, CAST_FRAGMENT, ['aPosition'], cast),
    cover: startProgram(
      gl,
      COVER_VERTEX,
      COVER_FRAGMENT,
      ['aPosition', 'aUv'],
      ['uSize', 'uEye', 'uSpine', 'uLine'],
    ),
    occlusion: startProgram(gl, QUAD_VERTEX, OCCLUSION_FRAGMENT, ['aCorner'], occlusion),
    blur: startProgram(gl, QUAD_VERTEX, BLUR_FRAGMENT, ['aCorner'], [...read, 'uStep']),
    lay: startProgram(gl, QUAD_VERTEX, SHADOW_FRAGMENT, ['aCorner'], [...read, 'uStrength']),
  };
}

/** Every program of a shadow, for asking the GPU whether it has finished with them. */
export function shadowPrograms(started: StartedShadow): StartedProgram[] {
  return [started.cast, started.cover, started.occlusion, started.blur, started.lay];
}

/** The programs ready to draw with. Waits for the GPU if it has not finished. */
export function finishShadowPrograms(gl: Gl, started: StartedShadow): ShadowPrograms {
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  return {
    cast: finishProgram(gl, started.cast),
    cover: finishProgram(gl, started.cover),
    occlusion: finishProgram(gl, started.occlusion),
    blur: finishProgram(gl, started.blur),
    lay: finishProgram(gl, started.lay),
    quad,
  };
}
