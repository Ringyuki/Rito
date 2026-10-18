import type { GlyphFamily, GlyphTable } from './atlas';
import type { QuadBatch } from './batch';
import type { GlPenDevice } from './device';
import { deviceQuarters, deviceRow } from './glyph-position';

interface RunPlacement {
  readonly text: string;
  readonly clusters: {
    readonly bytes: Uint32Array;
    readonly origins: Float32Array;
  };
}

interface Translation {
  readonly tx: number;
  readonly ty: number;
}

/**
 * Puts every inked cluster of a run on the GPU at the device position the
 * canvas would draw it at: its float32 origin under the ratio and the
 * translation in force, on the nearest quarter pixel, its baseline on the
 * nearest row. A cluster the run joins to the one before it is still drawn
 * at its own origin, which is where the string would put it.
 */
export function drawRunGlyphs(
  device: GlPenDevice,
  batch: QuadBatch,
  run: RunPlacement,
  table: GlyphTable,
  at: Translation,
): void {
  const { bytes, origins } = run.clusters;
  const text = run.text;
  const count = bytes.length;
  let current = table;
  let unit = 0;
  let byte = 0;
  for (let index = 0; index < count; index += 1) {
    const start = bytes[index] ?? 0;
    while (byte < start) {
      byte += utf8Length(text.charCodeAt(unit));
      unit += unitLength(text.charCodeAt(unit));
    }
    const code = text.charCodeAt(unit);
    if (code === 0x20) continue;
    const next = index + 1 < count ? (bytes[index + 1] ?? 0) : undefined;
    const family = familyOf(current, text, unit, start, next, code);
    const quarters = deviceQuarters(origins[index * 2] ?? 0, current.ratio, at.tx);
    const whole = Math.floor(quarters / 4);
    const phase = quarters - whole * 4;
    let cell = family.cells[phase] ?? device.atlas.cell(current, family, phase);
    if (cell === undefined) {
      current = emptiedAtlas(device, batch, current);
      cell = device.atlas.cell(current, familyOf(current, text, unit, start, next, code), phase);
      if (cell === undefined)
        throw new Error(`A glyph of "${family.text}" is larger than the atlas`);
    }
    if (cell.width === 0) continue;
    const row = deviceRow(origins[index * 2 + 1] ?? 0, current.ratio, at.ty);
    batch.push(
      'glyph',
      whole - cell.originX,
      row - cell.originY,
      cell.width,
      cell.height,
      cell.u,
      cell.v,
      current,
    );
  }
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
