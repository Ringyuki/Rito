import { buildFontString } from '../canvas-text/font-string';
import type { CanvasTextColorOverride } from '../canvas-text/types';
import type { CoreReaderPrimitive } from '../core-contracts';
import { toCanvasColor } from '../reader-session-canvas-converter';
import { declaredGroundFor, themedInk, type DeclaredGrounds } from '../theme/declared-grounds';
import type { GlyphAtlas, GlyphTable } from './atlas';
import { canvasChannels } from './color-probe';

type TextPrimitive = Extract<CoreReaderPrimitive, { readonly kind: 'text' | 'ruby' }>;
type RunPaint = TextPrimitive['paint'];

interface Resolved {
  readonly paint: RunPaint;
  readonly font: string;
  readonly color: string;
  readonly ink: string;
  readonly table: GlyphTable;
}

/**
 * The glyph table each run of a list draws from: its font and its ink as
 * the theme leaves it, read against the ground it was typeset on, as the
 * canvas pen does. Runs come in long stretches of one paint, so a run
 * painted like the one before it takes that one's table.
 */
export class RunInks {
  private last: Resolved | undefined;

  constructor(
    private readonly atlas: GlyphAtlas,
    private readonly ratio: number,
    private readonly override: CanvasTextColorOverride | undefined,
    private readonly grounds: DeclaredGrounds,
  ) {}

  tableFor(run: TextPrimitive): GlyphTable {
    const paint = run.paint;
    const last = this.last;
    const same = last !== undefined && samePaint(last.paint, paint);
    const font = same ? last.font : buildFontString(paint.font);
    const color = same ? last.color : toCanvasColor(paint.color);
    const ink =
      this.override === undefined
        ? color
        : themedInk(
            color,
            this.override,
            declaredGroundFor(this.deviceRect(run.rect), this.grounds),
          );
    if (same && ink === last.ink && this.atlas.holds(last.table)) return last.table;
    const table = this.atlas.table(this.ratio, font, ink, canvasChannels(ink));
    this.last = { paint, font, color, ink, table };
    return table;
  }

  private deviceRect(rect: TextPrimitive['rect']): TextPrimitive['rect'] {
    const ratio = this.ratio;
    return ratio === 1
      ? rect
      : {
          x: rect.x * ratio,
          y: rect.y * ratio,
          width: rect.width * ratio,
          height: rect.height * ratio,
        };
  }
}

function samePaint(a: RunPaint, b: RunPaint): boolean {
  if (a === b) return true;
  const { font: fa, color: ca } = a;
  const { font: fb, color: cb } = b;
  return (
    fa.family === fb.family &&
    fa.sizePx === fb.sizePx &&
    fa.weight === fb.weight &&
    fa.style === fb.style &&
    ca.space === cb.space &&
    ca.component0 === cb.component0 &&
    ca.component1 === cb.component1 &&
    ca.component2 === cb.component2 &&
    ca.alpha === cb.alpha
  );
}
