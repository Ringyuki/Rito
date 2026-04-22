import type { LayoutBlock } from '../core/types';

export function shrinkToFitWidth(
  children: readonly LayoutBlock['children'][number][],
  paddingRight: number,
  maxWidth: number,
): number {
  const maxRight = measureContentRight(children);
  return Math.min(maxRight + paddingRight, maxWidth);
}

function measureContentRight(children: readonly LayoutBlock['children'][number][]): number {
  let maxRight = 0;
  for (const child of children) {
    if (child.type === 'line-box') {
      maxRight = Math.max(maxRight, measureLineContentWidth(child));
    } else if (child.type === 'layout-block') {
      const nested = measureContentRight(child.children);
      const firstLineRight = measureFirstLineAbsRight(child.children);
      maxRight = Math.max(maxRight, child.bounds.x + nested, child.bounds.x + firstLineRight);
    } else if (child.type === 'image') {
      maxRight = Math.max(maxRight, child.bounds.width);
    } else if ('bounds' in child) {
      maxRight = Math.max(maxRight, child.bounds.x + child.bounds.width);
    }
  }
  return maxRight;
}

function measureLineContentWidth(
  line: Extract<LayoutBlock['children'][number], { type: 'line-box' }>,
): number {
  let minLeft = Infinity;
  let maxRight = 0;
  for (const run of line.runs) {
    if (run.bounds.x < minLeft) minLeft = run.bounds.x;
    const right = run.bounds.x + run.bounds.width;
    if (right > maxRight) maxRight = right;
  }
  return minLeft === Infinity ? 0 : maxRight - minLeft;
}

/** Absolute right edge of the first line-box (includes text-indent offset). */
function measureFirstLineAbsRight(children: readonly LayoutBlock['children'][number][]): number {
  for (const child of children) {
    if (child.type === 'line-box') return measureLineAbsRight(child);
    if (child.type === 'layout-block') return measureFirstLineAbsRight(child.children);
  }
  return 0;
}

function measureLineAbsRight(
  line: Extract<LayoutBlock['children'][number], { type: 'line-box' }>,
): number {
  let right = 0;
  for (const run of line.runs) {
    right = Math.max(right, run.bounds.x + run.bounds.width);
  }
  return right;
}

export function normalizeChildPositions(
  children: readonly LayoutBlock['children'][number][],
  preserveFirstLine = false,
): readonly LayoutBlock['children'][number][] {
  return children.map((child, index) => {
    if (child.type === 'line-box') return normalizeLineBox(child, preserveFirstLine && index === 0);
    if (child.type === 'layout-block') {
      return { ...child, children: normalizeChildPositions(child.children, true) };
    }
    if (child.type === 'image' && child.bounds.x > 0) {
      return { ...child, bounds: { ...child.bounds, x: 0 } };
    }
    return child;
  });
}

function normalizeLineBox(
  line: Extract<LayoutBlock['children'][number], { type: 'line-box' }>,
  preserve: boolean,
): LayoutBlock['children'][number] {
  if (preserve) return line;
  const minX = getLineMinX(line);
  if (minX <= 0 || minX === Infinity) return line;
  return {
    ...line,
    runs: line.runs.map((run) => ({
      ...run,
      bounds: { ...run.bounds, x: run.bounds.x - minX },
    })),
  };
}

function getLineMinX(line: Extract<LayoutBlock['children'][number], { type: 'line-box' }>): number {
  let minX = Infinity;
  for (const run of line.runs) {
    if (run.bounds.x < minX) minX = run.bounds.x;
  }
  return minX;
}
