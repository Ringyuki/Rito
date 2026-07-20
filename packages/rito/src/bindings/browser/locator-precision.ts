import type { ReaderLocator } from '../../reader';
import type { BrowserReaderBoundedSnapshot } from './core-contracts';
import { copyReaderLocator } from './reader/interaction-capture';

export type ReaderLocatorTargetOutcome =
  | { readonly kind: 'snapshot'; readonly snapshot: BrowserReaderBoundedSnapshot }
  | { readonly kind: 'error'; readonly error: unknown };

/** Drop one selector while preserving the locator's next-best durable chapter identity. */
export function lowerReaderLocatorPrecision(locator: ReaderLocator): ReaderLocator | undefined {
  if (locator.sourceRange) {
    const { sourceRange: _sourceRange, ...fallback } = locator;
    return fallback;
  }
  if (locator.sourcePoint) {
    const { sourcePoint: _sourcePoint, ...fallback } = locator;
    return fallback;
  }
  if (locator.anchorId) {
    const { anchorId: _anchorId, ...fallback } = locator;
    return fallback;
  }
  if (locator.progression !== undefined) {
    const { progression: _progression, ...fallback } = locator;
    return fallback;
  }
  return undefined;
}

export function fallbackReaderLocatorForOutcome(
  locator: ReaderLocator | undefined,
  outcome: ReaderLocatorTargetOutcome,
): ReaderLocator | undefined {
  if (!locator) return undefined;
  if (outcome.kind === 'error') return lowerReaderLocatorPrecision(locator);
  const { target } = outcome.snapshot;
  if (
    target.kind !== 'locator' ||
    target.resolution.status !== 'pending' ||
    target.resolution.reason !== 'noPageProjection'
  ) {
    return undefined;
  }
  return lowerReaderLocatorPrecision(copyReaderLocator(target.locator));
}
