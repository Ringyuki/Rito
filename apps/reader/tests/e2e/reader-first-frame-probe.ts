import type { Page } from '@playwright/test';

interface ReaderCanvasSample {
  readonly checksum: string;
  readonly nonBlank: boolean;
}

export interface FirstVisibleReaderFrame {
  readonly checksum: string | null;
  readonly firstLoadedSpread: number | null;
}

export async function installFirstVisibleReaderFrameProbe(page: Page): Promise<void> {
  // Playwright serializes this callback, so its browser-side helpers must remain self-contained.
  await page.evaluate(() => {
    interface ProbeState {
      checksum: string | null;
      firstLoadedSpread: number | null;
    }
    type ProbeWindow = Window & { __ritoFirstVisibleReaderFrame?: ProbeState };
    const state: ProbeState = { checksum: null, firstLoadedSpread: null };
    (window as ProbeWindow).__ritoFirstVisibleReaderFrame = state;

    const hashPixels = (pixels: Uint8ClampedArray): { hash: number; nonBlank: boolean } => {
      let hash = 2_166_136_261;
      let nonBlank = false;
      for (let index = 0; index < pixels.length; index += 4) {
        const red = pixels[index] ?? 0;
        const green = pixels[index + 1] ?? 0;
        const blue = pixels[index + 2] ?? 0;
        const alpha = pixels[index + 3] ?? 0;
        for (const channel of [red, green, blue, alpha]) {
          hash ^= channel;
          hash = Math.imul(hash, 16_777_619);
        }
        if (alpha > 0 && Math.abs(red - 255) + Math.abs(green - 255) + Math.abs(blue - 255) > 24) {
          nonBlank = true;
        }
      }
      return { hash, nonBlank };
    };

    const sampleReaderCanvas = (): ReaderCanvasSample | null => {
      const shell = document.querySelector<HTMLElement>('[data-testid="reader-shell"]');
      const canvas = shell?.querySelector<HTMLCanvasElement>(
        'canvas[data-rito-reader-surface="true"]',
      );
      if (!canvas?.isConnected || canvas.width === 0 || canvas.height === 0) return null;
      const sample = document.createElement('canvas');
      sample.width = 64;
      sample.height = 64;
      const context = sample.getContext('2d');
      if (!context) return null;
      context.drawImage(canvas, 0, 0, sample.width, sample.height);
      const result = hashPixels(context.getImageData(0, 0, sample.width, sample.height).data);
      return {
        checksum: `${String(canvas.width)}x${String(canvas.height)}:${String(result.hash >>> 0)}`,
        nonBlank: result.nonBlank,
      };
    };

    const observeFrame = (): void => {
      const shell = document.querySelector<HTMLElement>('[data-testid="reader-shell"]');
      if (state.firstLoadedSpread === null && shell?.dataset['loaded'] === 'true') {
        const spread = Number(shell.dataset['currentSpread']);
        if (Number.isSafeInteger(spread) && spread >= 0) state.firstLoadedSpread = spread;
      }
      const sample = state.checksum === null ? sampleReaderCanvas() : null;
      if (sample?.nonBlank) state.checksum = sample.checksum;
      if (state.checksum === null || state.firstLoadedSpread === null) {
        requestAnimationFrame(observeFrame);
      }
    };
    requestAnimationFrame(observeFrame);
  });
}

export async function readFirstVisibleReaderFrame(page: Page): Promise<FirstVisibleReaderFrame> {
  return page.evaluate(() => {
    type ProbeWindow = Window & {
      __ritoFirstVisibleReaderFrame?: FirstVisibleReaderFrame | undefined;
    };
    return (
      (window as ProbeWindow).__ritoFirstVisibleReaderFrame ?? {
        checksum: null,
        firstLoadedSpread: null,
      }
    );
  });
}
