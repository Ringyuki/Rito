import type {
  RitoReaderColorV1,
  RitoReaderRunPaintV1,
  RitoReaderTextRunV1,
} from '@ritojs/core-wasm/decoder';

import type { CoreFrameCommand } from './core-contracts';
import { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';

type CoreText = Extract<CoreFrameCommand, { readonly kind: 'paintText' }>;
type CoreRuby = Extract<CoreFrameCommand, { readonly kind: 'paintRuby' }>;
type CoreRunPaint = CoreText['paint'];

/** The text and ruby bodies the format-2 primitives carry; either converts
 * to the text painter's shape. */
export type ReaderTextBodyV1 = Pick<
  RitoReaderTextRunV1,
  'text' | 'rect' | 'paint' | 'lineHeightPx' | 'href' | 'sourceText' | 'vertical' | 'clusters'
>;
export type ReaderRubyBodyV1 = Pick<
  RitoReaderTextRunV1,
  'text' | 'rect' | 'paint' | 'rubyAlign' | 'vertical'
>;

export function convertReaderTextV1(command: ReaderTextBodyV1): CoreText {
  return {
    kind: 'paintText',
    text: command.text,
    rect: command.rect,
    paint: convertRunPaint(command.paint),
    ...(command.lineHeightPx === undefined ? {} : { lineHeightPx: command.lineHeightPx }),
    ...(command.href === undefined ? {} : { href: command.href }),
    ...(command.sourceText === undefined ? {} : { sourceText: command.sourceText }),
    ...(command.vertical ? { vertical: true } : {}),
    ...(command.clusters.length > 0 ? { clusters: command.clusters } : {}),
  };
}

export function convertReaderRubyV1(command: ReaderRubyBodyV1): CoreRuby {
  return {
    kind: 'paintRuby',
    text: command.text,
    rect: command.rect,
    paint: convertRunPaint(command.paint),
    ...(command.rubyAlign === 'start' ||
    command.rubyAlign === 'center' ||
    command.rubyAlign === 'space-between'
      ? { rubyAlign: command.rubyAlign }
      : {}),
    ...(command.vertical ? { vertical: true } : {}),
  };
}

/** The run's glyph paint. Its inline box and decoration line arrive as
 * their own primitives, so none of the box fields is ever set here. */
function convertRunPaint(paint: RitoReaderRunPaintV1): CoreRunPaint {
  return {
    font: paint.font,
    color: toCanvasColorV1(paint.color),
    ...(paint.wordSpacingPx === undefined ? {} : { wordSpacingPx: paint.wordSpacingPx }),
    ...(paint.letterSpacingPx === undefined ? {} : { letterSpacingPx: paint.letterSpacingPx }),
    textShadow: paint.textShadows.map((shadow) => ({
      ...shadow,
      color: toCanvasColorV1(shadow.color),
    })),
  };
}

/** The CSS `color()` space names the canvas parses; the typed wire also
 * tags spaces with no CSS spelling, which fail closed here. */
const PREDEFINED_COLOR_SPACES: Partial<Record<RitoReaderColorV1['space'], string>> = {
  srgb: 'srgb',
  'srgb-linear': 'srgb-linear',
  'display-p3': 'display-p3',
  'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb',
  rec2020: 'rec2020',
  'xyz-d50': 'xyz-d50',
  'xyz-d65': 'xyz-d65',
};

export function toCanvasColorV1(color: RitoReaderColorV1): string {
  const components = [color.component0, color.component1, color.component2, color.alpha];
  if (!components.every(Number.isFinite)) return unsupported('color-component:non-finite');
  const { none } = color;
  const hasNone = none.component0 || none.component1 || none.component2 || none.alpha;
  if (color.space === 'srgb' && !hasNone) {
    const red = color.component0 * 255;
    const green = color.component1 * 255;
    const blue = color.component2 * 255;
    return `rgba(${String(red)}, ${String(green)}, ${String(blue)}, ${String(color.alpha)})`;
  }
  const space = PREDEFINED_COLOR_SPACES[color.space];
  if (space === undefined) return unsupported(`color-space:${color.space}`);
  const channel = (value: number, missing: boolean): string => (missing ? 'none' : String(value));
  return `color(${space} ${channel(color.component0, none.component0)} ${channel(
    color.component1,
    none.component1,
  )} ${channel(color.component2, none.component2)} / ${channel(color.alpha, none.alpha)})`;
}

function unsupported(feature: string): never {
  throw new BrowserReaderCanvasUnsupportedErrorV1(feature);
}
