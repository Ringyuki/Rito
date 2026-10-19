/** The CSS colours kit paints its highlights in. */
export interface HighlightColors {
  readonly selection: string;
  readonly searchMatch: string;
  /** The search result the reader is on. */
  readonly searchActive: string;
  /** A highlight or note annotation whose record names no colour. */
  readonly highlight: string;
  /** An underline annotation whose record names no colour. */
  readonly underline: string;
}

export const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {
  selection: 'rgba(59, 130, 246, 0.3)',
  searchMatch: 'rgba(250, 204, 21, 0.4)',
  searchActive: 'rgba(249, 115, 22, 0.6)',
  highlight: 'rgba(250, 204, 21, 0.3)',
  underline: 'rgba(234, 88, 12, 0.85)',
};

/** `colors` with every colour `changes` names in its place. */
export function withHighlightColors(
  colors: HighlightColors,
  changes: Partial<HighlightColors> | undefined,
): HighlightColors {
  if (changes === undefined) return colors;
  const next = { ...colors };
  for (const key of Object.keys(DEFAULT_HIGHLIGHT_COLORS) as (keyof HighlightColors)[]) {
    const color = changes[key];
    if (color !== undefined) next[key] = color;
  }
  return next;
}
