import type { ComputedStyle, ListStyleType, StyledNode } from '../style/types';
import { LIST_STYLE_TYPES } from '../style/types';
import type { LayoutBlock, LineBox, TextRun } from './types';

/** Width reserved for the marker area (px). */
const MARKER_AREA_WIDTH = 24;
const BULLET = '\u2022';

/** Mutable context tracking list counter state within a ul/ol. */
export interface ListContext {
  listStyleType: ListStyleType;
  counter: number;
}

/** Create a list context if the node is a ul or ol. */
export function createListContext(node: StyledNode): ListContext | undefined {
  if (node.tag === 'ul' || node.tag === 'ol') {
    return { listStyleType: node.style.listStyleType, counter: 0 };
  }
  return undefined;
}

/**
 * Layout a list item (with marker) or a plain text block.
 * If listCtx is provided and node is a `<li>`, prepends a marker run.
 */
export function addListMarker(
  block: LayoutBlock,
  node: StyledNode,
  listCtx: ListContext | undefined,
): LayoutBlock {
  if (!listCtx || node.tag !== 'li' || listCtx.listStyleType === LIST_STYLE_TYPES.None) {
    return block;
  }
  listCtx.counter++;
  const firstLine = block.children[0];
  if (!firstLine || firstLine.type !== 'line-box') return block;
  const marker = createMarkerRun(
    listCtx.counter,
    listCtx.listStyleType,
    node.style,
    firstLine.bounds.height,
  );
  const markerLine: LineBox = {
    ...firstLine,
    runs: [marker, ...firstLine.runs],
  };
  return { ...block, children: [markerLine, ...block.children.slice(1)] };
}

function formatListMarker(counter: number, listStyleType: ListStyleType): string {
  if (listStyleType === LIST_STYLE_TYPES.Decimal) return `${String(counter)}.`;
  if (listStyleType === LIST_STYLE_TYPES.Disc) return BULLET;
  return '';
}

function createMarkerRun(
  counter: number,
  listStyleType: ListStyleType,
  style: ComputedStyle,
  lineHeight: number,
): TextRun {
  return {
    type: 'text-run',
    text: formatListMarker(counter, listStyleType),
    bounds: { x: -MARKER_AREA_WIDTH, y: 0, width: MARKER_AREA_WIDTH, height: lineHeight },
    style,
  };
}
