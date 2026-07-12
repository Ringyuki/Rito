import type { ReaderLocator, ReaderSourcePoint } from '../../../reader';
import type { CoreSourceLocator } from '../core-contracts';

export function copyReaderLocator(locator: ReaderLocator | CoreSourceLocator): ReaderLocator {
  return {
    href: locator.href,
    ...(locator.anchorId !== undefined ? { anchorId: locator.anchorId } : {}),
    ...(locator.sourcePoint ? { sourcePoint: copyReaderSourcePoint(locator.sourcePoint) } : {}),
    ...(locator.sourceRange
      ? {
          sourceRange: {
            start: copyReaderSourcePoint(locator.sourceRange.start),
            end: copyReaderSourcePoint(locator.sourceRange.end),
          },
        }
      : {}),
    ...(locator.progression !== undefined ? { progression: locator.progression } : {}),
  };
}

export function copyReaderSourcePoint(point: ReaderSourcePoint): ReaderSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
}
