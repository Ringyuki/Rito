import type { SourceRef } from '../../../parser/xhtml/types';
import type { ComputedStyle } from '../../../style/core/types';
import { measurePaintFromStyle } from '../../../style/css/font-shorthand';
import type { InlineAtom, TextRun } from '../../core/types';
import type { InlineAtomSegment } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import { runPaintFromStyle } from '../../text/run-paint-from-style';
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
      x += result.insetLeft + result.run.bounds.width + result.insetRight;
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
): { run?: TextRun; nextPos: number; insetLeft: number; insetRight: number } | undefined {
  const range = findRange(ranges, globalPos);
  if (!range) return undefined;

  const rangeEnd = Math.min(range.end - globalOffset, lineText.length);
  const runText = stripORC(lineText.slice(linePos, rangeEnd));
  if (runText.length === 0) return { nextPos: rangeEnd, insetLeft: 0, insetRight: 0 };

  // Only mark fragment edges on the true first/last slice of the range.
  // When a range wraps across lines, intermediate slices must not redraw
  // left/right borders.
  const isStart = range.borderStart === true && globalPos === range.start;
  const isEnd = range.borderEnd === true && rangeEnd + globalOffset >= range.end;
  const insetLeft = isStart ? range.style.borderLeft.width + range.style.paddingLeft : 0;
  const insetRight = isEnd ? range.style.paddingRight + range.style.borderRight.width : 0;
  // Inline margins create spacing outside the border/background
  const marginLeft = globalPos === range.start ? (range.inlineMarginLeft ?? 0) : 0;
  const marginRight = rangeEnd + globalOffset >= range.end ? (range.inlineMarginRight ?? 0) : 0;

  const sourceTextOffset = globalPos - range.start;
  const width = measurer.measureText(runText, measurePaintFromStyle(range.style)).width;
  let run = buildTextRun(
    runText,
    x + marginLeft + insetLeft,
    lineHeight,
    width,
    range.style,
    isStart,
    isEnd,
    range.href,
    range.sourceRef,
    range.sourceText,
    sourceTextOffset,
    baseFontSize,
    range.rubyAnnotation,
  );
  if (marginRight > 0) run = { ...run, inlineMarginRight: marginRight };
  return {
    run,
    nextPos: rangeEnd,
    insetLeft: insetLeft + marginLeft,
    insetRight: insetRight + marginRight,
  };
}

export function getRunsWidth(runs: readonly (TextRun | InlineAtom)[]): number {
  let width = 0;
  for (const run of runs) {
    let right = run.bounds.x + run.bounds.width;
    if (run.type === 'text-run') {
      // Trailing inline box extension (right padding + right border) past text.
      if (run.paint.border?.end) {
        right += (run.paint.padding?.right ?? 0) + run.paint.border.end.widthPx;
      }
      if (run.inlineMarginRight) right += run.inlineMarginRight;
    }
    width = Math.max(width, right);
  }
  return width;
}

function buildTextRun(
  text: string,
  x: number,
  lineHeight: number,
  width: number,
  style: ComputedStyle,
  isStart: boolean,
  isEnd: boolean,
  href?: string,
  sourceRef?: SourceRef,
  sourceText?: string,
  sourceTextOffset?: number,
  baseFontSize?: number,
  rubyAnnotation?: string,
): TextRun {
  const y = computeVerticalAlignOffset(style, lineHeight, baseFontSize);
  const height = style.lineHeightPx ?? style.fontSize * style.lineHeight;

  let run: TextRun = {
    type: 'text-run',
    text,
    bounds: { x, y, width, height },
    paint: runPaintFromStyle(style, { start: isStart, end: isEnd }),
    ...(style.lineHeightPx !== undefined ? { lineHeightPx: style.lineHeightPx } : {}),
    ...(sourceRef ? { sourceRef } : {}),
    ...(sourceText !== undefined ? { sourceText } : {}),
    ...(sourceTextOffset !== undefined ? { sourceTextOffset } : {}),
  };
  if (href) run = { ...run, href };
  // Ruby annotation: stash on the TextRun via a symbol-like field so the
  // LineBox finalizer can pick it up and emit a standalone RubyAnnotation
  // child. TextRun itself no longer carries `rubyAnnotation` — keeps the
  // render contract clean.
  if (rubyAnnotation) attachRuby(run, rubyAnnotation);
  return run;
}

/** Scratch store used by the LineBox finalizer to recover which runs carry
 *  ruby labels. Not part of the public TextRun shape — the finalizer reads
 *  it, emits a standalone RubyAnnotation child, and the symbol key becomes
 *  inert once it's out of scope. */
export const RUBY_TAG = Symbol('ruby');
export function attachRuby(run: TextRun, text: string): void {
  (run as unknown as { [RUBY_TAG]?: string })[RUBY_TAG] = text;
}
export function readRubyTag(run: TextRun): string | undefined {
  return (run as unknown as { [RUBY_TAG]?: string })[RUBY_TAG];
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
    let withSrc: InlineAtom = { ...result, imageSrc: atom.imageSrc };
    if (atom.alt) withSrc = { ...withSrc, alt: atom.alt };
    if (atom.href) withSrc = { ...withSrc, href: atom.href };
    return withSrc;
  }
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
      const base = baseFontSize ?? style.fontSize;
      return ASCENT_RATIO * (base - style.fontSize);
    }
    case 'top':
    case 'text-top':
      return 0;
    case 'super': {
      const base = baseFontSize ?? style.fontSize;
      return ASCENT_RATIO * (base - style.fontSize) - base * 0.4;
    }
    case 'sub': {
      const base = baseFontSize ?? style.fontSize;
      return ASCENT_RATIO * (base - style.fontSize) + base * 0.2;
    }
    case 'middle':
      return (lineHeight - style.fontSize) / 2;
    case 'bottom':
    case 'text-bottom':
      return lineHeight - style.fontSize;
    default:
      return 0;
  }
}
