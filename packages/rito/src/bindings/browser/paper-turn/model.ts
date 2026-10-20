import { RitoPaperTurn, type RitoPaperTurnClass, type RitoRawPaperTurn } from '@ritojs/core-wasm';

import type { PaperTurnAt, PaperTurnForgotten, PaperTurnModel } from '../../../reader/paper-turn';
import { engineModuleReady } from '../engine-module';
import {
  FRAME_NUMBERS,
  numberAt,
  pageAt,
  RELEASE_NUMBERS,
  SETTLE_NUMBERS,
  SHEET_NUMBERS,
  sheetOf,
  writeFrame,
  writeRelease,
} from './numbers';

/** The engine's paper turn model, on the page's one instance of the engine. */
export async function loadPaperTurnModel(): Promise<PaperTurnModel> {
  await engineModuleReady();
  const turn: RitoPaperTurnClass = RitoPaperTurn;
  const layouts = [...turn.layouts()];
  const ours = [FRAME_NUMBERS, SHEET_NUMBERS, RELEASE_NUMBERS, SETTLE_NUMBERS];
  if (layouts.join() !== ours.join()) {
    throw new Error(
      `The engine's paper turn numbers are laid out ${layouts.join()}, not ${ours.join()}`,
    );
  }
  return paperTurnModelOf(turn);
}

function forgottenOf(raw: RitoRawPaperTurn): PaperTurnForgotten {
  return { leaves: [...raw.forgottenLeaves()], release: raw.forgottenRelease() };
}

function settleOf(
  raw: RitoRawPaperTurn,
  from: number,
  velocity: number,
  to: number,
): (seconds: number, now: number) => PaperTurnAt {
  const state = new Float64Array(SETTLE_NUMBERS);
  const at = new Float64Array(3);
  raw.settle(from, velocity, to, state);
  return (seconds, now) => {
    raw.settleStep(state, seconds, now, at);
    return { x: numberAt(at, 0), velocity: numberAt(at, 1), done: numberAt(at, 2) === 1 };
  };
}

type Frames = Pick<PaperTurnModel, 'begin' | 'lay' | 'sheet' | 'points' | 'forget'>;

/** The frames of a turn: read, laid out, their sheets told, forgotten. */
function framesOf(raw: RitoRawPaperTurn): Frames {
  const frame = new Float64Array(FRAME_NUMBERS);
  const sheet = new Float64Array(SHEET_NUMBERS);
  const pages = new Float64Array(6);
  return {
    begin(input) {
      writeFrame(input, frame);
      const turns = raw.begin(frame) === 1;
      const forgotten = forgottenOf(raw);
      if (!turns) return { kind: 'shown', forgotten };
      return { kind: 'turn', spread: raw.spread, anew: raw.anew, forgotten };
    },
    lay(epoch) {
      if (!raw.lay(epoch)) return null;
      raw.ledPages(pages);
      return {
        led: raw.led,
        front: pageAt(pages, 0),
        after: pageAt(pages, 3),
        leftBook: [...raw.leftBook()],
        columns: raw.columns,
        rows: raw.rows,
        sheets: raw.sheetCount(),
      };
    },
    sheet(index) {
      raw.sheet(index, sheet);
      return sheetOf(sheet);
    },
    points(index, positions, normals) {
      raw.points(index, positions, normals);
    },
    forget(epoch) {
      raw.forget(epoch);
      return forgottenOf(raw);
    },
  };
}

/** How a turn moves, and what the turn tells of its page. */
function physicsOf(
  turn: RitoPaperTurnClass,
  raw: RitoRawPaperTurn,
): Omit<PaperTurnModel, keyof Frames> {
  const release = new Float64Array(RELEASE_NUMBERS);
  const touch = new Float64Array(4);
  const begins = new Float64Array(2);
  return {
    get painted() {
      return raw.painted;
    },
    get there() {
      return raw.there;
    },
    get gone() {
      return raw.gone;
    },
    aloft: (now) => raw.aloft(now),
    travel(finger, width, spine) {
      touch.set([finger.origin.x, finger.origin.y, finger.position.x, finger.position.y]);
      return turn.travel(touch, width, spine);
    },
    lands(input) {
      writeRelease(input, release);
      return turn.lands(release);
    },
    begins(dx, velocity, sameSpreads) {
      raw.begins(dx, velocity, sameSpreads, begins);
      return { dx: numberAt(begins, 0), velocity: numberAt(begins, 1) };
    },
    settle: (from, velocity, to) => settleOf(raw, from, velocity, to),
    eyeHeight: (width, height) => turn.eyeHeight(width, height),
  };
}

export function paperTurnModelOf(turn: RitoPaperTurnClass): PaperTurnModel {
  const raw = new turn();
  // Onto the physics, whose getters ask the engine each time, not copied.
  return Object.assign(physicsOf(turn, raw), framesOf(raw));
}
