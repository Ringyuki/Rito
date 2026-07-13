import type { Page } from '@playwright/test';
import type { Reader, ReaderOptions } from '@ritojs/core';

import {
  PINNED_FALLBACK_CORE_URL,
  PINNED_FALLBACK_EPUB_URL,
  PINNED_FALLBACK_FONT_URL,
  PINNED_FALLBACK_LANGUAGE,
  PINNED_FALLBACK_QUERY,
  type PinnedFallbackFixture,
} from './pinned-fallback-fixture';
import type {
  PinnedFallbackCanvasPaintObservation,
  PinnedFallbackProbeSnapshot,
} from './pinned-fallback-probe';

export interface PinnedFallbackExactRect {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PinnedFallbackCycleProof {
  readonly checksum: string;
  readonly visibleNonWhitePixelCount: number;
  readonly selectedText: string;
  readonly sourceHref: string;
  readonly exactRects: readonly PinnedFallbackExactRect[];
  readonly targetCanvasPaintFonts: readonly string[];
  readonly pinnedFacePresentBeforeDispose: boolean;
  readonly pinnedFacePresentAfterDispose: boolean;
  readonly terminatedWorkerCountBefore: number;
  readonly terminatedWorkerCountAfter: number;
}

interface PinnedFallbackCoreApi {
  createReader(
    data: ArrayBuffer,
    canvas: HTMLCanvasElement,
    options: ReaderOptions,
  ): Promise<Reader>;
}

interface PinnedFallbackProbeGlobal {
  __RITO_PINNED_FALLBACK_PROBE__?: {
    paints: PinnedFallbackCanvasPaintObservation[];
    openRequests: PinnedFallbackProbeSnapshot['openRequests'] extends readonly (infer Entry)[]
      ? Entry[]
      : never;
    openResults: PinnedFallbackProbeSnapshot['openResults'] extends readonly (infer Entry)[]
      ? Entry[]
      : never;
    terminatedWorkerIds: number[];
  };
}

export async function runPinnedFallbackCycle(
  page: Page,
  fixture: PinnedFallbackFixture,
): Promise<PinnedFallbackCycleProof> {
  return await page.evaluate(
    async ({ alias, coreUrl, epubUrl, fontSha256, fontUrl, language, query }) => {
      const runtime = globalThis as typeof globalThis & PinnedFallbackProbeGlobal;
      const probe = runtime.__RITO_PINNED_FALLBACK_PROBE__;
      if (!probe) throw new Error('Pinned fallback probe is unavailable');
      const paintStart = probe.paints.length;
      const terminatedWorkerCountBefore = probe.terminatedWorkerIds.length;
      const core = (await import(coreUrl)) as PinnedFallbackCoreApi;
      const [epubBytes, fontBytes] = await Promise.all([
        fetchArrayBuffer(epubUrl),
        fetchArrayBuffer(fontUrl),
      ]);
      const canvas = document.createElement('canvas');
      canvas.dataset['pinnedFallbackCanvas'] = 'true';
      document.body.append(canvas);
      const reader = await core.createReader(epubBytes, canvas, {
        width: 640,
        height: 520,
        margin: 32,
        spread: 'single',
        lineBreaking: 'greedy',
        devicePixelRatio: 1,
        logLevel: 'silent',
        pinnedFontPolicy: {
          schemaVersion: 1,
          faces: [
            {
              bytes: fontBytes,
              expectedSha256: fontSha256,
              genericRole: 'serif',
              language,
            },
          ],
        },
      });

      let proof:
        | Omit<
            PinnedFallbackCycleProof,
            | 'pinnedFacePresentAfterDispose'
            | 'terminatedWorkerCountBefore'
            | 'terminatedWorkerCountAfter'
          >
        | undefined;
      try {
        await document.fonts.ready;
        if (!reader.search) throw new Error('Pinned fallback search is unavailable');
        const results = await reader.search(query, { caseSensitive: true, wholeWord: false });
        const source = results.find((result) => result.source?.status === 'resolved')?.source;
        if (!source || source.status !== 'resolved') {
          throw new Error('Pinned fallback search did not return a durable source range');
        }
        const resolution = await reader.interactions?.resolveExactSourceRange?.({
          href: source.href,
          sourceRange: source.sourceRange,
        });
        if (!resolution || resolution.status !== 'resolved') {
          throw new Error(
            `Pinned fallback exact source range is unavailable: ${JSON.stringify({ source, resolution })}`,
          );
        }

        const size = reader.getCanvasSize(1);
        canvas.width = Math.round(size.width);
        canvas.height = Math.round(size.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Pinned fallback Canvas context is unavailable');
        await renderWhenReady(reader, context);
        const paints = probe.paints.slice(paintStart);
        const targetCanvasPaints = paints.filter((paint) => paint.targetCanvas);
        const aliasPaints = targetCanvasPaints.filter((paint) => paint.font.includes(alias));
        if (
          !aliasPaints
            .map((paint) => paint.text)
            .join('')
            .includes(query)
        ) {
          throw new Error('Pinned alias did not paint the fixture query');
        }
        if (!document.fonts.check(`32px "${alias}"`, query)) {
          throw new Error('Pinned FontFace cannot render the fixture query');
        }
        const canvasEvidence = inspectCanvas(context);
        proof = {
          ...canvasEvidence,
          selectedText: resolution.range.selectedText,
          sourceHref: source.href,
          exactRects: resolution.range.rects.map((rect) => ({ ...rect })),
          targetCanvasPaintFonts: targetCanvasPaints.map((paint) => paint.font),
          pinnedFacePresentBeforeDispose: hasFontFamily(alias),
        };
      } finally {
        reader.dispose();
        await waitUntil(
          () =>
            !hasFontFamily(alias) && probe.terminatedWorkerIds.length > terminatedWorkerCountBefore,
          5_000,
        );
        canvas.remove();
      }
      return {
        ...proof,
        pinnedFacePresentAfterDispose: hasFontFamily(alias),
        terminatedWorkerCountBefore,
        terminatedWorkerCountAfter: probe.terminatedWorkerIds.length,
      };

      async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Pinned fallback asset failed: ${String(response.status)}`);
        }
        return await response.arrayBuffer();
      }

      function hasFontFamily(family: string): boolean {
        let found = false;
        document.fonts.forEach((face) => {
          if (face.family === family) found = true;
        });
        return found;
      }

      async function renderWhenReady(
        activeReader: Reader,
        context: CanvasRenderingContext2D,
      ): Promise<void> {
        await new Promise<void>((resolveRender, rejectRender) => {
          let unsubscribe: () => void = () => undefined;
          const timeout = setTimeout(() => {
            unsubscribe();
            rejectRender(new Error('Timed out waiting for the pinned fallback frame'));
          }, 30_000);
          const attempt = (): void => {
            try {
              if (!activeReader.renderSpreadTo(0, context)) return;
              clearTimeout(timeout);
              unsubscribe();
              resolveRender();
            } catch (error) {
              clearTimeout(timeout);
              unsubscribe();
              rejectRender(error instanceof Error ? error : new Error(String(error)));
            }
          };
          unsubscribe = activeReader.onSpreadContentInvalidated((spreadIndex) => {
            if (spreadIndex === 0) attempt();
          });
          attempt();
        });
      }

      function inspectCanvas(context: CanvasRenderingContext2D): {
        readonly checksum: string;
        readonly visibleNonWhitePixelCount: number;
      } {
        const { width, height } = context.canvas;
        const pixels = context.getImageData(0, 0, width, height).data;
        let hash = 2_166_136_261;
        let visibleNonWhitePixelCount = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          for (let offset = 0; offset < 4; offset += 1) {
            hash ^= pixels[index + offset] ?? 0;
            hash = Math.imul(hash, 16_777_619);
          }
          const alpha = pixels[index + 3] ?? 0;
          const red = pixels[index] ?? 255;
          const green = pixels[index + 1] ?? 255;
          const blue = pixels[index + 2] ?? 255;
          if (alpha > 0 && (red < 250 || green < 250 || blue < 250)) {
            visibleNonWhitePixelCount += 1;
          }
        }
        return {
          checksum: `${String(width)}x${String(height)}:${String(hash >>> 0)}`,
          visibleNonWhitePixelCount,
        };
      }

      async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error('Pinned fallback disposal did not finish');
          }
          await new Promise<void>((resolveWait) => {
            setTimeout(resolveWait, 10);
          });
        }
      }
    },
    {
      alias: fixture.familyAlias,
      coreUrl: PINNED_FALLBACK_CORE_URL,
      epubUrl: PINNED_FALLBACK_EPUB_URL,
      fontSha256: fixture.fontSha256,
      fontUrl: PINNED_FALLBACK_FONT_URL,
      language: PINNED_FALLBACK_LANGUAGE,
      query: PINNED_FALLBACK_QUERY,
    },
  );
}
