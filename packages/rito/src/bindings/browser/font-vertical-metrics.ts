import { buildFontString } from './canvas-text/font-string';
import type { CanvasRenderingTarget } from './rendering';

export interface HostFontVerticalMetricDemand {
  readonly fontFamily: string;
  readonly fontStyle: 'normal' | 'italic';
  readonly fontWeight: number;
  readonly fontSizePx: number;
}

export interface HostFontVerticalMetricSample extends HostFontVerticalMetricDemand {
  readonly topBaselineAscentPx: number;
  readonly topBaselineDescentPx: number;
}

export type HostFontVerticalMetricStore = Record<string, HostFontVerticalMetricSample>;

const VERTICAL_METRIC_PROBE = 'Hg\u{4e00}';

export function createHostFontVerticalMetricStore(): HostFontVerticalMetricStore {
  return Object.create(null) as HostFontVerticalMetricStore;
}

export function ensureHostFontVerticalMetrics(
  store: HostFontVerticalMetricStore,
  context: CanvasRenderingTarget,
  demands: readonly HostFontVerticalMetricDemand[],
): boolean {
  let changed = false;
  for (const demand of demands) {
    const descriptor = normalizeDemand(demand);
    if (!descriptor) continue;
    const key = verticalMetricKey(descriptor);
    if (Object.hasOwn(store, key)) continue;
    const sample = measureFontVerticalMetrics(context, descriptor);
    if (!sample) continue;
    store[key] = sample;
    changed = true;
  }
  return changed;
}

export function hostFontVerticalMetricConfig(
  store: HostFontVerticalMetricStore,
): readonly HostFontVerticalMetricSample[] | undefined {
  const samples = Object.entries(store)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, sample]) => ({ ...sample }));
  return samples.length > 0 ? samples : undefined;
}

function measureFontVerticalMetrics(
  context: CanvasRenderingTarget,
  descriptor: HostFontVerticalMetricDemand,
): HostFontVerticalMetricSample | undefined {
  context.save();
  try {
    context.font = buildFontString({
      family: descriptor.fontFamily,
      style: descriptor.fontStyle,
      weight: descriptor.fontWeight,
      sizePx: descriptor.fontSizePx,
    });
    context.textBaseline = 'top';
    const measured = context.measureText(VERTICAL_METRIC_PROBE);
    const ascent = measured.fontBoundingBoxAscent;
    const descent = measured.fontBoundingBoxDescent;
    if (!validMetric(ascent) || !validMetric(descent) || ascent + descent <= 0) return undefined;
    return {
      ...descriptor,
      topBaselineAscentPx: ascent,
      topBaselineDescentPx: descent,
    };
  } finally {
    context.restore();
  }
}

function normalizeDemand(
  demand: HostFontVerticalMetricDemand,
): HostFontVerticalMetricDemand | undefined {
  const fontFamily = demand.fontFamily.trim();
  const fontWeight = Math.round(demand.fontWeight);
  if (
    fontFamily.length === 0 ||
    !Number.isFinite(fontWeight) ||
    fontWeight <= 0 ||
    fontWeight > 1000 ||
    !Number.isFinite(demand.fontSizePx) ||
    demand.fontSizePx <= 0
  ) {
    return undefined;
  }
  return {
    fontFamily,
    fontStyle: demand.fontStyle,
    fontWeight,
    fontSizePx: demand.fontSizePx,
  };
}

function verticalMetricKey(demand: HostFontVerticalMetricDemand): string {
  return JSON.stringify([
    asciiLowerCase(demand.fontFamily),
    demand.fontStyle,
    demand.fontWeight,
    demand.fontSizePx,
  ]);
}

function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}

function validMetric(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
