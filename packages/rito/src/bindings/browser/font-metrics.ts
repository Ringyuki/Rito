import type { CanvasRenderingTarget } from './rendering';

export type GlyphAdvances = Readonly<Record<string, number>>;
export type GlyphPairAdjustments = Readonly<Record<string, number>>;

export interface HostFontFaceMetrics {
  readonly advances: GlyphAdvances;
  readonly pairAdjustments: GlyphPairAdjustments;
}

export interface HostFontMetrics {
  genericSerif: HostFontFaceMetrics | undefined;
  readonly fontFamilies: Record<string, HostFontFaceMetrics>;
}

export interface HostFontMetricConfig {
  readonly genericSerifAdvances?: GlyphAdvances | undefined;
  readonly genericSerifPairAdjustments?: GlyphPairAdjustments | undefined;
  readonly fontFamilyAdvances?: Readonly<Record<string, GlyphAdvances>> | undefined;
  readonly fontFamilyPairAdjustments?: Readonly<Record<string, GlyphPairAdjustments>> | undefined;
}

const PROBE_FONT_SIZE_PX = 16;
const PRINTABLE_ASCII = Array.from({ length: 95 }, (_, index) =>
  String.fromCodePoint(0x20 + index),
);
const COMMON_FALLBACK_SYMBOLS = [
  '\u{00d7}',
  '\u{00b7}',
  '\u{2013}',
  '\u{2014}',
  '\u{2018}',
  '\u{2019}',
  '\u{201c}',
  '\u{201d}',
  '\u{2022}',
  '\u{2026}',
  '\u{2500}',
] as const;
const HOST_METRIC_PROBE_CHARACTERS = uniqueCharacters(
  [
    ...PRINTABLE_ASCII,
    ...COMMON_FALLBACK_SYMBOLS,
    '\u{3000}',
    '\u{3001}',
    '\u{3002}',
    '\u{3008}',
    '\u{3009}',
    '\u{300a}',
    '\u{300b}',
    '\u{300c}',
    '\u{300d}',
    '\u{300e}',
    '\u{300f}',
    '\u{3010}',
    '\u{3011}',
    '\u{3014}',
    '\u{3015}',
    '\u{ff01}',
    '\u{ff08}',
    '\u{ff09}',
    '\u{ff0c}',
    '\u{ff0e}',
    '\u{ff1a}',
    '\u{ff1b}',
    '\u{ff1f}',
    '\u{ff3b}',
    '\u{ff3d}',
    '\u{ff5b}',
    '\u{ff5d}',
  ].join(''),
);
const PAIR_ADJUSTMENT_EPSILON_EM = 1e-9;
const GENERIC_SERIF_METRIC_CACHE = new WeakMap<object, HostFontFaceMetrics>();

export function measureHostFontMetrics(context: CanvasRenderingTarget): HostFontMetrics {
  const metrics = createHostFontMetrics();
  ensureHostGenericSerifMetrics(metrics, context);
  return metrics;
}

export function createHostFontMetrics(): HostFontMetrics {
  return { genericSerif: undefined, fontFamilies: emptyFontFamilyMetrics() };
}

export function ensureHostGenericSerifMetrics(
  metrics: HostFontMetrics,
  context: CanvasRenderingTarget,
): boolean {
  if (metrics.genericSerif) return false;
  metrics.genericSerif = measureCachedGenericSerifMetrics(context);
  return true;
}

function measureCachedGenericSerifMetrics(context: CanvasRenderingTarget): HostFontFaceMetrics {
  const cacheKey = nativeContextPrototype(context);
  if (!cacheKey) return measureFontMetrics(context, 'serif');
  const cached = GENERIC_SERIF_METRIC_CACHE.get(cacheKey);
  if (cached) return cached;
  const measured = measureFontMetrics(context, 'serif');
  GENERIC_SERIF_METRIC_CACHE.set(cacheKey, measured);
  return measured;
}

function nativeContextPrototype(context: CanvasRenderingTarget): object | undefined {
  const prototype = Object.getPrototypeOf(context) as object | null;
  return prototype && prototype !== Object.prototype ? prototype : undefined;
}

