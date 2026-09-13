import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  RitoCoreWasmHostLineMetric,
  RitoCoreWasmHostLineMetricRequest,
} from '@ritojs/core-wasm';
import type { BrowserReaderWorkerClient } from '../../src/bindings/browser/core-contracts';

/**
 * The host measures `line-height: normal` with the DOM because the engine
 * cannot derive it from font tables. What a probe puts on the measured
 * line therefore decides every baseline the engine ships, so these tests
 * assert the markup each sample builds, not the numbers a real browser
 * would return for it.
 */

type FakeRect = { top: number; height: number };

class FakeElement {
  readonly style: { cssText: string; lineHeight: string } = { cssText: '', lineHeight: '' };
  textContent = '';
  innerHTML = '';
  readonly children: FakeElement[] = [];
  rect: FakeRect = { top: 0, height: 0 };
  removed = false;

  constructor(readonly tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.removed = true;
  }

  getBoundingClientRect(): FakeRect {
    return { top: this.rect.top, height: this.rect.height };
  }
}

type FakeTextMetrics = {
  width: number;
  actualBoundingBoxAscent: number;
  actualBoundingBoxDescent: number;
  fontBoundingBoxAscent: number;
  fontBoundingBoxDescent: number;
};

type CanvasProbe = { font: string; text: string };

interface DomOptions {
  /** Line box height and baseline offset handed to the nth paragraph. */
  geometry?: (index: number) => { height: number; baseline: number };
  measureText?: (font: string, text: string) => Partial<FakeTextMetrics>;
}

interface FakeDom {
  paragraphs: FakeElement[];
  hosts: FakeElement[];
  fontLoads: { font: string; text: string }[];
  canvasProbes: CanvasProbe[];
}

const DEFAULT_METRICS: FakeTextMetrics = {
  width: 8,
  actualBoundingBoxAscent: 7,
  actualBoundingBoxDescent: 1,
  fontBoundingBoxAscent: 12,
  fontBoundingBoxDescent: 3,
};

function installFakeDom(options: DomOptions = {}): FakeDom {
  const geometry = options.geometry ?? (() => ({ height: 20, baseline: 16 }));
  const dom: FakeDom = { paragraphs: [], hosts: [], fontLoads: [], canvasProbes: [] };

  const context = {
    font: '',
    letterSpacing: '',
    measureText(text: string): FakeTextMetrics {
      dom.canvasProbes.push({ font: context.font, text });
      return { ...DEFAULT_METRICS, ...options.measureText?.(context.font, text) };
    },
  };

  const createElement = (tagName: string): unknown => {
    if (tagName === 'canvas') return { getContext: () => context };
    const element = new FakeElement(tagName);
    if (tagName === 'div') dom.hosts.push(element);
    if (tagName === 'p') {
      const { height, baseline } = geometry(dom.paragraphs.length);
      element.rect = { top: 0, height };
      dom.paragraphs.push(element);
      // The zero-sized marker the module appends sits on the baseline, so
      // its top minus the paragraph's top is the baseline offset.
      const appendChild = element.appendChild.bind(element);
      element.appendChild = (child: FakeElement) => {
        child.rect = { top: baseline, height: 0 };
        return appendChild(child);
      };
    }
    return element;
  };

  vi.stubGlobal('document', {
    body: new FakeElement('body'),
    createElement,
    fonts: {
      ready: Promise.resolve(),
      load: (font: string, text: string) => {
        dom.fontLoads.push({ font, text });
        return Promise.resolve([]);
      },
    },
  });
  return dom;
}

interface FakeWorker {
  client: BrowserReaderWorkerClient;
  injected: RitoCoreWasmHostLineMetric[][];
  denylists: readonly (readonly string[])[];
}

