import type { ComputedStyle } from '../../../style/types';
import type { StyledSegment } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import type { LineContext, StyleRange } from './types';

export function buildStyleRanges(segments: readonly StyledSegment[]): {
  fullText: string;
  ranges: readonly StyleRange[];
} {
  const ranges: StyleRange[] = [];
  const textParts: string[] = [];
  let offset = 0;

  for (const segment of segments) {
    textParts.push(segment.text);
    if (segment.text.length === 0) continue;

    ranges.push({
      start: offset,
      end: offset + segment.text.length,
      style: segment.style,
    });
    offset += segment.text.length;
  }

  return { fullText: textParts.join(''), ranges };
}

export function buildLineContext(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  measurer: TextMeasurer,
): LineContext {
  return {
    text,
    baseStyle,
    ranges,
    maxWidth,
    lineHeight: baseStyle.fontSize * baseStyle.lineHeight,
    measurer,
    preserveWs: baseStyle.whiteSpace === 'pre' || baseStyle.whiteSpace === 'pre-wrap',
    allowWrap: baseStyle.whiteSpace !== 'pre' && baseStyle.whiteSpace !== 'nowrap',
  };
}

export function consumeNewlines(text: string, pos: number, preserveWs: boolean): number {
  if (preserveWs) {
    return pos < text.length && text[pos] === '\n' ? pos + 1 : pos;
  }

  while (pos < text.length && text[pos] === '\n') pos++;
  return pos;
}
