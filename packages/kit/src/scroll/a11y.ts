import type {
  ReaderInteractionTarget,
  ReaderPageSemantics,
  ReaderSemanticNode,
} from '@ritojs/core';
import { createA11yMirror } from '../interaction/dom/a11y-mirror';
import { scheduleAfterNextFrame } from '../utils/idle-task';
import { along, type ScrollView } from './view';

/** A window on screen: its spread and the page it shows. */
interface Shown {
  readonly spreadIndex: number;
  readonly pageIndex: number;
}

/**
 * A hidden mirror of the text a scrolled view shows, for screen readers:
 * once the strip rests, the semantics of the pages of the windows on
 * screen, put in after the next frame so the frame that brought them is
 * not held back. A link activated in the mirror taps its target, as a tap
 * on the view does. Returns the unsubscribe.
 */
export function wireScrollA11y(view: ScrollView, parent: HTMLElement): () => void {
  let installed = '';
  let generation = 0;
  let pages = new WeakMap<ReaderSemanticNode, Shown>();
  let cancel: (() => void) | null = null;
  const report = (error: unknown): void => {
    console.error('[rito] the scroll view could not mirror its text for screen readers', error);
  };
  const mirror = createA11yMirror(parent, {
    onLinkActivate: (node) => activate(view, pages.get(node), node, report),
  });
  const refresh = (): void => {
    const shown = shownPages(view);
    const key = shown.map((each) => each.pageIndex).join(',');
    if (key === installed) return;
    installed = key;
    generation += 1;
    const at = generation;
    cancel?.();
    const interactions = view.reader.interactions;
    const read = interactions?.getPageSemantics?.bind(interactions);
    if (!interactions?.enabled || read === undefined) {
      mirror.update([]);
      return;
    }
    semanticsOf(read, shown).then(({ nodes, of }) => {
      if (at !== generation) return;
      cancel = scheduleAfterNextFrame(() => {
        cancel = null;
        if (at !== generation) return;
        pages = of;
        mirror.update(nodes);
      });
    }, report);
  };
  const stops = [
    view.emitter.on('rest', refresh),
    view.reader.onLayoutCommitted(() => {
      // The same pages of a new layout hold other text.
      installed = '';
    }),
  ];
  return () => {
    generation += 1;
    cancel?.();
    for (const stop of stops) stop();
    mirror.dispose();
  };
}

/** The windows on screen, in reading order. */
function shownPages(view: ScrollView): Shown[] {
  const { geometry } = view;
  if (geometry === undefined) return [];
  return geometry.visible(Math.round(view.motion.offset), along(view)).flatMap((window) => {
    const pageIndex = view.reader.spreads[window.spreadIndex]?.leftPageIndex;
    return pageIndex === undefined ? [] : [{ spreadIndex: window.spreadIndex, pageIndex }];
  });
}

/** The semantics of the pages shown, in order, and the window each node is on. */
async function semanticsOf(
  read: (pageIndex: number) => Promise<ReaderPageSemantics | undefined>,
  shown: readonly Shown[],
): Promise<{ nodes: ReaderSemanticNode[]; of: WeakMap<ReaderSemanticNode, Shown> }> {
  const results = await Promise.all(shown.map((each) => read(each.pageIndex)));
  const of = new WeakMap<ReaderSemanticNode, Shown>();
  const nodes = results.flatMap((page, index) => {
    const each = shown[index];
    if (page === undefined || each === undefined) return [];
    bind(page.nodes, each, of);
    return page.nodes;
  });
  return { nodes, of };
}

function bind(
  nodes: readonly ReaderSemanticNode[],
  shown: Shown,
  pages: WeakMap<ReaderSemanticNode, Shown>,
): void {
  for (const node of nodes) {
    pages.set(node, shown);
    bind(node.children, shown, pages);
  }
}

/** A link activated in the mirror: its page's target taps, at its centre. */
function activate(
  view: ScrollView,
  shown: Shown | undefined,
  node: ReaderSemanticNode,
  report: (error: unknown) => void,
): boolean {
  const interactions = view.reader.interactions;
  if (shown === undefined || !interactions?.enabled) return false;
  interactions.getPageTargets(shown.pageIndex).then((page) => {
    const target = page?.targets.find((candidate) => linksTo(candidate, node));
    if (target === undefined) return;
    const { bounds } = target;
    view.emitter.emit('tap', {
      point: {
        ...shown,
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      },
      target,
      // A link activated in the mirror is the link, not a highlight over it.
      highlight: null,
    });
  }, report);
  return true;
}

function linksTo(target: ReaderInteractionTarget, node: ReaderSemanticNode): boolean {
  const link =
    target.kind === 'link' || target.kind === 'footnote' || target.kind === 'footnotePending';
  const { bounds } = target;
  const other = node.bounds;
  return (
    link &&
    target.href === node.href &&
    bounds.x <= other.x + other.width &&
    other.x <= bounds.x + bounds.width &&
    bounds.y <= other.y + other.height &&
    other.y <= bounds.y + bounds.height
  );
}
