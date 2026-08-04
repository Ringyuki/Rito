import type {
  RitoCoreWasmHostLineMetric,
  RitoCoreWasmHostLineMetricRequest,
} from '@ritojs/core-wasm';

import type { BrowserReaderWorkerClient } from './core-contracts';

/**
 * Host-measured `line-height: normal` metrics.
 *
 * The engine cannot derive normal line heights from font tables: the
 * browser's font scaler grid-fits ascent/descent to integers per size.
 * So the host measures them with the DOM and injects them; the engine
 * records (family, size, sample) misses for the next sync.
 *
 * Each request carries the `measureFamily` the engine derived by applying
 * its paint family rewrite to the raw key — unresolvable names dropped,
 * pinned aliases ahead of the first generic, generic tail kept — so the
 * measured strut comes from exactly the faces paint resolves to. The
 * engine's availability set is fixed at session open, which is what makes
 * these measurements stable per key. (Measuring the raw key instead once
 * sized `serif` struts with the browser's Times while SourceHan painted:
 * every body baseline sat one pixel low.)
 *
 * The sample is what goes on the measured line. Empty is an inline box's
 * own strut — the first available font of the measured list, whatever it
 * covers. A one-character sample measures whichever font the browser
 * resolves for that character, so a run the declared family cannot serve
 * is sized by the fallback font that actually paints it, exactly as the
 * browser sizes its own line boxes.
 *
 * The caches are module-level: keys measured once serve every document in
 * the session, so a steady-state open paginates once.
 */
type MeasuredMetric = {
  height: number;
  baseline: number;
  /**
   * Grid-fit (canvas `fontBoundingBox`) ascent/descent of the measured
   * list's first resolved font — the browser's basis for FIXED
   * line-height baselines, distinct from the normal-line envelope
   * whenever the font carries a line gap.
   */
  gridAscent?: number;
  gridDescent?: number;
};

/** Keyed by the MEASURED family list — what the DOM actually sized. */
const measuredCache = new Map<string, MeasuredMetric>();
/**
 * Keyed by the raw (engine-request) family list — replayed verbatim into
 * new sessions. Two raw lists that rewrite to the same measured list
 * share one measurement but need separate replay keys.
 */
const rawKeyCache = new Map<string, MeasuredMetric>();

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

const cacheKey = (family: string, size: number, sample: string) =>
  `${family}@@${size.toFixed(3)}@@${sample}`;

/** Every metric measured so far, for injection right after a session opens. */
export function cachedHostLineMetricEntries(): RitoCoreWasmHostLineMetric[] {
  return [...rawKeyCache.entries()].map(([key, metric]) => {
    const parts = key.split('@@');
    return {
      family: parts.slice(0, -2).join('@@'),
      size: Number(parts.at(-2)),
      sample: parts.at(-1) ?? '',
      ...metric,
    };
  });
}

/**
 * Drains the worker's pending metric requests, measures the missing pairs
 * with the DOM, and injects everything measured. Returns whether any
 * metric reached the worker — the caller must force a reflow then, so the
 * committed layout was built with the injected metrics.
 */
export async function syncBrowserHostLineMetrics(
  worker: BrowserReaderWorkerClient,
): Promise<boolean> {
  const requests = await worker.takeHostLineMetricRequests();
  if (requests.length === 0) return false;
  const entries: RitoCoreWasmHostLineMetric[] = [];
  const missing: RitoCoreWasmHostLineMetricRequest[] = [];
  for (const request of requests) {
    const { sample } = request;
    const hit = measuredCache.get(cacheKey(measuredFamilyList(request), request.size, sample));
    if (hit) {
      rawKeyCache.set(cacheKey(request.family, request.size, sample), hit);
      entries.push({ family: request.family, size: request.size, sample, ...hit });
    } else {
      missing.push(request);
    }
  }
  entries.push(...(await measureBrowserHostLineMetrics(missing)));
  if (entries.length === 0) return false;
  await worker.setHostLineMetrics(entries);
  return true;
}

