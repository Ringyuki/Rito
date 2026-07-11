import { vi } from 'vitest';

import {
  createMockCanvasContext,
  isCall,
  type CanvasRecord,
  type MockCanvasContext,
} from './mock-canvas-context';

type CanvasMode = 'context' | 'null' | 'missing';

export interface ScratchCanvasEnvironmentOptions {
  readonly offscreen: CanvasMode;
  readonly dom: CanvasMode;
  readonly throwOnFillTextCall?: number;
}

interface CanvasDimensions {
  width: number;
  height: number;
}

export interface ScratchCanvasCapture {
  readonly kind: 'offscreen' | 'dom';
  readonly canvas: CanvasDimensions;
  readonly getContextCalls: string[];
  readonly recorder: MockCanvasContext;
  readonly context: CanvasRenderingContext2D;
}

export interface ScratchCanvasEnvironment {
  readonly scratch: ScratchCanvasCapture[];
  readonly domCreateElementCalls: string[];
}

export interface ScratchCanvasSnapshot {
  readonly kind: ScratchCanvasCapture['kind'];
  readonly width: number;
  readonly height: number;
  readonly getContextCalls: readonly string[];
  readonly records: readonly CanvasRecord[];
}

export interface CanvasRecordsSnapshot {
  readonly main: readonly CanvasRecord[];
  readonly scratch: readonly ScratchCanvasSnapshot[];
  readonly domCreateElementCalls: readonly string[];
}

export function installScratchCanvasEnvironment(
  options: ScratchCanvasEnvironmentOptions,
): ScratchCanvasEnvironment {
  const scratch: ScratchCanvasCapture[] = [];
  const domCreateElementCalls: string[] = [];

  class FakeOffscreenCanvas implements CanvasDimensions {
    readonly capture: ScratchCanvasCapture;

    constructor(
      readonly width: number,
      readonly height: number,
    ) {
      this.capture = captureScratch('offscreen', this, options, scratch);
    }

    getContext(contextId: string): CanvasRenderingContext2D | null {
      this.capture.getContextCalls.push(contextId);
      return options.offscreen === 'null' ? null : this.capture.context;
    }
  }

  class FakeDomCanvas implements CanvasDimensions {
    width = 0;
    height = 0;
    readonly capture = captureScratch('dom', this, options, scratch);

    getContext(contextId: string): CanvasRenderingContext2D | null {
      this.capture.getContextCalls.push(contextId);
      return options.dom === 'null' ? null : this.capture.context;
    }
  }

  vi.stubGlobal(
    'OffscreenCanvas',
    options.offscreen === 'missing' ? undefined : FakeOffscreenCanvas,
  );
  vi.stubGlobal(
    'document',
    options.dom === 'missing'
      ? undefined
      : {
          createElement(tagName: string) {
            domCreateElementCalls.push(tagName);
            return new FakeDomCanvas();
          },
        },
  );
  return { scratch, domCreateElementCalls };
}

export function snapshotCanvasRecords(
  main: MockCanvasContext,
  environment: ScratchCanvasEnvironment,
): CanvasRecordsSnapshot {
  return {
    main: normalizeRecords(main.records, environment.scratch),
    scratch: environment.scratch.map((capture) => ({
      kind: capture.kind,
      width: capture.canvas.width,
      height: capture.canvas.height,
      getContextCalls: [...capture.getContextCalls],
      records: normalizeRecords(capture.recorder.records, environment.scratch),
    })),
    domCreateElementCalls: [...environment.domCreateElementCalls],
  };
}

function captureScratch(
  kind: ScratchCanvasCapture['kind'],
  canvas: CanvasDimensions,
  options: ScratchCanvasEnvironmentOptions,
  captures: ScratchCanvasCapture[],
): ScratchCanvasCapture {
  const recorder = createMockCanvasContext();
  const context = options.throwOnFillTextCall
    ? contextThrowingOnFillText(recorder.ctx, options.throwOnFillTextCall)
    : recorder.ctx;
  const capture = { kind, canvas, getContextCalls: [], recorder, context };
  captures.push(capture);
  return capture;
}

function contextThrowingOnFillText(
  ctx: CanvasRenderingContext2D,
  throwOnCall: number,
): CanvasRenderingContext2D {
  let calls = 0;
  return new Proxy(ctx, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (property !== 'fillText' || typeof value !== 'function') return value;
      return (...args: readonly unknown[]) => {
        calls += 1;
        Reflect.apply(value, target, args);
        if (calls === throwOnCall) throw new Error('forced scratch fillText failure');
      };
    },
  });
}

function normalizeRecords(
  records: readonly CanvasRecord[],
  scratch: readonly ScratchCanvasCapture[],
): readonly CanvasRecord[] {
  return records.map((record) =>
    isCall(record)
      ? { method: record.method, args: record.args.map((value) => normalizeValue(value, scratch)) }
      : { property: record.property, value: normalizeValue(record.value, scratch) },
  );
}

function normalizeValue(value: unknown, scratch: readonly ScratchCanvasCapture[]): unknown {
  const index = scratch.findIndex((capture) => capture.canvas === value);
  const capture = scratch[index];
  return capture
    ? {
        scratchCanvas: index,
        kind: capture.kind,
        width: capture.canvas.width,
        height: capture.canvas.height,
      }
    : value;
}
