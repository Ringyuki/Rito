import type { TextAlignment, TextJustify } from '../../style/core/types';
import type { InlineAtom, LineBox, RubyAnnotation, TextRun } from '../core/types';
import { readRubyTag } from '../line-breaker/greedy/runs';
import { justifyRuns } from './text-justify';

type Run = TextRun | InlineAtom;

const RUBY_FONT_SCALE = 0.5;
const RUBY_GAP = 1;

interface RubyRunGroup {
  readonly tag: string;
  readonly start: TextRun;
  readonly end: TextRun;
  readonly nextIndex: number;
}

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
  let maxBottom = 0;
  let rubyOverhang = 0;
  for (const run of runs) {
    let top: number;
    let bottom: number;

    if (run.type === 'text-run' && run.lineHeightPx !== undefined) {
      // CSS half-leading model: the inline box height is set by lineHeightPx,
      // not the content extent. When lineHeightPx < fontSize, half-leading is
      // negative and the inline box is smaller than the content area. Content
      // extends beyond but doesn't affect line box sizing. run.bounds.y is
      // the CONTENT top (for rendering); the INLINE BOX top is shifted inward
      // by halfLeading.
      const halfLeading = (run.paint.font.sizePx - run.lineHeightPx) / 2;
      top = run.bounds.y + halfLeading;
      bottom = top + run.lineHeightPx;
    } else {
      top = run.bounds.y;
      bottom = top + run.bounds.height;
    }

    if (top < minTop) minTop = top;
    if (bottom > maxBottom) maxBottom = bottom;
    if (run.type === 'text-run' && readRubyTag(run) !== undefined) {
      const overhang = run.paint.font.sizePx * RUBY_FONT_SCALE + RUBY_GAP;
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
  textJustify: TextJustify,
  isLastLine: boolean,
): LineBox {
  if (textAlign === 'center' && runs.length > 0) {
    const offset = (maxWidth - lineWidth) / 2;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'right' && runs.length > 0) {
    const offset = maxWidth - lineWidth;
    runs = runs.map((r) => ({ ...r, bounds: { ...r.bounds, x: r.bounds.x + offset } }));
  } else if (textAlign === 'justify' && !isLastLine && runs.length > 0) {
    runs = justifyRuns(runs, lineWidth, maxWidth, textJustify);
  }

  // Emit standalone RubyAnnotation children for any runs carrying a ruby tag.
  // Contiguous runs sharing the same tag group into a single annotation.
  const finalRuns = extractRubyAnnotations(runs, y);

  return {
    type: 'line-box',
    bounds: { x: 0, y, width: maxWidth, height: lineHeight },
    runs: finalRuns,
  };
}

/** Walk runs in order; whenever a contiguous group of TextRuns carries the
 *  same ruby tag, emit a `RubyAnnotation` node positioned above the group's
 *  base text and insert it between the group and the next run. */
function extractRubyAnnotations(
  runs: readonly Run[],
  lineY: number,
): (TextRun | InlineAtom | RubyAnnotation)[] {
  const out: (TextRun | InlineAtom | RubyAnnotation)[] = [];
  let i = 0;
  while (i < runs.length) {
    const run = runs[i];
    const group = run ? collectRubyGroup(runs, i, run) : undefined;
    if (!group) {
      if (run) out.push(run);
      i++;
      continue;
    }

    pushRubyBaseRuns(out, runs, i, group.nextIndex);
    out.push(createRubyAnnotation(group, lineY));
    i = group.nextIndex;
  }
  return out;
}

function collectRubyGroup(runs: readonly Run[], index: number, run: Run): RubyRunGroup | undefined {
  const tag = run.type === 'text-run' ? readRubyTag(run) : undefined;
  if (run.type !== 'text-run' || tag === undefined) return undefined;

  let groupEnd = run;
  let nextIndex = index + 1;
  while (nextIndex < runs.length) {
    const next = runs[nextIndex];
    if (!next || next.type !== 'text-run' || readRubyTag(next) !== tag) break;
    groupEnd = next;
    nextIndex++;
  }
  return { tag, start: run, end: groupEnd, nextIndex };
}

function pushRubyBaseRuns(
  out: (TextRun | InlineAtom | RubyAnnotation)[],
  runs: readonly Run[],
  start: number,
  end: number,
): void {
  for (let index = start; index < end; index++) {
    const run = runs[index];
    if (run) out.push(run);
  }
}

function createRubyAnnotation(group: RubyRunGroup, lineY: number): RubyAnnotation {
  const rubyFontSize = group.start.paint.font.sizePx * RUBY_FONT_SCALE;
  return {
    type: 'ruby-annotation',
    text: group.tag,
    bounds: {
      x: group.start.bounds.x,
      y: lineY + group.start.bounds.y - rubyFontSize - RUBY_GAP,
      width: group.end.bounds.x + group.end.bounds.width - group.start.bounds.x,
      height: rubyFontSize,
    },
    paint: {
      color: group.start.paint.color,
      font: {
        style: group.start.paint.font.style,
        weight: group.start.paint.font.weight,
        sizePx: rubyFontSize,
        family: group.start.paint.font.family,
      },
    },
  };
}
