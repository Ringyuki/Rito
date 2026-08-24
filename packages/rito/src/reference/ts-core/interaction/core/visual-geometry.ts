import type { LayoutBlock, Rect } from '../../layout/core/types';
import type { LengthPct, TransformFn } from '../../style/core/paint-types';

export interface AffineTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export interface VisualGeometry {
  readonly matrix: AffineTransform;
  readonly clip: Rect | undefined;
}

export const IDENTITY_TRANSFORM: AffineTransform = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
};

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function createPageVisualGeometry(): VisualGeometry {
  // Page clipping is expressed in viewport coordinates and depends on margins,
  // while interaction geometry deliberately uses margin-free content space.
  // Block clips can be represented exactly here; the page clip is applied by
  // the controller's coordinate mapper/render surface.
  return { matrix: IDENTITY_TRANSFORM, clip: undefined };
}

export function enterBlockVisualGeometry(
  block: LayoutBlock,
  absoluteX: number,
  absoluteY: number,
  parent: VisualGeometry,
): VisualGeometry {
  let matrix = parent.matrix;
  const offset = block.paint?.visualOffset;
  if (offset) matrix = multiplyTransform(matrix, translation(offset.dx, offset.dy));

  const transforms = block.paint?.transform;
  if (transforms && transforms.length > 0) {
    const cx = absoluteX + block.bounds.width / 2;
    const cy = absoluteY + block.bounds.height / 2;
    matrix = multiplyTransform(matrix, translation(cx, cy));
    for (const transform of transforms) {
      matrix = multiplyTransform(matrix, transformMatrix(transform, block.bounds));
    }
    matrix = multiplyTransform(matrix, translation(-cx, -cy));
  }

  let clip = parent.clip;
  if (block.paint?.clipToBounds) {
    const ownClip = transformRect(
      { x: absoluteX, y: absoluteY, width: block.bounds.width, height: block.bounds.height },
      matrix,
    );
    clip = clip ? (intersectRects(clip, ownClip) ?? EMPTY_RECT) : ownClip;
  }
  return { matrix, clip };
}

export function resolveVisualRect(rect: Rect, visual: VisualGeometry): Rect | undefined {
  const transformed = transformRect(rect, visual.matrix);
  if (visual.clip?.width === 0 || visual.clip?.height === 0) return undefined;
  return visual.clip ? intersectRects(transformed, visual.clip) : transformed;
}

export function transformRect(rect: Rect, matrix: AffineTransform): Rect {
  const points = [
    transformPoint(rect.x, rect.y, matrix),
    transformPoint(rect.x + rect.width, rect.y, matrix),
    transformPoint(rect.x, rect.y + rect.height, matrix),
    transformPoint(rect.x + rect.width, rect.y + rect.height, matrix),
  ];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  };
}

export function inverseTransformPoint(
  x: number,
  y: number,
  matrix: AffineTransform,
): { readonly x: number; readonly y: number } | undefined {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < Number.EPSILON) return undefined;
  const px = x - matrix.e;
  const py = y - matrix.f;
  return {
    x: (matrix.d * px - matrix.c * py) / determinant,
    y: (-matrix.b * px + matrix.a * py) / determinant,
  };
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function intersectRects(a: Rect, b: Rect): Rect | undefined {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return undefined;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function transformPoint(
  x: number,
  y: number,
  matrix: AffineTransform,
): { readonly x: number; readonly y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  };
}

function multiplyTransform(left: AffineTransform, right: AffineTransform): AffineTransform {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

function transformMatrix(transform: TransformFn, box: Rect): AffineTransform {
  if (transform.kind === 'rotate') {
    const cos = Math.cos(transform.rad);
    const sin = Math.sin(transform.rad);
    return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  }
  if (transform.kind === 'scale') {
    return { a: transform.sx, b: 0, c: 0, d: transform.sy, e: 0, f: 0 };
  }
  return translation(
    resolveLengthPct(transform.x, box.width),
    resolveLengthPct(transform.y, box.height),
  );
}

function resolveLengthPct(value: LengthPct, basis: number): number {
  return value.unit === 'percent' ? (value.value / 100) * basis : value.value;
}

function translation(dx: number, dy: number): AffineTransform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}
