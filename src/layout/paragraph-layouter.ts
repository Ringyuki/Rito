import type { LineBox } from './types';
import type { StyledSegment } from './styled-segment';

/**
 * Abstraction for paragraph-level inline layout.
 * Takes flattened styled segments and produces laid-out line boxes.
 *
 * This interface decouples line-breaking from the rest of the layout engine,
 * making the algorithm swappable (greedy, Knuth-Plass, or external adapters).
 */
export interface ParagraphLayouter {
  layoutParagraph(
    segments: readonly StyledSegment[],
    maxWidth: number,
    startY: number,
  ): readonly LineBox[];
}
