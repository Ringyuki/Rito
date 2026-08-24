import type { ReaderTextCaret, ReaderTextPoint } from '@ritojs/core';
import type { Rect } from '../layout-types';
import type { NativeSelectionProjection, PointerInput } from './engine';

export function projectNativeSelectionPoint(
  input: PointerInput,
  projection: NativeSelectionProjection | undefined,
): ReaderTextPoint | undefined {
  if (!projection) return undefined;
  return projection.spreadContentToPage(input.x, input.y) ?? undefined;
}

export function projectNativeSelectionCaret(
  projection: NativeSelectionProjection,
  caret: Pick<ReaderTextCaret, 'pageIndex' | 'geometry'>,
): Rect | null {
  if (!projection.isPageVisible(caret.pageIndex)) return null;
  return projection.pageContentToSpread(caret.pageIndex, {
    x: caret.geometry.x,
    y: caret.geometry.y,
    width: 0,
    height: caret.geometry.height,
  });
}
