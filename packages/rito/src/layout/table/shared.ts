import type { StyledNode } from '../../style/types';
import type { LayoutBlock, LineBox } from '../types';

export const CELL_PADDING = 4;

export function isCellNode(node: StyledNode): boolean {
  return node.type === 'block' && (node.tag === 'td' || node.tag === 'th');
}

export function columnX(colWidths: readonly number[], col: number): number {
  let x = 0;
  for (let i = 0; i < col; i++) x += colWidths[i] ?? 0;
  return x;
}

export function spanWidth(colWidths: readonly number[], col: number, span: number): number {
  let width = 0;
  for (let i = col; i < col + span; i++) width += colWidths[i] ?? 0;
  return width;
}

export function computeChildrenHeight(children: readonly (LineBox | LayoutBlock)[]): number {
  if (children.length === 0) return 0;
  const last = children[children.length - 1];
  return last ? last.bounds.y + last.bounds.height : 0;
}

export function offsetChildren(
  children: readonly (LineBox | LayoutBlock)[],
  dx: number,
  dy: number,
): (LineBox | LayoutBlock)[] {
  return children.map((child) => {
    if (child.type === 'line-box') {
      return {
        ...child,
        bounds: { ...child.bounds, x: child.bounds.x + dx, y: child.bounds.y + dy },
        runs: child.runs.map((run) => ({
          ...run,
          bounds: { ...run.bounds, x: run.bounds.x + dx, y: run.bounds.y + dy },
        })),
      };
    }

    return {
      ...child,
      bounds: { ...child.bounds, x: child.bounds.x + dx, y: child.bounds.y + dy },
    };
  });
}
