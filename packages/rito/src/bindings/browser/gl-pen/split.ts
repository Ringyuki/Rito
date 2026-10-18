import type { CoreReaderPrimitive, CoreReaderPrimitiveList } from '../core-contracts';
import type { CanvasFontShorthand } from '../canvas-text/types';
import { COMBINING_MARK, MAYBE_COLOR_GLYPH, codePointKind } from './code-points';

type Primitive = CoreReaderPrimitive;
type PathOps = Extract<Primitive, { readonly kind: 'clip-path' }>['path'];
type ReaderColor = Extract<Primitive, { readonly kind: 'fill-rect' }>['color'];
type TextPrimitive = Extract<Primitive, { readonly kind: 'text' | 'ruby' }>;
type DrawingPrimitive = Exclude<
  Primitive,
  {
    readonly kind: 'push-state' | 'pop-state' | 'translate' | 'opacity' | 'transform' | 'clip-path';
  }
>;

/** Whether a character paints in colours of its own in a font. */
export type ColorGlyphTest = (font: CanvasFontShorthand, character: string) => boolean;

interface SplitState {
  /** Only whole-pixel translations apply: no transform, no opacity, no clip but a whole-pixel rect. */
  plain: boolean;
  tx: number;
  ty: number;
}

/**
 * Whether the GPU paints every primitive of a list exactly as the canvas
 * does. Exact today: opaque sRGB fills on whole device pixels; text and
 * ruby runs in an opaque sRGB ink with no shadow, no combining mark and no
 * colour glyph; under whole-pixel translations and rect clips only.
 * `themeOpaque` false (a theme whose ink or paper is translucent) leaves
 * the runs and the page ground, whose colours the theme may replace, to
 * the canvas pen.
 *
 * A list is painted wholly by one pen or the other: on a GPU canvas, how a
 * primitive's edge is rasterized can depend on the primitives drawn after
 * it, so the canvas pen painting only part of a list is not the canvas
 * pen painting all of it.
 */
export function paintsWhollyOnGpu(
  list: CoreReaderPrimitiveList,
  colorGlyph: ColorGlyphTest,
  themeOpaque = true,
): boolean {
  let state: SplitState = { plain: true, tx: 0, ty: 0 };
  const stack: SplitState[] = [];
  return list.commands.every((primitive) => {
    switch (primitive.kind) {
      case 'push-state':
        stack.push(state);
        state = { ...state };
        return true;
      case 'pop-state':
        state = stack.pop() ?? state;
        return true;
      case 'translate':
        state.tx += primitive.dx;
        state.ty += primitive.dy;
        state.plain &&= wholeOffset(state);
        return true;
      case 'opacity':
        if (primitive.value !== 1) state.plain = false;
        return true;
      case 'transform':
        state.plain = false;
        return true;
      case 'clip-path':
        state.plain &&= wholePixelRect(primitive.path, state) !== undefined;
        return true;
      case 'fill-rect':
      case 'fill-path':
      case 'stroke-path':
      case 'shadow':
      case 'draw-image':
      case 'image-fallback':
      case 'text':
      case 'ruby':
        return state.plain && paintsExactly(primitive, state, colorGlyph, themeOpaque);
    }
  });
}

function paintsExactly(
  primitive: DrawingPrimitive,
  state: SplitState,
  colorGlyph: ColorGlyphTest,
  themeOpaque: boolean,
): boolean {
  switch (primitive.kind) {
    case 'fill-rect':
      return (
        opaqueSrgb(primitive.color) &&
        wholeRect(primitive.rect, state) &&
        (themeOpaque || primitive.ground !== 'page')
      );
    case 'text':
    case 'ruby':
      return themeOpaque && runPaintsExactly(primitive, colorGlyph);
    case 'fill-path':
    case 'stroke-path':
    case 'shadow':
    case 'draw-image':
    case 'image-fallback':
      return false;
  }
}

function runPaintsExactly(run: TextPrimitive, colorGlyph: ColorGlyphTest): boolean {
  if (run.clusters.bytes.length === 0 || run.paint.textShadows.length > 0) return false;
  if (!opaqueSrgb(run.paint.color)) return false;
  const text = run.text;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    // Below the combining marks nothing but © and ® needs a look.
    if (unit < 0x300 && unit !== 0xa9 && unit !== 0xae) continue;
    const code = text.codePointAt(index) ?? unit;
    if (code > 0xffff) index += 1;
    const kind = codePointKind(code);
    if (kind === COMBINING_MARK) return false;
    if (kind === MAYBE_COLOR_GLYPH && colorGlyph(run.paint.font, String.fromCodePoint(code))) {
      return false;
    }
  }
  return true;
}

function opaqueSrgb(color: ReaderColor): boolean {
  const { none } = color;
  return (
    color.space === 'srgb' &&
    color.alpha === 1 &&
    !none.component0 &&
    !none.component1 &&
    !none.component2 &&
    !none.alpha
  );
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function wholeOffset(state: SplitState): boolean {
  return Number.isInteger(state.tx) && Number.isInteger(state.ty);
}

/** Whether a rect, moved by the translation in force, has every edge on a device pixel boundary. */
export function wholeRect(rect: Box, state: { readonly tx: number; readonly ty: number }): boolean {
  const left = rect.x + state.tx;
  const top = rect.y + state.ty;
  return (
    Number.isInteger(left) &&
    Number.isInteger(top) &&
    Number.isInteger(left + rect.width) &&
    Number.isInteger(top + rect.height)
  );
}

/** The rect a clip path is, when it is one rect on whole device pixels. */
export function wholePixelRect(
  path: PathOps,
  state: { readonly tx: number; readonly ty: number },
): Box | undefined {
  let rect: Box | undefined;
  for (const op of path) {
    if (op.op === 'close') continue;
    if (op.op !== 'rect' || rect !== undefined) return undefined;
    rect = op;
  }
  return rect !== undefined && wholeRect(rect, state) ? rect : undefined;
}
