import type {
  RitoReaderColor,
  RitoReaderRunPaint,
  RitoReaderTextRun,
} from '@ritojs/core-wasm/decoder';

import type { CoreFrameCommand } from './core-contracts';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';

type CoreText = Extract<CoreFrameCommand, { readonly kind: 'paintText' }>;
type CoreRuby = Extract<CoreFrameCommand, { readonly kind: 'paintRuby' }>;
type CoreRunPaint = CoreText['paint'];

/** The text and ruby bodies the format-2 primitives carry; either converts
 * to the text painter's shape. */
export type ReaderTextBody = Pick<
  RitoReaderTextRun,
  'text' | 'rect' | 'paint' | 'lineHeightPx' | 'href' | 'sourceText' | 'clusters'
>;
export type ReaderRubyBody = Pick<RitoReaderTextRun, 'text' | 'rect' | 'paint' | 'clusters'>;

export function convertReaderText(command: ReaderTextBody): CoreText {
  return {
    kind: 'paintText',
    text: command.text,
    rect: command.rect,
    paint: convertRunPaint(command.paint),
    ...(command.lineHeightPx === undefined ? {} : { lineHeightPx: command.lineHeightPx }),
    ...(command.href === undefined ? {} : { href: command.href }),
    ...(command.sourceText === undefined ? {} : { sourceText: command.sourceText }),
    ...(command.clusters.length > 0 ? { clusters: command.clusters } : {}),
  };
}

export function convertReaderRuby(command: ReaderRubyBody): CoreRuby {
  return {
    kind: 'paintRuby',
    text: command.text,
    rect: command.rect,
    paint: convertRunPaint(command.paint),
    ...(command.clusters.length > 0 ? { clusters: command.clusters } : {}),
  };
}

/** The run's glyph paint. Its inline box and decoration line arrive as
 * their own primitives, so none of the box fields is ever set here. */
function convertRunPaint(paint: RitoReaderRunPaint): CoreRunPaint {
  return {
    font: paint.font,
    color: toCanvasColor(paint.color),
    textShadow: paint.textShadows.map((shadow) => ({
      ...shadow,
      color: toCanvasColor(shadow.color),
    })),
  };
}

/** The CSS `color()` space names the canvas parses; the typed wire also
 * tags spaces with no CSS spelling, which fail closed here. */
const PREDEFINED_COLOR_SPACES: Partial<Record<RitoReaderColor['space'], string>> = {
  srgb: 'srgb',
  'srgb-linear': 'srgb-linear',
  'display-p3': 'display-p3',
  'a98-rgb': 'a98-rgb',
  'prophoto-rgb': 'prophoto-rgb',
  rec2020: 'rec2020',
  'xyz-d50': 'xyz-d50',
  'xyz-d65': 'xyz-d65',
};

export function toCanvasColor(color: RitoReaderColor): string {
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
  throw new BrowserReaderCanvasUnsupportedError(feature);
}
