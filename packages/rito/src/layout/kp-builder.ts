/**
 * Converts styled segments into the box/glue/penalty item list
 * used by the Knuth-Plass line-breaking algorithm.
 */

import { findHyphenationPoints } from './hyphenation';
import type { KPBox, KPGlue, KPItem, KPPenalty } from './kp-types';
import type { StyledSegment } from './styled-segment';
import type { TextMeasurer } from './text-measurer';

/** Penalty value for hyphenation break points. */
const HYPHEN_PENALTY = 50;

/** Forced break penalty (must break here). */
const FORCED_BREAK_PENALTY = -Infinity;

/**
 * Build a KPItem list from styled segments.
 *
 * The conversion:
 * - Each word becomes a Box with measured width
 * - Each space between words becomes a Glue with stretch/shrink
 * - Hyphenation points within words become Penalty items
 * - A forced-break penalty is appended at the end
 * - Newline characters produce forced-break penalties
 */
export function buildKPItems(segments: readonly StyledSegment[], measurer: TextMeasurer): KPItem[] {
  const items: KPItem[] = [];

  for (const segment of segments) {
    const { text, style } = segment;
    if (text.length === 0) continue;

    const spaceWidth = measurer.measureText(' ', style).width;
    // Generous stretch/shrink for screen rendering (TeX uses ~0.5/0.33).
    // Higher stretch allows the solver to find feasible breaks more often.
    const stretchFactor = spaceWidth * 1.5;
    const shrinkFactor = spaceWidth * 0.5;

    // Split text into tokens (words and whitespace/newlines)
    const tokens = tokenize(text);

    for (const token of tokens) {
      if (token === '\n') {
        // Forced line break: add glue to fill remaining space, then forced penalty
        items.push(createGlue(0, 1e6, 0));
        items.push(createPenalty(0, FORCED_BREAK_PENALTY, false));
      } else if (token === ' ' || token === '\t') {
        items.push(createGlue(spaceWidth, stretchFactor, shrinkFactor));
      } else {
        // Word token — possibly with hyphenation
        addWordItems(items, token, segment, measurer);
      }
    }
  }

  // Finishing sequence: glue to fill + forced break
  if (items.length > 0) {
    items.push(createGlue(0, 1e6, 0));
    items.push(createPenalty(0, FORCED_BREAK_PENALTY, false));
  }

  return items;
}

/**
 * Tokenize text into words, spaces, and newlines.
 * Consecutive spaces are collapsed into single space tokens.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '\n') {
      tokens.push('\n');
      i++;
    } else if (ch === ' ' || ch === '\t') {
      tokens.push(' ');
      // Skip consecutive whitespace (collapse)
      while (i < text.length && (text[i] === ' ' || text[i] === '\t')) {
        i++;
      }
    } else {
      // Word character — accumulate until whitespace
      const start = i;
      while (i < text.length && text[i] !== ' ' && text[i] !== '\t' && text[i] !== '\n') {
        i++;
      }
      tokens.push(text.slice(start, i));
    }
  }

  return tokens;
}

/**
 * Add items for a single word, inserting penalty nodes at hyphenation points.
 */
function addWordItems(
  items: KPItem[],
  word: string,
  segment: StyledSegment,
  measurer: TextMeasurer,
): void {
  const { style } = segment;
  const hyphenPoints = findHyphenationPoints(word);

  if (hyphenPoints.length === 0) {
    // No hyphenation — single box
    const width = measurer.measureText(word, style).width;
    items.push(createBox(width, word, segment));
    return;
  }

  // Insert box + penalty pairs at each hyphenation point
  const hyphenWidth = measurer.measureText('-', style).width;
  let prevPos = 0;

  for (const point of hyphenPoints) {
    if (point <= prevPos || point >= word.length) continue;

    const fragment = word.slice(prevPos, point);
    const fragWidth = measurer.measureText(fragment, style).width;
    items.push(createBox(fragWidth, fragment, segment));
    items.push(createPenalty(hyphenWidth, HYPHEN_PENALTY, true));
    prevPos = point;
  }

  // Remaining part after last hyphenation point
  if (prevPos < word.length) {
    const fragment = word.slice(prevPos);
    const fragWidth = measurer.measureText(fragment, style).width;
    items.push(createBox(fragWidth, fragment, segment));
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
