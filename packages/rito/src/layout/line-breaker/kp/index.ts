import type { LineBox } from '../../core/types';
import type { ParagraphLayouter } from '../../text/paragraph-layouter';
import type { InlineSegment } from '../../text/styled-segment';
import { isInlineAtom } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import { createGreedyLayouter } from '../greedy';
import { buildKPItems } from './builder';
import { buildLineBoxes } from './line-boxes';
import { emergencyBreaks, solveKP } from './solver';

export function createKnuthPlassLayouter(measurer: TextMeasurer): ParagraphLayouter {
  const whiteSpaceFallback = createGreedyLayouter(measurer);
  return {
    layoutParagraph(
      segments: readonly InlineSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      if (segments.length === 0) return [];
      const firstStyle = segments[0]?.style;
      if (!firstStyle) return [];

      // The KP item model intentionally collapses glue. Delegate modes whose
      // whitespace preservation/no-wrap semantics cannot be represented by
      // stretchable glue to the exact greedy implementation.
      if (firstStyle.whiteSpace !== 'normal') {
        return whiteSpaceFallback.layoutParagraph(segments, maxWidth, startY);
      }

      const hasAtoms = segments.some(isInlineAtom);
      const fullText = segments.map((s) => (isInlineAtom(s) ? '\uFFFC' : s.text)).join('');
      if (fullText.trim().length === 0 && !fullText.includes('\n') && !hasAtoms) return [];

      const lineHeight = firstStyle.lineHeightPx ?? firstStyle.fontSize * firstStyle.lineHeight;
      const indent = firstStyle.textIndent;
      const items = buildKPItems(segments, measurer);
      if (items.length === 0) return [];

      const lineWidths = {
        firstLine: indent !== 0 ? maxWidth - indent : maxWidth,
        subsequentLines: maxWidth,
      };
      const breakPositions = solveKP(items, lineWidths) ?? emergencyBreaks(items, lineWidths);

      return buildLineBoxes(
        items,
        breakPositions,
        maxWidth,
        indent,
        startY,
        lineHeight,
        firstStyle,
        measurer,
      );
    },
  };
}
