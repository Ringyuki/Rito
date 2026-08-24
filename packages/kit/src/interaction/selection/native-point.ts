import type { NativeSelectionPoint } from './native-types';

export function requireNativeSelectionPoint(point: NativeSelectionPoint): void {
  if (!Number.isSafeInteger(point.pageIndex) || point.pageIndex < 0) {
    throw new TypeError('Native selection pageIndex must be a non-negative safe integer');
  }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError('Native selection point coordinates must be finite');
  }
}

export function copyNativeSelectionPoint(point: NativeSelectionPoint): NativeSelectionPoint {
  return { pageIndex: point.pageIndex, x: point.x, y: point.y };
}
