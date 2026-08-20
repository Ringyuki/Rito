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
  /**
   * Canvas advance of an uncovered-character probe's character (sentinel
   * E00E samples): the width the fallback font that paints it actually
   * occupies, which no registered face's tables can provide.
   */
  advance?: number;
};

/**
 * Families whose publication faces the host's font decoder rejected,
 * not yet pushed to each worker. The engine must stop shaping with a
 * face the canvas cannot paint (a shaper-only face measures runs the
 * paint then draws with a fallback font); the metric sync loop delivers
 * the denylist because it already owns the inject-then-reflow cycle.
 */
const pendingUnavailableFaces = new Map<string, Set<string>>();
const deliveredUnavailableFaces = new WeakMap<object, Set<string>>();

/** Families already known rejected, replayed into workers opened later. */
export function cachedUnavailableFontFamilies(): readonly string[] {
  return [...(pendingUnavailableFaces.get('') ?? [])];
}

export function reportUnavailableFontFamily(family: string): void {
  const key = family.trim();
  if (key.length === 0) return;
  const pending = pendingUnavailableFaces.get('') ?? new Set<string>();
  pending.add(key);
  pendingUnavailableFaces.set('', pending);
}

async function syncUnavailableFontFaces(worker: BrowserReaderWorkerClient): Promise<boolean> {
  const pending = pendingUnavailableFaces.get('');
  if (!pending || pending.size === 0) return false;
  const delivered = deliveredUnavailableFaces.get(worker) ?? new Set<string>();
  const fresh = [...pending].filter((family) => !delivered.has(family));
  if (fresh.length === 0) return false;
  await worker.setUnavailableFontFaces(fresh);
  for (const family of fresh) delivered.add(family);
  deliveredUnavailableFaces.set(worker, delivered);
  return true;
}

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
  const denylistChanged = await syncUnavailableFontFaces(worker);
  const requests = await worker.takeHostLineMetricRequests();
  if (requests.length === 0) return denylistChanged;
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
  if (entries.length === 0) return denylistChanged;
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
            : request.sample.charCodeAt(0) === 0xe00e
              ? // An advance probe: load the character itself so the
                // measured advance comes from the face that paints it.
                request.sample.slice(1)
              : // A ruby probe key may carry the annotation's own text
                // after the ratio; its glyphs must join the load text so
                // the face that covers them actually loads before the
                // probe renders.
                `中x${request.sample.split(':').slice(1).join(':')}`,
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
      // host measures it the way it measures normal lines. One-line
      // probes (E000/E002): the baseline is the minimum baseline the
      // annotation demands; the sentinel picks the rt face by the
      // annotation's script. Two-line probes (E001/E003/E004/E005): the
      // same ruby forced onto a second line; the total height exposes
      // how much of the previous line's under-edge the annotation may
      // reuse. E004/E005 put one Latin glyph on the previous line:
      // measured, a single non-CJK glyph there (a space included)
      // shrinks the reusable gap by a pixel at 16px, additively with
      // the annotation-script bit.
      const sentinel = sample.length > 0 ? sample.charCodeAt(0) : 0;
      if (sentinel === 0xe00e) {
        // Uncovered-character advance probe: the engine's registered
        // faces cannot serve this character, so the browser paints it
        // with a system fallback font. The canvas advance below is what
        // paint will actually occupy; the paragraph carries the
        // character so the line metrics stay honest for the same key.
        paragraph.textContent = sample.slice(1);
      } else if (sentinel === 0xe00c || sentinel === 0xe00d) {
        // Super/sub probes: the engine cannot derive Blink's quantized
        // above-baseline contribution of a raised span from font tables
        // (an oracle matrix refused every closed form), so the host
        // measures the exact idiom — strut text with the shifted span
        // inside, at the strut's used line-height. The key tail is
        // "<span-size ratio>:<used line-height px | n>"; the measured
        // baseline/height are the line's envelope with the raise
        // embedded.
        const [ratioPart, lineHeightPart] = sample.slice(1).split(':');
        const ratio = Number(ratioPart) || 0.8;
        if (lineHeightPart !== undefined && lineHeightPart !== 'n') {
          paragraph.style.lineHeight = `${String(Number(lineHeightPart))}px`;
        }
        const align = sentinel === 0xe00c ? 'super' : 'sub';
        paragraph.innerHTML =
          `中中<span style="font-size:${String(ratio)}em;` +
          `vertical-align:${align};font-weight:bold">①</span>中`;
      } else if (sentinel >= 0xe000 && sentinel <= 0xe00b) {
        // The key tail is "<ratio>[:<annotation text>]". The rt content
        // must be the annotation's OWN text when the engine sends it:
        // the annotation stack height depends on which face the family
        // list resolves for those characters, and a script-class sample
        // can fall out of a book face's coverage onto a fallback whose
        // stack differs (measured on b9's Han-only FZBWKS: the あ class
        // sample fell to SourceHan, one pixel taller than the real 破坏神
        // annotation's stack).
        const [ratioPart, ...annotationParts] = sample.slice(1).split(':');
        const ratio = Number(ratioPart) || 0.5;
        const annotationSample = annotationParts.join(':');
        const cjkAnnotation =
          sentinel === 0xe002 ||
          sentinel === 0xe003 ||
          sentinel === 0xe005 ||
          sentinel === 0xe007 ||
          sentinel === 0xe009 ||
          sentinel === 0xe00b;
        // E006-E00B mirror E000-E005 with a LATIN base: the ruby base
        // resolves the latin face, whose annotation stack sits one pixel
        // lower than the CJK face's (measured: Tinos base 16px rt 0.5 —
        // baseline 21 vs 22; the b96 long-base ruby paragraph is 26px in
        // Blink where a CJK base gets 27).
        const latinBase = sentinel >= 0xe006;
        const rtText =
          annotationSample.length > 0
            ? annotationSample.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : cjkAnnotation
              ? 'あ'
              : 'an';
        const rt = `<rt style="font-size:${String(ratio)}em">${rtText}</rt>`;
        if (
          sentinel === 0xe000 ||
          sentinel === 0xe002 ||
          sentinel === 0xe006 ||
          sentinel === 0xe007
        ) {
          paragraph.innerHTML = latinBase
            ? `<ruby><rb>ab ab</rb>${rt}</ruby>ab`
            : `<ruby><rb>中中</rb>${rt}</ruby>中中`;
        } else {
          // Probe text repeats one glyph (中, the most universally
          // covered CJK codepoint) so a decorative embedded face that
          // lacks some common character (b43's title font misses 文)
          // cannot leak a fallback font's taller metrics into the
          // measured geometry.
          // The two-line probe breaks EXPLICITLY: a width-driven wrap sat
          // on a fit boundary (content width == container width) and the
          // measured second-line reuse depended on where the break fell,
          // which inflated the derived under-edge allowance and made
          // later-line annotations over-grow.
          const mixedPrevious =
            sentinel === 0xe004 ||
            sentinel === 0xe005 ||
            sentinel === 0xe00a ||
            sentinel === 0xe00b;
          const previous = mixedPrevious ? '中中a中中' : '中中中中';
          paragraph.innerHTML = latinBase
            ? `${previous}<br/><ruby><rb>ab ab</rb>${rt}</ruby>ab`
            : `${previous}<br/><ruby><rb>中文</rb>${rt}</ruby>中文`;
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
      const metric: MeasuredMetric = {
        height: box.height,
        baseline: marker.getBoundingClientRect().top - box.top,
        ...measureGridMetric(gridContext, request.size, measured, sample),
      };
      if (sentinel === 0xe00e && gridContext) {
        gridContext.font = `${String(request.size)}px ${measured}`;
        gridContext.letterSpacing = '0px';
        const advance = gridContext.measureText(sample.slice(1)).width;
        if (Number.isFinite(advance) && advance > 0) metric.advance = advance;
      }
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
