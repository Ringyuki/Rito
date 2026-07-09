import type { StyledNode } from '../../style/core/types';
import { inheritableStyle } from '../../style/core/defaults';
import type { LayoutBlock } from '../core/types';
import type { ParagraphLayouter } from '../text/paragraph-layouter';
import type { ListContext } from './list';
import { FloatContext } from './float-context';
import { layoutBlockNode, layoutFloatableImage } from './dispatch';
import { collapseMargin, type LayoutState } from './state';
import type { ImageSizeMap } from './types';

export type { ImageSizeMap } from './types';

export function layoutBlocks(
  nodes: readonly StyledNode[],
  contentWidth: number,
  layouter: ParagraphLayouter,
  imageSizes?: ImageSizeMap,
  contentHeight = Infinity,
): readonly LayoutBlock[] {
  return layoutNodesAt(nodes, contentWidth, contentHeight, layouter, 0, imageSizes);
}

export function layoutNodesAt(
  nodes: readonly StyledNode[],
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  startY: number,
  imageSizes?: ImageSizeMap,
  listCtx?: ListContext,
): readonly LayoutBlock[] {
  const state: LayoutState = {
    blocks: [],
    floats: new FloatContext(),
    y: startY,
    prevMarginBottom: 0,
  };

  for (const node of wrapAnonymousInlineRuns(nodes)) {
    applyClearance(state, node);
    layoutTopLevelNode(state, node, contentWidth, contentHeight, layouter, imageSizes, listCtx);
  }

  return state.blocks;
}

/**
 * A block formatting context wraps consecutive inline-level children in an
 * anonymous block box.  Previously `layoutNodesAt` only dispatched explicit
 * block/image nodes, so body-level text and inline siblings around a nested
 * block disappeared entirely.
 */
function wrapAnonymousInlineRuns(nodes: readonly StyledNode[]): readonly StyledNode[] {
  const result: StyledNode[] = [];
  let run: StyledNode[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    if (hasTextualInlineContent(run)) {
      if (containsOnlyBareLineBreaks(run)) {
        for (const node of run) {
          if (node.type === 'text' && node.content === '\n') result.push(node);
        }
        run = [];
        return;
      }
      const first = run[0];
      if (first) {
        result.push({
          type: 'block',
          style: inheritableStyle(first.style),
          children: run,
        });
      }
    } else {
      for (const node of run) {
        if (node.type === 'image') result.push(node);
      }
    }
    run = [];
  };

  for (const node of nodes) {
    if (node.type === 'block') {
      flush();
      result.push(node);
    } else {
      run.push(node);
    }
  }
  flush();
  return result;
}

function containsOnlyBareLineBreaks(nodes: readonly StyledNode[]): boolean {
  let hasBreak = false;
  for (const node of nodes) {
    if (node.type !== 'text') return false;
    if (node.content === '\n') hasBreak = true;
    else if (node.content?.trim()) return false;
  }
  return hasBreak;
}

function hasTextualInlineContent(nodes: readonly StyledNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'text' && (node.content === '\n' || !!node.content?.trim())) return true;
    if (node.type === 'inline' && hasRenderableInlineDescendant(node.children)) return true;
  }
  return false;
}

function hasRenderableInlineDescendant(nodes: readonly StyledNode[]): boolean {
  for (const node of nodes) {
    if (node.type === 'image') return true;
    if (node.type === 'text' && (node.content === '\n' || !!node.content?.trim())) return true;
    if (node.type === 'inline' && hasRenderableInlineDescendant(node.children)) return true;
  }
  return false;
}

function applyClearance(state: LayoutState, node: StyledNode): void {
  // clearExpired is intentionally scoped to explicit CSS clear. Negative
  // margins can otherwise pull later blocks back into an active float range.
  if (node.style.clear === 'none') return;
  const clearY = state.floats.getClearY(node.style.clear);
  if (clearY > state.y) state.y = clearY;
  state.floats.clearExpired(state.y);
}

function layoutTopLevelNode(
  state: LayoutState,
  node: StyledNode,
  contentWidth: number,
  contentHeight: number,
  layouter: ParagraphLayouter,
  imageSizes: ImageSizeMap | undefined,
  listCtx: ListContext | undefined,
): void {
  if (node.type === 'text' && node.content === '\n') {
    layoutBareLineBreak(state, node);
  } else if (node.type === 'image' && node.src) {
    layoutFloatableImage(state, node, contentWidth, contentHeight, imageSizes);
  } else if (node.type === 'block' && node.style.position !== 'absolute') {
    layoutBlockNode(
      state,
      node,
      contentWidth,
      contentHeight,
      layouter,
      layoutNodesAt,
      imageSizes,
      listCtx,
    );
  }
}

function layoutBareLineBreak(state: LayoutState, node: StyledNode): void {
  collapseMargin(state, 0);
  state.y += node.style.lineHeightPx ?? node.style.fontSize * node.style.lineHeight;
  state.prevMarginBottom = 0;
}
