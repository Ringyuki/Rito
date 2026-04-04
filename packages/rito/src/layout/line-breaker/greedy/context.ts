import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtomSegment, InlineSegment } from '../../text/styled-segment';
import { isInlineAtom } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import type { LineContext, StyleRange } from './types';

/** Object Replacement Character used as placeholder for inline atoms. */
const ORC = '\uFFFC';

export function buildStyleRanges(segments: readonly InlineSegment[]): {
  fullText: string;
  ranges: readonly StyleRange[];
  atoms: ReadonlyMap<number, InlineAtomSegment>;
} {
  const ranges: StyleRange[] = [];
  const textParts: string[] = [];
  const atoms = new Map<number, InlineAtomSegment>();
  let offset = 0;

  for (const segment of segments) {
    if (isInlineAtom(segment)) {
      textParts.push(ORC);
      atoms.set(offset, segment);
      ranges.push({ start: offset, end: offset + 1, style: segment.style });
      offset += 1;
      continue;
    }
    textParts.push(segment.text);
    if (segment.text.length === 0) continue;

    const range: StyleRange = {
      start: offset,
      end: offset + segment.text.length,
      style: segment.style,
    };
    ranges.push(segment.href ? { ...range, href: segment.href } : range);
    offset += segment.text.length;
  }

  return { fullText: textParts.join(''), ranges, atoms };
}

export function buildLineContext(
  text: string,
  baseStyle: ComputedStyle,
  ranges: readonly StyleRange[],
  maxWidth: number,
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
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
    atoms,
  };
}

export function consumeNewlines(text: string, pos: number, preserveWs: boolean): number {
  if (preserveWs) {
    return pos < text.length && text[pos] === '\n' ? pos + 1 : pos;
  }

  while (pos < text.length && text[pos] === '\n') pos++;
  return pos;
}
