import type { SourceRef } from '../../../parser/xhtml/types';
import type { ComputedStyle } from '../../../style/core/types';
import type { InlineAtom, TextRun } from '../../core/types';
import type { InlineAtomSegment } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import type { StyleRange } from './types';

/** Object Replacement Character used as placeholder for inline atoms. */
const ORC = '\uFFFC';

export function buildStyledRuns(
  lineText: string,
  globalOffset: number,
  startX: number,
  lineHeight: number,
  ranges: readonly StyleRange[],
  measurer: TextMeasurer,
  atoms: ReadonlyMap<number, InlineAtomSegment> = new Map(),
): (TextRun | InlineAtom)[] {
  const runs: (TextRun | InlineAtom)[] = [];
  let x = startX;
  let linePos = 0;

  while (linePos < lineText.length) {
    const globalPos = globalOffset + linePos;
    const atom = atoms.get(globalPos);
    if (atom) {
      runs.push(buildInlineAtom(atom, x, lineHeight));
      x += atom.width;
      linePos += 1;
      continue;
    }

    const range = findRange(ranges, globalPos);
    if (!range) break;

    const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
    const runText = stripORC(lineText.slice(linePos, rangeEnd));
    if (runText.length === 0) {
      linePos = rangeEnd;
      continue;
    }

    const sourceTextOffset = globalPos - range.start;
    const width = measurer.measureText(runText, range.style).width;
    runs.push(
      buildTextRun(
        runText,
        x,
        lineHeight,
        width,
        range.style,
        range.href,
        range.sourceRef,
        range.sourceText,
        sourceTextOffset,
      ),
    );
    x += width;
    linePos = rangeEnd;
  }

  return runs;
}

export function getRunsWidth(runs: readonly (TextRun | InlineAtom)[]): number {
  return runs.reduce((maxWidth, run) => Math.max(maxWidth, run.bounds.x + run.bounds.width), 0);
}

function buildTextRun(
  text: string,
  x: number,
  lineHeight: number,
  width: number,
  style: ComputedStyle,
  href?: string,
  sourceRef?: SourceRef,
  sourceText?: string,
  sourceTextOffset?: number,
): TextRun {
  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y: computeVerticalAlignOffset(style, lineHeight), width, height: lineHeight },
    style,
    ...(sourceRef ? { sourceRef } : {}),
    ...(sourceText !== undefined ? { sourceText } : {}),
    ...(sourceTextOffset !== undefined ? { sourceTextOffset } : {}),
  };
  return href ? { ...run, href } : run;
}

function buildInlineAtom(atom: InlineAtomSegment, x: number, lineHeight: number): InlineAtom {
  const result: InlineAtom = {
    type: 'inline-atom',
    bounds: {
      x,
      y: computeVerticalAlignOffset(atom.style, lineHeight),
      width: atom.width,
      height: atom.height,
    },
  };
  if (atom.imageSrc !== undefined) {
    const withSrc: InlineAtom = { ...result, imageSrc: atom.imageSrc };
    return atom.alt ? { ...withSrc, alt: atom.alt } : withSrc;
  }
  if (atom.sourceNode) return { ...result, verticalAlign: atom.style.verticalAlign };
  return result;
}

function stripORC(text: string): string {
  return text.includes(ORC) ? text.replaceAll(ORC, '') : text;
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
