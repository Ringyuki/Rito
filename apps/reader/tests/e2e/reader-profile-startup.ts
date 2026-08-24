import type { ReaderLongTaskObservation } from './reader-worker-probe';
import type { ReaderStartupProbeSnapshot, ReaderStartupColorScheme } from './reader-startup-probe';

export type ReaderProfileBrowserIsolation = 'shared-process' | 'process-per-run';

export interface ReaderProfileBrowserPolicy {
  readonly isolation: ReaderProfileBrowserIsolation;
  readonly channel: string;
  readonly headless: boolean;
  readonly locale: string;
  readonly colorScheme: ReaderStartupColorScheme;
}

export interface ReaderProfileLongTaskSummary {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface ReaderProfileStartup {
  readonly browser: ReaderProfileBrowserPolicy;
  readonly browserLaunchMs: number | null;
  readonly navigationToReaderReadyMs: number;
  readonly navigationToFirstCanvasMs: number;
  readonly longTasks: ReaderProfileLongTaskSummary;
}

interface ReaderProfileStartupInput {
  readonly browser: ReaderProfileBrowserPolicy;
  readonly browserLaunchMs: number | null;
  readonly snapshot: ReaderStartupProbeSnapshot;
  readonly firstCanvasAt: number;
  readonly longTasks: readonly ReaderLongTaskObservation[];
}

export function buildReaderProfileStartup(input: ReaderProfileStartupInput): ReaderProfileStartup {
  const browserLaunchMs = input.browserLaunchMs === null ? null : rounded(input.browserLaunchMs);
  const startupLongTasks = input.longTasks.filter(
    (entry) =>
      entry.startTime <= input.firstCanvasAt &&
      entry.startTime + entry.duration >= input.snapshot.initializedAt,
  );
  return {
    browser: {
      ...input.browser,
      locale: input.snapshot.locale,
      colorScheme: input.snapshot.colorScheme,
    },
    browserLaunchMs,
    navigationToReaderReadyMs: rounded(
      input.snapshot.readerReadyAt - input.snapshot.navigationStartedAt,
    ),
    navigationToFirstCanvasMs: rounded(input.firstCanvasAt - input.snapshot.navigationStartedAt),
    longTasks: summarizeLongTasks(startupLongTasks),
  };
}

function summarizeLongTasks(
  longTasks: readonly ReaderLongTaskObservation[],
): ReaderProfileLongTaskSummary {
  return {
    count: longTasks.length,
    totalMs: rounded(longTasks.reduce((total, task) => total + task.duration, 0)),
    maxMs: rounded(Math.max(0, ...longTasks.map((task) => task.duration))),
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
