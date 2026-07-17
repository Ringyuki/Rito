import type { ReaderDocumentSourceSpan, ReaderLocator, ReaderSourcePoint } from '../../reader';
import type { CoreSourceLocator, CoreTextSourceSpan } from './core-contracts';

export function copyAndValidateTextSourceSpan(
  span: CoreTextSourceSpan,
  locator: CoreSourceLocator | undefined,
  start: ReaderLocator,
  end: ReaderLocator,
): ReaderDocumentSourceSpan {
  const copy = {
    start: { href: span.start.href, sourcePoint: copySourcePoint(span.start.sourcePoint) },
    end: { href: span.end.href, sourcePoint: copySourcePoint(span.end.sourcePoint) },
  };
  requireEndpointIdentity(copy, start, end);
  requireCompatibleLocator(copy, locator);
  return copy;
}

function requireEndpointIdentity(
  span: ReaderDocumentSourceSpan,
  start: ReaderLocator,
  end: ReaderLocator,
): void {
  if (
    !start.sourcePoint ||
    !end.sourcePoint ||
    span.start.href !== start.href ||
    span.end.href !== end.href ||
    !sameSourcePoint(span.start.sourcePoint, start.sourcePoint) ||
    !sameSourcePoint(span.end.sourcePoint, end.sourcePoint)
  ) {
    throw new Error('Reader text range source span does not match its normalized endpoints');
  }
}

function requireCompatibleLocator(
  span: ReaderDocumentSourceSpan,
  locator: CoreSourceLocator | undefined,
): void {
  if (locator === undefined) {
    if (span.start.href === span.end.href) {
      throw new Error('Reader same-resource text range omitted its compatible source locator');
    }
    return;
  }
  const range = locator.sourceRange;
  if (
    span.start.href !== span.end.href ||
    locator.href !== span.start.href ||
    !range ||
    locator.sourcePoint !== undefined ||
    locator.anchorId !== undefined ||
    locator.progression !== undefined ||
    !sameSourcePoint(range.start, span.start.sourcePoint) ||
    !sameSourcePoint(range.end, span.end.sourcePoint)
  ) {
    throw new Error('Reader text range source locator does not match its source span');
  }
}

function copySourcePoint(point: ReaderSourcePoint): ReaderSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
}

function sameSourcePoint(left: ReaderSourcePoint, right: ReaderSourcePoint): boolean {
  return (
    left.textOffset === right.textOffset &&
    left.nodePath.length === right.nodePath.length &&
    left.nodePath.every((part, index) => part === right.nodePath[index])
  );
}
