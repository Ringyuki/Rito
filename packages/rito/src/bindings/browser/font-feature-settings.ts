/** One OpenType feature a font reference turns on. */
export interface FontFeature {
  readonly tag: string;
  readonly value: number;
}

/**
 * The `font-feature-settings` descriptor a registered face takes for the
 * features its font reference lists: each four-letter tag quoted with its
 * value, as the descriptor's grammar writes them.
 */
export function fontFeatureSettings(features: readonly FontFeature[]): string {
  return features.map((feature) => `"${feature.tag}" ${String(feature.value)}`).join(', ');
}
