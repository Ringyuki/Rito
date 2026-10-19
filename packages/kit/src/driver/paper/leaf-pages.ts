import type {
  PaperTurnFace,
  PaperTurnForgotten,
  PaperTurnLaid,
  PaperTurnModel,
  PaperTurnPage,
} from '@ritojs/core';

import type { TransitionPage } from '../effects';
import type { PageSnapshot } from './gl';
import type { PaperRenderer, PaperSheet } from './renderer';

/** The pages a leaf in the air shows: on its front, and lying under it. */
interface Shown {
  front: PageSnapshot | null;
  after: PageSnapshot | null;
}

interface Points {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
}

/**
 * What of a paper turn is the host's: the pages the leaves in the air show,
 * copied from the pages as they were painted, and the points of each sheet.
 * The model names the leaves; the pages they show are kept here by those
 * names, taken when the model says a leaf is led and let go when it says a
 * leaf has left the book or is forgotten.
 */
export interface LeafPages {
  /** A page as the model knows it: its spread, and a number for the texture it is painted in. */
  named(page: TransitionPage | null): PaperTurnPage | null;
  /** Lets go of the pages of leaves the model forgot. */
  forget(forgotten: PaperTurnForgotten): void;
  /** Lets go of the pages of leaves that left the book, and gives the led leaf the frame's pages. */
  lay(laid: PaperTurnLaid, pages: readonly (TransitionPage | null)[]): void;
  /** The frame's sheets, their points copied out of the model. */
  sheets(model: PaperTurnModel, laid: PaperTurnLaid): PaperSheet[];
}

/** A number for the texture each page is painted in, by which the model tells pages apart. */
function pageNumbers(): {
  named(page: TransitionPage | null): PaperTurnPage | null;
  find(
    named: PaperTurnPage | null,
    pages: readonly (TransitionPage | null)[],
  ): TransitionPage | null;
} {
  const numbers = new WeakMap<WebGLTexture, number>();
  let counted = 0;
  return {
    named(page) {
      if (!page) return null;
      let buffer = numbers.get(page.texture);
      if (buffer === undefined) {
        counted += 1;
        buffer = counted;
        numbers.set(page.texture, buffer);
      }
      return { spread: page.spread, buffer };
    },
    find: (named, pages) =>
      named
        ? (pages.find((page) => page && numbers.get(page.texture) === named.buffer) ?? null)
        : null,
  };
}

export function createLeafPages(renderer: PaperRenderer): LeafPages {
  const numbers = pageNumbers();
  const leaves = new Map<number, Shown>();
  const letGo = (leaf: number, release: boolean): void => {
    const shown = leaves.get(leaf);
    leaves.delete(leaf);
    if (!shown || !release) return;
    if (shown.front) renderer.release(shown.front);
    if (shown.after) renderer.release(shown.after);
  };
  const points = sheetPoints();
  return {
    named: (page) => numbers.named(page),
    forget(forgotten) {
      for (const leaf of forgotten.leaves) letGo(leaf, forgotten.release);
    },
    lay(laid, pages) {
      for (const leaf of laid.leftBook) letGo(leaf, true);
      const shown = leaves.get(laid.led) ?? { front: null, after: null };
      // The led leaf shows its pages as they are now; a leaf left alone keeps them as they were.
      const taken = (
        page: TransitionPage | null,
        was: PageSnapshot | null,
      ): PageSnapshot | null => {
        const now = page ? renderer.snapshot(page) : null;
        if (was) renderer.release(was);
        return now;
      };
      shown.front = taken(numbers.find(laid.front, pages), shown.front);
      shown.after = taken(numbers.find(laid.after, pages), shown.after);
      leaves.set(laid.led, shown);
    },
    sheets(model, laid) {
      const faceOf = (face: PaperTurnFace | null): PageSnapshot | null =>
        face ? (leaves.get(face.leaf)?.[face.page] ?? null) : null;
      return points(model, laid, faceOf);
    },
  };
}

/**
 * The points of a frame's sheets. A sheet that moves is copied every frame
 * into arrays kept for its place in the frame; a sheet lying still into
 * arrays kept by the name the model gives its points, copied once, the
 * same arrays every frame: what tells the renderer it has them already.
 */
function sheetPoints(): (
  model: PaperTurnModel,
  laid: PaperTurnLaid,
  faceOf: (face: PaperTurnFace | null) => PageSnapshot | null,
) => PaperSheet[] {
  const moving: Points[] = [];
  let still = new Map<number, Points>();
  return (model, laid, faceOf) => {
    const length = laid.columns * laid.rows * 3;
    const fresh = (): Points => ({
      positions: new Float32Array(length),
      normals: new Float32Array(length),
    });
    const kept = new Map<number, Points>();
    const sheets: PaperSheet[] = [];
    for (let index = 0; index < laid.sheets; index += 1) {
      const sheet = model.sheet(index);
      let at: Points;
      if (sheet.still === null) {
        const was = moving[index];
        at = was?.positions.length === length ? was : fresh();
        moving[index] = at;
        model.points(index, at.positions, at.normals);
      } else {
        const was = still.get(sheet.still);
        at = was ?? fresh();
        if (!was) model.points(index, at.positions, at.normals);
        kept.set(sheet.still, at);
      }
      sheets.push({
        positions: at.positions,
        normals: at.normals,
        front: faceOf(sheet.front),
        back: faceOf(sheet.back),
        shown: sheet.shown,
        still: sheet.still !== null,
        ...(sheet.curl ? { curl: sheet.curl } : {}),
      });
    }
    still = kept;
    return sheets;
  };
}