async function measureBrowserHostLineMetrics(
  requests: readonly RitoCoreWasmHostLineMetricRequest[],
): Promise<RitoCoreWasmHostLineMetric[]> {
  if (requests.length === 0 || typeof document === 'undefined') return [];
  await document.fonts.ready;
  // A registered face the document has not painted yet stays `unloaded`;
  // measuring it without loading it first silently returns the fallback
  // font's metrics, which is how a book font's own line heights get
  // replaced by the system font's.
  await Promise.all(
    requests.map((request) =>
      document.fonts
        .load(
          `${String(request.size)}px ${measuredFamilyList(request)}`,
          request.sample.length > 0 && request.sample.charCodeAt(0) < 0xe000
            ? request.sample
            : '中x',
        )
        .catch(() => undefined),
    ),
  );
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;visibility:hidden;';
  document.body.appendChild(host);
  const gridContext = document.createElement('canvas').getContext('2d');
  try {
    return requests.map((request) => {
      const { sample } = request;
      const measured = measuredFamilyList(request);
      const paragraph = document.createElement('p');
      paragraph.style.cssText =
        `margin:0;padding:0;border:0;line-height:normal;white-space:pre;` +
        `font-family:${measured};font-size:${String(request.size)}px;`;
      // Ruby probes, keyed by private-use sample sentinels: the engine
      // cannot derive the browser's ruby-annotation stack from font
      // tables (three fonts, three inconsistent decompositions), so the
      // host measures it the way it measures normal lines. U+E000 is a
      // one-line ruby: its baseline is the minimum baseline the
      // annotation demands. U+E001 is the same ruby forced onto a second
      // line: its total height exposes how much of the previous line's
      // under-edge the annotation may reuse.
      if (sample.startsWith('\uE000') || sample.startsWith('\uE001')) {
        // The tail of the probe key is the annotation size ratio the
        // engine's cascade resolved for the rt element.
        const ratio = Number(sample.slice(1)) || 0.5;
        const rt = `<rt style="font-size:${String(ratio)}em">an</rt>`;
        if (sample.startsWith('\uE000')) {
          paragraph.innerHTML = `<ruby><rb>中文</rb>${rt}</ruby>中文`;
        } else {
          // The two-line probe breaks EXPLICITLY: a width-driven wrap sat
          // on a fit boundary (content width == container width) and the
          // measured second-line reuse depended on where the break fell,
          // which inflated the derived under-edge allowance and made
          // later-line annotations over-grow.
          paragraph.innerHTML = `中文中文<br/><ruby><rb>中文</rb>${rt}</ruby>中文`;
        }
      } else {
        // A zero-sized inline-block sits on the baseline, so its top is
        // the baseline offset from the line box top. An empty sample
        // leaves the line with nothing but the strut.
        paragraph.textContent = sample;
      }
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0';
      paragraph.appendChild(marker);
      host.appendChild(paragraph);
      const box = paragraph.getBoundingClientRect();
      const metric = {
        height: box.height,
        baseline: marker.getBoundingClientRect().top - box.top,
        ...measureGridMetric(gridContext, request.size, measured, sample),
      };
      measuredCache.set(cacheKey(measured, request.size, sample), metric);
      rawKeyCache.set(cacheKey(request.family, request.size, sample), metric);
      return { family: request.family, size: request.size, sample, ...metric };
    });
  } finally {
    host.remove();
  }
}

/**
 * Grid-fit ascent/descent of the font the measured list resolves for the
 * sample, via canvas `fontBoundingBox`. Distinct from the normal-line
 * measurement above: fixed line-heights center on this envelope, floored,
 * while normal lines distribute the font's line gap.
 */
function measureGridMetric(
  gridContext: CanvasRenderingContext2D | null,
  size: number,
  measured: string,
  sample: string,
): { gridAscent: number; gridDescent: number } | undefined {
  if (!gridContext) return undefined;
  gridContext.font = `${String(size)}px ${measured}`;
  const text = gridContext.measureText(sample.length > 0 ? sample : 'x');
  const gridAscent = text.fontBoundingBoxAscent;
  const gridDescent = text.fontBoundingBoxDescent;
  if (!Number.isFinite(gridAscent) || !Number.isFinite(gridDescent)) return undefined;
  return { gridAscent, gridDescent };
}

/** The engine-provided measure list, or the raw key for engines without one. */
function measuredFamilyList(request: RitoCoreWasmHostLineMetricRequest): string {
  return request.measureFamily !== undefined && request.measureFamily.length > 0
    ? request.measureFamily
    : cssFamilyList(request.family);
}

function cssFamilyList(familyKey: string): string {
  return familyKey
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => (GENERIC_FAMILIES.has(name) ? name : `"${name.replaceAll('"', '\\"')}"`))
    .join(', ');
}
