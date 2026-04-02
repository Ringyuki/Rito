import type { ComputedStyle, TextAlignment } from '../style/types';
import type { LineBox, TextRun } from './types';
import type { ParagraphLayouter } from './paragraph-layouter';
import type { StyledSegment } from './styled-segment';
import type { TextMeasurer } from './text-measurer';

/** A word token produced by tokenizing styled segments. */
interface Word {
  readonly text: string;
  readonly style: ComputedStyle;
  readonly width: number;
}

/**
 * Greedy paragraph layouter.
 * Splits text at word boundaries, fills lines left-to-right,
 * and breaks to a new line when the next word would overflow.
 * Supports text-indent (first line) and text-align (all lines).
 */
export function createGreedyLayouter(measurer: TextMeasurer): ParagraphLayouter {
  return {
    layoutParagraph(
      segments: readonly StyledSegment[],
      maxWidth: number,
      startY: number,
    ): readonly LineBox[] {
      const words = tokenize(segments, measurer);
      if (words.length === 0) return [];
      return breakLines(words, maxWidth, startY, measurer);
    },
  };
}

function tokenize(segments: readonly StyledSegment[], measurer: TextMeasurer): Word[] {
  const words: Word[] = [];
  for (const segment of segments) {
    const { text, style } = segment;
    const parts = text.split(/(\n)/);
    for (const part of parts) {
      if (part === '\n') {
        words.push({ text: '\n', style, width: 0 });
        continue;
      }
      const rawWords = part.split(/\s+/).filter((w) => w.length > 0);
      for (const w of rawWords) {
        const { width } = measurer.measureText(w, style);
        words.push({ text: w, style, width });
      }
    }
  }
  return words;
}

function breakLines(
  words: readonly Word[],
  maxWidth: number,
  startY: number,
  measurer: TextMeasurer,
): LineBox[] {
  const lines: LineBox[] = [];
  let currentWords: Word[] = [];
  let currentWidth = 0;
  let y = startY;
  let isFirstLine = true;

  const indent = words[0]?.style.textIndent ?? 0;
  const textAlign = words[0]?.style.textAlign ?? 'left';
  let effectiveMax = indent > 0 ? maxWidth - indent : maxWidth;

  for (const word of words) {
    if (word.text === '\n') {
      y = emitLine(
        lines,
        currentWords,
        currentWidth,
        y,
        maxWidth,
        effectiveMax,
        textAlign,
        isFirstLine && indent > 0 ? indent : 0,
        false,
        measurer,
      );
      currentWords = [];
      currentWidth = 0;
      isFirstLine = false;
      effectiveMax = maxWidth;
      continue;
    }

    if (currentWords.length === 0 && word.width > effectiveMax) {
      const chunks = breakWord(word, effectiveMax, measurer);
      for (const chunk of chunks) {
        y = emitLine(
          lines,
          [chunk],
          chunk.width,
          y,
          maxWidth,
          effectiveMax,
          textAlign,
          isFirstLine && indent > 0 ? indent : 0,
          false,
          measurer,
        );
        isFirstLine = false;
        effectiveMax = maxWidth;
      }
      continue;
    }

    const spaceWidth = currentWords.length > 0 ? measurer.measureText(' ', word.style).width : 0;
    const needed = currentWidth + spaceWidth + word.width;

    if (currentWords.length > 0 && needed > effectiveMax) {
      y = emitLine(
        lines,
        currentWords,
        currentWidth,
        y,
        maxWidth,
        effectiveMax,
        textAlign,
        isFirstLine && indent > 0 ? indent : 0,
        false,
        measurer,
      );
      isFirstLine = false;
      effectiveMax = maxWidth;
      if (word.width > maxWidth) {
        const chunks = breakWord(word, maxWidth, measurer);
        for (const chunk of chunks) {
          y = emitLine(
            lines,
            [chunk],
            chunk.width,
            y,
            maxWidth,
            maxWidth,
            textAlign,
            0,
            false,
            measurer,
          );
        }
        currentWords = [];
        currentWidth = 0;
      } else {
        currentWords = [word];
        currentWidth = word.width;
      }
    } else {
      currentWords.push(word);
      currentWidth =
        currentWords.length === 1 ? word.width : currentWidth + spaceWidth + word.width;
    }
  }

  // Last line: isLastLine=true (no justify for last line)
  emitLine(
    lines,
    currentWords,
    currentWidth,
    y,
    maxWidth,
    effectiveMax,
    textAlign,
    isFirstLine && indent > 0 ? indent : 0,
    true,
    measurer,
  );
  return lines;
}

