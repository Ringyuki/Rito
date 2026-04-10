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

    let range: StyleRange = {
      start: offset,
      end: offset + segment.text.length,
      style: segment.style,
      ...(segment.sourceRef ? { sourceRef: segment.sourceRef } : {}),
      ...(segment.sourceText !== undefined ? { sourceText: segment.sourceText } : {}),
    };
    if (segment.href) range = { ...range, href: segment.href };
    if (segment.rubyAnnotation) range = { ...range, rubyAnnotation: segment.rubyAnnotation };
    ranges.push(range);
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

export function consumeNewlines(text: string, pos: number, _preserveWs: boolean): number {
  // Consume exactly one newline (from <br>) so each <br> produces its own line break.
  return pos < text.length && text[pos] === '\n' ? pos + 1 : pos;
}
