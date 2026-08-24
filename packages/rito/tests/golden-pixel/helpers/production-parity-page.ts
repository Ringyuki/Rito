export function productionParityHtml(): string {
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
  const PROFILE = {
    width: 520,
    height: 600,
    margin: 32,
    spread: 'single',
    spreadGap: 0,
    lineBreaking: 'greedy',
    devicePixelRatio: 1,
  };
  const FULL_LAYOUT_TIMEOUT_MS = 30_000;
  const FRAME_TIMEOUT_MS = 30_000;

  window.renderRitoProductionParityReady = 'loading';

  Promise.all([
    import('/reference-dist/tooling/web.mjs'),
    import('/dist/index.mjs'),
  ])
    .then(([referenceModule, productionModule]) => {
      window.renderRitoProductionParityReady = 'ready';
      window.renderRitoProductionParity = async (bookBase64, fonts) => {
        const installedFonts = [];
        try {
          installedFonts.push(...(await installTestFonts(fonts)));
          const reference = await renderEngine(referenceModule, bookBase64, false);
          const production = await renderEngine(productionModule, bookBase64, true);
          return { reference, production };
        } finally {
          for (const face of installedFonts) document.fonts.delete(face);
        }
      };
    })
    .catch((error) => {
      console.error(error);
      window.renderRitoProductionParityReady = String(
        error && (error.stack || error.message || error),
      );
    });

  async function installTestFonts(fonts) {
    const faces = [];
    try {
      for (const font of fonts) {
        const face = new FontFace(
          font.family,
          base64ToArrayBuffer(font.fontBase64),
          font.descriptors,
        );
        await face.load();
        document.fonts.add(face);
        faces.push(face);
      }
      await document.fonts.ready;
      return faces;
    } catch (error) {
      for (const face of faces) document.fonts.delete(face);
      throw error;
    }
  }

  async function renderEngine(module, bookBase64, waitForFullLayout) {
    if (typeof module.createReader !== 'function') {
      throw new Error('Pixel parity reader module does not export createReader');
    }
    const canvas = document.createElement('canvas');
    const reader = await module.createReader(base64ToArrayBuffer(bookBase64), canvas, {
      width: PROFILE.width,
      height: PROFILE.height,
      margin: PROFILE.margin,
      spread: PROFILE.spread,
      spreadGap: PROFILE.spreadGap,
      lineBreaking: PROFILE.lineBreaking,
      devicePixelRatio: PROFILE.devicePixelRatio,
      backgroundColor: '#ffffff',
      logLevel: 'silent',
    });
    try {
      if (waitForFullLayout) await waitForNextLayoutCommit(reader);
      if (reader.totalSpreads < 1) throw new Error('Pixel parity fixture produced no spreads');
      sizeCanvas(reader, canvas);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Pixel parity canvas has no 2D context');
      await renderFrameWhenReady(reader, context, 0);
      await waitForAnimationFrames(2);
      const dataUrl = canvas.toDataURL('image/png');
      return {
        totalSpreads: reader.totalSpreads,
        width: canvas.width,
        height: canvas.height,
        blockOpacityCount: countSpreadBlockOpacity(reader.spreads[0]),
        pngBase64: dataUrl.slice(dataUrl.indexOf(',') + 1),
      };
    } finally {
      reader.dispose();
    }
  }

  function sizeCanvas(reader, canvas) {
    const size = reader.getCanvasSize(1);
    canvas.width = Math.round(size.width * PROFILE.devicePixelRatio);
    canvas.height = Math.round(size.height * PROFILE.devicePixelRatio);
  }

  function countSpreadBlockOpacity(spread) {
    if (!spread) return 0;
    return [spread.left, spread.right]
      .filter(Boolean)
      .flatMap((page) => page.content || [])
      .reduce((count, block) => count + countBlockOpacity(block), 0);
  }

  function countBlockOpacity(block) {
    const own = block.paint && block.paint.opacity < 1 ? 1 : 0;
    return (block.children || []).reduce(
      (count, child) =>
        count + (child.type === 'layout-block' ? countBlockOpacity(child) : 0),
      own,
    );
  }

  function waitForNextLayoutCommit(reader) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => undefined;
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error('Timed out waiting for the production full layout commit'));
      }, FULL_LAYOUT_TIMEOUT_MS);
      unsubscribe = reader.onLayoutCommitted(() => {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      });
    });
  }

  function renderFrameWhenReady(reader, context, spreadIndex) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => undefined;
      let imageBitmapPaintCount = 0;
      const originalDrawImage = context.drawImage;
      context.drawImage = function (source, ...args) {
        if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
          imageBitmapPaintCount += 1;
        }
        return originalDrawImage.call(this, source, ...args);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribe();
        context.drawImage = originalDrawImage;
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for the production frame'));
      }, FRAME_TIMEOUT_MS);
      const attempt = () => {
        const paintCountBefore = imageBitmapPaintCount;
        if (!reader.renderSpreadTo(spreadIndex, context)) return;
        if (imageBitmapPaintCount === paintCountBefore) return;
        cleanup();
        resolve();
      };
      unsubscribe = reader.onSpreadContentInvalidated((invalidatedIndex) => {
        if (invalidatedIndex === spreadIndex) attempt();
      });
      attempt();
    });
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
