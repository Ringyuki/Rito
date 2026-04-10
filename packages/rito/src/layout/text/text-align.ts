import type { TextAlignment } from '../../style/core/types';
import type { InlineAtom, LineBox, TextRun } from '../core/types';

type Run = TextRun | InlineAtom;

const RUBY_FONT_SCALE = 0.5;
const RUBY_GAP = 1;

/**
 * Compute effective line metrics from the actual bounding box of all runs.
 * When baseline offsets push a run above y=0 (negative offset), the line box
 * must expand and all runs shift down so nothing overflows the top.
 *
 * Ruby annotations add extra space above the line box without shifting the
 * baseline — all runs stay at their original y positions, and the line box
 * grows upward to accommodate the annotation.
 *
 * Returns `height` (the line box height) and `yShift` (the amount to add to
 * every run's y to eliminate negative overflow).
 */
export function computeEffectiveLineMetrics(
  runs: readonly Run[],
  baseLineHeight: number,
): { height: number; yShift: number } {
  let minTop = 0;
  let maxBottom = baseLineHeight;
  let rubyOverhang = 0;
  for (const run of runs) {
    const top = run.bounds.y;
    const bottom = top + run.bounds.height;
    if (top < minTop) minTop = top;
    if (bottom > maxBottom) maxBottom = bottom;
    // Track ruby overhang separately — it adds space above without shifting baseline
    if (run.type === 'text-run' && run.rubyAnnotation) {
      const overhang = run.style.fontSize * RUBY_FONT_SCALE + RUBY_GAP;
      if (overhang > rubyOverhang) rubyOverhang = overhang;
    }
  }
  const contentHeight = Math.max(baseLineHeight, maxBottom - minTop);
  const height = contentHeight + rubyOverhang;
  const yShift = (minTop < 0 ? -minTop : 0) + rubyOverhang;
  return { height, yShift };
}

/** Shift all runs' y positions by a fixed amount. */
export function shiftRunsY(runs: Run[], dy: number): void {
  if (dy === 0) return;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run) runs[i] = { ...run, bounds: { ...run.bounds, y: run.bounds.y + dy } };
  }
}

export function applyAlign(
  runs: Run[],
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

function justifyRuns(runs: Run[], lineWidth: number, maxWidth: number): Run[] {
  const gaps = collectGaps(runs);
  if (gaps.length === 0) return runs;
  return distributeGaps(runs, gaps, (maxWidth - lineWidth) / gaps.length);
}

function collectGaps(runs: readonly Run[]): number[] {
  const gaps: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run || run.type !== 'text-run') continue;
    for (let j = 0; j < run.text.length; j++) {
      if (run.text[j] === ' ') gaps.push(i);
    }
  }
  return gaps;
}

function distributeGaps(runs: readonly Run[], gaps: readonly number[], gapSize: number): Run[] {
  const result: Run[] = [];
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
    if (run.type === 'text-run') {
      for (let j = 0; j < run.text.length; j++) {
        if (run.text[j] === ' ') intraGaps++;
      }
    }

    result.push({
      ...run,
      bounds: {
        ...run.bounds,
        x: run.bounds.x + xOffset,
        width: run.bounds.width + intraGaps * gapSize,
      },
    });
    xOffset += intraGaps * gapSize;
    gapIdx += intraGaps;
  }
  return result;
}