function emitLine(
  lines: LineBox[],
  words: readonly Word[],
  lineWidth: number,
  y: number,
  maxWidth: number,
  _effectiveMax: number,
  textAlign: TextAlignment,
  indent: number,
  isLastLine: boolean,
  measurer: TextMeasurer,
): number {
  if (words.length === 0) return y;

  const lineHeight = computeLineHeight(words);
  let runs = buildTextRuns(words, indent, measurer);
  runs = applyTextAlign(runs, lineWidth, maxWidth, indent, textAlign, isLastLine);

  lines.push({
    type: 'line-box',
    bounds: { x: 0, y, width: maxWidth, height: lineHeight },
    runs,
  });

  return y + lineHeight;
}

function applyTextAlign(
  runs: TextRun[],
  lineWidth: number,
  maxWidth: number,
  indent: number,
  textAlign: TextAlignment,
  isLastLine: boolean,
): TextRun[] {
  if (textAlign === 'left' || runs.length === 0) return runs;

  const totalContentWidth = lineWidth + indent;

  if (textAlign === 'center') {
    const offset = (maxWidth - totalContentWidth) / 2;
    return offsetRuns(runs, offset);
  }

  if (textAlign === 'right') {
    const offset = maxWidth - totalContentWidth;
    return offsetRuns(runs, offset);
  }

  // justify: distribute extra space, but not on last line
  if (!isLastLine && runs.length > 1) {
    const extraSpace = maxWidth - totalContentWidth;
    const gapCount = runs.length - 1;
    const extraPerGap = extraSpace / gapCount;
    return runs.map((run, i) => ({
      ...run,
      bounds: { ...run.bounds, x: run.bounds.x + extraPerGap * i },
    }));
  }

  return runs;
}

function offsetRuns(runs: TextRun[], offset: number): TextRun[] {
  return runs.map((run) => ({
    ...run,
    bounds: { ...run.bounds, x: run.bounds.x + offset },
  }));
}

function computeLineHeight(words: readonly Word[]): number {
  let maxHeight = 0;
  for (const word of words) {
    const h = word.style.fontSize * word.style.lineHeight;
    if (h > maxHeight) maxHeight = h;
  }
  return maxHeight;
}

function buildTextRuns(words: readonly Word[], startX: number, measurer: TextMeasurer): TextRun[] {
  const runs: TextRun[] = [];
  let x = startX;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (!word) continue;

    if (i > 0) {
      x += measurer.measureText(' ', word.style).width;
    }

    const lineHeight = word.style.fontSize * word.style.lineHeight;
    runs.push({
      type: 'text-run',
      text: word.text,
      bounds: { x, y: 0, width: word.width, height: lineHeight },
      style: word.style,
    });
    x += word.width;
  }

  return runs;
}

function breakWord(word: Word, maxWidth: number, measurer: TextMeasurer): Word[] {
  const chunks: Word[] = [];
  let start = 0;
  while (start < word.text.length) {
    let end = start + 1;
    while (end < word.text.length) {
      const candidate = word.text.slice(start, end + 1);
      const { width } = measurer.measureText(candidate, word.style);
      if (width > maxWidth) break;
      end++;
    }
    const text = word.text.slice(start, end);
    const { width } = measurer.measureText(text, word.style);
    chunks.push({ text, style: word.style, width });
    start = end;
  }
  return chunks;
}
