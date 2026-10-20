import type {
  PaperTurnFace,
  PaperTurnFrame,
  PaperTurnPage,
  PaperTurnPoint,
  PaperTurnRelease,
  PaperTurnSheet,
  PaperTurnTouch,
} from '../../../reader/paper-turn';

// The layouts of `rito_turn::pack`, checked against the engine's as it loads.
export const FRAME_NUMBERS = 23;
export const SHEET_NUMBERS = 11;
export const RELEASE_NUMBERS = 15;
export const SETTLE_NUMBERS = 12;

/** The number at `index`: every layout is read at indices its length holds. */
export function numberAt(numbers: Float64Array, index: number): number {
  return numbers[index] ?? 0;
}

function writePoint(out: Float64Array, at: number, point: PaperTurnPoint): void {
  out[at] = point.x;
  out[at + 1] = point.y;
}

/** origin, position, then farthest (present, x, y): the touch of a frame and of a release. */
function writeTouch(out: Float64Array, at: number, touch: PaperTurnTouch | null): void {
  if (!touch) return;
  out[at] = 1;
  writePoint(out, at + 1, touch.origin);
  writePoint(out, at + 3, touch.position);
  if (!touch.farthest) return;
  out[at + 5] = 1;
  writePoint(out, at + 6, touch.farthest);
}

function writePage(out: Float64Array, at: number, page: PaperTurnPage | null): void {
  if (!page) return;
  out[at] = 1;
  out[at + 1] = page.spread;
  out[at + 2] = page.buffer;
}

const INCOMING = { next: 1, prev: 2 } as const;
const PHASE = { held: 0, landing: 1, returning: 2 } as const;

/** A frame as `FrameInput::read` reads it. */
export function writeFrame(frame: PaperTurnFrame, out: Float64Array): void {
  out.fill(0);
  out.set([frame.width, frame.height, frame.spine, frame.cssPixel, frame.dx]);
  out[5] = frame.incoming ? INCOMING[frame.incoming] : 0;
  out[6] = PHASE[frame.phase];
  writeTouch(out, 7, frame.touch);
  writePage(out, 15, frame.current);
  writePage(out, 18, frame.incomingPage);
  out[21] = frame.now;
  out[22] = frame.epoch;
}

/** A release as `read_release` reads it. */
export function writeRelease(release: PaperTurnRelease, out: Float64Array): void {
  out.fill(0);
  out.set([release.dx, release.from, release.velocity, release.width]);
  out[4] = release.direction === 'forward' ? 1 : 0;
  writeTouch(out, 5, release.touch);
  if (release.spine === undefined) return;
  out[13] = 1;
  out[14] = release.spine;
}

export function pageAt(numbers: Float64Array, at: number): PaperTurnPage | null {
  if (numberAt(numbers, at) === 0) return null;
  return { spread: numberAt(numbers, at + 1), buffer: numberAt(numbers, at + 2) };
}

function faceAt(numbers: Float64Array, at: number): PaperTurnFace | null {
  const kind = numberAt(numbers, at);
  if (kind === 0) return null;
  return { leaf: numberAt(numbers, at + 1), page: kind === 1 ? 'front' : 'after' };
}

/** A sheet as `write_sheet` writes it. */
export function sheetOf(numbers: Float64Array): PaperTurnSheet {
  const still = numberAt(numbers, 5);
  return {
    front: faceAt(numbers, 0),
    back: faceAt(numbers, 2),
    shown: numberAt(numbers, 4),
    still: still === 0 ? null : still,
    curl:
      numberAt(numbers, 6) === 1
        ? {
            dx: numberAt(numbers, 7),
            dy: numberAt(numbers, 8),
            at: numberAt(numbers, 9),
            radius: numberAt(numbers, 10),
          }
        : null,
  };
}
