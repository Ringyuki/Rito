import {
  loadPaperTurnModel,
  type PaperTurnFrame,
  type PaperTurnLaid,
  type PaperTurnModel,
} from '@ritojs/core';

import type {
  PaintedTransitionEffect,
  TransitionFrame,
  TransitionPage,
  TransitionScene,
} from '../effects';
import type { TransitionPhysics } from '../physics';
import { createLeafPages, type LeafPages } from './leaf-pages';
import { colourOf, paintPlain } from './pages';
import { paperPhysics } from './paper-physics';
import { createPaperRenderer, drawnLength, type PaperRenderer } from './renderer';

export interface PaperTurnOptions {
  /**
   * The paper's colour, as `#rrggbb`: what shows where a page's bitmap is
   * transparent. White when omitted. A page painted with its own
   * background needs none.
   */
  readonly paper?: string;
  /** The clock the leaf moves by, in ms. The page's own when omitted. */
  readonly now?: () => number;
}

interface PaperTurn {
  readonly now: () => number;
  readonly paper: readonly [number, number, number];
  readonly renderer: PaperRenderer;
  /** The engine's model of the turn, once it is loaded. */
  model: PaperTurnModel | null;
  physics: TransitionPhysics | undefined;
  readonly pages: LeafPages;
  /** The leaf whose turn began before the GPU was ready, and is drawn plain to its end; else null. */
  plain: number | null;
  /** That a turn was drawn plain for that reason has been said. */
  said: boolean;
}

/**
 * A page turned as paper is. With two pages a spread it is a leaf of a
 * book: bound at the spine, it bends round a cone as it lifts, swings over
 * the spine arched in the air, carrying the next page on its back, and
 * comes down on the far side edge first, the arch settling after. With one
 * page a spread it is curled over on itself: peeled back from its outer
 * edge or a corner round a small roll, its back showing, until the line it
 * leaves the page at reaches the spine. Paper bends without stretching.
 * Either way it is drawn in three dimensions, lit from over the reader's
 * shoulder, with its shadow on the pages beneath.
 *
 * A turn that cuts into another does not stop its page. Turned back, the
 * same page comes back from where it is; turned on, it carries on by itself
 * while the next lifts, so several are in the air at once; and a finger
 * takes a page in the air where it is.
 *
 * How the paper moves and where it is are the engine's, the same on every
 * host; it is drawn by the GPU. Until the engine is loaded, and where there
 * is no GPU, turns fall back to the built-in `cover`. Make one per reader.
 */
export function createPaperTurn(options: PaperTurnOptions = {}): PaintedTransitionEffect {
  return paperTurnWith(createPaperRenderer(), options);
}

/**
 * The paper turn drawn by `renderer`, moved by `model`: what
 * `createPaperTurn` makes, with a renderer and a model of its own.
 */
export function paperTurnWith(
  renderer: PaperRenderer,
  options: PaperTurnOptions = {},
  model: PaperTurnModel | Promise<PaperTurnModel> = loadPaperTurnModel(),
): PaintedTransitionEffect {
  const state: PaperTurn = {
    now: options.now ?? ((): number => performance.now()),
    paper: colourOf(options.paper),
    renderer,
    model: null,
    physics: undefined,
    pages: createLeafPages(renderer),
    plain: null,
    said: false,
  };
  const take = (loaded: PaperTurnModel): void => {
    state.model = loaded;
    state.physics = paperPhysics(loaded, state.now);
  };
  if (model instanceof Promise) {
    model.then(take, (error: unknown) => {
      console.error('[rito] the paper turn could not be loaded; turns are drawn plain', error);
    });
  } else {
    take(model);
  }
  return {
    paint(scene, frame): void {
      paint(state, scene, frame);
    },
    // The shaders are compiled while the book is opened, not in the first frame of the first turn.
    prepare(gl): void {
      state.renderer.prepare(gl);
    },
    // The pages a turn may take are copied now, not in its first frame.
    warm(scene): void {
      for (const slot of ['curr', 'next', 'prev'] as const) {
        const page = scene.page(slot);
        const snapshot = page && state.renderer.snapshot(page);
        if (snapshot) state.renderer.release(snapshot);
      }
    },
    // The built-in physics until the model is loaded.
    get physics(): TransitionPhysics | undefined {
      return state.physics;
    },
  };
}

function paint(state: PaperTurn, scene: TransitionScene, frame: TransitionFrame): void {
  state.renderer.prepare(scene.gl);
  const { model } = state;
  if (!model) {
    paintPlain(scene, frame);
    return;
  }
  const current = scene.page('curr');
  const incoming = frame.incoming ? scene.page(frame.incoming) : null;
  const begun = model.begin(frameOf(state, scene, frame, current, incoming));
  state.pages.forget(begun.forgotten);
  // One page a spread has no leaf to bring back before the first page.
  if (begun.kind === 'shown') {
    scene.drawPage('curr', frame.dx);
    return;
  }
  if (begun.anew) state.plain = null;
  const laid = drawnPlain(state, begun.spread) ? null : model.lay(state.renderer.epoch);
  if (!laid || !drawLeaves(state, model, scene, laid, [current, incoming])) {
    paintPlain(scene, frame);
  }
}

/** The frame as the model reads it. */
function frameOf(
  state: PaperTurn,
  scene: TransitionScene,
  frame: TransitionFrame,
  current: TransitionPage | null,
  incoming: TransitionPage | null,
): PaperTurnFrame {
  return {
    width: scene.width,
    height: scene.height,
    spine: scene.spine,
    cssPixel: scene.cssPixel,
    dx: frame.dx,
    incoming: frame.incoming,
    phase: frame.phase,
    touch: frame.touch,
    current: state.pages.named(current),
    incomingPage: state.pages.named(incoming),
    now: state.now(),
    epoch: state.renderer.epoch,
  };
}

/** Draws the sheets of a frame laid out; false, and nothing kept in the air, where the GPU cannot. */
function drawLeaves(
  state: PaperTurn,
  model: PaperTurnModel,
  scene: TransitionScene,
  laid: PaperTurnLaid,
  pages: readonly (TransitionPage | null)[],
): boolean {
  state.pages.lay(laid, pages);
  const drawn = state.renderer.draw({
    width: scene.width,
    height: scene.height,
    spine: scene.spine,
    columns: laid.columns,
    rows: laid.rows,
    eye: model.eyeHeight(drawnLength(scene.width), drawnLength(scene.height)),
    sheets: state.pages.sheets(model, laid),
    paper: state.paper,
  });
  if (!drawn) state.pages.forget(model.forget(state.renderer.epoch));
  return drawn;
}

/**
 * Whether this frame is drawn as the built-in cover: there is no GPU, or the
 * turn began while the GPU was still compiling. Such a turn stays plain to
 * its end, for a leaf appearing halfway would be a jump, and nothing waits:
 * a turn is never held up for its looks.
 */
function drawnPlain(state: PaperTurn, leaf: number): boolean {
  if (state.plain === leaf) return true;
  const standing = state.renderer.standing;
  state.plain = standing === 'ready' ? null : leaf;
  if (standing === 'ready') return false;
  if (standing === 'waiting' && !state.said) {
    state.said = true;
    console.warn('[rito] the paper turn was not ready for this turn, which is drawn plain');
  }
  return true;
}
