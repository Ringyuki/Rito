import { findHyphenationPoints } from '../../text/hyphenation';
import type { InlineSegment, StyledSegment } from '../../text/styled-segment';
import { isInlineAtom } from '../../text/styled-segment';
import type { TextMeasurer } from '../../text/text-measurer';
import type { KPBox, KPGlue, KPItem, KPPenalty } from './types';

const HYPHEN_PENALTY = 50;
const FORCED_BREAK_PENALTY = -Infinity;

export function buildKPItems(segments: readonly InlineSegment[], measurer: TextMeasurer): KPItem[] {
  const items: KPItem[] = [];

  for (const segment of segments) {
    if (isInlineAtom(segment)) {
      const dummySeg: StyledSegment = { text: '\uFFFC', style: segment.style };
      items.push({
        type: 'box',
        width: segment.width,
        text: '\uFFFC',
        segment: dummySeg,
        atom: segment,
      });
      continue;
    }

    const textSeg = segment;
    const { text, style } = textSeg;
    if (text.length === 0) continue;

    // Add zero-width box for left border+padding inset so it counts toward line width
    if (textSeg.borderStart) {
      const inset = style.borderLeft.width + style.paddingLeft;
      if (inset > 0) items.push(createBox(inset, '', textSeg));
    }

    const spaceWidth = measurer.measureText(' ', style).width;
    const stretchFactor = spaceWidth * 1.5;
    const shrinkFactor = spaceWidth * 0.5;

    for (const token of tokenize(text)) {
      if (token === '\n') {
        items.push(createGlue(0, 1e6, 0));
        items.push(createPenalty(0, FORCED_BREAK_PENALTY, false));
      } else if (token === ' ' || token === '\t') {
        items.push(createGlue(spaceWidth, stretchFactor, shrinkFactor));
      } else {
        addWordItems(items, token, textSeg, measurer);
      }
    }

    // Add zero-width box for right border+padding inset
    if (textSeg.borderEnd) {
      const inset = style.paddingRight + style.borderRight.width;
      if (inset > 0) items.push(createBox(inset, '', textSeg));
    }
  }

  if (items.length > 0) {
    items.push(createGlue(0, 1e6, 0));
    items.push(createPenalty(0, FORCED_BREAK_PENALTY, false));
  }

  return items;
}

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === '\n') {
      tokens.push('\n');
      index++;
    } else if (char === ' ' || char === '\t') {
      tokens.push(' ');
      while (index < text.length && (text[index] === ' ' || text[index] === '\t')) {
        index++;
      }
    } else {
      const start = index;
      while (
        index < text.length &&
        text[index] !== ' ' &&
        text[index] !== '\t' &&
        text[index] !== '\n'
      ) {
        index++;
      }
      tokens.push(text.slice(start, index));
    }
  }

  return tokens;
}

function addWordItems(
  items: KPItem[],
  word: string,
  segment: StyledSegment,
  measurer: TextMeasurer,
): void {
  const { style } = segment;
  const hyphenPoints = findHyphenationPoints(word);

  if (hyphenPoints.length === 0) {
    items.push(createBox(measurer.measureText(word, style).width, word, segment));
    return;
  }

  const hyphenWidth = measurer.measureText('-', style).width;
  let prevPos = 0;

  for (const point of hyphenPoints) {
    if (point <= prevPos || point >= word.length) continue;

    const fragment = word.slice(prevPos, point);
    items.push(createBox(measurer.measureText(fragment, style).width, fragment, segment));
    items.push(createPenalty(hyphenWidth, HYPHEN_PENALTY, true));
    prevPos = point;
  }

  if (prevPos < word.length) {
    const fragment = word.slice(prevPos);
    items.push(createBox(measurer.measureText(fragment, style).width, fragment, segment));
  }
}

function createBox(width: number, text: string, segment: StyledSegment): KPBox {
  return { type: 'box', width, text, segment };
}

function createGlue(width: number, stretch: number, shrink: number): KPGlue {
  return { type: 'glue', width, stretch, shrink };
}

function createPenalty(width: number, penalty: number, flagged: boolean): KPPenalty {
  return { type: 'penalty', width, penalty, flagged };
}
