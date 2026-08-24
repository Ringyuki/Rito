import type { Page } from '@playwright/test';
import type { ReaderProfileAnimationMetrics } from './reader-profile-toc-model';
import type { ReaderTransitionLifecycle } from './reader-transition-harness';

const SAMPLE_SIZE = 32;
const STORED_SAMPLE_BUDGET_BYTES = 2 * 1024 * 1024;
const ESTIMATED_STORED_SAMPLE_BYTES = 160;
const MAX_SAMPLES = Math.min(
  12_000,
  Math.floor(STORED_SAMPLE_BUDGET_BYTES / ESTIMATED_STORED_SAMPLE_BYTES),
);

export interface ReaderVisualTransitionSample {
  readonly observedAt: number;
  readonly checksum: string;
  readonly nonBlank: boolean;
  readonly activeHref: string;
  readonly transitioning: 'true' | 'false';
}

export interface ReaderVisualTransitionSnapshot {
  readonly samples: readonly ReaderVisualTransitionSample[];
  readonly overflowed: boolean;
  readonly sampleSize: number;
  readonly maxSamples: number;
  readonly storedSampleBudgetBytes: number;
}

export interface ReaderVisualTurnMeasurement {
  readonly animation: ReaderProfileAnimationMetrics;
  readonly firstVisualChangeAt: number;
  readonly firstTargetFrameAt: number;
}

export interface ReaderAtomicVisualTurnMeasurement {
  readonly firstVisualChangeAt: number;
  readonly firstTargetFrameAt: number;
}

interface ReaderVisualTransitionSamplerState {
  readonly samples: ReaderVisualTransitionSample[];
  readonly maxSamples: number;
  overflowed: boolean;
  animationFrameId: number | undefined;
}

interface ReaderVisualTransitionSamplerRuntime {
  __RITO_READER_VISUAL_TRANSITION_STATE__?: ReaderVisualTransitionSamplerState;
  __RITO_READER_CAPTURE_VISUAL_TRANSITION__?: () => void;
}

export async function startReaderVisualTransitionSampler(page: Page): Promise<void> {
  await page.evaluate(
    ({ sampleSize, maxSamples }) => {
      const runtime = globalThis as typeof globalThis & ReaderVisualTransitionSamplerRuntime;
      if (runtime.__RITO_READER_VISUAL_TRANSITION_STATE__) {
        throw new Error('Reader visual transition sampler is already active');
      }
      const shell = document.querySelector('[data-testid="reader-shell"]');
      if (!(shell instanceof HTMLElement)) throw new Error('Reader shell is unavailable');
      const state: ReaderVisualTransitionSamplerState = {
        samples: [],
        maxSamples,
        overflowed: false,
        animationFrameId: undefined,
      };
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = sampleSize;
      sampleCanvas.height = sampleSize;
      const sampleContext = sampleCanvas.getContext('2d');
      if (!sampleContext) throw new Error('Reader visual sample context is unavailable');
      const capture = (): void => {
        if (state.samples.length >= state.maxSamples) {
          state.overflowed = true;
          return;
        }
        state.samples.push(sampleReader(shell, sampleSize, sampleContext));
      };
      const tick = (): void => {
        capture();
        if (state.overflowed) return;
        state.animationFrameId = requestAnimationFrame(tick);
      };
      runtime.__RITO_READER_VISUAL_TRANSITION_STATE__ = state;
      runtime.__RITO_READER_CAPTURE_VISUAL_TRANSITION__ = capture;
      capture();
      state.animationFrameId = requestAnimationFrame(tick);

      function sampleReader(
        readerShell: HTMLElement,
        size: number,
        context: CanvasRenderingContext2D,
      ): ReaderVisualTransitionSample {
        const transitioning = readerShell.getAttribute('data-transitioning');
        if (transitioning !== 'true' && transitioning !== 'false') {
          throw new Error(`Invalid reader transition state: ${String(transitioning)}`);
        }
        const shellRect = readerShell.getBoundingClientRect();
        if (shellRect.width <= 0 || shellRect.height <= 0) {
          throw new Error('Reader shell has no visual area');
        }
        context.globalAlpha = 1;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, size, size);
        const scaleX = size / shellRect.width;
        const scaleY = size / shellRect.height;
        for (const canvas of readerShell.querySelectorAll('canvas')) {
          if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0 || canvas.height === 0) {
            continue;
          }
          const opacity = effectiveOpacity(canvas, readerShell);
          if (opacity <= 0) continue;
          const rect = canvas.getBoundingClientRect();
          if (
            rect.right <= shellRect.left ||
            rect.left >= shellRect.right ||
            rect.bottom <= shellRect.top ||
            rect.top >= shellRect.bottom
          ) {
            continue;
          }
          context.globalAlpha = opacity;
          context.drawImage(
            canvas,
            (rect.left - shellRect.left) * scaleX,
            (rect.top - shellRect.top) * scaleY,
            rect.width * scaleX,
            rect.height * scaleY,
          );
        }
        context.globalAlpha = 1;
        const pixels = context.getImageData(0, 0, size, size).data;
        let hash = 2_166_136_261;
        let nonBlank = false;
        for (let index = 0; index < pixels.length; index += 4) {
          const red = pixels[index] ?? 0;
          const green = pixels[index + 1] ?? 0;
          const blue = pixels[index + 2] ?? 0;
          const alpha = pixels[index + 3] ?? 0;
          hash = hashByte(hash, red);
          hash = hashByte(hash, green);
          hash = hashByte(hash, blue);
          hash = hashByte(hash, alpha);
          if (
            alpha > 0 &&
            Math.abs(red - 255) + Math.abs(green - 255) + Math.abs(blue - 255) > 24
          ) {
            nonBlank = true;
          }
        }
        return {
          observedAt: performance.now(),
          checksum: `${String(size)}x${String(size)}:${String(hash >>> 0)}`,
          nonBlank,
          activeHref: readerShell.getAttribute('data-active-chapter-href') ?? '',
          transitioning,
        };
      }

      function effectiveOpacity(element: HTMLElement, readerShell: HTMLElement): number {
        let opacity = 1;
        let current: HTMLElement | null = element;
        while (current && current !== readerShell) {
          const style = getComputedStyle(current);
          if (style.display === 'none' || style.visibility === 'hidden') return 0;
          const localOpacity = Number(style.opacity);
          if (Number.isFinite(localOpacity)) opacity *= localOpacity;
          current = current.parentElement;
        }
        return opacity;
      }

      function hashByte(hash: number, value: number): number {
        return Math.imul(hash ^ value, 16_777_619);
      }
    },
    { sampleSize: SAMPLE_SIZE, maxSamples: MAX_SAMPLES },
  );
}

