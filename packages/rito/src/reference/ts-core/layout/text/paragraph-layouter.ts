import type { LineBox } from '../core/types';
import type { InlineSegment } from './styled-segment';

/**
 * Abstraction for paragraph-level inline layout.
 * Takes flattened inline segments and produces laid-out line boxes.
 *
 * This interface decouples line-breaking from the rest of the layout engine,
 * making the algorithm swappable (greedy, Knuth-Plass, or external adapters).
 */
export interface ParagraphLayouter {
  layoutParagraph(
    segments: readonly InlineSegment[],
    maxWidth: number,
    startY: number,
  ): readonly LineBox[];
}
