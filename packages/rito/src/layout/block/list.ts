import { LIST_STYLE_TYPES } from '../../style/core/types';
import type { ComputedStyle, ListStyleType, StyledNode } from '../../style/core/types';
import type { LayoutBlock, LineBox, TextRun } from '../core/types';

const MARKER_AREA_WIDTH = 24;
const BULLET = '\u2022';
const SQUARE = '\u25AA';
const CIRCLE = '\u25CB';

export interface ListContext {
  listStyleType: ListStyleType;
  counter: number;
}

const ROMAN_PAIRS: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

export function createListContext(node: StyledNode): ListContext | undefined {
  if (node.tag === 'ul' || node.tag === 'ol') {
    return { listStyleType: node.style.listStyleType, counter: 0 };
  }
  return undefined;
}

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
  if (listStyleType === LIST_STYLE_TYPES.LowerAlpha) return `${toLowerAlpha(counter)}.`;
  if (listStyleType === LIST_STYLE_TYPES.UpperAlpha) {
    return `${toLowerAlpha(counter).toUpperCase()}.`;
  }
  if (listStyleType === LIST_STYLE_TYPES.LowerRoman) return `${toLowerRoman(counter)}.`;
  if (listStyleType === LIST_STYLE_TYPES.UpperRoman) {
    return `${toLowerRoman(counter).toUpperCase()}.`;
  }
  if (listStyleType === LIST_STYLE_TYPES.Square) return SQUARE;
  if (listStyleType === LIST_STYLE_TYPES.Circle) return CIRCLE;
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

function toLowerAlpha(n: number): string {
  let result = '';
  let remaining = n;
  while (remaining > 0) {
    remaining--;
    result = String.fromCharCode(97 + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function toLowerRoman(n: number): string {
  let result = '';
  let remaining = n;
  for (const [value, symbol] of ROMAN_PAIRS) {
    while (remaining >= value) {
      result += symbol;
      remaining -= value;
    }
  }
  return result;
}
