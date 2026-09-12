import type { BrowserReaderRevisionResult } from './core-contracts';
import {
  prepareControllerOwnedBrowserReaderCommitFrame,
  type BrowserReaderPreparedCommitFrame,
} from './revision-commit';
import { prepareControllerOwnedRevisionFonts } from './required-fonts';
import type { BrowserReaderBoundedSnapshotCommitContract } from './bounded-revision-snapshot';
import type { BrowserReaderState } from './reader/types';
import { prepareBrowserReaderRevisionFonts } from './resources';
import { captureBrowserReaderCandidateHostFontMetrics } from './bounded-font-geometry';
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

export interface PreparedRevisionPublication extends PreparedPublicationBase {
  readonly kind: 'revisionPublication';
  readonly commitFrame: BrowserReaderPreparedCommitFrame;
}

export type PreparedFontGeometryPublication =
  | PreparedHorizontalFontGeometryReplacement
  | PreparedRevisionPublication;

export async function prepareBrowserReaderFontGeometryPublication(
  state: BrowserReaderState,
  input: BrowserReaderFontGeometryPublicationInput,
  result: BrowserReaderRevisionResult,
  isEligible: () => boolean,
): Promise<PreparedFontGeometryPublication | undefined> {
  const pinned = state.pinnedFonts.summary.faces.length > 0;
  const publicationFontsReady = await preparePublicationFonts(
    state,
    input,
    result,
    pinned,
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
  isEligible: () => boolean,
): Promise<boolean> {
  // A pinned policy shapes with the engine's own faces; the host never
  // measures publication fonts for it.
  if (pinned) return false;
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
  pinned: boolean,
  publicationFontsReady: boolean,
  isEligible: () => boolean,
  rollbackFonts: () => void,
): Promise<PreparedFontGeometryPublication | undefined> {
  try {
    const captured = captureBrowserReaderCandidateHostFontMetrics(
      state,
      pinned,
      publicationFontsReady,
    );
    if (captured.horizontalMetricsChanged) {
      return { kind: 'horizontalFontGeometryReplacement', rollbackFonts };
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
