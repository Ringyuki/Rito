import type { ReaderInteractions, ReaderPageSemantics, Spread } from '@ritojs/core';
import {
  buildSemanticTree,
  createA11yMirror,
  type A11yMirror,
  type SemanticNode,
} from '../../interaction/index';
import type { DisposableCollection } from '../../utils/disposable';
import { asLegacyPage } from '../compat/legacy-page';
import type { WiringDeps } from '../core/wiring-deps';
import { dispatchNativeClickTarget } from './native-click';

interface A11yLoadState {
  alive: boolean;
  generation: number;
  pageByNode: WeakMap<SemanticNode, number>;
}

export function wireA11y(deps: WiringDeps, disposables: DisposableCollection): void {
  if (!deps.options.a11y?.enabled) return;
  const parent = deps.options.a11y.container ?? deps.canvas.parentElement;
  if (!parent) return;

  const state: A11yLoadState = { alive: true, generation: 0, pageByNode: new WeakMap() };
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
  if (typeof deps.reader.onLayoutCommitted === 'function') {
    disposables.add(
      deps.reader.onLayoutCommitted(() => {
        invalidateA11y(state, mirror);
      }),
    );
  }

  const initial = deps.reader.spreads[deps.getCurrentSpread()];
  if (initial) updateA11ySpread(initial, deps, mirror, state);
}

function updateA11ySpread(
  spread: Spread,
  deps: WiringDeps,
  mirror: A11yMirror,
  state: A11yLoadState,
): void {
  const interactions = deps.reader.interactions;
  if (!interactions?.getPageSemantics) {
    mirror.update(legacySemanticTrees(spread));
    return;
  }
  const readPageSemantics = interactions.getPageSemantics.bind(interactions);

  invalidateA11y(state, mirror);
  if (!interactions.enabled) return;
  const generation = state.generation;
  const pages = [spread.left, spread.right].filter((page) => page !== undefined);
  void Promise.all(pages.map((page) => readPageSemantics(page.index)))
    .then((results) => {
      if (!canInstall(state, deps, interactions, generation)) return;
      const semantics = requireMatchingSemantics(spread, pages, results);
      for (const page of semantics) bindPageNodes(page.nodes, page.pageIndex, state.pageByNode);
      mirror.update(semantics.flatMap((page) => page.nodes));
    })
    .catch((error: unknown) => {
      if (!canInstall(state, deps, interactions, generation)) return;
      deps.emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'native-page-semantics',
      });
    });
}

function requireMatchingSemantics(
  spread: Spread,
  pages: readonly NonNullable<Spread['left']>[],
  results: readonly (ReaderPageSemantics | undefined)[],
): readonly ReaderPageSemantics[] {
  if (results.some((result) => result === undefined)) return [];
  return results.map((result, index) => {
    const page = pages[index];
    if (
      !result ||
      !page ||
      result.pageIndex !== page.index ||
      result.spreadIndex !== spread.index
    ) {
      throw new Error('Native page semantics do not match the visible spread');
    }
    return result;
  });
}

function legacySemanticTrees(spread: Spread) {
  return [spread.left, spread.right]
    .filter((page) => page !== undefined)
    .flatMap((page) => buildSemanticTree(asLegacyPage(page)));
}

function invalidateA11y(state: A11yLoadState, mirror: A11yMirror): void {
  state.generation += 1;
  state.pageByNode = new WeakMap();
  mirror.update([]);
}

function bindPageNodes(
  nodes: readonly SemanticNode[],
  pageIndex: number,
  target: WeakMap<SemanticNode, number>,
): void {
  for (const node of nodes) {
    target.set(node, pageIndex);
    bindPageNodes(node.children, pageIndex, target);
  }
}

function activateNativeLink(node: SemanticNode, deps: WiringDeps, state: A11yLoadState): boolean {
  const pageIndex = state.pageByNode.get(node);
  const interactions = deps.reader.interactions;
  if (pageIndex === undefined || !interactions?.enabled) return false;
  const generation = state.generation;
  void interactions
    .getPageTargets(pageIndex)
    .then((page) => {
      if (!page || !canInstall(state, deps, interactions, generation)) return;
      const target = page.targets.find(
        (candidate) =>
          (candidate.kind === 'link' || candidate.kind === 'footnote') &&
          candidate.href === node.href &&
          boundsIntersect(candidate.bounds, node.bounds),
      );
      if (target) dispatchNativeClickTarget(pageIndex, target, deps);
    })
    .catch((error: unknown) => {
      if (!canInstall(state, deps, interactions, generation)) return;
      deps.emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'native-a11y-activation',
      });
    });
  return true;
}

function boundsIntersect(left: SemanticNode['bounds'], right: SemanticNode['bounds']): boolean {
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
  state.alive = false;
  state.generation += 1;
  state.pageByNode = new WeakMap();
  mirror.dispose();
}
