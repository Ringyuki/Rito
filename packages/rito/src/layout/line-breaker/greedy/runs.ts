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
  baseFontSize?: number,
): (TextRun | InlineAtom)[] {
  const runs: (TextRun | InlineAtom)[] = [];
  let x = startX;
  let linePos = 0;

  while (linePos < lineText.length) {
    const globalPos = globalOffset + linePos;
    const atom = atoms.get(globalPos);
    if (atom) {
      runs.push(buildInlineAtom(atom, x, lineHeight, baseFontSize));
      x += atom.width;
      linePos += 1;
      continue;
    }

    const result = processRange(
      lineText,
      linePos,
      globalPos,
      globalOffset,
      x,
      lineHeight,
      ranges,
      measurer,
      baseFontSize,
    );
    if (!result) break;
    if (result.run) {
      runs.push(result.run);
      x += result.run.bounds.width;
    }
    linePos = result.nextPos;
  }

  return runs;
}

function processRange(
  lineText: string,
  linePos: number,
  globalPos: number,
  globalOffset: number,
  x: number,
  lineHeight: number,
  ranges: readonly StyleRange[],
  measurer: TextMeasurer,
  baseFontSize?: number,
): { run?: TextRun; nextPos: number } | undefined {
  const range = findRange(ranges, globalPos);
  if (!range) return undefined;

  const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
  const runText = stripORC(lineText.slice(linePos, rangeEnd));
  if (runText.length === 0) return { nextPos: rangeEnd };

  const sourceTextOffset = globalPos - range.start;
  const width = measurer.measureText(runText, range.style).width;
  const run = buildTextRun(
    runText,
    x,
    lineHeight,
    width,
    range.style,
    range.href,
    range.sourceRef,
    range.sourceText,
    sourceTextOffset,
    baseFontSize,
  );
  return { run, nextPos: rangeEnd };
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
  baseFontSize?: number,
): TextRun {
  const run: TextRun = {
    type: 'text-run',
    text,
    bounds: {
      x,
      y: computeVerticalAlignOffset(style, lineHeight, baseFontSize),
      width,
      height: lineHeight,
    },
    style,
    ...(sourceRef ? { sourceRef } : {}),
    ...(sourceText !== undefined ? { sourceText } : {}),
    ...(sourceTextOffset !== undefined ? { sourceTextOffset } : {}),
  };
  return href ? { ...run, href } : run;
}

function buildInlineAtom(
  atom: InlineAtomSegment,
  x: number,
  lineHeight: number,
  baseFontSize?: number,
): InlineAtom {
  const result: InlineAtom = {
    type: 'inline-atom',
    bounds: {
      x,
      y: computeVerticalAlignOffset(atom.style, lineHeight, baseFontSize),
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

const ASCENT_RATIO = 0.8;

function computeVerticalAlignOffset(
  style: ComputedStyle,
  lineHeight: number,
  baseFontSize?: number,
): number {
  const verticalAlign = style.verticalAlign;
  switch (verticalAlign) {
    case 'baseline': {
      // Approximate baseline alignment: shift smaller-font runs down so
      // their baseline (ascent) aligns with the line's baseline.
      // baseFontSize is the paragraph's base font size (from baseStyle).
      const base = baseFontSize ?? style.fontSize;
      return ASCENT_RATIO * (base - style.fontSize);
    }
    case 'top':
    case 'text-top':
      return 0;
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