function createWorker(requests: RitoCoreWasmHostLineMetricRequest[][]): FakeWorker {
  const injected: RitoCoreWasmHostLineMetric[][] = [];
  const denylists: (readonly string[])[] = [];
  const pending = [...requests];
  const client = {
    takeHostLineMetricRequests: () => Promise.resolve(pending.shift() ?? []),
    setHostLineMetrics: (entries: readonly RitoCoreWasmHostLineMetric[]) => {
      injected.push([...entries]);
      return Promise.resolve();
    },
    setUnavailableFontFaces: (families: readonly string[]) => {
      denylists.push([...families]);
      return Promise.resolve();
    },
  } as unknown as BrowserReaderWorkerClient;
  return { client, injected, denylists };
}

/** Each test gets its own module instance: the caches are module-level. */
async function loadMetrics() {
  vi.resetModules();
  return import('../../src/bindings/browser/host-line-metrics');
}

const request = (
  overrides: Partial<RitoCoreWasmHostLineMetricRequest> = {},
): RitoCoreWasmHostLineMetricRequest =>
  ({
    family: 'Bookface',
    size: 16,
    sample: '',
    ...overrides,
  }) as RitoCoreWasmHostLineMetricRequest;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser host line metrics: the unavailable-face denylist', () => {
  it('keeps reported families, trimmed, and ignores blank ones', async () => {
    const metrics = await loadMetrics();

    metrics.reportUnavailableFontFamily('  Broken Face  ');
    metrics.reportUnavailableFontFamily('   ');
    metrics.reportUnavailableFontFamily('Broken Face');

    expect(metrics.cachedUnavailableFontFamilies()).toEqual(['Broken Face']);
  });

  it('delivers each family to a worker once and reports that it did', async () => {
    const metrics = await loadMetrics();
    installFakeDom();
    const worker = createWorker([[], []]);
    metrics.reportUnavailableFontFamily('Broken Face');

    const first = await metrics.syncBrowserHostLineMetrics(worker.client);
    const second = await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(worker.denylists).toEqual([['Broken Face']]);
  });

  it('replays the denylist into a second worker that has never seen it', async () => {
    const metrics = await loadMetrics();
    installFakeDom();
    metrics.reportUnavailableFontFamily('Broken Face');
    const first = createWorker([[]]);
    const second = createWorker([[]]);

    await metrics.syncBrowserHostLineMetrics(first.client);
    await metrics.syncBrowserHostLineMetrics(second.client);

    expect(first.denylists).toEqual([['Broken Face']]);
    expect(second.denylists).toEqual([['Broken Face']]);
  });

  it('reports no work when there is neither a denylist nor a request', async () => {
    const metrics = await loadMetrics();
    installFakeDom();
    const worker = createWorker([[]]);

    expect(await metrics.syncBrowserHostLineMetrics(worker.client)).toBe(false);
    expect(worker.injected).toEqual([]);
  });
});

