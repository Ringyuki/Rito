import type { BrowserContext, Page } from '@playwright/test';

export interface PinnedFallbackCanvasPaintObservation {
  readonly text: string;
  readonly font: string;
  readonly x: number;
  readonly y: number;
  readonly targetCanvas: boolean;
}

export interface PinnedFallbackProbeSnapshot {
  readonly paints: readonly PinnedFallbackCanvasPaintObservation[];
}

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface PinnedFallbackProbeGlobal {
  __RITO_PINNED_FALLBACK_PROBE__?: {
    paints: PinnedFallbackCanvasPaintObservation[];
    paintCanvases: (HTMLCanvasElement | OffscreenCanvas)[];
    targetPaintCanvases: WeakSet<object>;
  };
}

export async function installPinnedFallbackProbe(target: InitScriptTarget): Promise<void> {
  await target.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & PinnedFallbackProbeGlobal;
    const probe: NonNullable<PinnedFallbackProbeGlobal['__RITO_PINNED_FALLBACK_PROBE__']> = {
      paints: [],
      paintCanvases: [],
      targetPaintCanvases: new WeakSet(),
    };
    runtime.__RITO_PINNED_FALLBACK_PROBE__ = probe;
    installCanvasPaintProbe(probe);
    installOffscreenCanvasPaintProbe(probe);
    installCanvasCompositeProbe(probe);
    installWebGlUploadProbe(probe);

    function installCanvasPaintProbe(state: typeof probe): void {
      const originalFillText: unknown = Object.getOwnPropertyDescriptor(
        CanvasRenderingContext2D.prototype,
        'fillText',
      )?.value;
      if (typeof originalFillText !== 'function') {
        throw new Error('Canvas fillText is unavailable');
      }
      CanvasRenderingContext2D.prototype.fillText = function (
        text: string,
        x: number,
        y: number,
        maxWidth?: number,
      ): void {
        state.paints.push({
          text,
          font: this.font,
          x,
          y,
          targetCanvas: isTargetCanvas(state, this.canvas),
        });
        state.paintCanvases.push(this.canvas);
        if (maxWidth === undefined) Reflect.apply(originalFillText, this, [text, x, y]);
        else Reflect.apply(originalFillText, this, [text, x, y, maxWidth]);
      };
    }

    function installOffscreenCanvasPaintProbe(state: typeof probe): void {
      if (typeof OffscreenCanvasRenderingContext2D === 'undefined') return;
      const originalFillText: unknown = Object.getOwnPropertyDescriptor(
        OffscreenCanvasRenderingContext2D.prototype,
        'fillText',
      )?.value;
      if (typeof originalFillText !== 'function') return;
      OffscreenCanvasRenderingContext2D.prototype.fillText = function (
        text: string,
        x: number,
        y: number,
        maxWidth?: number,
      ): void {
        state.paints.push({
          text,
          font: this.font,
          x,
          y,
          targetCanvas: isTargetCanvas(state, this.canvas),
        });
        state.paintCanvases.push(this.canvas);
        if (maxWidth === undefined) Reflect.apply(originalFillText, this, [text, x, y]);
        else Reflect.apply(originalFillText, this, [text, x, y, maxWidth]);
      };
    }

    function installCanvasCompositeProbe(state: typeof probe): void {
      const originalDrawImage: unknown = Object.getOwnPropertyDescriptor(
        CanvasRenderingContext2D.prototype,
        'drawImage',
      )?.value;
      if (typeof originalDrawImage !== 'function') return;
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        ...args: unknown[]
      ): void {
        const source = args[0];
        if (
          typeof OffscreenCanvas !== 'undefined' &&
          source instanceof OffscreenCanvas &&
          isTargetCanvas(state, this.canvas)
        ) {
          state.targetPaintCanvases.add(source);
        }
        Reflect.apply(originalDrawImage, this, args);
      } as typeof CanvasRenderingContext2D.prototype.drawImage;
    }

    // The reader draws with WebGL: a canvas uploaded into the reader's
    // context (glyph cells, a page painted on a canvas) reaches the screen.
    function installWebGlUploadProbe(state: typeof probe): void {
      if (typeof WebGL2RenderingContext === 'undefined') return;
      for (const name of ['texImage2D', 'texSubImage2D'] as const) {
        const original: unknown = Object.getOwnPropertyDescriptor(
          WebGL2RenderingContext.prototype,
          name,
        )?.value;
        if (typeof original !== 'function') continue;
        Object.defineProperty(WebGL2RenderingContext.prototype, name, {
          configurable: true,
          writable: true,
          value: function (this: WebGL2RenderingContext, ...args: unknown[]): void {
            const source = args.at(-1);
            if (
              typeof OffscreenCanvas !== 'undefined' &&
              source instanceof OffscreenCanvas &&
              this.canvas instanceof HTMLCanvasElement &&
              isTargetCanvas(state, this.canvas)
            ) {
              state.targetPaintCanvases.add(source);
            }
            Reflect.apply(original, this, args);
          },
        });
      }
    }

    function isTargetCanvas(
      state: typeof probe,
      canvas: HTMLCanvasElement | OffscreenCanvas,
    ): boolean {
      return (
        state.targetPaintCanvases.has(canvas) ||
        (canvas instanceof HTMLCanvasElement &&
          (canvas.dataset['pinnedFallbackCanvas'] === 'true' ||
            canvas.closest('[data-testid="reader-shell"]') !== null))
      );
    }
  });
}

export async function readPinnedFallbackProbe(page: Page): Promise<PinnedFallbackProbeSnapshot> {
  return await page.evaluate(() => {
    const runtime = globalThis as typeof globalThis & PinnedFallbackProbeGlobal;
    const probe = runtime.__RITO_PINNED_FALLBACK_PROBE__;
    if (!probe) throw new Error('Pinned fallback probe is not installed');
    return {
      paints: probe.paints.map((paint, index) => {
        const canvas = probe.paintCanvases[index];
        return {
          ...paint,
          targetCanvas:
            canvas !== undefined &&
            (probe.targetPaintCanvases.has(canvas) ||
              (canvas instanceof HTMLCanvasElement &&
                (canvas.dataset['pinnedFallbackCanvas'] === 'true' ||
                  canvas.closest('[data-testid="reader-shell"]') !== null))),
        };
      }),
    };
  });
}
