import type { ReaderLocator } from '../../reader';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import { lowerReaderLocatorPrecision } from './locator-precision';
import type { BrowserReaderBoundedSessionOwner } from './reader-session-host';
import { copyReaderLocator } from './reader/interaction-capture';

interface CandidateTargetRequest {
  readonly targetSpreadIndex: number;
  readonly preserveLocator?: ReaderLocator | undefined;
  readonly fallbackOnLocatorFailure?: boolean | undefined;
}

type BoundedStartRequest = Parameters<BrowserReaderBoundedSessionOwner['controller']['start']>[0];
type BoundedStartBase = Omit<BoundedStartRequest, 'targetLocator' | 'targetSpreadIndex'>;
export async function startBrowserReaderCandidateTarget(
  owner: BrowserReaderBoundedSessionOwner,
  request: CandidateTargetRequest,
  base: BoundedStartBase,
): Promise<BrowserReaderBoundedSnapshot> {
  const locator = request.preserveLocator;
  if (!locator) {
    return owner.controller.start({ ...base, targetSpreadIndex: request.targetSpreadIndex });
  }
  let started: Promise<BrowserReaderBoundedSnapshot>;
  try {
    started = owner.controller.start({ ...base, targetLocator: copyReaderLocator(locator) });
  } catch (error) {
    if (!request.fallbackOnLocatorFailure) throw error;
    return startFallbackTarget(owner, request.targetSpreadIndex, base, error);
  }
  let snapshot: BrowserReaderBoundedSnapshot;
  try {
    snapshot = await started;
  } catch (error) {
    if (!request.fallbackOnLocatorFailure) throw error;
    return recoverRejectedInitialLocator(owner, locator, request.targetSpreadIndex, error);
  }
  if (!request.fallbackOnLocatorFailure || !locatorHasNoPage(snapshot)) return snapshot;
  return recoverInitialLocatorProjection(owner, snapshot);
}

function locatorHasNoPage(snapshot: BrowserReaderBoundedSnapshot): boolean {
  return (
    snapshot.target.kind === 'locator' &&
    snapshot.target.resolution.status === 'pending' &&
    snapshot.target.resolution.reason === 'noPageProjection'
  );
}

async function recoverInitialLocatorProjection(
  owner: BrowserReaderBoundedSessionOwner,
  initial: BrowserReaderBoundedSnapshot,
): Promise<BrowserReaderBoundedSnapshot> {
  let snapshot = initial;
  let fallback = lessPreciseLocator(snapshot);
  while (fallback) {
    snapshot = await owner.controller.ensureLocator(fallback);
    if (!locatorHasNoPage(snapshot)) return snapshot;
    fallback = lessPreciseLocator(snapshot);
  }
  throw new Error('Initial locator has no page projection, including its chapter href');
}

function lessPreciseLocator(snapshot: BrowserReaderBoundedSnapshot): ReaderLocator | undefined {
  if (snapshot.target.kind !== 'locator') return undefined;
  return lowerReaderLocatorPrecision(copyReaderLocator(snapshot.target.locator));
}

async function recoverRejectedInitialLocator(
  owner: BrowserReaderBoundedSessionOwner,
  locator: ReaderLocator,
  spreadIndex: number,
  locatorError: unknown,
): Promise<BrowserReaderBoundedSnapshot> {
  let fallback = lowerReaderLocatorPrecision(locator);
  while (fallback) {
    try {
      const snapshot = await owner.controller.ensureLocator(fallback);
      return locatorHasNoPage(snapshot)
        ? await recoverInitialLocatorProjection(owner, snapshot)
        : snapshot;
    } catch {
      fallback = lowerReaderLocatorPrecision(fallback);
    }
  }
  return ensureFallbackTarget(owner, spreadIndex, locatorError);
}

async function startFallbackTarget(
  owner: BrowserReaderBoundedSessionOwner,
  spreadIndex: number,
  base: BoundedStartBase,
  locatorError: unknown,
): Promise<BrowserReaderBoundedSnapshot> {
  try {
    return await owner.controller.start({ ...base, targetSpreadIndex: spreadIndex });
  } catch {
    throw locatorError;
  }
}

async function ensureFallbackTarget(
  owner: BrowserReaderBoundedSessionOwner,
  spreadIndex: number,
  locatorError: unknown,
): Promise<BrowserReaderBoundedSnapshot> {
  try {
    return await owner.controller.ensureSpread(spreadIndex);
  } catch {
    throw locatorError;
  }
}
