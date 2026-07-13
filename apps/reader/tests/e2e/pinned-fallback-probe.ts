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

export interface PinnedFallbackWorkerOpenResultObservation {
  readonly workerId: number;
  readonly policyId: string;
  readonly faces: readonly {
    readonly sha256: string;
    readonly shapeFingerprint: string;
    readonly familyAlias: string;
    readonly byteLength: number;
    readonly genericRole: string;
    readonly language: string;
  }[];
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

        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.pinnedFallbackWorkerId = nextWorkerId;
          nextWorkerId += 1;
          this.probesRitoWorker = options?.name === 'rito-browser-reader';
          if (!this.probesRitoWorker) return;
          this.addEventListener('message', (event: MessageEvent<unknown>) => {
            recordOpenResult(state, this.pinnedFallbackWorkerId, event.data);
          });
        }

        override postMessage(message: unknown, transfer: Transferable[]): void;
        override postMessage(message: unknown, options?: StructuredSerializeOptions): void;
        override postMessage(
          message: unknown,
          transferOrOptions?: Transferable[] | StructuredSerializeOptions,
        ): void {
          if (this.probesRitoWorker) {
            recordOpenRequest(state, this.pinnedFallbackWorkerId, message);
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

    function recordOpenRequest(state: typeof probe, workerId: number, value: unknown): void {
      const message = objectValue(value);
      if (message?.['kind'] !== 'open') return;
      const metadata = objectValue(message['pinnedFontPolicyMetadata']);
      const faces = arrayValue(metadata?.['faces']);
      const buffers = arrayValue(message['pinnedFontFaceBuffers']);
      state.openRequests.push({
        workerId,
        expectedSha256: faces.map((face) => {
          const record = objectValue(face);
          return typeof record?.['expectedSha256'] === 'string' ? record['expectedSha256'] : '';
        }),
        faceBufferByteLengths: buffers.map((buffer) =>
          buffer instanceof ArrayBuffer ? buffer.byteLength : -1,
        ),
      });
    }

    function recordOpenResult(state: typeof probe, workerId: number, value: unknown): void {
      const message = objectValue(value);
      if (message?.['ok'] !== true) return;
      const payload = objectValue(message['payload']);
      if (payload?.['kind'] !== 'open') return;
      const result = objectValue(payload['result']);
      const policy = objectValue(result?.['pinnedFontPolicy']);
      const faces = arrayValue(policy?.['faces']).map((face) => {
        const record = objectValue(face);
        return {
          sha256: stringValue(record?.['sha256']),
          shapeFingerprint: stringValue(record?.['shapeFingerprint']),
          familyAlias: stringValue(record?.['familyAlias']),
          byteLength: numberValue(record?.['byteLength']),
          genericRole: stringValue(record?.['genericRole']),
          language: stringValue(record?.['language']),
        };
      });
      state.openResults.push({
        workerId,
        policyId: stringValue(policy?.['policyId']),
        faces,
      });
    }

    function objectValue(value: unknown): Record<string, unknown> | undefined {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
      return value as Record<string, unknown>;
    }

    function arrayValue(value: unknown): unknown[] {
      return Array.isArray(value) ? value : [];
    }

    function stringValue(value: unknown): string {
      return typeof value === 'string' ? value : '';
    }

    function numberValue(value: unknown): number {
      return typeof value === 'number' ? value : -1;
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
      openResults: probe.openResults.map((result) => ({
        ...result,
        faces: result.faces.map((face) => ({ ...face })),
      })),
      terminatedWorkerIds: [...probe.terminatedWorkerIds],
    };
  });
}
