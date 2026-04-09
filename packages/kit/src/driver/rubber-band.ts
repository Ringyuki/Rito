/**
 * Non-linear rubber band formula for boundary overscroll.
 *
 * As |dx| → 0: nearly linear (feels responsive).
 * As |dx| → ∞: asymptotically approaches maxDisplacement * coefficient.
 *
 * Formula: sign(dx) * (1 - 1 / (|dx|/maxWidth + 1)) * maxWidth * coefficient
 */

const DEFAULT_COEFFICIENT = 0.55;

export function rubberBand(
  rawDx: number,
  maxWidth: number,
  coefficient = DEFAULT_COEFFICIENT,
): number {
  if (rawDx === 0) return 0;
  const sign = rawDx > 0 ? 1 : -1;
  const abs = Math.abs(rawDx);
  return sign * (1 - 1 / (abs / maxWidth + 1)) * maxWidth * coefficient;
}
