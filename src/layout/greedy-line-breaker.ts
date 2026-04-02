import type { ComputedStyle } from '../style/types';
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

  for (const word of words) {
    if (word.text === '\n') {
      y = emitLine(lines, currentWords, currentWidth, y, measurer);
      currentWords = [];
      currentWidth = 0;
      continue;
    }

    const spaceWidth = currentWords.length > 0 ? measurer.measureText(' ', word.style).width : 0;
    const needed = currentWidth + spaceWidth + word.width;

    if (currentWords.length > 0 && needed > maxWidth) {
      y = emitLine(lines, currentWords, currentWidth, y, measurer);
      currentWords = [word];
      currentWidth = word.width;
    } else {
      currentWords.push(word);
      currentWidth =
        currentWords.length === 1 ? word.width : currentWidth + spaceWidth + word.width;
    }
  }

  emitLine(lines, currentWords, currentWidth, y, measurer);
  return lines;
}

/** Emit a completed line and return the updated y position. */
function emitLine(
  lines: LineBox[],
  words: readonly Word[],
  lineWidth: number,
  y: number,
  measurer: TextMeasurer,
): number {
  if (words.length === 0) return y;

  const lineHeight = computeLineHeight(words);
  const runs = buildTextRuns(words, y, measurer);

  lines.push({
    type: 'line-box',
    bounds: { x: 0, y, width: lineWidth, height: lineHeight },
    runs,
  });

  return y + lineHeight;
}

function computeLineHeight(words: readonly Word[]): number {
  let maxHeight = 0;
  for (const word of words) {
    const h = word.style.fontSize * word.style.lineHeight;
    if (h > maxHeight) maxHeight = h;
  }
  return maxHeight;
}

function buildTextRuns(words: readonly Word[], y: number, measurer: TextMeasurer): TextRun[] {
  const runs: TextRun[] = [];
  let x = 0;

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
      bounds: { x, y, width: word.width, height: lineHeight },
      style: word.style,
    });
    x += word.width;
  }

  return runs;
}
