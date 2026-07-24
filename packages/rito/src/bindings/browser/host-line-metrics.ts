import type {
  RitoCoreWasmHostLineMetric,
  RitoCoreWasmHostLineMetricRequest,
} from '@ritojs/core-wasm';

import type { BrowserReaderWorkerClient } from './core-contracts';

/**
 * Host-measured `line-height: normal` metrics.
 *
 * The engine cannot derive normal line heights from font tables: the
 * browser's font scaler grid-fits ascent/descent to integers per size,
 * and lines containing CJK glyphs get a separately grid-fitted lifted
 * height. So the host measures its own two-level heights with the DOM
 * and injects them; the engine records (family, size) misses for the
 * next sync. The cache is module-level: pairs measured once serve every
 * document in the session, so a steady-state open paginates once.
 */
const measuredCache = new Map<string, { strut: number; cjk: number }>();

const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
]);

const cacheKey = (family: string, size: number) => `${family}@@${size.toFixed(3)}`;

/** Every metric measured so far, for injection right after a session opens. */
export function cachedHostLineMetricEntries(): RitoCoreWasmHostLineMetric[] {
  return [...measuredCache.entries()].map(([key, metric]) => {
    const at = key.lastIndexOf('@@');
    return {
      family: key.slice(0, at),
      size: Number(key.slice(at + 2)),
      strut: metric.strut,
      cjk: metric.cjk,
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
    const hit = measuredCache.get(cacheKey(request.family, request.size));
    if (hit) entries.push({ family: request.family, size: request.size, ...hit });
    else missing.push(request);
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
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;width:1000px;visibility:hidden;';
  document.body.appendChild(host);
  try {
    return requests.map((request) => {
      const measure = (probe: string) => {
        const paragraph = document.createElement('p');
        paragraph.style.cssText =
          `margin:0;padding:0;border:0;line-height:normal;` +
          `font-family:${cssFamilyList(request.family)};font-size:${String(request.size)}px;`;
        paragraph.textContent = probe;
        host.appendChild(paragraph);
        return paragraph.getBoundingClientRect().height;
      };
      // 'x' sizes the plain strut (identical to an empty line's height);
      // one CJK glyph sizes the lifted line. Mirrors the engine's
      // per-line two-level rule.
      const strut = measure('x');
      const cjk = measure('试');
      measuredCache.set(cacheKey(request.family, request.size), { strut, cjk });
      return { family: request.family, size: request.size, strut, cjk };
    });
  } finally {
    host.remove();
  }
}

function cssFamilyList(familyKey: string): string {
  return familyKey
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => (GENERIC_FAMILIES.has(name) ? name : `"${name.replaceAll('"', '\\"')}"`))
    .join(', ');
}
