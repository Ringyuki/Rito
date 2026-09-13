import type {
  ReaderInteractions,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageReadingAnchor,
} from '@ritojs/core';
import { progressForPage, type PositionLayout, type ReadingPosition } from './model';

export type PositionInteractions = ReaderInteractions;
export type PositionLocatorNavigator = (
  locator: ReaderLocator,
  signal: AbortSignal,
) => Promise<ReaderLocatorResolution | undefined>;
export type NativePositionInteractions = PositionInteractions &
  Required<Pick<PositionInteractions, 'getPageReadingAnchor'>>;

export function supportsNativePosition(
  interactions: PositionInteractions | undefined,
): interactions is NativePositionInteractions {
  return typeof interactions?.getPageReadingAnchor === 'function';
}

export function spreadPageIndexes(layout: PositionLayout, spreadIndex: number): readonly number[] {
  const clamped = Math.max(0, Math.min(spreadIndex, layout.spreads.length - 1));
  return layout.spreads[clamped]?.pageIndexes ?? [];
}

export async function captureNativeSpreadPosition(
  getLayout: () => PositionLayout,
  spreadIndex: number,
  interactions: NativePositionInteractions,
  isCurrent: () => boolean,
  publish: (position: ReadingPosition) => void,
): Promise<void> {
  const pageIndexes = spreadPageIndexes(getLayout(), spreadIndex);
  for (const pageIndex of pageIndexes) {
    const anchor = await interactions.getPageReadingAnchor(pageIndex);
    if (!isCurrent() || anchor === undefined) return;
    if (anchor.status === 'resolved') {
      publish(positionFromAnchor(anchor, getLayout()));
      return;
    }
  }
}

/** Give an older spine-relative position a source locator so it can be resolved natively. */
export function withPortableLocator(
  position: ReadingPosition,
  layout: PositionLayout,
): ReadingPosition | undefined {
  if (position.sourceLocator) return position;
  const spineLocator = position.locator;
  if (!spineLocator) return undefined;
  const href = spineLocator.manifestHref ?? layout.manifestHrefMap?.get(spineLocator.spineIdref);
  if (!href) return undefined;
  return {
    ...position,
    sourceLocator: {
      href,
      ...(spineLocator.sourcePoint ? { sourcePoint: spineLocator.sourcePoint } : {}),
      progression: spineLocator.chapterProgress,
    },
  };
}

export function positionFromAnchor(
  anchor: Extract<ReaderPageReadingAnchor, { readonly status: 'resolved' }>,
  layout: PositionLayout,
): ReadingPosition {
  return {
    sourceLocator: anchor.locator,
    projection: { spreadIndex: anchor.spreadIndex, pageIndex: anchor.pageIndex },
    progress: progressForPage(anchor.pageIndex, layout),
    timestamp: Date.now(),
  };
}

export function positionFromResolution(
  position: ReadingPosition,
  resolution: Extract<ReaderLocatorResolution, { readonly status: 'resolved' }>,
  layout: PositionLayout,
): ReadingPosition {
  return {
    ...position,
    sourceLocator: resolution.locator,
    projection: { spreadIndex: resolution.spreadIndex, pageIndex: resolution.pageIndex },
    progress: progressForPage(resolution.pageIndex, layout),
    timestamp: Date.now(),
  };
}
