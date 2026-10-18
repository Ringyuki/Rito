import { buildFontString } from '../canvas-text/font-string';
import type { CanvasFontShorthand } from '../canvas-text/types';

type ProbeContext = OffscreenCanvasRenderingContext2D;

const channels = new Map<string, readonly [number, number, number, number]>();
const colorGlyphs = new Map<string, boolean>();
let pixel: ProbeContext | undefined;
let glyph: ProbeContext | undefined;

function probe(width: number, height: number): ProbeContext {
  const context = new OffscreenCanvas(width, height).getContext('2d', {
    willReadFrequently: true,
  });
  if (!context) throw new Error('A 2D context to read colours back is unavailable');
  return context;
}

/** The 8-bit RGBA a canvas paints a CSS colour as. */
export function canvasChannels(color: string): readonly [number, number, number, number] {
  const known = channels.get(color);
  if (known) return known;
  pixel ??= probe(1, 1);
  pixel.clearRect(0, 0, 1, 1);
  pixel.fillStyle = color;
  pixel.fillRect(0, 0, 1, 1);
  const data = pixel.getImageData(0, 0, 1, 1).data;
  const value = [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0] as const;
  channels.set(color, value);
  return value;
}

const PROBE_SIZE = 32;

/**
 * Whether `character` paints in colours of its own in `font` (a colour
 * emoji, say) rather than in the ink: drawn in black, any channel that is
 * not black says so.
 */
export function paintsInColor(font: CanvasFontShorthand, character: string): boolean {
  const key = `${font.family}|${String(font.weight)}|${font.style}|${character}`;
  const known = colorGlyphs.get(key);
  if (known !== undefined) return known;
  glyph ??= probe(PROBE_SIZE * 2, PROBE_SIZE * 2);
  glyph.clearRect(0, 0, PROBE_SIZE * 2, PROBE_SIZE * 2);
  glyph.font = buildFontString({ ...font, sizePx: PROBE_SIZE });
  glyph.fillStyle = '#000';
  glyph.textBaseline = 'alphabetic';
  glyph.fillText(character, PROBE_SIZE / 4, PROBE_SIZE * 1.4);
  const data = glyph.getImageData(0, 0, PROBE_SIZE * 2, PROBE_SIZE * 2).data;
  let colored = false;
  for (let index = 0; index < data.length && !colored; index += 4) {
    colored = (data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0) > 0;
  }
  colorGlyphs.set(key, colored);
  return colored;
}
