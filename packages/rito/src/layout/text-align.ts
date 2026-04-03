import type { TextAlignment } from '../style/types';
import type { LineBox, TextRun } from './types';

export function applyAlign(
  runs: TextRun[],
  lineWidth: number,
  y: number,
  lineHeight: number,
  maxWidth: number,
  textAlign: TextAlignment,
  isLastLine: boolean,
): LineBox {
  if (textAlign === 'center' && runs.length > 0) {
    const offset = (maxWidth - lineWidth) / 2;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'right' && runs.length > 0) {
    const offset = maxWidth - lineWidth;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'justify' && !isLastLine && runs.length > 0) {
    runs = justifyRuns(runs, lineWidth, maxWidth);
  }

  return {
    type: 'line-box',
    bounds: { x: 0, y, width: maxWidth, height: lineHeight },
    runs,
  };
}

function justifyRuns(runs: TextRun[], lineWidth: number, maxWidth: number): TextRun[] {
  const gaps = collectGaps(runs);
  if (gaps.length === 0) return runs;
  return distributeGaps(runs, gaps, (maxWidth - lineWidth) / gaps.length);
}

function collectGaps(runs: readonly TextRun[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    for (let j = 0; j < run.text.length; j++) {
      if (run.text[j] === ' ') gaps.push(i);
    }
  }
  return gaps;
}

function distributeGaps(runs: readonly TextRun[], gaps: readonly number[], gapSize: number): TextRun[] {
  const result: TextRun[] = [];
  let xOffset = 0;
  let gapIdx = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;

    while (gapIdx < gaps.length && (gaps[gapIdx] ?? Infinity) < i) {
      xOffset += gapSize;
      gapIdx++;
    }

    let intraGaps = 0;
    for (let j = 0; j < run.text.length; j++) {
      if (run.text[j] === ' ') intraGaps++;
    }

    result.push({
      ...run,
      bounds: { ...run.bounds, x: run.bounds.x + xOffset, width: run.bounds.width + intraGaps * gapSize },
    });
    xOffset += intraGaps * gapSize;
    gapIdx += intraGaps;
  }
  return result;
}