/** Establishes a per-run nominal rAF interval before the measured input. */
export async function calibrateReaderVisualTransitionSampler(
  page: Page,
  frameCount = 12,
): Promise<void> {
  await page.evaluate(async (count) => {
    for (let frame = 0; frame < count; frame += 1) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => {
          resolve();
        }),
      );
    }
  }, frameCount);
}

export async function stopReaderVisualTransitionSampler(
  page: Page,
): Promise<ReaderVisualTransitionSnapshot | undefined> {
  return page.evaluate(
    ({ sampleSize, storedSampleBudgetBytes }) => {
      const runtime = globalThis as typeof globalThis & ReaderVisualTransitionSamplerRuntime;
      const state = runtime.__RITO_READER_VISUAL_TRANSITION_STATE__;
      if (!state) return undefined;
      if (state.animationFrameId !== undefined) cancelAnimationFrame(state.animationFrameId);
      runtime.__RITO_READER_CAPTURE_VISUAL_TRANSITION__?.();
      const snapshot: ReaderVisualTransitionSnapshot = {
        samples: state.samples.map((entry) => ({ ...entry })),
        overflowed: state.overflowed,
        sampleSize,
        maxSamples: state.maxSamples,
        storedSampleBudgetBytes,
      };
      delete runtime.__RITO_READER_VISUAL_TRANSITION_STATE__;
      delete runtime.__RITO_READER_CAPTURE_VISUAL_TRANSITION__;
      return snapshot;
    },
    { sampleSize: SAMPLE_SIZE, storedSampleBudgetBytes: STORED_SAMPLE_BUDGET_BYTES },
  );
}

