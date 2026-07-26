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
          request.sample.length > 0 ? request.sample : 'x',
        )
        .catch(() => undefined),
    ),
  );
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;visibility:hidden;';
  document.body.appendChild(host);
  try {
    return requests.map((request) => {
      const { sample } = request;
      const measured = measuredFamilyList(request);
      const paragraph = document.createElement('p');
      paragraph.style.cssText =
        `margin:0;padding:0;border:0;line-height:normal;white-space:pre;` +
        `font-family:${measured};font-size:${String(request.size)}px;`;
      // A zero-sized inline-block sits on the baseline, so its top is the
      // baseline offset from the line box top. An empty sample leaves the
      // line with nothing but the strut.
      paragraph.textContent = sample;
      const marker = document.createElement('span');
      marker.style.cssText = 'display:inline-block;width:0;height:0';
      paragraph.appendChild(marker);
      host.appendChild(paragraph);
      const box = paragraph.getBoundingClientRect();
      const metric = {
        height: box.height,
        baseline: marker.getBoundingClientRect().top - box.top,
      };
      measuredCache.set(cacheKey(measured, request.size, sample), metric);
      rawKeyCache.set(cacheKey(request.family, request.size, sample), metric);
      return { family: request.family, size: request.size, sample, ...metric };
    });
  } finally {
    host.remove();
  }
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
