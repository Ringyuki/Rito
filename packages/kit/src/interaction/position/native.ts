import type {
  ReaderInteractions,
  ReaderLocator,
  ReaderLocatorResolution,
  ReaderPageReadingAnchor,
} from '@ritojs/core';
import type { PositionLayout, ReadingPosition } from './model';

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
  const spread = layout.spreads[clamped];
  if (!spread) return [];
  return [spread.left?.index, spread.right?.index]
    .filter((pageIndex): pageIndex is number => pageIndex !== undefined)
    .sort((left, right) => left - right);
}

export function withPortableLocator(
  position: ReadingPosition,
  layout: PositionLayout,
): ReadingPosition | undefined {
  if (position.sourceLocator) return position;
  const legacy = position.locator;
  if (!legacy) return undefined;
  const href = legacy.manifestHref ?? layout.manifestHrefMap?.get(legacy.spineIdref);
  if (!href) return undefined;
  return {
    ...position,
    sourceLocator: {
      href,
      ...(legacy.sourcePoint ? { sourcePoint: legacy.sourcePoint } : {}),
      progression: legacy.chapterProgress,
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

function progressForPage(pageIndex: number, layout: PositionLayout): number {
  return layout.pages.length > 0 ? pageIndex / layout.pages.length : 0;
}
