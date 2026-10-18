import type { GlyphFamily, GlyphTable } from './atlas';
import type { QuadBatch } from './batch';
import type { GlPenDevice } from './device';
import { deviceRow, glyphQuarters } from './glyph-position';

interface RunPlacement {
  readonly text: string;
  readonly clusters: {
    readonly bytes: Uint32Array;
    readonly origins: Float32Array;
    readonly joins: Uint8Array;
  };
}

interface Translation {
  readonly tx: number;
  readonly ty: number;
}

const f32 = Math.fround;

/**
 * Puts every inked cluster of a run on the GPU at the device position the
 * canvas pen draws it at: its float32 origin under the ratio and the
 * translation in force, on the quarter pixel the canvas rounds it to, its
 * baseline on the row. The canvas pen draws a cluster that joins the one
 * before it in the same string: it sits the advances the canvas has added
 * since that string's origin, in float as the canvas adds them, into it.
 */
export function drawRunGlyphs(
  device: GlPenDevice,
  batch: QuadBatch,
  run: RunPlacement,
  table: GlyphTable,
  at: Translation,
): void {
  const { bytes, origins, joins } = run.clusters;
  const text = run.text;
  const count = bytes.length;
  let current = table;
  let unit = 0;
  let byte = 0;
  // The string the clusters joined so far are drawn in: its origin and how
  // far its pen has gone.
  let stringOrigin = 0;
  let stringPen = 0;
  let advance = 0;
  for (let index = 0; index < count; index += 1) {
    const start = bytes[index] ?? 0;
    while (byte < start) {
      byte += utf8Length(text.charCodeAt(unit));
      unit += unitLength(text.charCodeAt(unit));
    }
    const code = text.charCodeAt(unit);
    const next = index + 1 < count ? (bytes[index + 1] ?? 0) : undefined;
    const family = familyOf(current, text, unit, start, next, code);
    if (joins[index] === 1) {
      stringPen = f32(stringPen + advance);
    } else {
      stringOrigin = f32(origins[index * 2] ?? 0);
      stringPen = 0;
    }
    advance = device.atlas.reach(current, family).advance;
    if (code === 0x20) continue;
    const quarters = glyphQuarters(stringOrigin, stringPen, current.ratio, at.tx);
    const y = origins[index * 2 + 1] ?? 0;
    if (placeCluster(device, batch, current, family, quarters, y, at)) continue;
    // The atlas is full: draw what uses it, empty it, carry on.
    current = emptiedAtlas(device, batch, current);
    const again = familyOf(current, text, unit, start, next, code);
    if (!placeCluster(device, batch, current, again, quarters, y, at)) {
      throw new Error(`A glyph of "${family.text}" is larger than the atlas`);
    }
  }
}

/** Puts one cluster at `quarters` device quarter pixels and CSS baseline `y`; false when the atlas has no room for its cell. */
function placeCluster(
  device: GlPenDevice,
  batch: QuadBatch,
  table: GlyphTable,
  family: GlyphFamily,
  quarters: number,
  y: number,
  at: Translation,
): boolean {
  const whole = Math.floor(quarters / 4);
  const phase = quarters - whole * 4;
  const cell = family.cells[phase] ?? device.atlas.cell(table, family, phase);
  if (cell === undefined) return false;
  if (cell.width === 0) return true;
  const row = deviceRow(y, table.ratio, at.ty);
  batch.push(
    'glyph',
    whole - cell.originX,
    row - cell.originY,
    cell.width,
    cell.height,
    cell.u,
    cell.v,
    table,
  );
  return true;
}

/** Draws what uses the full atlas, empties it and answers the table to carry on in. */
function emptiedAtlas(device: GlPenDevice, batch: QuadBatch, table: GlyphTable): GlyphTable {
  batch.flush();
  device.atlas.reset();
  return device.atlas.table(table.ratio, table.font, table.ink, table.channels);
}

/** The family of the cluster starting at UTF-16 `unit` (UTF-8 `start`) and ending where the next cluster starts. */
function familyOf(
  table: GlyphTable,
  text: string,
  unit: number,
  start: number,
  next: number | undefined,
  code: number,
): GlyphFamily {
  const single =
    unitLength(code) === 1 &&
    (next === undefined ? unit + 1 === text.length : next === start + utf8Length(code));
  if (single) {
    let family = table.byCode.get(code);
    if (family === undefined) {
      family = { text: String.fromCharCode(code), cells: [], reach: undefined };
      table.byCode.set(code, family);
    }
    return family;
  }
  const cluster = text.slice(unit, endUnit(text, unit, start, next));
  let family = table.byText.get(cluster);
  if (family === undefined) {
    family = { text: cluster, cells: [], reach: undefined };
    table.byText.set(cluster, family);
  }
  return family;
}

function endUnit(text: string, unit: number, start: number, next: number | undefined): number {
  if (next === undefined) return text.length;
  let end = unit;
  let byte = start;
  while (byte < next && end < text.length) {
    byte += utf8Length(text.charCodeAt(end));
    end += unitLength(text.charCodeAt(end));
  }
  return end;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code < 0xdc00;
}

function unitLength(code: number): number {
  return isHighSurrogate(code) ? 2 : 1;
}

function utf8Length(code: number): number {
  if (isHighSurrogate(code)) return 4;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
}