describe('browser host line metrics: measuring and injecting', () => {
  it('injects the measured line box and baseline under the requested key', async () => {
    const metrics = await loadMetrics();
    installFakeDom({ geometry: () => ({ height: 21, baseline: 17 }) });
    const worker = createWorker([[request({ family: 'Bookface', size: 16 })]]);

    expect(await metrics.syncBrowserHostLineMetrics(worker.client)).toBe(true);
    expect(worker.injected).toHaveLength(1);
    expect(worker.injected[0]?.[0]).toMatchObject({
      family: 'Bookface',
      size: 16,
      sample: '',
      height: 21,
      baseline: 17,
    });
  });

  it('measures once for two raw keys that rewrite to the same measured list', async () => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([
      [request({ family: 'Alias A', measureFamily: '"Shared", serif' })],
      [request({ family: 'Alias B', measureFamily: '"Shared", serif' })],
    ]);

    await metrics.syncBrowserHostLineMetrics(worker.client);
    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(dom.paragraphs).toHaveLength(1);
    expect(worker.injected[1]?.[0]).toMatchObject({ family: 'Alias B' });
    expect(
      metrics
        .cachedHostLineMetricEntries()
        .map((entry) => entry.family)
        .sort(),
    ).toEqual(['Alias A', 'Alias B']);
  });

  it('round-trips a family list that contains the cache key separator', async () => {
    const metrics = await loadMetrics();
    installFakeDom();
    const worker = createWorker([[request({ family: 'Odd@@Name, serif', size: 12.5 })]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(metrics.cachedHostLineMetricEntries()[0]).toMatchObject({
      family: 'Odd@@Name, serif',
      size: 12.5,
      sample: '',
    });
  });

  it('measures nothing when the runtime has no document', async () => {
    const metrics = await loadMetrics();
    vi.stubGlobal('document', undefined);
    const worker = createWorker([[request()]]);

    expect(await metrics.syncBrowserHostLineMetrics(worker.client)).toBe(false);
    expect(worker.injected).toEqual([]);
  });

  it('removes the measuring host even though it measured', async () => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([[request()]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(dom.hosts.at(0)?.removed).toBe(true);
  });
});

describe('browser host line metrics: the measured family list', () => {
  it("measures the engine's rewritten list rather than the raw key", async () => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([
      [request({ family: 'Raw Key', measureFamily: '"Pinned Serif", serif' })],
    ]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(dom.paragraphs[0]?.style.cssText).toContain('font-family:"Pinned Serif", serif;');
    expect(dom.fontLoads[0]?.font).toBe('16px "Pinned Serif", serif');
  });

  it('quotes named families and leaves generic keywords bare', async () => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([[request({ family: 'Source Han Serif, serif , monospace' })]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(dom.paragraphs[0]?.style.cssText).toContain(
      'font-family:"Source Han Serif", serif, monospace;',
    );
  });

  it('escapes a quote inside a family name', async () => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([[request({ family: 'Say "Hi"' })]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(dom.paragraphs[0]?.style.cssText).toContain('font-family:"Say \\"Hi\\"";');
  });
});

describe('browser host line metrics: what each sample puts on the line', () => {
  const probeMarkup = async (sample: string, overrides = {}) => {
    const metrics = await loadMetrics();
    const dom = installFakeDom();
    const worker = createWorker([[request({ sample, ...overrides })]]);
    await metrics.syncBrowserHostLineMetrics(worker.client);
    return dom;
  };

  it('leaves an empty sample with nothing but the strut', async () => {
    const dom = await probeMarkup('');

    expect(dom.paragraphs[0]?.textContent).toBe('');
    expect(dom.paragraphs[0]?.innerHTML).toBe('');
  });

  it('puts a plain sample on the line as text', async () => {
    const dom = await probeMarkup('中');

    expect(dom.paragraphs[0]?.textContent).toBe('中');
    expect(dom.fontLoads[0]?.text).toBe('中');
  });

  it('renders a super probe at its ratio and used line height', async () => {
    const dom = await probeMarkup('0.8:24');
    const paragraph = dom.paragraphs[0];

    expect(paragraph?.innerHTML).toBe(
      '中中<span style="font-size:0.8em;vertical-align:super;font-weight:bold">①</span>中',
    );
    expect(paragraph?.style.lineHeight).toBe('24px');
  });

  it('leaves the line height alone when a sub probe says the strut decides it', async () => {
    const dom = await probeMarkup('0.7:n');

    expect(dom.paragraphs[0]?.innerHTML).toContain('vertical-align:sub');
    expect(dom.paragraphs[0]?.style.lineHeight).toBe('');
  });

  it('measures an uncovered character through the face that paints it', async () => {
    const dom = await probeMarkup('☃');

    expect(dom.paragraphs[0]?.textContent).toBe('☃');
    // The character itself must load, not the sentinel.
    expect(dom.fontLoads[0]?.text).toBe('☃');
    expect(dom.canvasProbes.some((probe) => probe.text === '☃')).toBe(true);
  });

  it('reports the canvas advance of an uncovered character', async () => {
    const metrics = await loadMetrics();
    installFakeDom({ measureText: (_font, text) => (text === '☃' ? { width: 13.5 } : {}) });
    const worker = createWorker([[request({ sample: '☃' })]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(worker.injected[0]?.[0]).toMatchObject({ advance: 13.5 });
  });

  it('builds a one-line ruby probe over a CJK base', async () => {
    const dom = await probeMarkup('0.5');

    expect(dom.paragraphs[0]?.innerHTML).toBe(
      '<ruby><rb>中中</rb><rt style="font-size:0.5em">an</rt></ruby>中中',
    );
  });

  it('uses a CJK annotation for the CJK-script sentinel', async () => {
    const dom = await probeMarkup('0.5');

    expect(dom.paragraphs[0]?.innerHTML).toContain('<rt style="font-size:0.5em">あ</rt>');
  });

  it('builds a one-line ruby probe over a Latin base', async () => {
    const dom = await probeMarkup('0.5');

    expect(dom.paragraphs[0]?.innerHTML).toBe(
      '<ruby><rb>ab ab</rb><rt style="font-size:0.5em">an</rt></ruby>ab',
    );
  });

  it('forces the two-line probe onto a second line with an explicit break', async () => {
    const dom = await probeMarkup('0.5');

    expect(dom.paragraphs[0]?.innerHTML).toBe(
      '中中中中<br/><ruby><rb>中文</rb><rt style="font-size:0.5em">an</rt></ruby>中文',
    );
  });

  it('puts one Latin glyph on the previous line for the mixed two-line probe', async () => {
    const dom = await probeMarkup('0.5');

    expect(dom.paragraphs[0]?.innerHTML).toContain('中中a中中<br/>');
  });

  it("carries the annotation's own text and loads the glyphs it needs", async () => {
    const dom = await probeMarkup('0.5:はかい');

    expect(dom.paragraphs[0]?.innerHTML).toContain('<rt style="font-size:0.5em">はかい</rt>');
    expect(dom.fontLoads[0]?.text).toBe('中xはかい');
  });

  it('escapes markup characters in an annotation', async () => {
    const dom = await probeMarkup('0.5:a&b<c>');

    expect(dom.paragraphs[0]?.innerHTML).toContain('a&amp;b&lt;c&gt;');
  });

  it('falls back to a default ratio when the key carries none', async () => {
    const dom = await probeMarkup('x');

    expect(dom.paragraphs[0]?.innerHTML).toContain('font-size:0.5em');
  });
});

describe('browser host line metrics: the grid-fit envelope', () => {
  it('takes the grid box of the family that actually serves the sample', async () => {
    const metrics = await loadMetrics();
    installFakeDom({
      measureText: (font) => {
        // The list renders the CJK glyph through the second family, so
        // only that family's solo metrics match the list's.
        if (font.includes(',')) return { width: 16, fontBoundingBoxAscent: 99 };
        if (font.includes('Latin First')) return { width: 8, fontBoundingBoxAscent: 11 };
        return { width: 16, fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 4 };
      },
    });
    const worker = createWorker([
      [request({ family: 'k', measureFamily: '"Latin First", "Han Second"', sample: '中' })],
    ]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    expect(worker.injected[0]?.[0]).toMatchObject({ gridAscent: 14, gridDescent: 4 });
  });

  it('omits the grid envelope when the canvas cannot report one', async () => {
    const metrics = await loadMetrics();
    installFakeDom({ measureText: () => ({ fontBoundingBoxAscent: Number.NaN }) });
    const worker = createWorker([[request()]]);

    await metrics.syncBrowserHostLineMetrics(worker.client);

    const entry = worker.injected[0]?.[0];
    expect(entry).toBeDefined();
    expect(entry && 'gridAscent' in entry).toBe(false);
  });
});
