import { measurePaintFromStyle } from '../../../style/css/font-shorthand';
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
    addSegmentItems(items, segment, measurer);
  }
  if (items.length > 0) addForcedBreak(items);
  return items;
}

function addSegmentItems(items: KPItem[], segment: InlineSegment, measurer: TextMeasurer): void {
  if (isInlineAtom(segment)) {
    addAtomItem(items, segment);
    return;
  }
  if (segment.text.length > 0) addTextSegmentItems(items, segment, measurer);
}

function addAtomItem(items: KPItem[], segment: InlineSegment): void {
  if (!isInlineAtom(segment)) return;
  const dummySeg: StyledSegment = { text: '\uFFFC', style: segment.style };
  items.push({
    type: 'box',
    width: segment.width,
    text: '\uFFFC',
    segment: dummySeg,
    atom: segment,
  });
}

function addTextSegmentItems(
  items: KPItem[],
  segment: StyledSegment,
  measurer: TextMeasurer,
): void {
  addInlineStartInset(items, segment);
  const paint = measurePaintFromStyle(segment.style);
  const spaceWidth = measurer.measureText(' ', paint).width;
  for (const token of tokenize(segment.text)) {
    addTokenItems(items, token, segment, measurer, spaceWidth);
  }
  addInlineEndInset(items, segment);
}

function addTokenItems(
  items: KPItem[],
  token: string,
  segment: StyledSegment,
  measurer: TextMeasurer,
  spaceWidth: number,
): void {
  if (token === '\n') {
    addForcedBreak(items);
  } else if (token === ' ' || token === '\t') {
    items.push(createGlue(spaceWidth, spaceWidth * 1.5, spaceWidth * 0.5));
  } else {
    addWordItems(items, token, segment, measurer);
  }
}

function addInlineStartInset(items: KPItem[], segment: StyledSegment): void {
  if (!segment.borderStart) return;
  const inset = segment.style.borderLeft.width + segment.style.paddingLeft;
  if (inset > 0) items.push(createBox(inset, '', segment));
}

function addInlineEndInset(items: KPItem[], segment: StyledSegment): void {
  if (!segment.borderEnd) return;
  const inset = segment.style.paddingRight + segment.style.borderRight.width;
  if (inset > 0) items.push(createBox(inset, '', segment));
}

function addForcedBreak(items: KPItem[]): void {
  items.push(createGlue(0, 1e6, 0));
  items.push(createPenalty(0, FORCED_BREAK_PENALTY, false));
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
  const paint = measurePaintFromStyle(style);
  const hyphenPoints = findHyphenationPoints(word);

  if (hyphenPoints.length === 0) {
    items.push(createBox(measurer.measureText(word, paint).width, word, segment));
    return;
  }

  const hyphenWidth = measurer.measureText('-', paint).width;
  let prevPos = 0;

  for (const point of hyphenPoints) {
    if (point <= prevPos || point >= word.length) continue;

    const fragment = word.slice(prevPos, point);
    items.push(createBox(measurer.measureText(fragment, paint).width, fragment, segment));
    items.push(createPenalty(hyphenWidth, HYPHEN_PENALTY, true));
    prevPos = point;
  }

  if (prevPos < word.length) {
    const fragment = word.slice(prevPos);
    items.push(createBox(measurer.measureText(fragment, paint).width, fragment, segment));
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
