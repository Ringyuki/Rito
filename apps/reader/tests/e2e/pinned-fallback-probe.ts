import type { BrowserContext, Page } from '@playwright/test';

export interface PinnedFallbackCanvasPaintObservation {
  readonly text: string;
  readonly font: string;
  readonly x: number;
  readonly y: number;
  readonly targetCanvas: boolean;
}

export interface PinnedFallbackWorkerOpenRequestObservation {
  readonly workerId: number;
  readonly expectedSha256: readonly string[];
  readonly faceBufferByteLengths: readonly number[];
}

/** A session a worker opened with the policy it was sent. */
export interface PinnedFallbackWorkerOpenResultObservation {
  readonly workerId: number;
}

export interface PinnedFallbackProbeSnapshot {
  readonly paints: readonly PinnedFallbackCanvasPaintObservation[];
  readonly openRequests: readonly PinnedFallbackWorkerOpenRequestObservation[];
  readonly openResults: readonly PinnedFallbackWorkerOpenResultObservation[];
  readonly terminatedWorkerIds: readonly number[];
}

type InitScriptTarget = Pick<Page, 'addInitScript'> | Pick<BrowserContext, 'addInitScript'>;

interface PinnedFallbackProbeGlobal {
  __RITO_PINNED_FALLBACK_PROBE__?: {
    paints: PinnedFallbackCanvasPaintObservation[];
    openRequests: PinnedFallbackWorkerOpenRequestObservation[];
    openResults: PinnedFallbackWorkerOpenResultObservation[];
    terminatedWorkerIds: number[];
    paintCanvases: (HTMLCanvasElement | OffscreenCanvas)[];
    targetPaintCanvases: WeakSet<object>;
  };
}

export async function installPinnedFallbackProbe(target: InitScriptTarget): Promise<void> {
  await target.addInitScript(() => {
    const runtime = globalThis as typeof globalThis & PinnedFallbackProbeGlobal;
    const probe: NonNullable<PinnedFallbackProbeGlobal['__RITO_PINNED_FALLBACK_PROBE__']> = {
      paints: [],
      openRequests: [],
      openResults: [],
      terminatedWorkerIds: [],
      paintCanvases: [],
      targetPaintCanvases: new WeakSet(),
    };
    runtime.__RITO_PINNED_FALLBACK_PROBE__ = probe;
    installCanvasPaintProbe(probe);
    installOffscreenCanvasPaintProbe(probe);
    installCanvasCompositeProbe(probe);
    installWorkerProbe(probe);

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

    function installWorkerProbe(state: typeof probe): void {
      const NativeWorker = globalThis.Worker;
      let nextWorkerId = 1;
      class PinnedFallbackWorkerProbe extends NativeWorker {
        readonly pinnedFallbackWorkerId: number;
        readonly probesRitoWorker: boolean;
        /** Ids of the open requests this worker has not answered yet. */
        readonly pendingOpens = new Set<number>();

        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.pinnedFallbackWorkerId = nextWorkerId;
          nextWorkerId += 1;
          this.probesRitoWorker = options?.name === 'rito-browser-reader-session';
          if (!this.probesRitoWorker) return;
          this.addEventListener('message', (event: MessageEvent<unknown>) => {
            recordOpenResult(state, this.pinnedFallbackWorkerId, this.pendingOpens, event.data);
          });
        }

        override postMessage(message: unknown, transfer: Transferable[]): void;
        override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
        override postMessage(
          message: unknown,
          transferOrOptions?: Transferable[] | StructuredSerializeOptions,
        ): void {
          if (this.probesRitoWorker) {
            recordOpenRequest(state, this.pinnedFallbackWorkerId, this.pendingOpens, message);
          }
          if (transferOrOptions === undefined) super.postMessage(message);
          else if (Array.isArray(transferOrOptions)) super.postMessage(message, transferOrOptions);
          else super.postMessage(message, transferOrOptions);
        }

        override terminate(): void {
          if (this.probesRitoWorker) {
            state.terminatedWorkerIds.push(this.pinnedFallbackWorkerId);
          }
          super.terminate();
        }
      }
      globalThis.Worker = PinnedFallbackWorkerProbe;
    }

    function recordOpenRequest(
      state: typeof probe,
      workerId: number,
      pendingOpens: Set<number>,
      value: unknown,
    ): void {
      const message = objectValue(value);
      if (message?.['kind'] !== 'open') return;
      if (typeof message['id'] === 'number') pendingOpens.add(message['id']);
      // A session opens with the policy's metadata as JSON and one byte
      // view per face.
      const policy = objectValue(message['pinnedFontPolicy']);
      const metadata = policyMetadata(policy?.['metadataJson']);
      const faces = arrayValue(metadata?.['faces']);
      const buffers = arrayValue(policy?.['faces']);
      state.openRequests.push({
        workerId,
        expectedSha256: faces.map((face) => {
          const record = objectValue(face);
          return typeof record?.['expectedSha256'] === 'string' ? record['expectedSha256'] : '';
        }),
        faceBufferByteLengths: buffers.map((buffer) =>
          buffer instanceof Uint8Array ? buffer.byteLength : -1,
        ),
      });
    }

    function policyMetadata(value: unknown): Record<string, unknown> | undefined {
      if (typeof value !== 'string') return undefined;
      try {
        return objectValue(JSON.parse(value));
      } catch {
        return undefined;
      }
    }

    function recordOpenResult(
      state: typeof probe,
      workerId: number,
      pendingOpens: Set<number>,
      value: unknown,
    ): void {
      const message = objectValue(value);
      const id = message?.['id'];
      if (typeof id !== 'number' || !pendingOpens.delete(id)) return;
      if (message?.['ok'] === true) state.openResults.push({ workerId });
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }

    function arrayValue(value: unknown): unknown[] {
      return Array.isArray(value) ? value : [];
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
      openRequests: probe.openRequests.map((request) => ({
        ...request,
        expectedSha256: [...request.expectedSha256],
        faceBufferByteLengths: [...request.faceBufferByteLengths],
      })),
      openResults: probe.openResults.map((result) => ({ ...result })),
      terminatedWorkerIds: [...probe.terminatedWorkerIds],
    };
  });
}
