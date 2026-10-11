import type {
  ReaderInteractions,
  ReaderPageSemantics,
  ReaderSemanticNode,
  Spread,
} from '@ritojs/core';
import { createA11yMirror, type A11yMirror } from '../../interaction/index';
import type { DisposableCollection } from '../../utils/disposable';
import { scheduleAfterNextFrame } from '../../utils/idle-task';
import { transitionLifecycle } from '../core/transition-lifecycle';
import type { WiringDeps } from '../core/wiring-deps';
import { dispatchNativeClickTarget } from './native-click';
import { supersedePendingImageRequest } from './image-click';

interface A11yLoadState {
  alive: boolean;
  generation: number;
  spreadIndex: number | null;
  pageByNode: WeakMap<ReaderSemanticNode, number>;
  /** Puts the visible spread's semantics, already read, into the mirror. */
  install: (() => void) | null;
  cancelInstall: (() => void) | null;
}

export function wireA11y(deps: WiringDeps, disposables: DisposableCollection): void {
  if (!deps.options.a11y?.enabled) return;
  const parent = deps.options.a11y.container ?? deps.canvas.parentElement;
  if (!parent) return;

  const state: A11yLoadState = {
    alive: true,
    generation: 0,
    spreadIndex: null,
    pageByNode: new WeakMap(),
    install: null,
    cancelInstall: null,
  };
  const mirror = createA11yMirror(parent, {
    onLinkActivate: (node) => activateNativeLink(node, deps, state),
  });
  disposables.add(() => {
    disposeA11y(state, mirror);
  });
  disposables.add(
    deps.reader.onSpreadRendered((_index, spread) => {
      updateA11ySpread(spread, deps, mirror, state);
    }),
  );
  disposables.add(
    deps.emitter.on('transitionEnd', () => {
      installAtRest(state, deps);
    }),
  );
  disposables.add(
    deps.frameDriver.onRest(() => {
      installAtRest(state, deps);
    }),
  );
  if (typeof deps.reader.onLayoutCommitted === 'function') {
    disposables.add(
      deps.reader.onLayoutCommitted((activeSpreadIndex) => {
        const committedSpread = deps.reader.spreads[activeSpreadIndex];
        if (committedSpread) {
          updateA11ySpread(committedSpread, deps, mirror, state);
        } else {
          invalidateA11y(state, mirror);
        }
      }),
    );
  }

  const initial = deps.reader.spreads[deps.getCurrentSpread()];
  if (initial) updateA11ySpread(initial, deps, mirror, state);
}

/**
 * Load both visible pages' semantics against the committed layout. The
 * mirror stays empty until they are installed, which waits for the reader
 * to be at rest on the spread.
 */
function updateA11ySpread(
  spread: Spread,
  deps: WiringDeps,
  mirror: A11yMirror,
  state: A11yLoadState,
): void {
  invalidateA11y(state, mirror);
  const interactions = deps.reader.interactions;
  const readPageSemantics = interactions?.getPageSemantics?.bind(interactions);
  if (!interactions?.enabled || !readPageSemantics) return;
  state.spreadIndex = spread.index;
  const generation = state.generation;
  const pageIndexes = spread.pageIndexes;
  void Promise.resolve()
    .then(() => Promise.all(pageIndexes.map((pageIndex) => readPageSemantics(pageIndex))))
    .then((results) => {
      if (!canInstall(state, deps, interactions, generation)) return;
      const semantics = requireMatchingSemantics(spread, pageIndexes, results);
      state.install = () => {
        try {
          for (const page of semantics) bindPageNodes(page.nodes, page.pageIndex, state.pageByNode);
          mirror.update(semantics.flatMap((page) => page.nodes));
        } catch (error: unknown) {
          containA11yFailure(error, 'native-page-semantics', state, deps, interactions, generation);
        }
      };
      installAtRest(state, deps);
    })
    .catch((error: unknown) => {
      containA11yFailure(error, 'native-page-semantics', state, deps, interactions, generation);
    });
}

/**
 * Installs the semantics that are waiting once the frame showing their
 * spread has been produced and no turn is on screen. Rebuilding the mirror
 * lays out both pages' text as DOM, which nobody sees: done at once it would
 * hold back the first frame of the turn or relayout that brought the spread.
 * A turn still open leaves them waiting for its `transitionEnd`; what is
 * left of a turn that was cut into, for its picture to come to rest.
 */
