import type { Reader } from '@ritojs/core';
import { buildSemanticTree, createA11yMirror, type A11yMirror } from '@ritojs/core/a11y';
import type { DisposableCollection } from '../../utils/disposable';
import type { ControllerOptions } from '../types';

export function wireA11y(
  opts: ControllerOptions,
  canvas: HTMLCanvasElement,
  reader: Reader,
  disposables: DisposableCollection,
): void {
  if (!opts.a11y?.enabled) return;

  const parent = opts.a11y.container ?? canvas.parentElement;
  if (!parent) return;

  const mirror: A11yMirror = createA11yMirror(parent);
  disposables.add(() => {
    mirror.dispose();
  });

  disposables.add(
    reader.onSpreadRendered((_idx, spread) => {
      const pages = [spread.left, spread.right].filter(
        (p): p is NonNullable<typeof p> => p != null,
      );
      const trees = pages.flatMap((page) => buildSemanticTree(page));
      mirror.update(trees);
    }),
  );
}
