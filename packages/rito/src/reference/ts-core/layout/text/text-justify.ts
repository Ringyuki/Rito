import type { InlineAtom, TextRun } from '../core/types';
import type { TextJustify } from '../../style/core/types';
import { containsEastAsianBreakChar, splitTextUnits } from '../line-breaker/break-classifier';

type Run = TextRun | InlineAtom;

interface InterCharacterGapPlan {
  readonly perRun: readonly number[];
  readonly boundaryBefore: readonly boolean[];
  readonly totalGaps: number;
}

export function justifyRuns(
  runs: Run[],
  lineWidth: number,
  maxWidth: number,
  textJustify: TextJustify,
): Run[] {
  const extra = maxWidth - lineWidth;
  if (extra <= 0 || textJustify === 'none') return runs;

  const spaceGaps = collectSpaceGaps(runs);
  if (spaceGaps.length > 0 && textJustify !== 'inter-character') {
    return distributeSpaceGaps(runs, spaceGaps, extra / spaceGaps.length);
  }

  if (textJustify === 'inter-word') return runs;
  const interCharacter = collectInterCharacterGaps(runs);
  if (!interCharacter || interCharacter.totalGaps <= 0) return runs;
  return distributeInterCharacterGaps(runs, interCharacter, extra / interCharacter.totalGaps);
}

function collectSpaceGaps(runs: readonly Run[]): number[] {
  const gaps: number[] = [];
  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (!run || run.type !== 'text-run') continue;
    for (let charIndex = 0; charIndex < run.text.length; charIndex++) {
      if (run.text[charIndex] === ' ') gaps.push(index);
    }
  }
  return gaps;
}

function distributeSpaceGaps(
  runs: readonly Run[],
  gaps: readonly number[],
  gapSize: number,
): Run[] {
  const result: Run[] = [];
  let xOffset = 0;
  let gapIndex = 0;

  for (let runIndex = 0; runIndex < runs.length; runIndex++) {
    const run = runs[runIndex];
    if (!run) continue;

    while (gapIndex < gaps.length) {
      const gapRunIndex = gaps[gapIndex];
      if (gapRunIndex === undefined || gapRunIndex >= runIndex) break;
      xOffset += gapSize;
      gapIndex++;
    }

    const intraGaps = run.type === 'text-run' ? countSpaces(run.text) : 0;
    result.push({
      ...run,
      ...(run.type === 'text-run'
        ? {
            paint: {
              ...run.paint,
              wordSpacingPx: (run.paint.wordSpacingPx ?? 0) + gapSize,
            },
          }
        : {}),
      bounds: {
        ...run.bounds,
        x: run.bounds.x + xOffset,
        width: run.bounds.width + intraGaps * gapSize,
      },
    });
    xOffset += intraGaps * gapSize;
    gapIndex += intraGaps;
  }

  return result;
}

function collectInterCharacterGaps(runs: readonly Run[]): InterCharacterGapPlan | undefined {
  if (runs.some((run) => run.type === 'inline-atom')) return undefined;

  const perRun = Array.from({ length: runs.length }, () => 0);
  const boundaryBefore = Array.from({ length: runs.length }, () => false);
  let totalGaps = 0;
  let previousTextRun: TextRun | undefined;

  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (!run || run.type !== 'text-run') {
      previousTextRun = undefined;
      continue;
    }

    const intraGaps = countInterCharacterGaps(run.text);
    perRun[index] = intraGaps;
    totalGaps += intraGaps;

    if (previousTextRun && hasEastAsianText(run.text)) {
      boundaryBefore[index] = true;
      totalGaps++;
    }

    previousTextRun = hasEastAsianText(run.text) ? run : undefined;
  }

  return totalGaps > 0 ? { perRun, boundaryBefore, totalGaps } : undefined;
}

function distributeInterCharacterGaps(
  runs: readonly Run[],
  plan: InterCharacterGapPlan,
  gapSize: number,
): Run[] {
  const result: Run[] = [];
  let xOffset = 0;

  for (let index = 0; index < runs.length; index++) {
    const run = runs[index];
    if (!run) continue;

    if (plan.boundaryBefore[index]) xOffset += gapSize;

    if (run.type !== 'text-run') {
      result.push({
        ...run,
        bounds: { ...run.bounds, x: run.bounds.x + xOffset },
      });
      continue;
    }

    const intraGaps = plan.perRun[index] ?? 0;
    result.push({
      ...run,
      ...(intraGaps > 0
        ? {
            paint: {
              ...run.paint,
              letterSpacingPx: (run.paint.letterSpacingPx ?? 0) + gapSize,
            },
          }
        : {}),
      bounds: {
        ...run.bounds,
        x: run.bounds.x + xOffset,
        width: run.bounds.width + intraGaps * gapSize,
      },
    });
    xOffset += intraGaps * gapSize;
  }

  return result;
}

function countSpaces(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === ' ') count++;
  }
  return count;
}

function countInterCharacterGaps(text: string): number {
  if (!hasEastAsianText(text)) return 0;
  const glyphCount = splitTextUnits(text).length;
  return glyphCount > 1 ? glyphCount - 1 : 0;
}

function hasEastAsianText(text: string): boolean {
  return containsEastAsianBreakChar(text);
}
