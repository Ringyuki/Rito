import type { ReaderProfileStage, ReaderProfileStageInput } from './reader-profile-model';

export interface ReaderProfileFarTocStage extends ReaderProfileStage {
  /** All reader-worker requests posted after the click was accepted and before first target paint. */
  readonly workerRequestsToFirstFrame: number;
}

export interface ReaderProfileFarTocStageInput extends ReaderProfileStageInput {
  readonly workerRequestsToFirstFrame: number;
}

export interface ReaderProfileTocTransition {
  readonly fromHref: string;
  readonly toHref: string;
  readonly checksumBefore: string;
  readonly checksumAfter: string;
}

interface ReaderProfileCommonTocLatency {
  readonly acceptedToFirstVisualChangeMs: number;
  readonly acceptedToFirstTargetFrameMs: number;
  readonly acceptedToStableIdleObservationMs: number;
}

export interface ReaderProfileAnimatedTocLatency extends ReaderProfileCommonTocLatency {
  readonly acceptedToTransitionStartMs: number;
  /** Signed target rAF time minus logical transition end; positive is after end. */
  readonly firstTargetFrameRelativeToTransitionEndMs: number;
  readonly acceptedToTransitionEndMs: number;
}

export interface ReaderProfileAtomicTocLatency extends ReaderProfileCommonTocLatency {
  readonly acceptedToTransitionStartMs: null;
  readonly firstTargetFrameRelativeToTransitionEndMs: null;
  readonly acceptedToTransitionEndMs: null;
}

export type ReaderProfileTocLatency =
  | ReaderProfileAnimatedTocLatency
  | ReaderProfileAtomicTocLatency;

export interface ReaderProfileAnimationMetrics {
  /** Perceptible Canvas motion, excluding a later static exact-layout handoff. */
  readonly durationMs: number;
  readonly sampledFrameCount: number;
  readonly nominalFrameIntervalMs: number;
  readonly p50FrameIntervalMs: number;
  readonly p95FrameIntervalMs: number;
  readonly maxFrameIntervalMs: number;
  readonly overBudgetFrameIntervalCount: number;
  /** Sum of missing nominal intervals inferred from sampled rAF gaps. */
  readonly estimatedDroppedFrameCount: number;
  readonly distinctVisualCount: number;
  readonly blankFrameCount: number;
}

export type ReaderProfileFarTocTransition = ReaderProfileTocTransition &
  (
    | {
        readonly presentation: 'animated';
        readonly latency: ReaderProfileAnimatedTocLatency;
        readonly animation: ReaderProfileAnimationMetrics;
      }
    | {
        readonly presentation: 'atomic';
        readonly latency: ReaderProfileAtomicTocLatency;
        readonly animation: null;
      }
  );

export interface ReaderProfileActiveHrefObservation {
  readonly href: string;
  readonly observedAt: number;
}

export interface ReaderProfileHeldTocResponse {
  readonly workerId: number;
  readonly category: 'mainContinuation' | 'chapterLocalMutation';
  readonly kind: string;
  readonly requestId: number;
  readonly heldAt: number;
  readonly releasedAt: number;
}

export interface ReaderProfileTocSupersedeTransitionInput extends ReaderProfileTocTransition {
  readonly supersededHref: string;
  readonly observedHrefs: readonly string[];
  readonly observedHrefObservations: readonly ReaderProfileActiveHrefObservation[];
  /** The near-target click time at which the earlier far intent became stale. */
  readonly supersededAt: number;
  readonly heldContinuationRequestId: number;
  readonly heldResponses: readonly ReaderProfileHeldTocResponse[];
}

export interface ReaderProfileTocSupersedeTransition extends ReaderProfileTocTransition {
  readonly supersededHref: string;
  readonly observedHrefs: readonly string[];
  readonly observedHrefObservations: readonly ReaderProfileActiveHrefObservation[];
  readonly supersededAt: number;
  readonly heldContinuationRequestId: number;
  readonly heldResponses: readonly ReaderProfileHeldTocResponse[];
  readonly staleCommitCount: number;
}

export function buildTocSupersedeTransition(
  input: ReaderProfileTocSupersedeTransitionInput,
): ReaderProfileTocSupersedeTransition {
  const observedHrefs = [...input.observedHrefs];
  const observedHrefObservations = input.observedHrefObservations.map((entry) => ({ ...entry }));
  return {
    ...input,
    observedHrefs,
    observedHrefObservations,
    heldResponses: input.heldResponses.map((entry) => ({ ...entry })),
    staleCommitCount: observedHrefObservations.filter(
      (entry) => entry.href === input.supersededHref && entry.observedAt >= input.supersededAt,
    ).length,
  };
}

export interface ReaderProfileFreshFarGeneration {
  readonly previousRevisionIds: readonly string[];
  readonly freshRevisionIds: readonly string[];
  readonly previousWorkerCount: number;
  readonly closedWorkerCount: number;
  readonly workersBeforeOpen: number;
  readonly freshWorkerCount: number;
  readonly positionStorageKey: string;
  readonly positionClearedBeforeOpen: boolean;
  readonly freshProbeOperationIndex: number;
  readonly freshOpenRequestId: number;
  readonly freshRevisionRequestId: number;
  readonly checksumAfter: string;
}

export function copyFreshFarGeneration(
  input: ReaderProfileFreshFarGeneration,
): ReaderProfileFreshFarGeneration {
  return {
    ...input,
    previousRevisionIds: [...input.previousRevisionIds],
    freshRevisionIds: [...input.freshRevisionIds],
  };
}
