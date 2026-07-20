import type { BrowserReaderBoundedSnapshot, BrowserReaderRevisionResult } from './core-contracts';
import {
  prepareControllerOwnedBrowserReaderCommitFrame,
  type BrowserReaderPreparedCommitFrame,
} from './revision-commit';
import { prepareControllerOwnedRevisionFonts } from './required-fonts';
import type { BrowserReaderBoundedSnapshotCommitContract } from './bounded-revision-snapshot';
import type { BrowserReaderState } from './reader/types';
import { prepareBrowserReaderRevisionFonts } from './resources';
import { captureBrowserReaderCandidateHostFontMetrics } from './bounded-font-geometry';
import type { HostFontVerticalMetricSample } from './font-metrics';
import { boundedSnapshotRevisionHandle } from './bounded-revision-result';

interface BrowserReaderFontGeometryPublicationInput extends BrowserReaderBoundedSnapshotCommitContract {
  readonly superseded?: Promise<void> | undefined;
}

interface PreparedPublicationBase {
  readonly rollbackFonts: () => void;
}

export interface PreparedHorizontalFontGeometryReplacement extends PreparedPublicationBase {
  readonly kind: 'horizontalFontGeometryReplacement';
}

export interface PreparedVerticalFontGeometryCalibration extends PreparedPublicationBase {
  readonly kind: 'verticalFontGeometryCalibration';
  readonly samples: readonly HostFontVerticalMetricSample[];
}

export interface PreparedRevisionPublication extends PreparedPublicationBase {
  readonly kind: 'revisionPublication';
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

export type PreparedFontGeometryPublication =
  | PreparedHorizontalFontGeometryReplacement
  | PreparedVerticalFontGeometryCalibration
  | PreparedRevisionPublication;

type BrowserReaderFontVerticalMetricDemands = NonNullable<
  BrowserReaderRevisionResult['bundle']['fontVerticalMetricDemands']
>;

export function claimVerticalMetricCalibrationSamples(
  progressKeys: Set<string>,
  snapshot: BrowserReaderBoundedSnapshot,
  samples: readonly HostFontVerticalMetricSample[],
): readonly HostFontVerticalMetricSample[] {
  const pending = samples.filter(
    (sample) => !progressKeys.has(verticalMetricProgressKey(snapshot, sample)),
  );
  for (const sample of pending) {
    progressKeys.add(verticalMetricProgressKey(snapshot, sample));
  }
  return pending;
}

export async function prepareBrowserReaderFontGeometryPublication(
  state: BrowserReaderState,
  input: BrowserReaderFontGeometryPublicationInput,
  result: BrowserReaderRevisionResult,
  isEligible: () => boolean,
): Promise<PreparedFontGeometryPublication | undefined> {
  const demands = result.bundle.fontVerticalMetricDemands ?? [];
  const pinned = state.pinnedFonts.summary.faces.length > 0;
  const publicationFontsReady = await preparePublicationFonts(
    state,
    input,
    result,
    pinned,
    demands.length > 0,
    isEligible,
  );
  if (!isEligible()) return undefined;
  const rollbackFonts = await prepareControllerOwnedRevisionFonts(
    state,
    input.owner.worker,
    result.bundle,
    isEligible,
  );
  if (!rollbackFonts) return undefined;
  return capturePublication(
    state,
    input,
    result,
    demands,
    pinned,
    publicationFontsReady,
    isEligible,
    rollbackFonts,
  );
}

async function preparePublicationFonts(
  state: BrowserReaderState,
  input: BrowserReaderFontGeometryPublicationInput,
  result: BrowserReaderRevisionResult,
  pinned: boolean,
  hasVerticalMetricDemands: boolean,
  isEligible: () => boolean,
): Promise<boolean> {
  if (pinned) return hasVerticalMetricDemands;
  return prepareBrowserReaderRevisionFonts(
    state,
    input.owner.worker,
    boundedSnapshotRevisionHandle(input.snapshot),
    isEligible,
    result.bundle.fontFamilies,
  );
}

async function capturePublication(
  state: BrowserReaderState,
  input: BrowserReaderFontGeometryPublicationInput,
  result: BrowserReaderRevisionResult,
  demands: BrowserReaderFontVerticalMetricDemands,
  pinned: boolean,
  publicationFontsReady: boolean,
  isEligible: () => boolean,
  rollbackFonts: () => void,
): Promise<PreparedFontGeometryPublication | undefined> {
  try {
    const captured = captureBrowserReaderCandidateHostFontMetrics(
      state,
      demands,
      pinned,
      publicationFontsReady,
    );
    if (captured.horizontalMetricsChanged) {
      return { kind: 'horizontalFontGeometryReplacement', rollbackFonts };
    }
    if (captured.demandedVerticalMetricSamples.length > 0) {
      return {
        kind: 'verticalFontGeometryCalibration',
        rollbackFonts,
        samples: captured.demandedVerticalMetricSamples,
      };
    }
    return await preparePublicationFrame(state, input, result, isEligible, rollbackFonts);
  } catch (error) {
    rollbackFonts();
    throw error;
  }
}

async function preparePublicationFrame(
  state: BrowserReaderState,
  input: BrowserReaderFontGeometryPublicationInput,
  result: BrowserReaderRevisionResult,
  isEligible: () => boolean,
  rollbackFonts: () => void,
): Promise<PreparedRevisionPublication | undefined> {
  // Missing browser font boxes only reduce caret/selection precision. Rust
  // retains a run-bounds fallback, so an unmeasurable descriptor must not
  // block pagination or paint publication.
  const commitFrame = await prepareControllerOwnedBrowserReaderCommitFrame(
    state,
    result,
    input.superseded,
  );
  if (commitFrame && isEligible()) {
    return { kind: 'revisionPublication', rollbackFonts, commitFrame };
  }
  rollbackFonts();
  return undefined;
}

function verticalMetricProgressKey(
  snapshot: BrowserReaderBoundedSnapshot,
  sample: HostFontVerticalMetricSample,
): string {
  return JSON.stringify([
    snapshot.revision.revisionId,
    snapshot.revision.knownExtent.pageCount,
    verticalMetricSampleKey(sample),
  ]);
}

function verticalMetricSampleKey(sample: HostFontVerticalMetricSample): string {
  return JSON.stringify([
    asciiLowerCase(sample.fontFamily.trim()),
    sample.fontStyle,
    sample.fontWeight,
    sample.fontSizePx,
  ]);
}

function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => character.toLowerCase());
}
