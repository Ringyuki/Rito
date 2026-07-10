import type { BlockPaint, BorderBox, LayoutBlock, LineBox, PaginationPolicy } from '../core/types';

interface SplitResult {
  readonly head: LayoutBlock;
  readonly tail: LayoutBlock;
}

const GEOMETRY_EPSILON = 0.001;

export function trySplitBlock(
  block: LayoutBlock,
  availableHeight: number,
  policy?: PaginationPolicy,
): SplitResult | undefined {
  if (isLineBlock(block)) return splitLineBlock(block, availableHeight, policy, false);
  return splitCompositeBlock(block, availableHeight, policy, false);
}

/**
 * Force-split a block at the height boundary, ignoring orphan/widow rules.
 * Composite blocks are split recursively so non-line children are never
 * discarded merely because a fallback split was required.
 */
export function forceSplitBlock(
  block: LayoutBlock,
  availableHeight: number,
): SplitResult | undefined {
  if (isLineBlock(block)) return splitLineBlock(block, availableHeight, undefined, true);
  return splitCompositeBlock(block, availableHeight, undefined, true);
}

export function repositionBlock(block: LayoutBlock, newY: number): LayoutBlock {
  return { ...block, bounds: { ...block.bounds, y: newY } };
}

function isLineBlock(block: LayoutBlock): block is LayoutBlock & { readonly children: LineBox[] } {
  return block.children.length > 0 && block.children.every(isLineBox);
}

function isLineBox(child: LayoutBlock['children'][number]): child is LineBox {
  return child.type === 'line-box';
}

function splitLineBlock(
  block: LayoutBlock & { readonly children: readonly LineBox[] },
  availableHeight: number,
  policy: PaginationPolicy | undefined,
  force: boolean,
): SplitResult | undefined {
  const lineBoxes = block.children.filter(isLineBox);
  let splitIndex = findSplitIndex(lineBoxes, availableHeight);

  if (!force) splitIndex = enforceWidowsAndOrphans(block, splitIndex, policy);
  if (splitIndex <= 0 || splitIndex >= lineBoxes.length) return undefined;

  const headLines = lineBoxes.slice(0, splitIndex);
  const headContentBottom = computeLinesHeight(headLines);
  const nextLineY = lineBoxes[splitIndex]?.bounds.y ?? headContentBottom;
  const splitOffset =
    headContentBottom > availableHeight ? headContentBottom : Math.min(availableHeight, nextLineY);
  return buildFragmentResult(
    block,
    headLines,
    repositionLines(lineBoxes.slice(splitIndex), splitOffset),
    splitOffset,
  );
}

function enforceWidowsAndOrphans(
  block: LayoutBlock,
  initialSplitIndex: number,
  policy: PaginationPolicy | undefined,
): number {
  const lineCount = block.children.length;
  const policyEnabled = policy?.enabled !== false;
  const orphans = policyEnabled ? (block.orphans ?? policy?.defaultOrphans ?? 2) : 1;
  const widows = policyEnabled ? (block.widows ?? policy?.defaultWidows ?? 2) : 1;
  if (lineCount < orphans + widows) return initialSplitIndex;
  return Math.min(Math.max(initialSplitIndex, orphans), lineCount - widows);
}

/** Split nested blocks at a shared horizontal cut, preserving every child. */
function splitCompositeBlock(
  block: LayoutBlock,
  availableHeight: number,
  policy: PaginationPolicy | undefined,
  force: boolean,
): SplitResult | undefined {
  if (block.children.length === 0 || availableHeight <= 0) return undefined;

  const splitOffset = resolveCompositeSplitOffset(block, availableHeight, policy, force);
  if (splitOffset <= 0 || splitOffset >= block.bounds.height) return undefined;

  const headChildren: LayoutBlock['children'][number][] = [];
  const tailChildren: LayoutBlock['children'][number][] = [];

  for (const child of block.children) {
    const top = child.bounds.y;
    const bottom = top + child.bounds.height;
    if (bottom <= splitOffset + GEOMETRY_EPSILON) {
      headChildren.push(child);
      continue;
    }
    if (top >= splitOffset - GEOMETRY_EPSILON) {
      tailChildren.push(shiftChildY(child, -splitOffset));
      continue;
    }
    if (child.type !== 'layout-block') return undefined;

    const nested = splitNestedBlock(child, splitOffset - top, policy, force);
    if (!nested || nested.head.bounds.height > splitOffset - top + GEOMETRY_EPSILON) {
      return undefined;
    }
    headChildren.push({
      ...nested.head,
      bounds: { ...nested.head.bounds, x: child.bounds.x, y: top },
    });
    tailChildren.push({
      ...nested.tail,
      bounds: { ...nested.tail.bounds, x: child.bounds.x, y: 0 },
    });
  }

  if (headChildren.length === 0 || tailChildren.length === 0) return undefined;
  return buildFragmentResult(block, headChildren, tailChildren, splitOffset);
}

