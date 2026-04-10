import type { ComputedStyle } from '../../style/core/types';
import { applySizeConstraints } from './primitives';
import { resolveMarginLeft, resolveMarginRight } from './resolve-pct';

/**
 * Pre-layout horizontal metrics for a block-level element.
 * Shared by leaf blocks, container blocks, and tables.
 */
export interface HorizontalBoxMetrics {
  readonly marginLeft: number;
  readonly marginRight: number;
  /** Total box width for layout (after margins and CSS width/max-width/box-sizing constraints). */
  readonly targetWidth: number;
}

/**
 * Resolve the horizontal box metrics for a block-level element:
 * 1. Resolve percentage margins
 * 2. Subtract fixed margins from container width
 * 3. Apply CSS width / max-width / box-sizing constraints
 */
export function resolveHorizontalBoxMetrics(
  containerWidth: number,
  style: ComputedStyle,
): HorizontalBoxMetrics {
  const marginLeft = resolveMarginLeft(style, containerWidth);
  const marginRight = resolveMarginRight(style, containerWidth);
  let targetWidth =
    marginLeft + marginRight > 0 ? containerWidth - marginLeft - marginRight : containerWidth;
  targetWidth = applySizeConstraints(targetWidth, style);
  return { marginLeft, marginRight, targetWidth };
}

/**
 * Post-layout x offset for a block-level element, handling margin-left,
 * margin-right, and margin: auto centering.
 *
 * @param containerWidth - The parent's content width
 * @param actualWidth    - The element's actual rendered width (may differ from targetWidth)
 * @param style          - Computed style (for marginLeftAuto / marginRightAuto flags)
 * @param marginLeft     - Resolved margin-left value
 * @param marginRight    - Resolved margin-right value
 * @param baseOffset     - Additional base offset (e.g. float indent), added to fixed-margin case
 */
export function resolveHorizontalOffset(
  containerWidth: number,
  actualWidth: number,
  style: ComputedStyle,
  marginLeft: number,
  marginRight: number,
  baseOffset = 0,
): number {
  if ((style.marginLeftAuto || style.marginRightAuto) && actualWidth < containerWidth) {
    const remaining = containerWidth - actualWidth;
    if (style.marginLeftAuto && style.marginRightAuto) return remaining / 2;
    if (style.marginLeftAuto) return remaining - marginRight;
  }
  return marginLeft + baseOffset;
}
