import type { LayoutConfig, Spread } from '../../layout/core/types';

/**
 * Resolve the effective body background for a dual-page spread.
 *
 * Rules:
 * - Both pages share the same bg → use it
 * - One page has bg, the other doesn't → unify to the bg page's color
 * - Both pages have different bgs → no unified bg (each page draws its own)
 *
 * Returns undefined when there is no body bg on either page or when the
 * spread is in single-page mode.
 */
export function resolveSpreadBodyBackground(
  spread: Spread,
  config: LayoutConfig,
): string | undefined {
  if (config.spreadMode !== 'double') return spread.left?.paint?.backgroundColor;

  const leftBg = spread.left?.paint?.backgroundColor;
  const rightBg = spread.right?.paint?.backgroundColor;

  if (leftBg && rightBg && leftBg !== rightBg) return undefined;
  return leftBg ?? rightBg;
}
