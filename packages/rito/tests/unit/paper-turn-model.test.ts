/**
 * The paper turn's model as the web runs it, the engine built for the
 * browser, replayed over the turns `crates/rito-turn` replays natively
 * (`tests/web_traces.rs`): every answer folds into the same digest, so the
 * web computes the bits every other host does. Skipped on the placeholder
 * build, which has no engine.
 */
import { existsSync, readFileSync } from 'node:fs';

import { initRitoCoreWasmSync } from '@ritojs/core-wasm';
import { describe, expect, it } from 'vitest';

import {
  loadPaperTurnModel,
  type PaperTurnFace,
  type PaperTurnModel,
  type PaperTurnPage,
  type PaperTurnSheet,
  type PaperTurnTouch,
} from '../../src/index';

const WASM = new URL('../../../rito-core-wasm/dist/rito_wasm_bg.wasm', import.meta.url);
const FIXTURES = new URL('../../../../crates/rito-turn/tests/fixtures/', import.meta.url);
const engineBuilt = existsSync(WASM) && readFileSync(WASM).byteLength > 1024;

interface Point {
  readonly x: number;
  readonly y: number;
}
interface RecordedTouch {
  readonly origin: Point;
  readonly position: Point;
  readonly farthest: Point | null;
}
interface RecordedFrame {
  readonly dx: number;
  readonly incoming: 'next' | 'prev' | null;
  readonly phase: 'held' | 'landing' | 'returning';
  readonly touch: RecordedTouch | null;
}
interface Recorded {
  readonly lands?: {
    readonly release: {
      readonly dx: number;
      readonly from: number;
      readonly velocity: number;
      readonly width: number;
      readonly direction: 'forward' | 'backward';
      readonly touch: RecordedTouch | null;
      readonly spine: number | null;
    };
    readonly answer: boolean;
  };
  readonly settleFrom?: { readonly from: number; readonly velocity: number; readonly to: number };
  readonly settle?: { readonly seconds: number };
  readonly now: number;
  readonly spread: number;
  readonly incoming: number | null;
  readonly frame: RecordedFrame;
}
interface Trace {
  readonly name: string;
  readonly layout: {
    readonly width: number;
    readonly height: number;
    readonly spine: number;
    readonly cssPixel: number;
  };
  readonly frames: readonly Recorded[];
}

/** FNV-1a over 32-bit words, f64s low word first: `Digest` in `tests/web_traces.rs`. */
class Digest {
  value = 2_166_136_261;
  private readonly wide = new Float64Array(1);
  private readonly words = new Uint32Array(this.wide.buffer);

  word(word: number): void {
    this.value = Math.imul(this.value ^ word, 16_777_619) >>> 0;
  }
  number(value: number): void {
    this.wide[0] = value;
    this.word(this.words[0] ?? 0);
    this.word(this.words[1] ?? 0);
  }
  flag(value: boolean): void {
    this.word(value ? 1 : 0);
  }
  leaves(leaves: readonly number[]): void {
    this.word(leaves.length);
    for (const leaf of leaves) this.word(leaf);
  }
  points(values: Float32Array): void {
    const words = new Uint32Array(values.buffer, values.byteOffset, values.length);
    let value = this.value;
    for (const word of words) value = Math.imul(value ^ word, 16_777_619) >>> 0;
    this.value = value;
  }
}

function touchOf(touch: RecordedTouch | null): PaperTurnTouch | null {
  if (!touch) return null;
  const { origin, position, farthest } = touch;
  return farthest ? { origin, position, farthest } : { origin, position };
}

const page = (spread: number): PaperTurnPage => ({ spread, buffer: 1000 + spread });

/** A sheet as `write_sheet` lays it out. */
function sheetNumbers(sheet: PaperTurnSheet): number[] {
  const face = (face: PaperTurnFace | null): number[] =>
    face ? [face.page === 'front' ? 1 : 2, face.leaf] : [0, 0];
  const curl = sheet.curl;
  return [
    ...face(sheet.front),
    ...face(sheet.back),
    sheet.shown,
    sheet.still ?? 0,
    ...(curl ? [1, curl.dx, curl.dy, curl.at, curl.radius] : [0, 0, 0, 0, 0]),
  ];
}

function laidOut(model: PaperTurnModel, digest: Digest): void {
  const laid = model.lay(0);
  if (!laid) throw new Error('a frame waits');
  digest.word(laid.led);
  digest.leaves(laid.leftBook);
  digest.word(laid.columns);
  digest.word(laid.rows);
  digest.word(laid.sheets);
  for (let index = 0; index < laid.sheets; index += 1) {
    const positions = new Float32Array(laid.columns * laid.rows * 3);
    const normals = new Float32Array(laid.columns * laid.rows * 3);
    const sheet = model.sheet(index);
    model.points(index, positions, normals);
    for (const value of sheetNumbers(sheet)) digest.number(value);
    digest.points(positions);
    digest.points(normals);
  }
}

async function replay(trace: Trace): Promise<string> {
  const model = await loadPaperTurnModel();
  const digest = new Digest();
  let settle:
    | ((seconds: number, now: number) => { x: number; velocity: number; done: boolean })
    | null = null;
  for (const record of trace.frames) {
    if (record.lands) {
      const { spine, ...release } = record.lands.release;
      const answer = model.lands({
        ...release,
        touch: touchOf(release.touch),
        ...(typeof spine === 'number' ? { spine } : {}),
      });
      expect(answer).toBe(record.lands.answer);
      digest.flag(answer);
      continue;
    }
    if (record.settleFrom) {
      const { from, velocity, to } = record.settleFrom;
      settle = model.settle(from, velocity, to);
      continue;
    }
    if (settle && record.settle) {
      const at = settle(record.settle.seconds, record.now);
      digest.number(at.x);
      digest.number(at.velocity);
      digest.flag(at.done);
    }
    const { frame } = record;
    const begun = model.begin({
      ...trace.layout,
      dx: frame.dx,
      incoming: frame.incoming,
      phase: frame.phase,
      touch: touchOf(frame.touch),
      current: page(record.spread),
      incomingPage: typeof record.incoming === 'number' ? page(record.incoming) : null,
      now: record.now,
      epoch: 0,
    });
    if (begun.kind === 'shown') {
      digest.word(0);
      digest.number(frame.dx);
    } else {
      digest.word(1);
      digest.number(begun.spread);
      digest.flag(begun.anew);
    }
    digest.leaves(begun.forgotten.leaves);
    digest.flag(begun.forgotten.release);
    if (begun.kind === 'turn') laidOut(model, digest);
    digest.flag(model.gone);
  }
  return digest.value.toString(16).padStart(8, '0');
}

describe.skipIf(!engineBuilt)('the paper turn model on the web', () => {
  it('replays the recorded turns to the digests the native engine replays them to', async () => {
    initRitoCoreWasmSync({ module: readFileSync(WASM) });
    const recorded = JSON.parse(readFileSync(new URL('web-traces.json', FIXTURES), 'utf8')) as {
      readonly traces: readonly Trace[];
    };
    const held = JSON.parse(
      readFileSync(new URL('web-traces-digest.json', FIXTURES), 'utf8'),
    ) as Record<string, string>;
    const ours: Record<string, string> = {};
    for (const trace of recorded.traces) ours[trace.name] = await replay(trace);
    expect(ours).toEqual(held);
  });
});
