import type { ComputedStyle } from '../../style/core/types';

/** Resolve a margin value, substituting percentage if set. */
export function resolveMarginTop(style: ComputedStyle, containerWidth: number): number {
  return style.marginTopPct !== undefined
    ? (containerWidth * style.marginTopPct) / 100
    : style.marginTop;
}

export function resolveMarginRight(style: ComputedStyle, containerWidth: number): number {
  return style.marginRightPct !== undefined
    ? (containerWidth * style.marginRightPct) / 100
    : style.marginRight;
}

export function resolveMarginBottom(style: ComputedStyle, containerWidth: number): number {
  return style.marginBottomPct !== undefined
    ? (containerWidth * style.marginBottomPct) / 100
    : style.marginBottom;
}

export function resolveMarginLeft(style: ComputedStyle, containerWidth: number): number {
  return style.marginLeftPct !== undefined
    ? (containerWidth * style.marginLeftPct) / 100
    : style.marginLeft;
}

/** Resolve a padding value, substituting percentage if set. */
export function resolvePaddingTop(style: ComputedStyle, containerWidth: number): number {
  return style.paddingTopPct !== undefined
    ? (containerWidth * style.paddingTopPct) / 100
    : style.paddingTop;
}

export function resolvePaddingRight(style: ComputedStyle, containerWidth: number): number {
  return style.paddingRightPct !== undefined
    ? (containerWidth * style.paddingRightPct) / 100
    : style.paddingRight;
}

export function resolvePaddingBottom(style: ComputedStyle, containerWidth: number): number {
  return style.paddingBottomPct !== undefined
    ? (containerWidth * style.paddingBottomPct) / 100
    : style.paddingBottom;
}

export function resolvePaddingLeft(style: ComputedStyle, containerWidth: number): number {
  return style.paddingLeftPct !== undefined
    ? (containerWidth * style.paddingLeftPct) / 100
    : style.paddingLeft;
}
