/** Helpers for mapping pointer events to page-local coordinates within a spread. */

import type { LayoutConfig, Rect } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import { getSelectionRects } from './selection';
import type { HitMap, TextPosition, TextRange } from './types';

export interface SpreadContext {
  readonly config: LayoutConfig;
  readonly measurer: TextMeasurer;
  readonly leftHitMap: HitMap | undefined;
  readonly rightHitMap: HitMap | undefined;
}

export interface AnchoredPosition {
  readonly pageIndex: number;
  readonly position: TextPosition;
}

export interface PageHit {
  readonly hitMap: HitMap;
  readonly localX: number;
  readonly localY: number;
  readonly pageIndex: number;
}

export function resolvePageHit(x: number, y: number, ctx: SpreadContext): PageHit | undefined {
  const { config, leftHitMap, rightHitMap } = ctx;

  if (config.spreadMode === 'double' && rightHitMap) {
    const rightX = config.pageWidth + config.spreadGap;
    if (x >= rightX && x < rightX + config.pageWidth) {
      return {
        hitMap: rightHitMap,
        localX: x - rightX,
        localY: y,
        pageIndex: rightHitMap.pageIndex,
      };
    }
  }

  if (leftHitMap && x >= 0 && x < config.pageWidth) {
    return { hitMap: leftHitMap, localX: x, localY: y, pageIndex: leftHitMap.pageIndex };
  }
  return undefined;
}

export function isSamePosition(a: AnchoredPosition, b: AnchoredPosition): boolean {
  return (
    a.pageIndex === b.pageIndex &&
    a.position.blockIndex === b.position.blockIndex &&
    a.position.lineIndex === b.position.lineIndex &&
    a.position.runIndex === b.position.runIndex &&
    a.position.charIndex === b.position.charIndex
  );
}

export function computeSelectionRects(
  range: TextRange,
  ctx: SpreadContext,
  anchor: AnchoredPosition,
  focus: AnchoredPosition,
): readonly Rect[] {
  if (anchor.pageIndex === focus.pageIndex) {
    return samePageRects(range, ctx, anchor.pageIndex);
  }
  return crossPageRects(ctx, anchor, focus);
}

function samePageRects(range: TextRange, ctx: SpreadContext, pageIndex: number): readonly Rect[] {
  const hitMap = pageIndex === ctx.leftHitMap?.pageIndex ? ctx.leftHitMap : ctx.rightHitMap;
  if (!hitMap) return [];
  const offsetX = getPageOffsetX(pageIndex, ctx);
  const rects = getSelectionRects(hitMap, range, ctx.measurer);
  return offsetX > 0 ? rects.map((r) => ({ ...r, x: r.x + offsetX })) : rects;
}

function crossPageRects(
  ctx: SpreadContext,
  anchor: AnchoredPosition,
  focus: AnchoredPosition,
): Rect[] {
  const [startPos, endPos] = anchor.pageIndex < focus.pageIndex ? [anchor, focus] : [focus, anchor];
  const rects: Rect[] = [];

  const startMap =
    startPos.pageIndex === ctx.leftHitMap?.pageIndex ? ctx.leftHitMap : ctx.rightHitMap;
  if (startMap) {
    const r: TextRange = { start: startPos.position, end: lastPosition(startMap) };
    rects.push(
      ...offsetRects(getSelectionRects(startMap, r, ctx.measurer), startPos.pageIndex, ctx),
    );
  }

  const endMap = endPos.pageIndex === ctx.leftHitMap?.pageIndex ? ctx.leftHitMap : ctx.rightHitMap;
  if (endMap) {
    const r: TextRange = { start: firstPosition(), end: endPos.position };
    rects.push(...offsetRects(getSelectionRects(endMap, r, ctx.measurer), endPos.pageIndex, ctx));
  }

  return rects;
}

function offsetRects(rects: readonly Rect[], pageIndex: number, ctx: SpreadContext): Rect[] {
  const dx = getPageOffsetX(pageIndex, ctx);
  return dx > 0 ? rects.map((r) => ({ ...r, x: r.x + dx })) : [...rects];
}

function getPageOffsetX(pageIndex: number, ctx: SpreadContext): number {
  if (ctx.config.spreadMode !== 'double') return 0;
  return pageIndex === ctx.rightHitMap?.pageIndex ? ctx.config.pageWidth + ctx.config.spreadGap : 0;
}

function lastPosition(hitMap: HitMap): TextPosition {
  const last = hitMap.entries[hitMap.entries.length - 1];
  if (!last) return { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 };
  return {
    blockIndex: last.blockIndex,
    lineIndex: last.lineIndex,
    runIndex: last.runIndex,
    charIndex: last.text.length,
  };
}

function firstPosition(): TextPosition {
  return { blockIndex: 0, lineIndex: 0, runIndex: 0, charIndex: 0 };
}