export function requireVisualReaderTurn(
  snapshot: ReaderVisualTransitionSnapshot,
  lifecycle: ReaderTransitionLifecycle,
  fromHref: string,
  toHref: string,
): void {
  if (snapshot.overflowed) throw new Error('Reader visual transition sample budget overflowed');
  const first = snapshot.samples[0];
  const final = snapshot.samples.at(-1);
  if (!first?.nonBlank || first.activeHref !== fromHref || first.transitioning !== 'false') {
    throw new Error('Reader visual transition did not begin on the settled old frame');
  }
  if (!final?.nonBlank || final.activeHref !== toHref || final.transitioning !== 'false') {
    throw new Error('Reader visual transition did not finish on the settled target frame');
  }
  if (first.checksum === final.checksum) {
    throw new Error('Reader visual transition old and target frames are identical');
  }
  const animatedSamples = snapshot.samples.filter(
    (entry) => entry.observedAt > lifecycle.startedAt && entry.observedAt < lifecycle.endedAt,
  );
  if (animatedSamples.length === 0) {
    throw new Error('Reader transition lifecycle completed within one animation-frame interval');
  }
  if (
    !animatedSamples.some(
      (entry) => entry.checksum !== first.checksum && entry.checksum !== final.checksum,
    )
  ) {
    throw new Error('Reader transition did not expose an intermediate visual frame');
  }
  const firstTargetVisual = snapshot.samples.findIndex(
    (entry) => entry.activeHref === toHref && entry.checksum !== first.checksum,
  );
  if (firstTargetVisual < 0) throw new Error('Reader transition never exposed its target visual');
  if (
    snapshot.samples.slice(firstTargetVisual + 1).some((entry) => entry.checksum === first.checksum)
  ) {
    throw new Error('Reader transition flashed back to the old frame after target preview');
  }
}

export function requireAtomicReaderTurn(
  snapshot: ReaderVisualTransitionSnapshot,
  fromHref: string,
  toHref: string,
): void {
  if (snapshot.overflowed) throw new Error('Reader visual transition sample budget overflowed');
  const first = snapshot.samples[0];
  const final = snapshot.samples.at(-1);
  if (!first?.nonBlank || first.activeHref !== fromHref || first.transitioning !== 'false') {
    throw new Error('Reader atomic turn did not begin on the settled old frame');
  }
  if (!final?.nonBlank || final.activeHref !== toHref || final.transitioning !== 'false') {
    throw new Error('Reader atomic turn did not finish on the settled target frame');
  }
  if (first.checksum === final.checksum) {
    throw new Error('Reader atomic turn old and target frames are identical');
  }
  if (snapshot.samples.some((entry) => entry.transitioning !== 'false')) {
    throw new Error('Reader exact-only control unexpectedly exposed an animated lifecycle');
  }
}

export function measureAtomicReaderTurn(
  snapshot: ReaderVisualTransitionSnapshot,
  acceptedAt: number,
  toHref: string,
): ReaderAtomicVisualTurnMeasurement {
  return visualTurnResponse(snapshot, acceptedAt, toHref);
}

export function measureVisualReaderTurn(
  snapshot: ReaderVisualTransitionSnapshot,
  lifecycle: ReaderTransitionLifecycle,
  acceptedAt: number,
  toHref: string,
): ReaderVisualTurnMeasurement {
  requireMonotonicSamples(snapshot.samples);
  const response = visualTurnResponse(snapshot, acceptedAt, toHref);
  const calibrationIntervals = intervals(
    snapshot.samples
      .filter((entry) => entry.observedAt < acceptedAt)
      .map((entry) => entry.observedAt),
  );
  if (calibrationIntervals.length < 6) {
    throw new Error('Reader visual transition has insufficient pre-input rAF calibration');
  }
  const nominalFrameIntervalMs = percentile(calibrationIntervals, 0.5);
  if (!(nominalFrameIntervalMs > 0)) {
    throw new Error('Reader visual transition has an invalid nominal frame interval');
  }
  if (response.firstTargetFrameAt - lifecycle.endedAt > nominalFrameIntervalMs * 1.5) {
    throw new Error('Reader target visual appeared more than one rAF after transition end');
  }
  const animatedSamples = perceptibleMotionSamples(
    snapshot.samples,
    lifecycle,
    nominalFrameIntervalMs,
  );
  const frameIntervals = intervals(animatedSamples.map((entry) => entry.observedAt));
  if (frameIntervals.length === 0) {
    throw new Error('Reader visual transition has insufficient animation frame samples');
  }
  const overBudgetThreshold = nominalFrameIntervalMs * 1.5;
  return {
    ...response,
    animation: {
      durationMs: rounded(
        (animatedSamples.at(-1)?.observedAt ?? lifecycle.startedAt) - lifecycle.startedAt,
      ),
      sampledFrameCount: animatedSamples.length,
      nominalFrameIntervalMs: rounded(nominalFrameIntervalMs),
      p50FrameIntervalMs: rounded(percentile(frameIntervals, 0.5)),
      p95FrameIntervalMs: rounded(percentile(frameIntervals, 0.95)),
      maxFrameIntervalMs: rounded(Math.max(...frameIntervals)),
      overBudgetFrameIntervalCount: frameIntervals.filter(
        (interval) => interval > overBudgetThreshold,
      ).length,
      estimatedDroppedFrameCount: frameIntervals.reduce(
        (total, interval) => total + Math.max(0, Math.round(interval / nominalFrameIntervalMs) - 1),
        0,
      ),
      distinctVisualCount: new Set(animatedSamples.map((entry) => entry.checksum)).size,
      blankFrameCount: animatedSamples.filter((entry) => !entry.nonBlank).length,
    },
  };
}

