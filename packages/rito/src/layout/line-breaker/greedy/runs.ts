import type { ComputedStyle } from '../../../style/types';
import type { TextRun } from '../../core/types';
import type { TextMeasurer } from '../../text/text-measurer';
import type { StyleRange } from './types';

export function buildStyledRuns(
  lineText: string,
  globalOffset: number,
  startX: number,
  lineHeight: number,
  ranges: readonly StyleRange[],
  measurer: TextMeasurer,
): TextRun[] {
  const runs: TextRun[] = [];
  let x = startX;
  let linePos = 0;

  while (linePos < lineText.length) {
    const globalPos = globalOffset + linePos;
    const range = findRange(ranges, globalPos);
    if (!range) break;

    const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
    const runText = lineText.slice(linePos, rangeEnd);
    if (runText.length === 0) break;

    const width = measurer.measureText(runText, range.style).width;
    runs.push({
      type: 'text-run',
      text: runText,
      bounds: {
        x,
        y: computeVerticalAlignOffset(range.style, lineHeight),
        width,
        height: lineHeight,
      },
      style: range.style,
    });
    x += width;
    linePos = rangeEnd;
  }

  return runs;
}

export function getRunsWidth(runs: readonly TextRun[]): number {
  return runs.reduce((maxWidth, run) => Math.max(maxWidth, run.bounds.x + run.bounds.width), 0);
}

function findRange(ranges: readonly StyleRange[], globalPos: number): StyleRange | undefined {
  for (const range of ranges) {
    if (globalPos >= range.start && globalPos < range.end) return range;
  }
  return undefined;
}

function computeVerticalAlignOffset(style: ComputedStyle, lineHeight: number): number {
  const verticalAlign = style.verticalAlign;
  if (verticalAlign === 'baseline' || verticalAlign === 'top' || verticalAlign === 'text-top') {
    return 0;
  }

  switch (verticalAlign) {
    case 'super':
      return -(style.fontSize * 0.4);
    case 'sub':
      return style.fontSize * 0.2;
    case 'middle':
      return (lineHeight - style.fontSize) / 2;
    case 'bottom':
    case 'text-bottom':
      return lineHeight - style.fontSize;
    default:
      return 0;
  }
}