function installAtRest(state: A11yLoadState, deps: WiringDeps): void {
  if (!state.install) return;
  state.cancelInstall?.();
  state.cancelInstall = scheduleAfterNextFrame(() => {
    state.cancelInstall = null;
    if (transitionLifecycle(deps.emitter).openDirection !== null) return;
    if (deps.frameDriver.animating) return;
    const install = state.install;
    state.install = null;
    install?.();
  });
}

function requireMatchingSemantics(
  spread: Spread,
  pageIndexes: readonly number[],
  results: readonly (ReaderPageSemantics | undefined)[],
): readonly ReaderPageSemantics[] {
  if (results.some((result) => result === undefined)) return [];
  return results.map((result, index) => {
    const pageIndex = pageIndexes[index];
    if (
      !result ||
      pageIndex === undefined ||
      result.pageIndex !== pageIndex ||
      result.spreadIndex !== spread.index
    ) {
      throw new Error('Native page semantics do not match the visible spread');
    }
    return result;
  });
}

function invalidateA11y(state: A11yLoadState, mirror: A11yMirror): void {
  dropPendingInstall(state);
  state.generation += 1;
  state.spreadIndex = null;
  state.pageByNode = new WeakMap();
  mirror.update([]);
}

function dropPendingInstall(state: A11yLoadState): void {
  state.cancelInstall?.();
  state.cancelInstall = null;
  state.install = null;
}

function bindPageNodes(
  nodes: readonly ReaderSemanticNode[],
  pageIndex: number,
  target: WeakMap<ReaderSemanticNode, number>,
): void {
  for (const node of nodes) {
    target.set(node, pageIndex);
    bindPageNodes(node.children, pageIndex, target);
  }
}

function activateNativeLink(
  node: ReaderSemanticNode,
  deps: WiringDeps,
  state: A11yLoadState,
): boolean {
  const pageIndex = state.pageByNode.get(node);
  const spreadIndex = state.spreadIndex;
  const interactions = deps.reader.interactions;
  if (pageIndex === undefined || spreadIndex === null || !interactions?.enabled) return false;
  supersedePendingImageRequest(deps);
  const contentClickGeneration = deps.coordState.contentInteractionGeneration;
  const generation = state.generation;
  void Promise.resolve()
    .then(() => interactions.getPageTargets(pageIndex))
    .then((page) => {
      if (
        deps.coordState.contentInteractionGeneration !== contentClickGeneration ||
        !canInstall(state, deps, interactions, generation)
      ) {
        return;
      }
      if (page && (page.pageIndex !== pageIndex || page.spreadIndex !== spreadIndex)) {
        throw new Error('Native page targets do not match the accessibility mirror');
      }
      if (!page) return;
      const target = page.targets.find(
        (candidate) =>
          (candidate.kind === 'link' ||
            candidate.kind === 'footnote' ||
            candidate.kind === 'footnotePending') &&
          candidate.href === node.href &&
          boundsIntersect(candidate.bounds, node.bounds),
      );
      if (target) dispatchNativeClickTarget(pageIndex, target, deps);
    })
    .catch((error: unknown) => {
      containA11yFailure(
        error,
        'native-a11y-activation',
        state,
        deps,
        interactions,
        generation,
        contentClickGeneration,
      );
    });
  return true;
}

function containA11yFailure(
  error: unknown,
  source: string,
  state: A11yLoadState,
  deps: WiringDeps,
  interactions: ReaderInteractions,
  generation: number,
  contentInteractionGeneration?: number,
): void {
  if (
    !canInstall(state, deps, interactions, generation) ||
    (contentInteractionGeneration !== undefined &&
      deps.coordState.contentInteractionGeneration !== contentInteractionGeneration)
  ) {
    return;
  }
  try {
    deps.emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source,
    });
  } catch {
    // User error listeners must not turn an accessibility failure into an unhandled rejection.
  }
}

function boundsIntersect(
  left: ReaderSemanticNode['bounds'],
  right: ReaderSemanticNode['bounds'],
): boolean {
  return (
    left.x <= right.x + right.width &&
    right.x <= left.x + left.width &&
    left.y <= right.y + right.height &&
    right.y <= left.y + left.height
  );
}

function canInstall(
  state: A11yLoadState,
  deps: WiringDeps,
  interactions: ReaderInteractions,
  generation: number,
): boolean {
  return (
    state.alive &&
    state.generation === generation &&
    deps.reader.interactions === interactions &&
    interactions.enabled
  );
}

function disposeA11y(state: A11yLoadState, mirror: A11yMirror): void {
  dropPendingInstall(state);
  state.alive = false;
  state.generation += 1;
  state.spreadIndex = null;
  state.pageByNode = new WeakMap();
  mirror.dispose();
}
