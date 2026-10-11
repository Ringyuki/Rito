import { describe, expect, it } from 'vitest';
import { createSheetMesh } from '../src/driver/paper/mesh';
import { createSheet, type Sheet, type SheetHold } from '../src/driver/paper/sheet';

const shape = { spine: 400, width: 400, height: 600 };
const FRAME = 1 / 60;
/** How far short of its full reach the hand carries the edge. */
const SLACK = 0.12;

function sheetAt(turned: number): Sheet {
  const sheet = createSheet();
  sheet.reset(shape, turned);
  return sheet;
}

/** The outer edge, two thirds down, carried `turned` of the way round the spine. */
function carried(turned: number): SheetHold {
  const x = shape.spine + shape.width * (1 - 2 * turned);
  const chord = shape.width * (1 - SLACK * Math.sin(Math.PI * turned));
  return {
    u: 1,
    v: 2 / 3,
    x,
    y: shape.height * (2 / 3),
    z: Math.sqrt(Math.max(0, chord ** 2 - (x - shape.spine) ** 2)),
    grip: 1,
    span: 0.4,
  };
}

function run(sheet: Sheet, seconds: number, hold: (elapsed: number) => SheetHold | null): void {
  for (let elapsed = 0; elapsed < seconds; elapsed += FRAME) sheet.step(FRAME, hold(elapsed), null);
}

const heldRow = (sheet: Sheet): number => Math.round((sheet.rows - 1) * (2 / 3));

function point(sheet: Sheet, column: number, row: number): [number, number, number] {
  const p = (row * sheet.columns + column) * 3;
  return [sheet.positions[p] ?? 0, sheet.positions[p + 1] ?? 0, sheet.positions[p + 2] ?? 0];
}

function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  );
}

describe('a sheet of paper', () => {
  it('lies still when flat', () => {
    const sheet = sheetAt(0);
    run(sheet, 1, () => null);
    expect(sheet.distanceFromFlat(0)).toBeLessThan(0.2);
    expect(sheet.speed()).toBeLessThan(2);
  });

  it('goes where it is held, bound at the spine and without stretching', () => {
    const sheet = sheetAt(0);
    // Snatched a third of the way over in a tenth of a second, then held there.
    run(sheet, 0.6, (elapsed) => carried(Math.min(1, elapsed / 0.1) / 3));
    const hold = carried(1 / 3);
    const held = point(sheet, sheet.columns - 1, heldRow(sheet));
    expect(apart(held, [hold.x, held[1], hold.z])).toBeLessThan(1.5);
    for (let row = 0; row < sheet.rows; row += 1) {
      const [x, , z] = point(sheet, 0, row);
      expect([x, z]).toEqual([shape.spine, 0]);
      for (let column = 1; column < sheet.columns; column += 1) {
        const reach = (column / (sheet.columns - 1)) * shape.width;
        expect(apart(point(sheet, column, row), point(sheet, 0, row))).toBeLessThanOrEqual(
          reach * 1.0001,
        );
      }
    }
  });

  it('keeps its length where the hand is nearer than that, and bows', () => {
    const sheet = sheetAt(0);
    run(sheet, 0.5, (elapsed) => carried(Math.min(0.5, elapsed)));
    const row = heldRow(sheet);
    let length = 0;
    for (let column = 1; column < sheet.columns; column += 1) {
      length += apart(point(sheet, column, row), point(sheet, column - 1, row));
    }
    const straight = apart(point(sheet, sheet.columns - 1, row), point(sheet, 0, row));
    expect(straight).toBeLessThan(shape.width * 0.9);
    expect(length).toBeGreaterThan(shape.width * 0.97);
    expect(length).toBeLessThan(shape.width * 1.03);
  });

  it('falls to the side it leans to when let go, and lies flat there', () => {
    const over = sheetAt(0.6);
    run(over, 2, () => null);
    expect(over.distanceFromFlat(1)).toBeLessThan(1);

    const back = sheetAt(0.4);
    run(back, 2, () => null);
    expect(back.distanceFromFlat(0)).toBeLessThan(1);
  });

  it('is pressed flat on the page it lands on, however it was thrown', () => {
    const sheet = sheetAt(0);
    run(sheet, 0.3, (elapsed) => carried(elapsed / 0.3));
    for (let frame = 0; frame < 30; frame += 1) {
      sheet.step(FRAME, null, { pose: 1, weight: 0.3 });
    }
    expect(sheet.distanceFromFlat(1)).toBeLessThan(0.5);
    expect(Array.from(sheet.positions).every(Number.isFinite)).toBe(true);
  });

  it('moves the same whatever the frame rate', () => {
    const at = (frame: number): number => {
      const sheet = sheetAt(0);
      for (let elapsed = 0; elapsed < 0.3 - 1e-9; elapsed += frame) {
        sheet.step(frame, carried(0.3), null);
      }
      return point(sheet, 12, 10)[2];
    };
    // The same substeps, however the frames divide the time.
    expect(at(1 / 60)).toBeCloseTo(at(1 / 120), 0);
  });
});

describe('the surface drawn through the particles', () => {
  it('passes through every particle and faces the reader when flat', () => {
    const sheet = sheetAt(0);
    const mesh = createSheetMesh(sheet.columns, sheet.rows);
    mesh.update(sheet.positions);
    const detail = (mesh.columns - 1) / (sheet.columns - 1);
    for (const [column, row] of [
      [0, 0],
      [7, 11],
      [sheet.columns - 1, sheet.rows - 1],
    ] as const) {
      const fine = (row * detail * mesh.columns + column * detail) * 3;
      expect(Array.from(mesh.positions.slice(fine, fine + 3))).toEqual(point(sheet, column, row));
    }
    for (let index = 0; index < mesh.normals.length; index += 3) {
      expect(mesh.normals[index + 2]).toBeCloseTo(1, 5);
    }
    expect(mesh.indices.length).toBe((mesh.columns - 1) * (mesh.rows - 1) * 6);
    expect(Math.max(...mesh.indices)).toBe(mesh.columns * mesh.rows - 1);
  });

  it('rounds the paper between particles', () => {
    const sheet = sheetAt(0);
    run(sheet, 0.3, (elapsed) => carried(elapsed));
    const mesh = createSheetMesh(sheet.columns, sheet.rows);
    mesh.update(sheet.positions);
    // Between two particles on a bend, the surface lies off the straight line joining them.
    const row = heldRow(sheet);
    const detail = (mesh.columns - 1) / (sheet.columns - 1);
    let offLine = 0;
    for (let column = 0; column + 1 < sheet.columns; column += 1) {
      const a = point(sheet, column, row);
      const b = point(sheet, column + 1, row);
      const fine = (row * detail * mesh.columns + column * detail + 1) * 3;
      const between = Array.from(mesh.positions.slice(fine, fine + 3));
      const onLine = a.map((value, axis) => value + ((b[axis] ?? 0) - value) / detail);
      offLine = Math.max(offLine, apart(between, onLine));
    }
    expect(offLine).toBeGreaterThan(0.2);
  });
});