/**
 * A requested cut may cross an unsplittable child, or a nested line block may
 * need to break slightly earlier for widow/orphan control. Move the shared cut
 * upward until every crossing child can be fragmented at the same boundary.
 */
function resolveCompositeSplitOffset(
  block: LayoutBlock,
  availableHeight: number,
  policy: PaginationPolicy | undefined,
  force: boolean,
): number {
  let splitOffset = Math.min(availableHeight, block.bounds.height);
  const maxIterations = block.children.length + 2;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let adjusted = splitOffset;
    for (const child of block.children) {
      const top = child.bounds.y;
      const bottom = top + child.bounds.height;
      if (top >= splitOffset || bottom <= splitOffset) continue;

      if (child.type !== 'layout-block') {
        adjusted = Math.min(adjusted, top);
        continue;
      }
      const nested = splitNestedBlock(child, splitOffset - top, policy, force);
      adjusted = Math.min(adjusted, nested ? top + nested.head.bounds.height : top);
    }
    if (adjusted >= splitOffset - GEOMETRY_EPSILON) return splitOffset;
    splitOffset = adjusted;
    if (splitOffset <= 0) return 0;
  }
  return splitOffset;
}

function splitNestedBlock(
  block: LayoutBlock,
  availableHeight: number,
  policy: PaginationPolicy | undefined,
  force: boolean,
): SplitResult | undefined {
  const local = { ...block, bounds: { ...block.bounds, y: 0 } };
  return force
    ? forceSplitBlock(local, availableHeight)
    : trySplitBlock(local, availableHeight, policy);
}

function findSplitIndex(lineBoxes: readonly LineBox[], availableHeight: number): number {
  let splitIndex = 0;
  for (let index = 0; index < lineBoxes.length; index++) {
    const lineBox = lineBoxes[index];
    if (!lineBox || lineBox.bounds.y + lineBox.bounds.height > availableHeight) break;
    splitIndex = index + 1;
  }
  return splitIndex;
}

function buildFragmentResult(
  block: LayoutBlock,
  headChildren: readonly LayoutBlock['children'][number][],
  tailChildren: readonly LayoutBlock['children'][number][],
  splitOffset: number,
): SplitResult {
  const headHeight = Math.max(0, Math.min(splitOffset, block.bounds.height));
  const tailHeight = Math.max(0, block.bounds.height - headHeight);
  return {
    head: buildFragment(block, headChildren, block.bounds.y, headHeight, 'head'),
    tail: buildFragment(block, tailChildren, 0, tailHeight, 'tail'),
  };
}

function buildFragment(
  block: LayoutBlock,
  children: readonly LayoutBlock['children'][number][],
  y: number,
  height: number,
  side: 'head' | 'tail',
): LayoutBlock {
  const { anchorId, pageBreakBefore, pageBreakAfter, paint, borderBox, ...base } = block;
  return {
    ...base,
    bounds: { ...block.bounds, y, height },
    children,
    ...(side === 'head' && anchorId ? { anchorId } : {}),
    ...(side === 'head' && pageBreakBefore ? { pageBreakBefore } : {}),
    ...(side === 'tail' && pageBreakAfter ? { pageBreakAfter } : {}),
    ...(paint ? { paint: slicePaint(paint, side) } : {}),
    ...(borderBox ? { borderBox: sliceBorderBox(borderBox, side) } : {}),
  };
}

function slicePaint(paint: BlockPaint, side: 'head' | 'tail'): BlockPaint {
  if (!paint.border) return paint;
  const { top, bottom, ...inlineEdges } = paint.border;
  return {
    ...paint,
    border: {
      ...inlineEdges,
      ...(side === 'head' && top ? { top } : {}),
      ...(side === 'tail' && bottom ? { bottom } : {}),
    },
  };
}

function sliceBorderBox(borderBox: BorderBox, side: 'head' | 'tail'): BorderBox {
  return {
    ...borderBox,
    topWidth: side === 'head' ? borderBox.topWidth : 0,
    bottomWidth: side === 'tail' ? borderBox.bottomWidth : 0,
  };
}

function repositionLines(lines: readonly LineBox[], splitOffset: number): LineBox[] {
  return lines.map((line) => ({
    ...line,
    bounds: { ...line.bounds, y: line.bounds.y - splitOffset },
  }));
}

function shiftChildY(
  child: LayoutBlock['children'][number],
  dy: number,
): LayoutBlock['children'][number] {
  return { ...child, bounds: { ...child.bounds, y: child.bounds.y + dy } };
}

function computeLinesHeight(lines: readonly LineBox[]): number {
  const last = lines[lines.length - 1];
  return last ? last.bounds.y + last.bounds.height : 0;
}