function visualTurnResponse(
  snapshot: ReaderVisualTransitionSnapshot,
  acceptedAt: number,
  toHref: string,
): ReaderAtomicVisualTurnMeasurement {
  requireMonotonicSamples(snapshot.samples);
  const first = snapshot.samples[0];
  if (!first) throw new Error('Reader visual transition has no baseline sample');
  const firstVisualChange = snapshot.samples.find(
    (entry) =>
      entry.observedAt >= acceptedAt && entry.nonBlank && entry.checksum !== first.checksum,
  );
  if (!firstVisualChange) throw new Error('Reader visual transition has no changed visual sample');
  const firstTargetFrame = snapshot.samples.find(
    (entry) =>
      entry.observedAt >= acceptedAt &&
      entry.nonBlank &&
      entry.activeHref === toHref &&
      entry.checksum !== first.checksum,
  );
  if (!firstTargetFrame) throw new Error('Reader visual transition has no target visual sample');
  return {
    firstVisualChangeAt: firstVisualChange.observedAt,
    firstTargetFrameAt: firstTargetFrame.observedAt,
  };
}

function perceptibleMotionSamples(
  samples: readonly ReaderVisualTransitionSample[],
  lifecycle: ReaderTransitionLifecycle,
  nominalFrameIntervalMs: number,
): readonly ReaderVisualTransitionSample[] {
  const firstInside = samples.findIndex((entry) => entry.observedAt >= lifecycle.startedAt);
  if (firstInside < 0) return [];
  const firstIndex = Math.max(0, firstInside - 1);
  const firstAfter = samples.findIndex(
    (entry, index) => index >= firstInside && entry.observedAt > lifecycle.endedAt,
  );
  const lifecycleEnd = firstAfter < 0 ? samples.length : firstAfter;
  const stableFrames = Math.max(4, Math.ceil(100 / nominalFrameIntervalMs));
  const stableStart = firstStableVisualRun(samples, firstInside, lifecycleEnd, stableFrames);
  const lastIndex = stableStart < 0 ? lifecycleEnd - 1 : stableStart;
  return samples.slice(firstIndex, lastIndex + 1);
}

function firstStableVisualRun(
  samples: readonly ReaderVisualTransitionSample[],
  start: number,
  end: number,
  requiredFrames: number,
): number {
  for (let index = start; index + requiredFrames <= end; index += 1) {
    const candidate = samples[index];
    if (!candidate?.nonBlank) continue;
    const stable = samples
      .slice(index, index + requiredFrames)
      .every(
        (entry) =>
          entry.nonBlank &&
          entry.checksum === candidate.checksum &&
          entry.activeHref === candidate.activeHref,
      );
    if (stable) return index;
  }
  return -1;
}

function requireMonotonicSamples(samples: readonly ReaderVisualTransitionSample[]): void {
  let previous: ReaderVisualTransitionSample | undefined;
  for (const sample of samples) {
    if (previous && sample.observedAt < previous.observedAt) {
      throw new Error('Reader visual transition samples are not chronological');
    }
    previous = sample;
  }
}

function intervals(timestamps: readonly number[]): number[] {
  const result: number[] = [];
  let previous: number | undefined;
  for (const timestamp of timestamps) {
    if (previous !== undefined) result.push(timestamp - previous);
    previous = timestamp;
  }
  return result;
}

function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) throw new Error('Reader visual transition percentile is empty');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1);
  const result = sorted[Math.max(0, index)];
  if (result === undefined) throw new Error('Reader visual transition percentile is empty');
  return result;
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
