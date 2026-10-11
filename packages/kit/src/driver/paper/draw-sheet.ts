import { attribute } from './gl';
import { FACES, type Gpu } from './gpu';
import {
  KEY_DIRECTION,
  KEY_SHARE,
  PAPER_ALBEDO,
  PAPER_THROUGH,
  SHOWS_THROUGH,
  SHOWS_THROUGH_CURLED,
} from './light';
import { sheetGrid, type SheetGrid } from './mesh';
import type { PaperFrame, PaperSheet } from './renderer';

/** What of a sheet is drawn: all of it, what lies on the pages, or what stands off them. */
export type SheetPart = 'whole' | 'lying' | 'lifted';

/** A sheet standing less than this above the pages, in the frame's units, casts no shadow. */
const LYING = 0.5;
/** How far apart sheets lying on each other are told to the depth test, in the frame's units. */
const SHEET_APART = 0.05;

/** Whether the whole of a sheet lies on the pages. */
export function liesOnThePages(sheet: PaperSheet): boolean {
  return tallestOf(sheet.positions) <= LYING;
}

/**
 * How far a sheet is lifted for the depth test alone, where it lies as it
 * was bound and where it is turned over. Lying right, a sheet nearer the
 * front of the book lies on the ones behind it; lying left, the other way
 * about. A leaf is one or the other as it swings; a page curled over is
 * both at once, each part in its own order.
 */
function liftOf(frame: PaperFrame, index: number): { lying: number; turned: number } {
  const sheet = frame.sheets[index];
  const behind = frame.sheets.length - 1 - index;
  if (sheet?.curl) {
    return { lying: SHEET_APART * behind, turned: SHEET_APART * (index - behind) };
  }
  const shown = sheet?.shown ?? 0;
  return { lying: SHEET_APART * ((1 - shown) * behind + shown * index), turned: 0 };
}

function tallestOf(positions: Float32Array): number {
  let tallest = 0;
  for (let index = 2; index < positions.length; index += 3) {
    tallest = Math.max(tallest, positions[index] ?? 0);
  }
  return tallest;
}

/** Sends every sheet's surface, and the way each point of it faces, to the GPU. */
export function uploadSheets(gpu: Gpu, frame: PaperFrame): SheetGrid {
  const { gl } = gpu;
  const grid = `${String(frame.columns)}x${String(frame.rows)}`;
  if (!gpu.mesh || gpu.grid !== grid) {
    gpu.grid = grid;
    gpu.mesh = sheetGrid(frame.columns, frame.rows);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvs);
    gl.bufferData(gl.ARRAY_BUFFER, gpu.mesh.uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpu.mesh.indices, gl.STATIC_DRAW);
  }
  frame.sheets.forEach((sheet, index) => {
    const buffers = (gpu.sheets[index] ??= {
      positions: gl.createBuffer(),
      normals: gl.createBuffer(),
      holds: null,
    });
    // A sheet lying still is already there as it was sent.
    if (sheet.still && buffers.holds === sheet.positions) return;
    buffers.holds = sheet.still ? sheet.positions : null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions);
    gl.bufferData(gl.ARRAY_BUFFER, sheet.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normals);
    gl.bufferData(gl.ARRAY_BUFFER, sheet.normals, gl.DYNAMIC_DRAW);
  });
  return gpu.mesh;
}

const PARTS: Record<SheetPart, number> = { whole: 0, lying: 1, lifted: -1 };

/** Tells the program what is drawn of which sheet: how it is lifted, which part, how its back shows. */
function drawnAs(gpu: Gpu, frame: PaperFrame, index: number, part: SheetPart): void {
  const { gl, sheet: program } = gpu;
  const lift = liftOf(frame, index);
  const curl = frame.sheets[index]?.curl;
  gl.uniform1f(program.uniforms['uLift'] ?? null, lift.lying);
  gl.uniform1f(program.uniforms['uTurnedLift'] ?? null, lift.turned);
  gl.uniform1f(program.uniforms['uPart'] ?? null, PARTS[part]);
  gl.uniform4f(program.uniforms['uCurl'] ?? null, curl?.dx ?? 0, curl?.dy ?? 0, curl?.at ?? 0, 0);
  gl.uniform1f(program.uniforms['uShows'] ?? null, curl ? SHOWS_THROUGH_CURLED : SHOWS_THROUGH);
}

/** Draws one sheet of a frame, or one part of it. */
export function drawSheet(
  gpu: Gpu,
  frame: PaperFrame,
  index: number,
  mesh: SheetGrid,
  eye: number,
  part: SheetPart,
): void {
  const sheet = frame.sheets[index];
  const buffers = gpu.sheets[index];
  if (!sheet || !buffers) return;
  const { gl, sheet: program } = gpu;
  const reach = frame.width - frame.spine;
  gl.useProgram(program.program);
  gl.uniform2f(program.uniforms['uSize'] ?? null, frame.width, frame.height);
  gl.uniform1f(program.uniforms['uEye'] ?? null, eye);
  gl.uniform1f(program.uniforms['uDepth'] ?? null, reach * 1.25);
  drawnAs(gpu, frame, index, part);
  gl.uniform1f(program.uniforms['uSpine'] ?? null, frame.spine / frame.width);
  gl.uniform1f(program.uniforms['uSheet'] ?? null, reach / frame.width);
  gl.uniform3f(program.uniforms['uPaper'] ?? null, ...frame.paper);
  gl.uniform3f(program.uniforms['uLight'] ?? null, ...KEY_DIRECTION);
  gl.uniform1f(program.uniforms['uKeyShare'] ?? null, KEY_SHARE);
  gl.uniform1f(program.uniforms['uThrough'] ?? null, PAPER_THROUGH);
  gl.uniform1f(program.uniforms['uAlbedo'] ?? null, PAPER_ALBEDO);
  [sheet.front, sheet.back].forEach((page, unit) => {
    const [sampler, printed] = FACES[unit] ?? FACES[0];
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, page ? page.texture : gpu.bare);
    gl.uniform1i(program.uniforms[sampler] ?? null, unit);
    gl.uniform1f(program.uniforms[printed] ?? null, page ? 1 : 0);
  });
  attribute(gl, program, 'aPosition', buffers.positions, 3);
  attribute(gl, program, 'aNormal', buffers.normals, 3);
  attribute(gl, program, 'aUv', gpu.uvs, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
}

/** How far out from the spine the leaf's shape is sampled for its shadow, as shares of its width. */
const PROFILE = [0.03, 0.25, 0.6, 1];

/** How high the leaf stands at most, and its shape in eight rows of four points: what its shadow is worked out from. */
export function outline(
  frame: PaperFrame,
  positions: Float32Array,
): { tallest: number; profile: Float32Array } {
  const { columns, rows } = frame;
  const profile = new Float32Array(8 * PROFILE.length * 3);
  for (let line = 0; line < 8; line += 1) {
    const row = Math.round((line / 7) * (rows - 1));
    PROFILE.forEach((out, point) => {
      const at = (row * columns + Math.round(out * (columns - 1))) * 3;
      profile.set(positions.subarray(at, at + 3), (line * PROFILE.length + point) * 3);
    });
  }
  return { tallest: Math.max(1, tallestOf(positions)), profile };
}