export function ensureHostFontFamilyMetrics(
  metrics: HostFontMetrics,
  context: CanvasRenderingTarget,
  families: readonly string[],
): boolean {
  const additions = measureFontFamilyMetrics(context, families, metrics);
  if (Object.keys(additions).length === 0) return false;
  Object.assign(metrics.fontFamilies, additions);
  return true;
}

export function hostFontMetricConfig(metrics: HostFontMetrics): HostFontMetricConfig {
  const families = Object.entries(metrics.fontFamilies);
  const generic = metrics.genericSerif;
  const genericPairAdjustments = { ...generic?.pairAdjustments };
  return {
    ...(generic ? { genericSerifAdvances: { ...generic.advances } } : {}),
    ...(generic && Object.keys(genericPairAdjustments).length > 0
      ? { genericSerifPairAdjustments: genericPairAdjustments }
      : {}),
    ...(families.length > 0
      ? {
          fontFamilyAdvances: Object.fromEntries(
            families.map(([family, value]) => [family, { ...value.advances }]),
          ),
          fontFamilyPairAdjustments: Object.fromEntries(
            families.map(([family, value]) => [family, { ...value.pairAdjustments }]),
          ),
        }
      : {}),
  };
}

export function measureGenericSerifAdvances(context: CanvasRenderingTarget): GlyphAdvances {
  return measureGenericSerifMetrics(context).advances;
}

export function measureGenericSerifMetrics(context: CanvasRenderingTarget): HostFontFaceMetrics {
  return measureFontMetrics(context, 'serif');
}

export function measureFontFamilyMetrics(
  context: CanvasRenderingTarget,
  families: readonly string[],
  existing?: HostFontMetrics,
): Record<string, HostFontFaceMetrics> {
  const result = emptyFontFamilyMetrics();
  for (const family of families) {
    const cssFamily = family.trim();
    const key = normalizeFontFamilyKey(cssFamily);
    if (
      key.length === 0 ||
      Object.hasOwn(result, key) ||
      (existing !== undefined && Object.hasOwn(existing.fontFamilies, key))
    ) {
      continue;
    }
    result[key] = measureFontMetrics(context, JSON.stringify(cssFamily));
  }
  return result;
}

function measureFontMetrics(
  context: CanvasRenderingTarget,
  fontFamily: string,
): HostFontFaceMetrics {
  const advances: Record<string, number> = {};
  const pairAdjustments: Record<string, number> = {};
  context.save();
  try {
    context.font = `${String(PROBE_FONT_SIZE_PX)}px ${fontFamily}`;
    context.wordSpacing = '0px';
    context.letterSpacing = '0px';
    for (const character of HOST_METRIC_PROBE_CHARACTERS) {
      const advance = context.measureText(character).width / PROBE_FONT_SIZE_PX;
      if (Number.isFinite(advance) && advance > 0) advances[character] = advance;
    }
    for (const first of HOST_METRIC_PROBE_CHARACTERS) {
      const firstAdvance = advances[first];
      if (firstAdvance === undefined) continue;
      for (const second of HOST_METRIC_PROBE_CHARACTERS) {
        const secondAdvance = advances[second];
        if (secondAdvance === undefined) continue;
        const pair = `${first}${second}`;
        const pairAdvance = context.measureText(pair).width / PROBE_FONT_SIZE_PX;
        if (!Number.isFinite(pairAdvance) || pairAdvance <= 0) continue;
        const adjustment = pairAdvance - firstAdvance - secondAdvance;
        if (Math.abs(adjustment) > PAIR_ADJUSTMENT_EPSILON_EM) {
          pairAdjustments[pair] = adjustment;
        }
      }
    }
  } finally {
    context.restore();
  }
  return { advances, pairAdjustments };
}

function uniqueCharacters(text: string): readonly string[] {
  return Array.from(new Set(text));
}

function emptyFontFamilyMetrics(): Record<string, HostFontFaceMetrics> {
  return Object.create(null) as Record<string, HostFontFaceMetrics>;
}

function normalizeFontFamilyKey(family: string): string {
  return Array.from(family.trim(), (character) =>
    character >= 'A' && character <= 'Z' ? character.toLowerCase() : character,
  ).join('');
}
