import type {
  ReaderLongTaskObservation,
  ReaderWorkerOperationObservation,
} from './reader-worker-probe';
import type { ReaderProfileLongTaskSummary, ReaderProfileStartup } from './reader-profile-startup';

export type {
  ReaderProfileBrowserIsolation,
  ReaderProfileBrowserPolicy,
  ReaderProfileLongTaskSummary,
  ReaderProfileStartup,
} from './reader-profile-startup';

export const READER_PROFILE_SCHEMA_VERSION = 2;

export interface ReaderProfileViewport {
  readonly width: number;
  readonly height: number;
}

export interface ReaderProfileEnvironment {
  readonly machineId: string;
  readonly platform: string;
  readonly arch: string;
  readonly cpuModel: string;
  readonly osRelease: string;
  readonly browserName: string;
  readonly browserVersion: string;
  readonly deviceScaleFactor: number;
  readonly viewport: ReaderProfileViewport;
  readonly reflowViewport: ReaderProfileViewport;
}

export interface ReaderProfileFixture {
  readonly id: string;
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ReaderProfileOperationSummary {
  readonly kind: string;
  readonly count: number;
  readonly completed: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface ReaderProfileStage {
  readonly durationMs: number;
  readonly observedDurationMs: number;
  readonly operationsByKind: readonly ReaderProfileOperationSummary[];
  readonly operations: readonly ReaderWorkerOperationObservation[];
  readonly longTasks: ReaderProfileLongTaskSummary;
}

export interface ReaderProfileMilestones {
  readonly inputToOpenMs: number;
  readonly openRoundTripMs: number;
  readonly boundedToPresentationMs: number;
  readonly frameWarmRoundTripMs: number;
  readonly aggregateReadMs: number;
  readonly hostCommitGapMs: number;
  readonly loadedToCanvasMs: number;
  readonly loadedMs: number;
  readonly canvasReadyMs: number;
}

export interface ReaderProfileTransition {
  readonly fromSpread: number;
  readonly toSpread: number;
  readonly knownSpreadCountBefore: number;
  readonly knownSpreadCountAfter: number;
  readonly checksumBefore: string;
  readonly checksumAfter: string;
}

export interface ReaderLoadProfileReport {
  readonly schemaVersion: typeof READER_PROFILE_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly environment: ReaderProfileEnvironment;
  readonly fixture: ReaderProfileFixture;
  readonly startup: ReaderProfileStartup;
  readonly milestones: ReaderProfileMilestones;
  readonly stages: {
    readonly initial: ReaderProfileStage;
    readonly cachedTurn: ReaderProfileStage;
    readonly deferredGrowth: ReaderProfileStage;
    readonly reflow: ReaderProfileStage;
  };
  readonly transitions: {
    readonly cachedTurn: ReaderProfileTransition;
    readonly deferredGrowth: ReaderProfileTransition;
  };
  readonly operationsByKind: readonly ReaderProfileOperationSummary[];
  readonly operations: readonly ReaderWorkerOperationObservation[];
  readonly longTasks: ReaderProfileLongTaskSummary;
  readonly browserErrors: readonly string[];
}

export interface ReaderProfileStageInput {
  readonly startedAt: number;
  readonly completedAt: number;
  readonly observedUntil: number;
  readonly operations: readonly ReaderWorkerOperationObservation[];
  readonly longTasks: readonly ReaderLongTaskObservation[];
}

export interface ReaderLoadProfileReportInput {
  readonly generatedAt: string;
  readonly environment: ReaderProfileEnvironment;
  readonly fixture: ReaderProfileFixture;
  readonly startup: ReaderProfileStartup;
  readonly startedAt: number;
  readonly loadedAt: number;
  readonly canvasAt: number;
  readonly initial: ReaderProfileStageInput;
  readonly cachedTurn: ReaderProfileStageInput;
  readonly deferredGrowth: ReaderProfileStageInput;
  readonly reflow: ReaderProfileStageInput;
  readonly cachedTurnTransition: ReaderProfileTransition;
  readonly deferredGrowthTransition: ReaderProfileTransition;
  readonly operations: readonly ReaderWorkerOperationObservation[];
  readonly longTasks: readonly ReaderLongTaskObservation[];
  readonly browserErrors: readonly string[];
}

export function buildReaderLoadProfileReport(
  input: ReaderLoadProfileReportInput,
): ReaderLoadProfileReport {
  return {
    schemaVersion: READER_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    environment: input.environment,
    fixture: input.fixture,
    startup: input.startup,
    milestones: profileMilestones(input),
    stages: {
      initial: profileStage(input.initial),
      cachedTurn: profileStage(input.cachedTurn),
      deferredGrowth: profileStage(input.deferredGrowth),
      reflow: profileStage(input.reflow),
    },
    transitions: {
      cachedTurn: input.cachedTurnTransition,
      deferredGrowth: input.deferredGrowthTransition,
    },
    operationsByKind: summarizeOperations(input.operations),
    operations: input.operations.map(roundOperation),
    longTasks: summarizeLongTasks(input.longTasks),
    browserErrors: [...input.browserErrors],
  };
}

function profileMilestones(input: ReaderLoadProfileReportInput): ReaderProfileMilestones {
  const open = firstOperation(input.initial.operations, 'open');
  const bounded = firstOperation(input.initial.operations, 'createBoundedRevision');
  const presentation = firstOperation(
    input.initial.operations,
    'getRevisionPresentationAtRevision',
  );
  const frame = firstOperation(input.initial.operations, 'warmFrameWindowAtRevision');
  const aggregates = [
    firstOperation(input.initial.operations, 'getFootnotesAtRevision'),
    firstOperation(input.initial.operations, 'getChapterTextIndicesAtRevision'),
  ].filter((entry): entry is ReaderWorkerOperationObservation => entry !== undefined);
  const prerequisiteEnd = Math.max(
    input.startedAt,
    frame?.completedAt ?? input.startedAt,
    ...aggregates.map((entry) => entry.completedAt ?? input.startedAt),
  );
  return {
    inputToOpenMs: rounded((open?.startedAt ?? input.startedAt) - input.startedAt),
    openRoundTripMs: rounded(open?.durationMs ?? 0),
    boundedToPresentationMs: rounded(
      (presentation?.completedAt ?? bounded?.startedAt ?? input.startedAt) -
        (bounded?.startedAt ?? input.startedAt),
    ),
    frameWarmRoundTripMs: rounded(frame?.durationMs ?? 0),
    aggregateReadMs: rounded(operationInterval(aggregates)),
    hostCommitGapMs: rounded(input.loadedAt - prerequisiteEnd),
    loadedToCanvasMs: rounded(input.canvasAt - input.loadedAt),
    loadedMs: rounded(input.loadedAt - input.startedAt),
    canvasReadyMs: rounded(input.canvasAt - input.startedAt),
  };
}

function profileStage(input: ReaderProfileStageInput): ReaderProfileStage {
  return {
    durationMs: rounded(input.completedAt - input.startedAt),
    observedDurationMs: rounded(input.observedUntil - input.startedAt),
    operationsByKind: summarizeOperations(input.operations),
    operations: input.operations.map(roundOperation),
    longTasks: summarizeLongTasks(input.longTasks),
  };
}

function firstOperation(
  operations: readonly ReaderWorkerOperationObservation[],
  kind: string,
): ReaderWorkerOperationObservation | undefined {
  return operations.find((entry) => entry.kind === kind);
}

function operationInterval(operations: readonly ReaderWorkerOperationObservation[]): number {
  if (operations.length === 0) return 0;
  return (
    Math.max(...operations.map((entry) => entry.completedAt ?? entry.startedAt)) -
    Math.min(...operations.map((entry) => entry.startedAt))
  );
}

function summarizeOperations(
  operations: readonly ReaderWorkerOperationObservation[],
): ReaderProfileOperationSummary[] {
  const kinds = [...new Set(operations.map((entry) => entry.kind))];
  return kinds.map((kind) => {
    const matching = operations.filter((entry) => entry.kind === kind);
    const durations = matching.flatMap((entry) =>
      entry.durationMs === null ? [] : [entry.durationMs],
    );
    return {
      kind,
      count: matching.length,
      completed: durations.length,
      totalMs: rounded(durations.reduce((total, duration) => total + duration, 0)),
      maxMs: rounded(Math.max(0, ...durations)),
    };
  });
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

function roundOperation(
  operation: ReaderWorkerOperationObservation,
): ReaderWorkerOperationObservation {
  return {
    ...operation,
    startedAt: rounded(operation.startedAt),
    completedAt: operation.completedAt === null ? null : rounded(operation.completedAt),
    durationMs: operation.durationMs === null ? null : rounded(operation.durationMs),
    requestedRevision: operation.requestedRevision ? { ...operation.requestedRevision } : null,
    revision: operation.revision ? { ...operation.revision } : null,
  };
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}
