export function readerParityReviewHtml(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<style>
  html,
  body {
    margin: 0;
    background: #fff;
  }
</style>
<script type="importmap">
  {
    "imports": {
      "css-line-break": "/vendor/css-line-break.js",
      "fflate": "/vendor/fflate/browser.js"
    }
  }
</script>
<script type="module">
  const FULL_LAYOUT_TIMEOUT_MS = 90_000;
  const FRAME_READY_TIMEOUT_MS = 30_000;
  const FRAME_POLL_MS = 30;
  const FRAME_QUIET_MS = 250;
  const REQUIRED_STABLE_ROUNDS = 2;

  window.renderRitoReaderParityReady = 'loading';

  Promise.all([
    import('/reference-dist/compatibility/web.mjs'),
    import('/dist/index.mjs'),
  ])
    .then(([referenceModule, productionModule]) => {
      window.renderRitoReaderParityReady = 'ready';
      window.renderRitoReaderParity = async (testRun, bookBase64) => {
        const reference = await renderReferenceRun(referenceModule, testRun, bookBase64);
        const spreadIndexes = reference.spreads.map((spread) => spread.spreadIndex);
        const production = await renderProductionRun(
          productionModule,
          testRun,
          bookBase64,
          spreadIndexes,
          reference.totalSpreads,
          reference.spreads.find((spread) => spread.spreadIndex === 0)?.pngBase64,
        );
        return { reference, production };
      };
    })
    .catch((error) => {
      console.error(error);
      window.renderRitoReaderParityReady = String(
        error && (error.stack || error.message || error),
      );
    });

  async function renderReferenceRun(module, testRun, bookBase64) {
    const canvas = document.createElement('canvas');
    const reader = await createReader(module, testRun, bookBase64, canvas);
    try {
      const totalSpreads = reader.totalSpreads;
      const spreadIndexes = await spreadIndexesForRun(reader, testRun, totalSpreads);
      sizeCanvas(reader, canvas, testRun.profile.devicePixelRatio);
      const context = requireContext(canvas);
      const textDraws = trackTextDraws(context, testRun.captureTextDraws === true);
      const spreads = [];
      try {
        for (const spreadIndex of spreadIndexes) {
          if (!reader.renderSpreadTo(spreadIndex, context)) {
            throw new Error('TS reference did not render spread ' + String(spreadIndex));
          }
          await waitForAnimationFrames(2);
          spreads.push({
            spreadIndex,
            pngBase64: pngBase64(canvas),
            ...(testRun.captureTextDraws ? { textDraws: textDraws.take() } : {}),
          });
        }
      } finally {
        textDraws.dispose();
      }
      return { totalSpreads, spreads, missingSpreadIndexes: [] };
    } finally {
      reader.dispose();
    }
  }

  async function renderProductionRun(
    module,
    testRun,
    bookBase64,
    spreadIndexes,
    expectedTotalSpreads,
    initialExpectedPng,
  ) {
    const canvas = document.createElement('canvas');
    const reader = await createReader(module, testRun, bookBase64, canvas);
    try {
      await Promise.all([
        assertInitialPreviewParity(reader, canvas, testRun, initialExpectedPng),
        waitForDeferredFullLayout(reader, expectedTotalSpreads),
      ]);
      const totalSpreads = reader.totalSpreads;
      const validIndexes = spreadIndexes.filter((spreadIndex) => spreadIndex < totalSpreads);
      const missingSpreadIndexes = spreadIndexes.filter((spreadIndex) => spreadIndex >= totalSpreads);
      sizeCanvas(reader, canvas, testRun.profile.devicePixelRatio);
      const context = requireContext(canvas);
      const textDraws = trackTextDraws(context, testRun.captureTextDraws === true);
      const invalidationVersions = trackInvalidations(reader);
      try {
        const spreads = [];
        for (const spreadIndex of validIndexes) {
          const png = await renderStableProductionSpread(
            reader,
            canvas,
            context,
            spreadIndex,
            invalidationVersions,
          );
          spreads.push({
            spreadIndex,
            pngBase64: png,
            ...(testRun.captureTextDraws ? { textDraws: textDraws.take() } : {}),
          });
        }
        return { totalSpreads, spreads, missingSpreadIndexes };
      } finally {
        textDraws.dispose();
        invalidationVersions.dispose();
      }
    } finally {
      reader.dispose();
    }
  }

  async function assertInitialPreviewParity(reader, canvas, testRun, expectedPng) {
    if (!expectedPng) return;
    sizeCanvas(reader, canvas, testRun.profile.devicePixelRatio);
    const context = requireContext(canvas);
    const deadline = performance.now() + FRAME_READY_TIMEOUT_MS;
    while (performance.now() < deadline) {
      if (!reader.renderSpreadTo(0, context)) {
        await delay(FRAME_POLL_MS);
        continue;
      }
      await waitForFonts();
      await waitForAnimationFrames(2);
      if (pngBase64(canvas) === expectedPng) return;
      await delay(FRAME_POLL_MS);
    }
    throw new Error('Rust production initial preview differs from the TypeScript reference');
  }

  async function createReader(module, testRun, bookBase64, canvas) {
    if (typeof module.createReader !== 'function') {
      throw new Error('Pixel parity reader module does not export createReader');
    }
    return await module.createReader(base64ToArrayBuffer(bookBase64), canvas, {
      width: testRun.profile.width,
      height: testRun.profile.height,
      margin: testRun.profile.margin,
      spread: testRun.profile.spread,
      spreadGap: testRun.profile.spreadGap,
      lineBreaking: testRun.lineBreaking,
      devicePixelRatio: testRun.profile.devicePixelRatio,
      backgroundColor: '#ffffff',
      logLevel: 'silent',
    });
  }

  async function renderStableProductionSpread(reader, canvas, context, spreadIndex, versions) {
    const deadline = performance.now() + FRAME_READY_TIMEOUT_MS;
    let stablePng = '';
    let stableRounds = 0;
    reader.notifyActiveSpread(spreadIndex);

    while (performance.now() < deadline) {
      const version = versions.read(spreadIndex);
      if (!reader.renderSpreadTo(spreadIndex, context)) {
        await delay(FRAME_POLL_MS);
        continue;
      }
      await waitForFonts();
      await waitForAnimationFrames(2);
      const beforeQuiet = pngBase64(canvas);
      await delay(FRAME_QUIET_MS);
      if (versions.read(spreadIndex) !== version) {
        stablePng = '';
        stableRounds = 0;
        continue;
      }
      if (!reader.renderSpreadTo(spreadIndex, context)) {
        stablePng = '';
        stableRounds = 0;
        continue;
      }
      await waitForAnimationFrames(2);
      const afterQuiet = pngBase64(canvas);
      if (versions.read(spreadIndex) !== version || beforeQuiet !== afterQuiet) {
        stablePng = '';
        stableRounds = 0;
        continue;
      }
      if (stablePng === afterQuiet) stableRounds += 1;
      else {
        stablePng = afterQuiet;
        stableRounds = 1;
      }
      if (stableRounds >= REQUIRED_STABLE_ROUNDS) return afterQuiet;
    }
    throw new Error('Timed out waiting for stable production spread ' + String(spreadIndex));
  }

  function trackInvalidations(reader) {
    const versions = new Map();
    const unsubscribe = reader.onSpreadContentInvalidated((spreadIndex) => {
      versions.set(spreadIndex, (versions.get(spreadIndex) || 0) + 1);
    });
    return {
      read: (spreadIndex) => versions.get(spreadIndex) || 0,
      dispose: unsubscribe,
    };
  }

  function waitForDeferredFullLayout(reader, expectedTotalSpreads) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let unsubscribe = () => undefined;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      };
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        reject(new Error('Timed out waiting for the production full layout commit'));
      }, FULL_LAYOUT_TIMEOUT_MS);
      unsubscribe = reader.onLayoutCommitted(() => {
        if (reader.totalSpreads === expectedTotalSpreads) finish();
      });
    });
  }

  async function spreadIndexesForRun(reader, testRun, totalSpreads) {
    const selection = testRun.spreadSelection || { mode: 'all' };
    let selected;
    if (selection.mode === 'explicit') selected = selection.indexes || [];
    else if (selection.mode === 'curated') {
      selected = curatedSpreadIndexes(selection.frontmatterSpreadCount || 0, totalSpreads);
    } else if (selection.mode === 'key') {
      selected = keySpreadIndexes(selection.frontmatterSpreadCount || 0, totalSpreads);
    } else selected = Array.from({ length: totalSpreads }, (_, spreadIndex) => spreadIndex);
    const querySpreads = await spreadIndexesForQueries(reader, testRun.spreadQueries || []);
    return validSpreadIndexes([...selected, ...querySpreads], totalSpreads);
  }

  async function spreadIndexesForQueries(reader, queries) {
    if (queries.length === 0) return [];
    if (typeof reader.search !== 'function' || typeof reader.findSpread !== 'function') {
      throw new Error('Reader parity search selection requires search and findSpread');
    }
    const spreadIndexes = [];
    for (const query of queries) {
      const matches = await reader.search(query);
      if (!matches || matches.length === 0) {
        throw new Error('Reader parity query did not match: ' + query);
      }
      for (const match of matches) {
        const spreadIndex = reader.findSpread(match.pageIndex);
        if (spreadIndex !== undefined) spreadIndexes.push(spreadIndex);
      }
    }
    return spreadIndexes;
  }

  function curatedSpreadIndexes(frontmatterSpreadCount, totalSpreads) {
    const frontmatter = Array.from(
      { length: Math.min(frontmatterSpreadCount, totalSpreads) },
      (_, spreadIndex) => spreadIndex,
    );
    const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
    const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
    const tailStart = Math.max(bodyStart, totalSpreads - 2);
    return validSpreadIndexes(
      [...frontmatter, bodyStart, bodyStart + 1, bodyMiddle, tailStart, totalSpreads - 1],
      totalSpreads,
    );
  }

  function keySpreadIndexes(frontmatterSpreadCount, totalSpreads) {
    const lastFrontmatter = Math.min(frontmatterSpreadCount - 1, totalSpreads - 1);
    const bodyStart = Math.min(frontmatterSpreadCount, totalSpreads - 1);
    const bodyMiddle = Math.floor((bodyStart + totalSpreads - 1) / 2);
    return validSpreadIndexes(
      [0, 1, 2, lastFrontmatter, bodyStart, bodyMiddle, totalSpreads - 1],
      totalSpreads,
    );
  }

  function validSpreadIndexes(spreadIndexes, totalSpreads) {
    return [...new Set(spreadIndexes)].filter(
      (spreadIndex) => spreadIndex >= 0 && spreadIndex < totalSpreads,
    );
  }

  function sizeCanvas(reader, canvas, devicePixelRatio) {
    const size = reader.getCanvasSize(1);
    canvas.width = Math.round(size.width * devicePixelRatio);
    canvas.height = Math.round(size.height * devicePixelRatio);
  }

  function requireContext(canvas) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pixel parity canvas has no 2D context');
    return context;
  }

  function trackTextDraws(context, enabled) {
    if (!enabled) return { take: () => [], dispose: () => undefined };
    const draws = [];
    const originalFillText = context.fillText;
    context.fillText = function (text, x, y, maxWidth) {
      draws.push({
        text,
        x,
        y,
        font: this.font,
        letterSpacing: this.letterSpacing,
        wordSpacing: this.wordSpacing,
      });
      if (maxWidth === undefined) return originalFillText.call(this, text, x, y);
      return originalFillText.call(this, text, x, y, maxWidth);
    };
    return {
      take: () => draws.splice(0, draws.length),
      dispose: () => {
        context.fillText = originalFillText;
      },
    };
  }

  async function waitForFonts() {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready.catch(() => undefined);
    }
  }

  function waitForAnimationFrames(count) {
    return new Promise((resolve) => {
      const next = (remaining) => {
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(() => next(remaining - 1));
      };
      next(count);
    });
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function pngBase64(canvas) {
    const dataUrl = canvas.toDataURL('image/png');
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  }

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  }
</script>`;
}
